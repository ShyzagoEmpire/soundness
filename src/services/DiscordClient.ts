import { AccountData, GameInfo, ValidationResult } from '../types';
import { DiscordClientManager } from './DiscordClientManager';
import { MessageAnalyzer, ErrorHandler } from '../utils';

/**
 * Simplified Discord client with delegated operations to DiscordClientManager
 */
export class DiscordClient {
  private clientManager: DiscordClientManager;

  constructor() {
    this.clientManager = new DiscordClientManager();
  }

  /**
   * Validates Discord token with enhanced validation
   */
  public async validateAccount(token: string): Promise<AccountData | null> {
    ErrorHandler.log('Attempting login...', 'Validation');
    
    const result = await this.clientManager.validateAccount(token);
    
    if (!result.success) {
      ErrorHandler.log(`Validation failed: ${result.error}`, 'Validation');
      return null;
    }

    return result.data || null;
  }

  /**
   * Revalidates pending account
   */
  public async revalidatePendingAccount(account: AccountData): Promise<AccountData | null> {
    const result = await this.clientManager.revalidatePendingAccount(account);
    
    if (!result.success) {
      ErrorHandler.warn(`Revalidation error for ${account.username}: ${result.error}`, 'Revalidation');
      return account; // Keep as pending on error
    }

    return result.data || account;
  }

  /**
   * Executes Discord slash command with unified response analysis
   */
  public async executeSlashCommand(account: AccountData, commandName: string): Promise<any> {
    const result = await this.clientManager.executeSlashCommand(account, commandName);
    
    if (!result.success) {
      ErrorHandler.log(`Command execution failed: ${result.error}`, 'Command');
      throw new Error(result.error || 'Command execution failed');
    }

    return result.data;
  }

  /**
   * Analyzes message response using unified analyzer
   */
  public analyzeMessage(message: any, userRoles?: Array<{ id: string; name: string }>): any {
    return MessageAnalyzer.analyze(message, userRoles);
  }

  /**
   * Checks if bot response indicates game rate limiting
   */
  public isGameRateLimited(message: any): boolean {
    const analysis = MessageAnalyzer.analyze(message);
    return analysis.isRateLimited;
  }

  /**
   * Checks if bot response indicates access restriction
   */
  public isAccessRestricted(message: any): boolean {
    const analysis = MessageAnalyzer.analyze(message);
    return analysis.isAccessRestricted;
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
    const analysis = MessageAnalyzer.analyze(message);
    
    if (analysis.isAccessRestricted) {
      ErrorHandler.log('Access restricted - missing required role', 'ProfileStats');
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
   * Extracts numeric value from embed field using regex
   */
  private extractNumberFromField(fields: any[], regex: RegExp): number | null {
    const field = fields.find((f: any) => regex.test(f.name));
    if (!field) return null;

    const match = field.value.match(/\*\*(\d+(?:\.\d+)?)\*\*/);
    return match ? parseFloat(match[1]) : null;
  }
}