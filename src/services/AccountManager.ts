import fs from 'fs-extra';
import { AccountData, AccountsStorage } from '../types';
import { config } from '../config/environment';
import { ErrorHandler } from '../utils';

/**
 * Manages account data persistence with enhanced error handling and validation
 */
export class AccountManager {
  private accounts: AccountsStorage = {
    accounts: [],
    lastUpdated: new Date().toISOString(),
    version: '3.0.0'
  };

  constructor() {
    this.loadAccounts();
  }

  /**
   * Returns all stored accounts
   */
  public getAccounts(): AccountData[] {
    return this.accounts.accounts;
  }

  /**
   * Returns accounts filtered by status
   */
  public getAccountsByStatus(status: AccountData['status']): AccountData[] {
    return this.accounts.accounts.filter(account => account.status === status);
  }

  /**
   * Returns account by ID
   */
  public getAccountById(accountId: string): AccountData | undefined {
    return this.accounts.accounts.find(acc => acc.id === accountId);
  }

  /**
   * Returns account by token
   */
  public getAccountByToken(token: string): AccountData | undefined {
    return this.accounts.accounts.find(acc => acc.token === token);
  }

  /**
   * Adds new account or updates existing one by ID
   */
  public addOrUpdateAccount(accountData: AccountData): void {
    this.validateAccountData(accountData);

    const existingIndex = this.accounts.accounts.findIndex(acc => acc.id === accountData.id);
    
    if (existingIndex >= 0) {
      // Update existing account
      this.accounts.accounts[existingIndex] = { 
        ...this.accounts.accounts[existingIndex], 
        ...accountData 
      };
      ErrorHandler.log(`Updated account: ${accountData.username}`, 'AccountManager');
    } else {
      // Add new account
      this.accounts.accounts.push(accountData);
      ErrorHandler.log(`Added new account: ${accountData.username}`, 'AccountManager');
    }
  }

  /**
   * Updates account status by ID
   */
  public updateAccountStatus(accountId: string, status: AccountData['status']): boolean {
    const account = this.accounts.accounts.find(acc => acc.id === accountId);
    if (account) {
      const oldStatus = account.status;
      account.status = status;
      ErrorHandler.log(`Status changed for ${account.username}: ${oldStatus} → ${status}`, 'AccountManager');
      return true;
    }
    return false;
  }

  /**
   * Updates account statistics
   */
  public updateAccountStats(
    accountId: string, 
    stats: AccountData['stats']
  ): boolean {
    const account = this.accounts.accounts.find(acc => acc.id === accountId);
    if (account) {
      const oldStats = account.stats;
      account.stats = stats;
      
      const gamesPlayed = stats.played - oldStats.played;
      const winsGained = stats.wins - oldStats.wins;
      
      if (gamesPlayed > 0 || winsGained > 0) {
        ErrorHandler.log(`Stats updated for ${account.username}: +${gamesPlayed} games, +${winsGained} wins`, 'AccountManager');
      }
      
      return true;
    }
    return false;
  }

  /**
   * Removes account by ID
   */
  public removeAccount(accountId: string): boolean {
    const initialLength = this.accounts.accounts.length;
    const accountToRemove = this.accounts.accounts.find(acc => acc.id === accountId);
    
    this.accounts.accounts = this.accounts.accounts.filter(acc => acc.id !== accountId);
    
    const wasRemoved = this.accounts.accounts.length < initialLength;
    if (wasRemoved && accountToRemove) {
      ErrorHandler.log(`Removed account: ${accountToRemove.username}`, 'AccountManager');
    }
    
    return wasRemoved;
  }

  /**
   * Returns account statistics by status
   */
  public getAccountStats(): { [status: string]: number } {
    const stats = {
      confirmed: 0,
      pending: 0,
      total: this.accounts.accounts.length
    };

    this.accounts.accounts.forEach(account => {
      stats[account.status]++;
    });

    return stats;
  }

  /**
   * Returns detailed account summary
   */
  public getAccountSummary(): {
    total: number;
    confirmed: number;
    pending: number;
    generalChannel: number;
    fallbackChannel: number;
    totalWins: number;
    totalGames: number;
  } {
    const summary = {
      total: this.accounts.accounts.length,
      confirmed: 0,
      pending: 0,
      generalChannel: 0,
      fallbackChannel: 0,
      totalWins: 0,
      totalGames: 0
    };

    this.accounts.accounts.forEach(account => {
      // Status counts
      summary[account.status]++;
      
      // Channel counts
      if (account.executableChannel === 'general') summary.generalChannel++;
      else if (account.executableChannel === 'fallback') summary.fallbackChannel++;
      
      // Game statistics
      summary.totalWins += account.stats.wins;
      summary.totalGames += account.stats.played;
    });

    return summary;
  }

