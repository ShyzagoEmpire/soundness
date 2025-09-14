import { Client } from 'discord.js-selfbot-v13';
import { AccountData, ClientOperationResult, ChannelContext } from '../types';
import { config } from '../config/environment';
import { Utils, ErrorHandler } from '../utils';

/**
 * Manages Discord client lifecycle and operations
 */
export class DiscordClientManager {
  private readonly LOGIN_TIMEOUT = 30000;
  private readonly STANDARD_DELAY = 2500;

  /**
   * Executes operation with managed Discord client lifecycle
   */
  async withClient<T>(
    token: string, 
    operation: (client: Client) => Promise<T>
  ): Promise<ClientOperationResult<T>> {
    const client = new Client();
    
    try {
      await this.loginWithTimeout(client, token);
      await Utils.delay(this.STANDARD_DELAY);
      
      const data = await operation(client);
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    } finally {
      await this.safeDestroy(client);
    }
  }

  /**
   * Gets available channels for account execution
   */
  getExecutableChannels(account: AccountData): ChannelContext[] {
    const channels: ChannelContext[] = [
      {
        id: config.GENERAL_CHANNEL_ID,
        name: 'general',
        hasPermission: true // General channel is always accessible for confirmed accounts
      }
    ];

    if (config.FALLBACK_CHANNEL_ID) {
      channels.push({
        id: config.FALLBACK_CHANNEL_ID,
        name: 'fallback',
        hasPermission: account.executableChannel === 'fallback' || account.executableChannel === null
      });
    }

    return channels;
  }

  /**
   * Executes slash command with automatic retry and channel fallback
   */
  async executeSlashCommand(
    account: AccountData, 
    commandName: string
  ): Promise<ClientOperationResult<any>> {
    return this.withClient(account.token, async (client) => {
      const channels = this.getExecutableChannels(account);
      const preferredChannel = channels.find(c => 
        (account.executableChannel === 'general' && c.name === 'general') ||
        (account.executableChannel === 'fallback' && c.name === 'fallback')
      ) || channels[0];

      return await this.executeSlashCommandInternal(client, preferredChannel.id, commandName);
    });
  }

  /**
   * Validates account with comprehensive channel testing
   */
  async validateAccount(token: string): Promise<ClientOperationResult<AccountData | null>> {
    return this.withClient(token, async (client) => {
      const user = client.user;
      if (!user) throw new Error('User not available after login');

      ErrorHandler.log(`Logged in as: ${user.username}`, 'Validation');

      // Initial validation (Guild & Role checks)
      const baseAccount = await this.performInitialValidation(client, user);
      if (!baseAccount) {
        ErrorHandler.log('Initial validation failed - token will be discarded', 'Validation');
        return null;
      }

      // Test channels to determine executable channel
      const channelTestResult = await this.testChannelAccess(client, baseAccount);
      return channelTestResult;
    });
  }

  /**
   * Revalidates pending account
   */
  async revalidatePendingAccount(account: AccountData): Promise<ClientOperationResult<AccountData | null>> {
    if (!config.FALLBACK_CHANNEL_ID) {
      return { success: true, data: account }; // Keep as pending if no fallback configured
    }

    return this.withClient(account.token, async (client) => {
      // Check if account now has permission for fallback channel
      const hasPermission = await this.checkFallbackChannelPermission(client, account.roles);
      if (!hasPermission) {
        ErrorHandler.log(`${account.username} still has no fallback channel permission`, 'Revalidation');
        return account; // Keep as pending
      }

      // Try executing /profile in fallback channel
      try {
        const response = await this.executeWithRetry(async () => {
          return await this.executeSlashCommandInternal(client, config.FALLBACK_CHANNEL_ID!, 'profile');
        }, 2);

        if (response) {
          return this.processChannelTestResponse(response, account, 'fallback');
        }
      } catch (error) {
        ErrorHandler.log(`${account.username} fallback validation failed - removing account`, 'Revalidation');
        return null; // Account should be removed
      }

      return account; // Keep as pending
    });
  }

