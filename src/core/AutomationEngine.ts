import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { AccountManager } from '../services/AccountManager';
import { DiscordClient } from '../services/DiscordClient';
import { GameSolver } from '../services/GameSolver';
import { GameAPIClient } from '../services/GameAPIClient';
import { CLIExecutor } from '../services/CLIExecutor';
import { AccountData, GameExecutionResult } from '../types';
import { config } from '../config/environment';
import { Utils, ErrorHandler, MessageAnalyzer } from '../utils';

/**
 * Main automation engine with streamlined architecture and improved error handling
 */
export class AutomationEngine {
  private accountManager: AccountManager;
  private discordClient: DiscordClient;
  private gameSolver: GameSolver;
  private gameApiClient: GameAPIClient;
  private cliExecutor: CLIExecutor;
  private isFirstRun: boolean = true;

  constructor() {
    this.accountManager = new AccountManager();
    this.discordClient = new DiscordClient();
    this.gameSolver = new GameSolver();
    this.gameApiClient = new GameAPIClient();
    this.cliExecutor = new CLIExecutor();
  }

  /**
   * Starts the automation process with initial setup and continuous cycles
   */
  public async start(): Promise<void> {
    console.log('\n🎮 Soundness Automation v3.0 (Refactored)\n');

    try {
      await this.validateKeyStore();

      if (this.isFirstRun) {
        await this.initialSetup();
        this.isFirstRun = false;
      }

      await this.startContinuousCycle();
    } catch (error) {
      ErrorHandler.handle(error, 'Automation startup');
    }
  }

  /**
   * Validates existence of key_store.json file
   */
  private async validateKeyStore(): Promise<void> {
    const keyStorePath = path.join(process.cwd(), 'key_store.json');
    
    if (!fs.existsSync(keyStorePath)) {
      console.log('❌ key_store.json file not found!');
      console.log('\n📝 You need to import your wallet key first.');
      console.log('Use this command to import your key:');
      console.log('\n   soundness-cli import-key --name <n> --mnemonic "<mnemonic>"\n');
      console.log('Replace:');
      console.log('  <n>     - with your preferred key name (e.g., "mykey")');
      console.log('  <mnemonic> - with your 12/24 word mnemonic phrase');
      console.log('\nAfter importing your key, run this script again.');
      process.exit(1);
    }

    ErrorHandler.log('key_store.json found', 'Setup');
  }

  /**
   * Handles initial account setup on first run
   */
  private async initialSetup(): Promise<void> {
    const shouldCollectTokens = await this.checkExistingAccountsAndPrompt();
    
    if (shouldCollectTokens) {
      const tokens = await this.collectTokens();
      await this.processTokens(tokens);
    }
  }

  /**
   * Checks for existing accounts and prompts user for action
   */
  private async checkExistingAccountsAndPrompt(): Promise<boolean> {
    const confirmedAccounts = this.accountManager.getAccountsByStatus('confirmed');

    if (confirmedAccounts.length === 0) {
      ErrorHandler.log('No existing confirmed accounts found', 'Setup');
      return true;
    }

    ErrorHandler.log(`Found ${confirmedAccounts.length} existing confirmed account(s):`, 'Setup');
    confirmedAccounts.forEach(acc => {
      console.log(`   👤 ${acc.username} (${acc.globalName}) - Status: ${acc.status} - Channel: ${acc.executableChannel}`);
    });

    const { addMoreAccounts } = await inquirer.prompt([{
      type: 'list',
      name: 'addMoreAccounts',
      message: 'Do you want to add more accounts?',
      choices: [
        'Iya, aku mau nambahin akun',
        'Engga, udah gaada tuyul lagi'
      ]
    }]);

    return addMoreAccounts === 'Iya, aku mau nambahin akun';
  }