  /**
   * Validates account data structure
   */
  private validateAccountData(accountData: AccountData): void {
    const required = ['id', 'token', 'username', 'globalName', 'roles', 'stats', 'status'];
    
    for (const field of required) {
      if (!(field in accountData)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!['confirmed', 'pending'].includes(accountData.status)) {
      throw new Error(`Invalid status: ${accountData.status}`);
    }

    if (accountData.executableChannel && !['general', 'fallback'].includes(accountData.executableChannel)) {
      throw new Error(`Invalid executable channel: ${accountData.executableChannel}`);
    }
  }

  /**
   * Saves accounts to JSON file with enhanced error handling
   */
  public saveAccounts(): void {
    try {
      this.accounts.lastUpdated = new Date().toISOString();
      
      // Ensure directory exists
      const accountsDir = require('path').dirname(config.ACCOUNTS_FILE);
      fs.ensureDirSync(accountsDir);
      
      // Create backup if file exists
      if (fs.existsSync(config.ACCOUNTS_FILE)) {
        const backupPath = `${config.ACCOUNTS_FILE}.backup`;
        fs.copySync(config.ACCOUNTS_FILE, backupPath);
      }
      
      // Save accounts with formatting
      fs.writeJsonSync(config.ACCOUNTS_FILE, this.accounts, { spaces: 2 });
      
      const stats = this.getAccountStats();
      ErrorHandler.log(`Saved accounts: ${stats.confirmed} confirmed, ${stats.pending} pending (${stats.total} total)`, 'AccountManager');
    } catch (error) {
      ErrorHandler.handle(error, 'Failed to save accounts file');
    }
  }

  /**
   * Loads accounts from JSON file with enhanced error handling
   */
  private loadAccounts(): void {
    try {
      if (fs.existsSync(config.ACCOUNTS_FILE)) {
        const data = fs.readJsonSync(config.ACCOUNTS_FILE);
        
        // Validate loaded data structure
        if (data && data.accounts && Array.isArray(data.accounts)) {
          this.accounts = {
            accounts: data.accounts,
            lastUpdated: data.lastUpdated || new Date().toISOString(),
            version: data.version || '3.0.0'
          };
          
          // Validate each account
          this.accounts.accounts = this.accounts.accounts.filter((account, index) => {
            try {
              this.validateAccountData(account);
              return true;
            } catch (error) {
              ErrorHandler.warn(`Invalid account data at index ${index}, skipping: ${error}`, 'AccountManager');
              return false;
            }
          });
          
          const stats = this.getAccountStats();
          ErrorHandler.log(`Loaded ${stats.total} existing accounts: ${stats.confirmed} confirmed, ${stats.pending} pending`, 'AccountManager');
        } else {
          ErrorHandler.warn('Invalid accounts file format, starting fresh', 'AccountManager');
        }
      } else {
        ErrorHandler.log('No existing accounts file found, starting fresh', 'AccountManager');
      }
    } catch (error) {
      ErrorHandler.warn(`Failed to load accounts file: ${error}. Starting fresh.`, 'AccountManager');
    }
  }

  /**
   * Cleans up invalid accounts and removes duplicates
   */
  public cleanupAccounts(): number {
    const initialCount = this.accounts.accounts.length;
    const seen = new Set<string>();
    
    this.accounts.accounts = this.accounts.accounts.filter(account => {
      // Remove duplicates by ID
      if (seen.has(account.id)) {
        ErrorHandler.warn(`Removed duplicate account: ${account.username}`, 'AccountManager');
        return false;
      }
      seen.add(account.id);
      
      // Validate account data
      try {
        this.validateAccountData(account);
        return true;
      } catch (error) {
        ErrorHandler.warn(`Removed invalid account ${account.username}: ${error}`, 'AccountManager');
        return false;
      }
    });
    
    const removedCount = initialCount - this.accounts.accounts.length;
    if (removedCount > 0) {
      ErrorHandler.log(`Cleanup complete: removed ${removedCount} invalid/duplicate accounts`, 'AccountManager');
      this.saveAccounts();
    }
    
    return removedCount;
  }
}