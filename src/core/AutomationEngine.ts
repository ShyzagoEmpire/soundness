import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { AccountManager } from '../services/AccountManager';
import { DiscordClient } from '../services/DiscordClient';
import { GameSolver } from '../services/GameSolver';
import { GameAPIClient } from '../services/GameAPIClient';
import { CLIExecutor } from '../services/CLIExecutor';
import { AccountData } from '../types';
import { config } from '../config/environment';

/**
 * Main automation engine with zero redundancy and optimized performance
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
    console.log('\n🎮 Soundness Automation v3.0\n');

    try {
      await this.validateKeyStore();

      if (this.isFirstRun) {
        await this.initialSetup();
        this.isFirstRun = false;
      }

      await this.startContinuousCycle();
    } catch (error) {
      console.error('❌ Automation failed:', error);
      process.exit(1);
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

    console.log('✅ key_store.json found');
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
    const existingAccounts = this.accountManager.getAccounts();
    const confirmedAccounts = existingAccounts.filter(acc => 
      acc.id && acc.token && acc.status === 'confirmed'
    );

    if (confirmedAccounts.length === 0) {
      console.log('📋 No existing confirmed accounts found');
      return true;
    }

    console.log(`📋 Found ${confirmedAccounts.length} existing confirmed account(s):`);
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
        console.log(`✅ Token added (${tokens.length} total)`);
      }

      const { continueAdding } = await inquirer.prompt([{
        type: 'list',
        name: 'continueAdding',
        message: 'Add another account?',
        choices: ['Yeah, of course!', 'Nah, that\'s enough']
      }]);

      if (continueAdding === 'Nah, that\'s enough') break;
    }

    console.log(`\n📊 Collected ${tokens.length} tokens for processing\n`);
    return tokens;
  }

  /**
   * Processes and validates collected tokens
   */
  private async processTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      console.log('📊 No new tokens to process\n');
      return;
    }

    console.log('🔄 Processing collected tokens...\n');

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      console.log(`Processing token ${i + 1}/${tokens.length}...`);

      const existingAccount = this.accountManager.getAccounts().find(acc => acc.token === token);
      if (existingAccount) {
        console.log(`⚠️ Token already exists for user: ${existingAccount.username}`);
        continue;
      }

      const accountData = await this.discordClient.validateAccount(token);
      if (accountData) {
        this.accountManager.addOrUpdateAccount(accountData);
        const statusText = accountData.status === 'confirmed' 
          ? `confirmed (${accountData.executableChannel} channel)` 
          : 'pending';
        console.log(`✅ Account ${accountData.username} validated successfully - ${statusText}`);
      } else {
        console.log('❌ Failed to validate token - token discarded');
      }

      if (i < tokens.length - 1) {
        await this.delay(config.COMMAND_DELAY);
      }
    }

    this.accountManager.saveAccounts();
    console.log('\n📊 Token processing complete!\n');
  }

  /**
   * Starts continuous automation cycles
   */
  private async startContinuousCycle(): Promise<void> {
    console.log('🔄 Starting continuous automation cycle...\n');

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
    console.log(`\n⏰ Cycle started at ${cycleStart.toLocaleString()}\n`);

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
        console.log('📊 Skipping profile sync (no games played)\n');
      }

      // Save accounts only once per cycle if any changes were made
      if (accountsModified) {
        this.accountManager.saveAccounts();
      }

      const nextCycle = new Date(Date.now() + config.RETRY_INTERVAL);
      console.log(`\n✅ Cycle completed successfully`);
      console.log(`🕐 Next cycle starts at ${nextCycle.toLocaleString()}\n`);
    } catch (error) {
      console.error('❌ Cycle failed:', error);
      const nextCycle = new Date(Date.now() + config.RETRY_INTERVAL);
      console.log(`🕐 Next cycle starts at ${nextCycle.toLocaleString()}\n`);
    }
  }

  /**
   * Gets confirmed accounts with validation
   */
  private getConfirmedAccounts(): AccountData[] | null {
    const confirmedAccounts = this.accountManager.getAccountsByStatus('confirmed');
    
    if (confirmedAccounts.length === 0) {
      console.log('✅ No confirmed accounts found');
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

    console.log(`🔄 Processing ${pendingAccounts.length} pending account(s)...\n`);
    let accountsModified = false;

    for (const account of pendingAccounts) {
      console.log(`Revalidating ${account.username}...`);

      try {
        const revalidatedAccount = await this.discordClient.revalidatePendingAccount(account);
        
        if (!revalidatedAccount) {
          // Account should be removed
          this.accountManager.removeAccount(account.id);
          console.log(`❌ Removed ${account.username} - failed revalidation`);
          accountsModified = true;
        } else if (revalidatedAccount.status === 'confirmed') {
          // Account was promoted to confirmed
          this.accountManager.addOrUpdateAccount(revalidatedAccount);
          console.log(`✅ ${account.username} promoted to confirmed status (${revalidatedAccount.executableChannel} channel)`);
          accountsModified = true;
        } else {
          // Account remains pending
          console.log(`⏳ ${account.username} remains pending`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`⚠️ Revalidation error for ${account.username}: ${errorMessage}`);
      }

      await this.delay(config.COMMAND_DELAY);
    }

    if (accountsModified) {
      console.log('\n📊 Pending accounts processing complete!\n');
    }
    return accountsModified;
  }

  /**
   * Executes 8queens commands for confirmed accounts only
   */
  private async execute8QueensCommands(): Promise<{ gamesPlayed: boolean; accountsModified: boolean }> {
    console.log('🎮 Executing /8queens commands...\n');

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
        console.log(`✅ 8queens completed for ${account.username}`);
        anyGamesPlayed = true;
      } else if (result.rateLimited) {
        console.log(`⏰ ${account.username} rate limited - too many games played recently (expected behavior)`);
      } else if (result.accessRestricted) {
        console.log(`🔒 ${account.username} access restricted - bot role restriction (expected behavior)`);
      } else {
        console.log(`❌ 8queens failed for ${account.username}`);
      }

      await this.delay(config.COMMAND_DELAY);
    }

    console.log('\n🎯 8queens execution complete!\n');
    return { gamesPlayed: anyGamesPlayed, accountsModified };
  }

  /**
   * Updates profile statistics after game completion
   */
  private async executeProfileCommands(): Promise<boolean> {
    console.log('📊 Updating post-game statistics...\n');

    const confirmedAccounts = this.getConfirmedAccounts();
    if (!confirmedAccounts) {
      console.log('📋 No confirmed accounts for stats update');
      return false;
    }

    let accountsModified = false;

    for (const account of confirmedAccounts) {
      console.log(`📊 Updating stats for ${account.username}...`);

      try {
        const response = await this.discordClient.executeSlashCommand(account, 'profile');
        
        if (response) {
          if (this.discordClient.isAccessRestricted(response)) {
            console.log(`🔒 ${account.username} access restricted - bot role restriction (keeping account)`);
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
              console.log(`✅ Stats updated for ${account.username}:`);
              console.log(`   Games: ${oldStats.played} → ${stats.played} (+${gamesPlayed})`);
              console.log(`   Wins: ${oldStats.wins} → ${stats.wins} (+${winsGained})`);
            } else {
              console.log(`📊 No stat changes for ${account.username}`);
            }
          } else {
            console.log(`⚠️ Could not parse stats for ${account.username}`);
          }
        } else {
          console.log(`⚠️ No response received for ${account.username}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`⚠️ Stats update failed for ${account.username}: ${errorMessage}`);
      }

      await this.delay(config.COMMAND_DELAY);
    }

    console.log('\n📊 Stats update complete!\n');
    return accountsModified;
  }

  /**
   * Executes complete game sequence for a single account
   */
  private async executeGameSequence(account: AccountData): Promise<{
    success: boolean;
    rateLimited?: boolean;
    accessRestricted?: boolean;
  }> {
    try {
      console.log('   📡 Sending /8queens command...');
      const gameResponse = await this.discordClient.executeSlashCommand(account, '8queens');
      
      if (this.discordClient.isGameRateLimited(gameResponse)) {
        console.log('   ⏰ Rate limited - too many games played recently');
        return { success: false, rateLimited: true };
      }

      if (this.discordClient.isAccessRestricted(gameResponse)) {
        console.log('   🔒 Access restricted - bot role restriction');
        return { success: false, accessRestricted: true };
      }

      const gameInfo = this.discordClient.extractGameInfo(gameResponse);
      if (!gameInfo) throw new Error('Could not extract game info');

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
      const keyName = account.username.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await this.cliExecutor.executeCommand(cliCommand, keyName);

      return { success: true };
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { success: false };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}