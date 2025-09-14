import { Client } from 'discord.js-selfbot-v13';
import { AccountData, GameInfo } from '../types';
import { config } from '../config/environment';

/**
 * Handles Discord API interactions with enhanced validation and clean logging
 */
export class DiscordClient {
  private readonly LOGIN_TIMEOUT = 30000;

  /**
   * Helper function to execute actions with retry logic
   */
  private async executeWithRetry<T>(action: () => Promise<T>, retries: number = 2): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await action();
      } catch (error) {
        console.log(`   ⚠️ Attempt ${i + 1} failed. Retrying...`);
        if (i === retries - 1) throw error;
      }
    }
    throw new Error('All retry attempts exhausted');
  }

  /**
   * Validates Discord token with enhanced access restriction handling
   */
  public async validateAccount(token: string): Promise<AccountData | null> {
    const client = new Client();
    
    try {
      console.log('   🔐 Attempting login...');
      
      await Promise.race([
        client.login(token),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Login timeout')), this.LOGIN_TIMEOUT)
        )
      ]);
      console.log('   ✅ Login successful');

      await this.delay(2000);

      const user = client.user;
      if (!user) {
        throw new Error('User not available after login');
      }

      console.log(`   👤 Logged in as: ${user.username}`);

      // Initial validation (Guild & Role checks)
      const validationResult = await this.performInitialValidation(client, user);
      if (!validationResult) {
        console.log('   ❌ Initial validation failed - token will be discarded');
        return null;
      }

      // Try executing /profile in general channel with retry
      console.log('   🎯 Testing /profile command in general channel...');
      try {
        const profileResponse = await this.executeWithRetry(async () => {
          return await this.executeSlashCommandInternal(client, config.GENERAL_CHANNEL_ID, 'profile');
        }, 2);

        if (profileResponse) {
          if (this.isAccessRestricted(profileResponse)) {
            // Bot restricts access due to role, but Discord API works fine
            const requiredRole = this.extractRequiredRole(profileResponse);
            const userRole = this.getUserSpecialRole(validationResult.roles);
            console.log(`   🔒 Bot access restricted: Your role is ${userRole}, but ${requiredRole} role is required`);
            console.log('   ✅ General channel access confirmed (bot role restriction)');
            
            return {
              ...validationResult,
              stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
              status: 'confirmed',
              executableChannel: 'general'
            };
          } else {
            const stats = this.parseProfileStats(profileResponse);
            if (stats) {
              console.log('   ✅ General channel access confirmed');
              return {
                ...validationResult,
                stats,
                status: 'confirmed',
                executableChannel: 'general'
              };
            }
          }
        }
      } catch (error) {
        console.log('   ⚠️ General channel failed, trying fallback logic...');
      }

      // Fallback Channel Logic
      if (!config.FALLBACK_CHANNEL_ID) {
        console.log('   ❌ No fallback channel configured');
        return {
          ...validationResult,
          stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
          status: 'pending',
          executableChannel: null
        };
      }

      // Check permissions for fallback channel
      const hasPermission = await this.checkFallbackChannelPermission(client, validationResult.roles);
      if (!hasPermission) {
        console.log('   ❌ No permission for fallback channel');
        return {
          ...validationResult,
          stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
          status: 'pending',
          executableChannel: null
        };
      }

      // Try executing /profile in fallback channel with retry
      console.log('   🎯 Testing /profile command in fallback channel...');
      try {
        const fallbackResponse = await this.executeWithRetry(async () => {
          return await this.executeSlashCommandInternal(client, config.FALLBACK_CHANNEL_ID!, 'profile');
        }, 2);

        if (fallbackResponse) {
          if (this.isAccessRestricted(fallbackResponse)) {
            // Bot restricts access due to role, but Discord API works fine
            const requiredRole = this.extractRequiredRole(fallbackResponse);
            const userRole = this.getUserSpecialRole(validationResult.roles);
            console.log(`   🔒 Bot access restricted: Your role is ${userRole}, but ${requiredRole} role is required`);
            console.log('   ✅ Fallback channel access confirmed (bot role restriction)');
            
            return {
              ...validationResult,
              stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
              status: 'confirmed',
              executableChannel: 'fallback'
            };
          } else {
            const stats = this.parseProfileStats(fallbackResponse);
            if (stats) {
              console.log('   ✅ Fallback channel access confirmed');
              return {
                ...validationResult,
                stats,
                status: 'confirmed',
                executableChannel: 'fallback'
              };
            }
          }
        }
      } catch (error) {
        console.log('   ❌ Fallback channel also failed');
      }

      // If all attempts failed, discard token
      console.log('   ❌ All validation attempts failed - token will be discarded');
      return null;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`   ❌ Validation failed: ${errorMessage}`);
      
      if (errorMessage.includes('Incorrect login details') || errorMessage.includes('401')) {
        console.log('   💡 Hint: Check if your Discord token is valid and not expired');
      } else if (errorMessage.includes('timeout')) {
        console.log('   💡 Hint: Network issue or Discord API is slow');
      } else if (errorMessage.includes('Missing Access')) {
        console.log('   💡 Hint: Token may not have necessary permissions');
      }
      
      return null;
    } finally {
      try {
        if (client.user) {
          await client.destroy();
        }
      } catch (destroyError) {
        console.log('   ⚠️ Error during cleanup:', destroyError);
      }
    }
  }

  /**
   * Revalidates pending accounts by checking fallback channel permissions
   */
  public async revalidatePendingAccount(account: AccountData): Promise<AccountData | null> {
    if (!config.FALLBACK_CHANNEL_ID) {
      return account; // Keep as pending if no fallback configured
    }

    const client = new Client();
    
    try {
      await client.login(account.token);
      await this.delay(2000);

      // Check if account now has permission for fallback channel
      const hasPermission = await this.checkFallbackChannelPermission(client, account.roles);
      if (!hasPermission) {
        console.log(`   ❌ ${account.username} still has no fallback channel permission`);
        return account; // Keep as pending
      }

      // Try executing /profile in fallback channel
      console.log(`   🎯 Testing fallback channel for ${account.username}...`);
      try {
        const response = await this.executeWithRetry(async () => {
          return await this.executeSlashCommandInternal(client, config.FALLBACK_CHANNEL_ID!, 'profile');
        }, 2);

        if (response) {
          if (this.isAccessRestricted(response)) {
            // Bot restricts access due to role, but Discord API works fine
            const requiredRole = this.extractRequiredRole(response);
            const userRole = this.getUserSpecialRole(account.roles);
            console.log(`   🔒 ${account.username} bot access restricted: Your role is ${userRole}, but ${requiredRole} role is required`);
            console.log(`   ✅ ${account.username} confirmed via fallback channel (bot role restriction)`);
            return {
              ...account,
              stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
              status: 'confirmed',
              executableChannel: 'fallback'
            };
          } else {
            const stats = this.parseProfileStats(response);
            if (stats) {
              console.log(`   ✅ ${account.username} confirmed via fallback channel`);
              return {
                ...account,
                stats,
                status: 'confirmed',
                executableChannel: 'fallback'
              };
            }
          }
        }
      } catch (error) {
        console.log(`   ❌ ${account.username} fallback validation failed - removing account`);
        return null; // Account should be removed
      }

      return account; // Keep as pending
    } catch (error) {
      console.log(`   ❌ ${account.username} revalidation error: ${error}`);
      return account; // Keep as pending
    } finally {
      try {
        if (client.user) {
          await client.destroy();
        }
      } catch (destroyError) {
        console.log('   ⚠️ Error during cleanup:', destroyError);
      }
    }
  }

  /**
   * Performs initial validation (guild membership and roles)
   */
  private async performInitialValidation(client: Client, user: any): Promise<Omit<AccountData, 'stats' | 'status' | 'executableChannel'> | null> {
    const guild = await this.withTimeout(
      client.guilds.fetch(config.GUILD_ID),
      10000,
      'Guild fetch timeout'
    ).catch(() => null);

    if (!guild) {
      console.log('   ⚠️ User not in guild or cannot access guild');
      return null;
    }

    console.log(`   ✅ Found guild: ${guild.name}`);

    const member = await this.withTimeout(
      guild.members.fetch(user.id),
      10000,
      'Member fetch timeout'
    ).catch(() => null);

    if (!member) {
      console.log('   ⚠️ Could not fetch member data');
      return null;
    }

    console.log('   🎭 Checking roles...');
    const userRoles = member.roles.cache.map(role => role.id);
    console.log(`   📋 User has ${userRoles.length} roles`);

    const hasRequiredRoles = config.REQUIRED_ROLES.every(roleId => {
      const hasRole = userRoles.includes(roleId);
      if (!hasRole) {
        console.log(`   ❌ Missing required role: ${roleId}`);
      }
      return hasRole;
    });

    const hasSpecialRole = config.SPECIAL_ROLES.some(roleId => {
      const hasRole = userRoles.includes(roleId);
      if (hasRole) {
        console.log(`   ✅ Has special role: ${roleId}`);
      }
      return hasRole;
    });

    if (!hasRequiredRoles || !hasSpecialRole) {
      console.log('   ❌ Role requirements not met');
      return null;
    }

    console.log('   ✅ All role requirements met');

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
  }

  /**
   * Checks if account has VIEW_CHANNEL permission for fallback channel
   */
  private async checkFallbackChannelPermission(client: Client, userRoles: Array<{ id: string; name: string }>): Promise<boolean> {
    if (!config.FALLBACK_CHANNEL_ID) return false;

    try {
      const channel = await client.channels.fetch(config.FALLBACK_CHANNEL_ID);
      if (!channel || !('guild' in channel)) return false;

      const guild = channel.guild;
      const member = await guild.members.fetch(client.user!.id);
      
      // Check if any of the user's special roles grants VIEW_CHANNEL permission
      const specialRoleIds = config.SPECIAL_ROLES;
      const userSpecialRoles = userRoles.filter(role => specialRoleIds.includes(role.id));
      
      for (const userRole of userSpecialRoles) {
        const role = guild.roles.cache.get(userRole.id);
        if (role) {
          const permissions = channel.permissionsFor(role);
          if (permissions?.has('VIEW_CHANNEL')) {
            console.log(`   ✅ Role ${role.name} grants fallback channel access`);
            return true;
          }
        }
      }

      console.log('   ❌ No special roles grant fallback channel access');
      return false;
    } catch (error) {
      console.log(`   ⚠️ Error checking fallback channel permission: ${error}`);
      return false;
    }
  }

  /**
   * Executes Discord slash command and waits for response
   */
  public async executeSlashCommand(account: AccountData, commandName: string): Promise<any> {
    const client = new Client();
    
    try {
      await Promise.race([
        client.login(account.token),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Login timeout')), this.LOGIN_TIMEOUT)
        )
      ]);

      await this.delay(3000);
      const channelId = this.getChannelIdForAccount(account);
      return await this.executeSlashCommandInternal(client, channelId, commandName);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`   ❌ Command execution failed: ${errorMessage}`);
      throw error;
    } finally {
      try {
        if (client.user) {
          await client.destroy();
        }
      } catch (destroyError) {
        console.log('   ⚠️ Error during cleanup:', destroyError);
      }
    }
  }

  /**
   * Internal method to execute slash command in specific channel
   */
  private async executeSlashCommandInternal(client: Client, channelId: string, commandName: string): Promise<any> {
    const commandsResponse = await this.withTimeout(
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
        nonce: this.generateNonce()
      }
    });

    return await this.waitForBotResponseWithUpdates(client, channelId, config.BOT_ID);
  }

  /**
   * Gets the appropriate channel ID for account based on executableChannel
   */
  private getChannelIdForAccount(account: AccountData): string {
    if (account.executableChannel === 'general') {
      return config.GENERAL_CHANNEL_ID;
    } else if (account.executableChannel === 'fallback' && config.FALLBACK_CHANNEL_ID) {
      return config.FALLBACK_CHANNEL_ID;
    }
    throw new Error(`No valid channel configured for account ${account.username}`);
  }

  /**
   * Extracts game information from 8queens bot response
   */
  public extractGameInfo(message: any): GameInfo | null {
    if (!message.embeds || message.embeds.length === 0) return null;

    const embed = message.embeds[0];
    if (!embed || !embed.title?.includes('8 Queens')) return null;

    const gameIdField = embed.fields?.find((f: any) => f.name?.includes('Game ID'));
    if (!gameIdField) return null;

    const gameId = gameIdField.value.replace(/`/g, '').trim();
    const playField = embed.fields?.find((f: any) => f.name?.includes('Play'));
    const urlMatch = playField?.value.match(/\(([^)]+)\)/);
    const gameUrl = urlMatch ? urlMatch[1] : undefined;

    return {
      gameId,
      gameUrl,
      title: embed.title,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Parses profile statistics from bot response
   */
  public parseProfileStats(message: any): any {
    if (this.isAccessRestricted(message)) {
      console.log('   🔒 Access restricted - missing required role');
      return null;
    }

    if (message.embeds && message.embeds[0]) {
      const embed = message.embeds[0];
      if (embed.title?.includes('Profile')) {
        const fields = embed.fields || [];
        
        return {
          played: this.extractNumberFromField(fields, /games?\s+played/i) || 0,
          wins: this.extractNumberFromField(fields, /wins?/i) || 0,
          winRate: this.extractNumberFromField(fields, /win\s+rate/i) || 0,
          badgesEarned: this.extractNumberFromField(fields, /badges?/i) || 0
        };
      }
    }
    
    return null;
  }

  /**
   * Checks if bot response indicates access restriction
   */
  public isAccessRestricted(message: any): boolean {
    if (message.embeds && message.embeds[0]) {
      const embed = message.embeds[0];
      if (embed.title?.includes('Access Restricted')) {
        return true;
      }
    }

    if (message.content?.includes('too many games recently') || 
        message.content?.includes('wait 24 hours')) {
      return true;
    }

    return false;
  }

  /**
   * Checks if bot response indicates rate limiting
   */
  public isGameRateLimited(message: any): boolean {
    if (message.content?.includes('too many games recently') || 
        message.content?.includes('wait 24 hours')) {
      return true;
    }
    
    return false;
  }

  /**
   * Extracts required role from access restricted message
   */
  private extractRequiredRole(message: any): string {
    if (message.embeds && message.embeds[0] && message.embeds[0].fields) {
      const requiredRoleField = message.embeds[0].fields.find((field: any) => 
        field.name?.includes('Required Role')
      );
      if (requiredRoleField && requiredRoleField.value) {
        // Extract role name from "You need the **Echo** role to use this bot."
        const roleMatch = requiredRoleField.value.match(/\*\*([^*]+)\*\*/);
        return roleMatch ? roleMatch[1] : 'unknown role';
      }
    }
    return 'unknown role';
  }

  /**
   * Gets user's special role name
   */
  private getUserSpecialRole(userRoles: Array<{ id: string; name: string }>): string {
    const specialRoleIds = config.SPECIAL_ROLES;
    const userSpecialRole = userRoles.find(role => specialRoleIds.includes(role.id));
    return userSpecialRole ? userSpecialRole.name : 'unknown role';
  }

  /**
   * Extracts numeric value from embed field using regex
   */
  private extractNumberFromField(fields: any[], regex: RegExp): number | null {
    const field = fields.find((f: any) => regex.test(f.name));
    if (!field) return null;

    const match = field.value.match(/\*\*(\d+(?:\.\d+)?)\*\*/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Waits for bot response with message update handling
   */
  private async waitForBotResponseWithUpdates(client: any, channelId: string, botId: string): Promise<any> {
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
   * Adds timeout to promise
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    );

    return Promise.race([promise, timeout]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generates Discord nonce for interactions
   */
  private generateNonce(): string {
    const timestamp = Date.now() - 1420070400000;
    const random = Math.floor(Math.random() * 4096);
    return ((timestamp << 22) | (1 << 17) | random).toString();
  }
}