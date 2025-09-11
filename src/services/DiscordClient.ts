import { Client } from 'discord.js-selfbot-v13';
import { AccountData, GameInfo } from '../types';
import { config } from '../config/environment';

/**
 * Handles Discord API interactions and command execution
 */
export class DiscordClient {
  private readonly LOGIN_TIMEOUT = 30000;

  /**
   * Validates Discord token and checks guild membership and roles
   * @param token - Discord user token
   * @returns Account data if validation successful, null otherwise
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

      if (!hasRequiredRoles) {
        console.log('   ❌ Missing required roles');
        return null;
      }

      if (!hasSpecialRole) {
        console.log('   ❌ Missing special roles');
        return null;
      }

      console.log('   ✅ All role requirements met');

      return {
        id: user.id,
        token: token,
        username: user.username,
        globalName: user.globalName || user.username,
        roles: member.roles.cache.map(role => ({
          id: role.id,
          name: role.name
        })),
        stats: { played: 0, wins: 0, winRate: 0, badgesEarned: 0 },
        status: 'validated'
      };

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
   * Executes Discord slash command and waits for response
   * @param account - Account to use for command execution
   * @param commandName - Name of the slash command to execute
   * @returns Bot response message
   */
  public async executeSlashCommand(account: AccountData, commandName: string): Promise<any> {
    const client = new Client();
    
    try {
      console.log(`   🔐 Logging in as ${account.username}...`);
      
      await Promise.race([
        client.login(account.token),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Login timeout')), this.LOGIN_TIMEOUT)
        )
      ]);

      console.log('   ✅ Login successful');
      await this.delay(3000);

      const channelId = await this.determineChannelId(client);
      console.log(`   📡 Using channel: ${channelId}`);

      console.log('   🔍 Fetching bot commands...');
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

      console.log(`   🎮 Executing /${commandName} command...`);

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

      console.log('   📨 Command sent, waiting for response...');
      return await this.waitForBotResponseWithUpdates(client, channelId, config.BOT_ID);

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
   * Extracts numeric value from embed field using regex
   */
  private extractNumberFromField(fields: any[], regex: RegExp): number | null {
    const field = fields.find((f: any) => regex.test(f.name));
    if (!field) return null;

    const match = field.value.match(/\*\*(\d+(?:\.\d+)?)\*\*/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Determines appropriate channel ID for commands
   */
  private async determineChannelId(client: Client): Promise<string> {
    try {
      const channel = await this.withTimeout(
        client.channels.fetch(config.GENERAL_CHANNEL_ID),
        5000,
        'Channel fetch timeout'
      );
      
      if (channel && 'guild' in channel) {
        return config.GENERAL_CHANNEL_ID;
      }
    } catch (error) {
      console.log('   ⚠️ Cannot access general channel, trying fallback...');
    }

    if (config.FALLBACK_CHANNEL_ID) {
      try {
        const channel = await this.withTimeout(
          client.channels.fetch(config.FALLBACK_CHANNEL_ID),
          5000,
          'Fallback channel fetch timeout'
        );
        
        if (channel && 'guild' in channel) {
          return config.FALLBACK_CHANNEL_ID;
        }
      } catch (error) {
        console.log('   ⚠️ Cannot access fallback channel either');
      }
    }

    throw new Error('No accessible channel found');
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
          console.log(`   📩 Received message from bot (flags: ${message.flags?.bitfield || 'none'})`);
          lastMessage = message;
          
          if (message.flags?.bitfield === 192) {
            console.log('   ⏳ Received loading message, waiting for update...');
            return;
          }
          
          if (message.flags?.bitfield === 64 || !message.flags?.bitfield) {
            console.log('   ✅ Received final message');
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
          
          console.log(`   🔄 Message updated (flags: ${oldMessage.flags?.bitfield || 'none'} → ${newMessage.flags?.bitfield || 'none'})`);
          
          if (oldMessage.flags?.bitfield === 192 && newMessage.flags?.bitfield === 64) {
            console.log('   ✅ Message updated from loading to ready');
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