  /**
   * Collects Discord tokens from user input
   */
  private async collectTokens(): Promise<string[]> {
    console.log('\n🔍 Token Collection Phase\n');
    const tokens: string[] = [];

    while (true) {
      const { token } = await inquirer.prompt([{
        type: 'password',
        name: 'token',
        message: 'Enter your Discord token:',
        mask: '*'
      }]);

      if (token.trim()) {
        tokens.push(token.trim());
        ErrorHandler.log(`Token added (${tokens.length} total)`, 'TokenCollection');
      }

      const { continueAdding } = await inquirer.prompt([{
        type: 'list',
        name: 'continueAdding',
        message: 'Add another account?',
        choices: ['Yeah, of course!', 'Nah, that\'s enough']
      }]);

      if (continueAdding === 'Nah, that\'s enough') break;
    }

    ErrorHandler.log(`Collected ${tokens.length} tokens for processing`, 'TokenCollection');
    return tokens;
  }

  /**
   * Processes and validates collected tokens
   */
  private async processTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      ErrorHandler.log('No new tokens to process', 'TokenProcessing');
      return;
    }

    ErrorHandler.log('Processing collected tokens...', 'TokenProcessing');

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      console.log(`Processing token ${i + 1}/${tokens.length}...`);

      // Skip if token already exists
      const existingAccount = this.accountManager.getAccounts().find(acc => acc.token === token);
      if (existingAccount) {
        ErrorHandler.warn(`Token already exists for user: ${existingAccount.username}`, 'TokenProcessing');
        continue;
      }

      // Validate new token
      const accountData = await this.discordClient.validateAccount(token);
      if (accountData) {
        this.accountManager.addOrUpdateAccount(accountData);
        const statusText = accountData.status === 'confirmed' 
          ? `confirmed (${accountData.executableChannel} channel)` 
          : 'pending';
        ErrorHandler.log(`Account ${accountData.username} validated successfully - ${statusText}`, 'TokenProcessing');
      } else {
        ErrorHandler.warn('Failed to validate token - token discarded', 'TokenProcessing');
      }

      if (i < tokens.length - 1) {
        await Utils.delay(config.COMMAND_DELAY);
      }
    }

    this.accountManager.saveAccounts();
    ErrorHandler.log('Token processing complete!', 'TokenProcessing');
  }

  /**
   * Starts continuous automation cycles
   */
  private async startContinuousCycle(): Promise<void> {
    ErrorHandler.log('Starting continuous automation cycle...', 'Cycle');

    await this.runCycle();

    setInterval(async () => {
      await this.runCycle();
    }, config.RETRY_INTERVAL);
  }

  /**
   * Executes single automation cycle with optimized account management
   */
  private async runCycle(): Promise<void> {
    const cycleStart = new Date();
    ErrorHandler.log(`Cycle started at ${cycleStart.toLocaleString()}`, 'Cycle');

    try {
      let accountsModified = false;

      // Handle pending accounts first
      if (await this.handlePendingAccounts()) {
        accountsModified = true;
      }
      
      // Execute 8queens for confirmed accounts
      const gamesResult = await this.execute8QueensCommands();
      if (gamesResult.accountsModified) {
        accountsModified = true;
      }
      
      if (gamesResult.gamesPlayed) {
        // Update profiles after gaming to get latest stats
        if (await this.executeProfileCommands()) {
          accountsModified = true;
        }
      } else {
        ErrorHandler.log('Skipping profile sync (no games played)', 'Cycle');
      }

      // Save accounts only once per cycle if any changes were made
      if (accountsModified) {
        this.accountManager.saveAccounts();
      }

      const nextCycle = new Date(Date.now() + config.RETRY_INTERVAL);
      ErrorHandler.log(`Cycle completed successfully`, 'Cycle');
      ErrorHandler.log(`Next cycle starts at ${nextCycle.toLocaleString()}`, 'Cycle');
    } catch (error) {
      ErrorHandler.warn(`Cycle failed: ${error}`, 'Cycle');
      const nextCycle = new Date(Date.now() + config.RETRY_INTERVAL);
      ErrorHandler.log(`Next cycle starts at ${nextCycle.toLocaleString()}`, 'Cycle');
    }
  }

  /**
   * Gets confirmed accounts with validation
   */
  private getConfirmedAccounts(): AccountData[] | null {
    const confirmedAccounts = this.accountManager.getAccountsByStatus('confirmed');
    
    if (confirmedAccounts.length === 0) {
      ErrorHandler.log('No confirmed accounts found', 'Cycle');
      return null;
    }
    
    return confirmedAccounts;
  }

  /**
   * Handles pending accounts by attempting revalidation
   */
  private async handlePendingAccounts(): Promise<boolean> {
    const pendingAccounts = this.accountManager.getAccountsByStatus('pending');
    
    if (pendingAccounts.length === 0) {
      return false;
    }

    ErrorHandler.log(`Processing ${pendingAccounts.length} pending account(s)...`, 'PendingAccounts');
    let accountsModified = false;

    for (const account of pendingAccounts) {
      console.log(`Revalidating ${account.username}...`);

      try {
        const revalidatedAccount = await this.discordClient.revalidatePendingAccount(account);
        
        if (!revalidatedAccount) {
          // Account should be removed
          this.accountManager.removeAccount(account.id);
          ErrorHandler.log(`Removed ${account.username} - failed revalidation`, 'PendingAccounts');
          accountsModified = true;
        } else if (revalidatedAccount.status === 'confirmed') {
          // Account was promoted to confirmed
          this.accountManager.addOrUpdateAccount(revalidatedAccount);
          ErrorHandler.log(`${account.username} promoted to confirmed status (${revalidatedAccount.executableChannel} channel)`, 'PendingAccounts');
          accountsModified = true;
        } else {
          // Account remains pending
          ErrorHandler.log(`${account.username} remains pending`, 'PendingAccounts');
        }
      } catch (error) {
        ErrorHandler.warn(`Revalidation error for ${account.username}: ${error}`, 'PendingAccounts');
      }

      await Utils.delay(config.COMMAND_DELAY);
    }

    if (accountsModified) {
      ErrorHandler.log('Pending accounts processing complete!', 'PendingAccounts');
    }
    return accountsModified;
  }

  /**
   * Executes 8queens commands for confirmed accounts only
   */
  private async execute8QueensCommands(): Promise<{ gamesPlayed: boolean; accountsModified: boolean }> {
    ErrorHandler.log('Executing /8queens commands...', 'Gaming');

    const confirmedAccounts = this.getConfirmedAccounts();
    if (!confirmedAccounts) {
      return { gamesPlayed: false, accountsModified: false };
    }

    let anyGamesPlayed = false;
    let accountsModified = false;

    for (const account of confirmedAccounts) {
      console.log(`🎯 Playing 8queens for ${account.username}...`);

      const result = await this.executeGameSequence(account);
      
      if (result.success) {
        ErrorHandler.log(`8queens completed for ${account.username}`, 'Gaming');
        anyGamesPlayed = true;
      } else if (result.rateLimited) {
        ErrorHandler.log(`${account.username} rate limited - too many games played recently (expected behavior)`, 'Gaming');
      } else if (result.accessRestricted) {
        ErrorHandler.log(`${account.username} access restricted - bot role restriction (expected behavior)`, 'Gaming');
      } else {
        ErrorHandler.warn(`8queens failed for ${account.username}: ${result.error || 'Unknown error'}`, 'Gaming');
      }

      await Utils.delay(config.COMMAND_DELAY);
    }

    ErrorHandler.log('8queens execution complete!', 'Gaming');
    return { gamesPlayed: anyGamesPlayed, accountsModified };
  }

  /**
   * Updates profile statistics after game completion
   */
  private async executeProfileCommands(): Promise<boolean> {
    ErrorHandler.log('Updating post-game statistics...', 'ProfileSync');

    const confirmedAccounts = this.getConfirmedAccounts();
    if (!confirmedAccounts) {
      ErrorHandler.log('No confirmed accounts for stats update', 'ProfileSync');
      return false;
    }

    let accountsModified = false;

    for (const account of confirmedAccounts) {
      console.log(`📊 Updating stats for ${account.username}...`);

      try {
        const response = await this.discordClient.executeSlashCommand(account, 'profile');
        
        if (response) {
          const analysis = MessageAnalyzer.analyze(response, account.roles);
          
          if (analysis.isAccessRestricted) {
            ErrorHandler.log(`${account.username} access restricted - bot role restriction (keeping account)`, 'ProfileSync');
            continue;
          }

          const stats = this.discordClient.parseProfileStats(response);
          if (stats) {
            const oldStats = account.stats;
            account.stats = stats;
            this.accountManager.addOrUpdateAccount(account);
            accountsModified = true;
            
            const gamesPlayed = stats.played - oldStats.played;
            const winsGained = stats.wins - oldStats.wins;
            
            if (gamesPlayed > 0 || winsGained > 0) {
              ErrorHandler.log(`Stats updated for ${account.username}:`, 'ProfileSync');
              console.log(`   Games: ${oldStats.played} → ${stats.played} (+${gamesPlayed})`);
              console.log(`   Wins: ${oldStats.wins} → ${stats.wins} (+${winsGained})`);
            } else {
              ErrorHandler.log(`No stat changes for ${account.username}`, 'ProfileSync');
            }
          } else {
            ErrorHandler.warn(`Could not parse stats for ${account.username}`, 'ProfileSync');
          }
        } else {
          ErrorHandler.warn(`No response received for ${account.username}`, 'ProfileSync');
        }
      } catch (error) {
        ErrorHandler.warn(`Stats update failed for ${account.username}: ${error}`, 'ProfileSync');
      }

      await Utils.delay(config.COMMAND_DELAY);
    }

    ErrorHandler.log('Stats update complete!', 'ProfileSync');
    return accountsModified;
  }

  /**
   * Executes complete game sequence for a single account
   */
  private async executeGameSequence(account: AccountData): Promise<GameExecutionResult> {
    try {
      console.log('   📡 Sending /8queens command...');
      const gameResponse = await this.discordClient.executeSlashCommand(account, '8queens');
      
      // Analyze response using unified analyzer
      const analysis = MessageAnalyzer.analyze(gameResponse, account.roles);
      
      if (analysis.isRateLimited) {
        console.log('   ⏰ Rate limited - too many games played recently');
        return { success: false, rateLimited: true };
      }

      if (analysis.isAccessRestricted) {
        console.log('   🔒 Access restricted - bot role restriction');
        return { success: false, accessRestricted: true };
      }

      const gameInfo = this.discordClient.extractGameInfo(gameResponse);
      if (!gameInfo) {
        throw new Error('Could not extract game info');
      }

      console.log(`   🎮 Game created: ${gameInfo.gameId}`);

      console.log('   🧩 Getting solution...');
      const solution = this.gameSolver.getSolution();
      const stats = this.gameSolver.getStats();

      console.log('   📤 Submitting solution and waiting for victory URL...');
      const victoryUrl = await this.gameApiClient.submitGameCompletion(
        gameInfo.gameId,
        solution,
        stats
      );

      console.log('   📄 Waiting for CLI command to be ready...');
      const cliCommand = await this.gameApiClient.pollForCLICommand(victoryUrl);

      console.log('   ⚙️ Executing blockchain transaction...');
      const keyName = this.generateKeyName(account.username);
      await this.cliExecutor.executeCommand(cliCommand, keyName);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`   ❌ Error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generates safe key name from username
   */
  private generateKeyName(username: string): string {
    return username.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }
}