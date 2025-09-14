import fs from 'fs-extra';
import { AccountData, AccountsStorage } from '../types';
import { config } from '../config/environment';

/**
 * Manages account data persistence with simplified status handling
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
   * Adds new account or updates existing one by ID
   */
  public addOrUpdateAccount(accountData: AccountData): void {
    const existingIndex = this.accounts.accounts.findIndex(acc => acc.id === accountData.id);
    
    if (existingIndex >= 0) {
      this.accounts.accounts[existingIndex] = { 
        ...this.accounts.accounts[existingIndex], 
        ...accountData 
      };
    } else {
      this.accounts.accounts.push(accountData);
    }
  }

  /**
   * Updates account status by ID
   */
  public updateAccountStatus(accountId: string, status: AccountData['status']): boolean {
    const account = this.accounts.accounts.find(acc => acc.id === accountId);
    if (account) {
      account.status = status;
      return true;
    }
    return false;
  }

  /**
   * Removes account by ID
   */
  public removeAccount(accountId: string): boolean {
    const initialLength = this.accounts.accounts.length;
    this.accounts.accounts = this.accounts.accounts.filter(acc => acc.id !== accountId);
    return this.accounts.accounts.length < initialLength;
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
   * Saves accounts to JSON file
   */
  public saveAccounts(): void {
    try {
      this.accounts.lastUpdated = new Date().toISOString();
      fs.ensureDirSync(require('path').dirname(config.ACCOUNTS_FILE));
      fs.writeJsonSync(config.ACCOUNTS_FILE, this.accounts, { spaces: 2 });
      
      const stats = this.getAccountStats();
      console.log(`💾 Saved accounts: ${stats.confirmed} confirmed, ${stats.pending} pending (${stats.total} total)`);
    } catch (error) {
      console.error('❌ Failed to save accounts file:', error);
    }
  }

  /**
   * Loads accounts from JSON file
   */
  private loadAccounts(): void {
    try {
      if (fs.existsSync(config.ACCOUNTS_FILE)) {
        const data = fs.readJsonSync(config.ACCOUNTS_FILE);
        this.accounts = data;
        
        const stats = this.getAccountStats();
        console.log(`📂 Loaded ${stats.total} existing accounts: ${stats.confirmed} confirmed, ${stats.pending} pending`);
      }
    } catch (error) {
      console.log('📂 No existing accounts file found, starting fresh');
    }
  }
}