  /**
   * Performs initial Discord validation (guild membership and roles)
   */
  private async performInitialValidation(
    client: Client, 
    user: any
  ): Promise<Omit<AccountData, 'stats' | 'status' | 'executableChannel'> | null> {
    try {
      const guild = await Utils.withTimeout(
        client.guilds.fetch(config.GUILD_ID),
        10000,
        'Guild fetch timeout'
      );

      ErrorHandler.log(`Found guild: ${guild.name}`, 'Validation');

      const member = await Utils.withTimeout(
        guild.members.fetch(user.id),
        10000,
        'Member fetch timeout'
      );

      ErrorHandler.log('Checking roles...', 'Validation');
      const userRoles = member.roles.cache.map(role => role.id);
      ErrorHandler.log(`User has ${userRoles.length} roles`, 'Validation');

      const hasRequiredRoles = config.REQUIRED_ROLES.every(roleId => {
        const hasRole = userRoles.includes(roleId);
        if (!hasRole) {
          ErrorHandler.log(`Missing required role: ${roleId}`, 'Validation');
        }
        return hasRole;
      });

      const hasSpecialRole = config.SPECIAL_ROLES.some(roleId => {
        const hasRole = userRoles.includes(roleId);
        if (hasRole) {
          ErrorHandler.log(`Has special role: ${roleId}`, 'Validation');
        }
        return hasRole;
      });

      if (!hasRequiredRoles || !hasSpecialRole) {
        ErrorHandler.log('Role requirements not met', 'Validation');
        return null;
      }

      ErrorHandler.log('All role requirements met', 'Validation');

      return {
        id: user.id,
        token: client.token!,
        username: user.username,
        globalName: user.globalName || user.username,
        roles: member.roles.cache.map(role => ({
          id: role.id,
          name: role.name
        }))
      };
    } catch (error) {
      ErrorHandler.warn(`Initial validation failed: ${error}`, 'Validation');
      return null;
    }
  }

  /**
   * Tests channel access to determine executable channel
   */
  private async testChannelAccess(
    client: Client, 
    baseAccount: Omit<AccountData, 'stats' | 'status' | 'executableChannel'>
  ): Promise<AccountData | null> {
    // Try general channel first
    try {
      ErrorHandler.log('Testing /profile command in general channel...', 'ChannelTest');
      const generalResponse = await this.executeWithRetry(async () => {
        return await this.executeSlashCommandInternal(client, config.GENERAL_CHANNEL_ID, 'profile');
      }, 2);

      if (generalResponse) {
        const result = this.processChannelTestResponse(generalResponse, baseAccount, 'general');
        if (result) {
          ErrorHandler.log('General channel access confirmed', 'ChannelTest');
          return result;
        }
      }
    } catch (error) {
      ErrorHandler.warn('General channel failed, trying fallback logic...', 'ChannelTest');
    }

    // Try fallback channel if available
    if (!config.FALLBACK_CHANNEL_ID) {
      ErrorHandler.log('No fallback channel configured', 'ChannelTest');
      return {
        ...baseAccount,
        stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
        status: 'pending',
        executableChannel: null
      };
    }

    // Check permissions for fallback channel
    const hasPermission = await this.checkFallbackChannelPermission(client, baseAccount.roles);
    if (!hasPermission) {
      ErrorHandler.log('No permission for fallback channel', 'ChannelTest');
      return {
        ...baseAccount,
        stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
        status: 'pending',
        executableChannel: null
      };
    }

    // Test fallback channel
    try {
      ErrorHandler.log('Testing /profile command in fallback channel...', 'ChannelTest');
      const fallbackResponse = await this.executeWithRetry(async () => {
        return await this.executeSlashCommandInternal(client, config.FALLBACK_CHANNEL_ID!, 'profile');
      }, 2);

      if (fallbackResponse) {
        const result = this.processChannelTestResponse(fallbackResponse, baseAccount, 'fallback');
        if (result) {
          ErrorHandler.log('Fallback channel access confirmed', 'ChannelTest');
          return result;
        }
      }
    } catch (error) {
      ErrorHandler.log('Fallback channel also failed', 'ChannelTest');
    }

    // If all attempts failed, discard token
    ErrorHandler.log('All validation attempts failed - token will be discarded', 'ChannelTest');
    return null;
  }

  /**
   * Processes channel test response and creates AccountData
   */
  private processChannelTestResponse(
    response: any,
    baseAccount: Omit<AccountData, 'stats' | 'status' | 'executableChannel'>,
    channelType: 'general' | 'fallback'
  ): AccountData | null {
    // This would use MessageAnalyzer from utils
    const isAccessRestricted = response.embeds?.[0]?.title?.includes('Access Restricted') || false;
    
    if (isAccessRestricted) {
      ErrorHandler.log(`Bot access restricted but Discord API works fine`, 'ChannelTest');
      return {
        ...baseAccount,
        stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
        status: 'confirmed',
        executableChannel: channelType
      };
    } else {
      const stats = this.parseProfileStats(response);
      if (stats) {
        return {
          ...baseAccount,
          stats,
          status: 'confirmed',
          executableChannel: channelType
        };
      }
    }

    return null;
  }

  /**
   * Parses profile statistics from bot response
   */
  private parseProfileStats(message: any): any {
    if (message.embeds?.[0]) {
      const embed = message.embeds[0];
      if (embed.title?.includes('Profile')) {
        const fields = embed.fields || [];
        
        return {
          played: Utils.extractNumberFromField(fields, /games?\s+played/i) || 0,
          wins: Utils.extractNumberFromField(fields, /wins?/i) || 0,
          winRate: Utils.extractNumberFromField(fields, /win\s+rate/i) || 0,
          badgesEarned: Utils.extractNumberFromField(fields, /badges?/i) || 0
        };
      }
    }
    
    return null;
  }

  /**
   * Checks if account has VIEW_CHANNEL permission for fallback channel
   */
  private async checkFallbackChannelPermission(
    client: Client, 
    userRoles: Array<{ id: string; name: string }>
  ): Promise<boolean> {
    if (!config.FALLBACK_CHANNEL_ID) return false;

    try {
      const channel = await client.channels.fetch(config.FALLBACK_CHANNEL_ID);
      if (!channel || !('guild' in channel)) return false;

      const guild = channel.guild;
      const member = await guild.members.fetch(client.user!.id);
      
      const specialRoleIds = config.SPECIAL_ROLES;
      const userSpecialRoles = userRoles.filter(role => specialRoleIds.includes(role.id));
      
      for (const userRole of userSpecialRoles) {
        const role = guild.roles.cache.get(userRole.id);
        if (role) {
          const permissions = channel.permissionsFor(role);
          if (permissions?.has('VIEW_CHANNEL')) {
            ErrorHandler.log(`Role ${role.name} grants fallback channel access`, 'Permission');
            return true;
          }
        }
      }

      ErrorHandler.log('No special roles grant fallback channel access', 'Permission');
      return false;
    } catch (error) {
      ErrorHandler.warn(`Error checking fallback channel permission: ${error}`, 'Permission');
      return false;
    }
  }

  /**
   * Executes slash command in specific channel
   */
  private async executeSlashCommandInternal(
    client: Client, 
    channelId: string, 
    commandName: string
  ): Promise<any> {
    const commandsResponse = await Utils.withTimeout(
      (client as any).api.applications(config.BOT_ID).commands.get(),
      10000,
      'Commands fetch timeout'
    );

    const commands = commandsResponse as Array<{
      id: string;
      name: string;
      version: string;
      type: number;
    }>;

    const command = commands.find((cmd) => cmd.name === commandName);
    if (!command) throw new Error(`${commandName} command not found`);

    await (client as any).api.interactions.post({
      data: {
        type: 2,
        application_id: config.BOT_ID,
        guild_id: config.GUILD_ID,
        channel_id: channelId,
        session_id: (client as any).sessionId,
        data: {
          version: command.version,
          id: command.id,
          name: command.name,
          type: command.type,
          options: [],
          attachments: []
        },
        nonce: Utils.generateNonce()
      }
    });

    return await this.waitForBotResponseWithUpdates(client, channelId, config.BOT_ID);
  }

  /**
   * Executes action with retry logic
   */
  private async executeWithRetry<T>(action: () => Promise<T>, retries: number = 2): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await action();
      } catch (error) {
        ErrorHandler.warn(`Attempt ${i + 1} failed. Retrying...`, 'Retry');
        if (i === retries - 1) throw error;
      }
    }
    throw new Error('All retry attempts exhausted');
  }

  /**
   * Waits for bot response with message update handling
   */
  private async waitForBotResponseWithUpdates(
    client: any, 
    channelId: string, 
    botId: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for bot response'));
      }, 30000);

      let lastMessage: any = null;

      const cleanup = () => {
        clearTimeout(timeout);
        client.removeListener('messageCreate', messageHandler);
        client.removeListener('messageUpdate', updateHandler);
      };

      const messageHandler = (message: any) => {
        if (message.channel.id === channelId && message.author.id === botId) {
          lastMessage = message;
          
          if (message.flags?.bitfield === 192) {
            return; // Loading message, wait for update
          }
          
          if (message.flags?.bitfield === 64 || !message.flags?.bitfield) {
            cleanup();
            resolve(message);
          }
        }
      };

      const updateHandler = (oldMessage: any, newMessage: any) => {
        if (newMessage.channel.id === channelId && 
            newMessage.author.id === botId && 
            lastMessage && 
            lastMessage.id === newMessage.id) {
          
          if (oldMessage.flags?.bitfield === 192 && newMessage.flags?.bitfield === 64) {
            cleanup();
            resolve(newMessage);
          }
        }
      };

      client.on('messageCreate', messageHandler);
      client.on('messageUpdate', updateHandler);
    });
  }

  /**
   * Logs in with timeout
   */
  private async loginWithTimeout(client: Client, token: string): Promise<void> {
    await Utils.withTimeout(
      client.login(token),
      this.LOGIN_TIMEOUT,
      'Login timeout'
    );
  }

  /**
   * Safely destroys client
   */
  private async safeDestroy(client: Client): Promise<void> {
    try {
      if (client.user) {
        await client.destroy();
      }
    } catch (error) {
      ErrorHandler.warn(`Error during cleanup: ${error}`, 'Cleanup');
    }
  }
}