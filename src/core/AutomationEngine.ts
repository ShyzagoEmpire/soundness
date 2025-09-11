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
 * Main automation engine that orchestrates the entire 8Queens automation workflow
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
    const readyAccounts = existingAccounts.filter(acc => 
      acc.id && acc.token && acc.status === 'ready'
    );

    if (readyAccounts.length === 0) {
      console.log('📋 No existing ready accounts found');
      return true;
    }

    console.log(`📋 Found ${readyAccounts.length} existing ready account(s):`);
    readyAccounts.forEach(acc => {
      console.log(`   👤 ${acc.username} (${acc.globalName}) - Status: ${acc.status}`);
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
        console.log(`✅ Account ${accountData.username} validated successfully`);
      } else {
        console.log('❌ Failed to validate token - discarding');
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
   * Executes single automation cycle
   */
  private async runCycle(): Promise<void> {
    const cycleStart = new Date();
    console.log(`\n⏰ Cycle started at ${cycleStart.toLocaleString()}\n`);

    try {
      await this.executeProfileCommands();
      const gamesWerePlayed = await this.execute8QueensCommands();
      
      if (gamesWerePlayed) {
        await this.postGameProfileSync();
      } else {
        console.log('📊 Skipping post-game profile sync (no games played)\n');
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
   * Executes profile commands for account synchronization
   */
  private async executeProfileCommands(): Promise<void> {
    console.log('👤 Executing /profile commands...\n');

    const accountsNeedingProfileSync = [
      ...this.accountManager.getAccountsByStatus('validated'),
      ...this.accountManager.getAccountsByStatus('ready')
    ];

    if (accountsNeedingProfileSync.length === 0) {
      console.log('📋 No accounts need profile sync');
      return;
    }

    for (const account of accountsNeedingProfileSync) {
      console.log(`Syncing profile for ${account.username}...`);

      try {
        const response = await this.discordClient.executeSlashCommand(account, 'profile');
        
        if (response) {
          if (this.discordClient.isAccessRestricted(response)) {
            console.log(`🔒 Access restricted for ${account.username} - account validation inconsistency`);
            const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Access restricted after successful validation');
            if (wasRemoved) {
              console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
            }
            continue;
          }

          const stats = this.discordClient.parseProfileStats(response);
          if (stats) {
            account.canAccessGeneral = true;
            account.status = 'ready';
            account.stats = stats;
            this.accountManager.addOrUpdateAccount(account);
            this.accountManager.resetAccountFailures(account.id);
            console.log(`✅ Profile synced for ${account.username} - ${stats.played} games played, ${stats.wins} wins`);
          } else {
            console.log(`⚠️ Could not parse profile stats for ${account.username}`);
            const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Failed to parse profile stats');
            if (wasRemoved) {
              console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
            }
          }
        } else {
          console.log(`⚠️ No response received for ${account.username}`);
          const wasRemoved = this.accountManager.markAccountFailure(account.id, 'No response received from Discord');
          if (wasRemoved) {
            console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`⚠️ Profile sync failed for ${account.username}: ${errorMessage}`);
        const wasRemoved = this.accountManager.markAccountFailure(account.id, `Profile sync error: ${errorMessage}`);
        if (wasRemoved) {
          console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
        }
      }

      await this.delay(config.COMMAND_DELAY);
    }

    this.accountManager.saveAccounts();
    console.log('\n📊 Profile sync complete!\n');
  }

  /**
   * Executes 8queens commands for all ready accounts
   */
  private async execute8QueensCommands(): Promise<boolean> {
    console.log('🎮 Executing /8queens commands...\n');

    const readyAccounts = this.accountManager.getAccountsByStatus('ready');

    if (readyAccounts.length === 0) {
      console.log('✅ No ready accounts found');
      return false;
    }

    let anyGamesPlayed = false;

    for (const account of readyAccounts) {
      console.log(`🎯 Playing 8queens for ${account.username}...`);

      const result = await this.executeGameSequence(account);
      
      if (result.success) {
        console.log(`✅ 8queens completed for ${account.username}`);
        this.accountManager.resetAccountFailures(account.id);
        anyGamesPlayed = true;
      } else if (result.rateLimited) {
        console.log(`⏰ ${account.username} rate limited - too many games played recently (expected behavior)`);
        this.accountManager.resetAccountFailures(account.id);
      } else if (result.accessRestricted) {
        console.log(`🔒 ${account.username} access restricted - validation inconsistency detected`);
        const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Access restricted after successful validation');
        if (wasRemoved) {
          console.log(`💡 Manual check needed: Try sending /8queens manually in Discord with account ${account.username} - there might be an issue`);
        }
      } else {
        console.log(`❌ 8queens failed for ${account.username}`);
        const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Failed to complete 8queens game');
        if (wasRemoved) {
          console.log(`💡 Manual check needed: Try sending /8queens manually in Discord with account ${account.username} - there might be an issue`);
        }
      }

      await this.delay(config.COMMAND_DELAY);
    }

    this.accountManager.saveAccounts();
    console.log('\n🎯 8queens execution complete!\n');
    
    return anyGamesPlayed;
  }

  /**
   * Updates profile statistics after game completion
   */
  private async postGameProfileSync(): Promise<void> {
    console.log('📊 Post-game profile sync...\n');

    const readyAccounts = this.accountManager.getAccountsByStatus('ready');

    if (readyAccounts.length === 0) {
      console.log('📋 No ready accounts for post-game sync');
      return;
    }

    for (const account of readyAccounts) {
      console.log(`Updating stats for ${account.username}...`);

      try {
        const response = await this.discordClient.executeSlashCommand(account, 'profile');
        
        if (response) {
          if (this.discordClient.isAccessRestricted(response)) {
            console.log(`🔒 ${account.username} access restricted during post-game sync - validation inconsistency`);
            const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Access restricted during post-game sync');
            if (wasRemoved) {
              console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
            }
            continue;
          }

          const stats = this.discordClient.parseProfileStats(response);
          if (stats) {
            const oldStats = account.stats;
            account.stats = stats;
            this.accountManager.addOrUpdateAccount(account);
            this.accountManager.resetAccountFailures(account.id);
            
            console.log(`✅ Stats updated for ${account.username}:`);
            console.log(`   Games: ${oldStats.played} → ${stats.played} (+${stats.played - oldStats.played})`);
            console.log(`   Wins: ${oldStats.wins} → ${stats.wins} (+${stats.wins - oldStats.wins})`);
          } else {
            const wasRemoved = this.accountManager.markAccountFailure(account.id, 'Failed to parse post-game profile stats');
            if (wasRemoved) {
              console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
            }
          }
        } else {
          const wasRemoved = this.accountManager.markAccountFailure(account.id, 'No response from post-game profile sync');
          if (wasRemoved) {
            console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.log(`⚠️ Post-game stats update failed for ${account.username}: ${errorMessage}`);
        const wasRemoved = this.accountManager.markAccountFailure(account.id, `Post-game sync error: ${errorMessage}`);
        if (wasRemoved) {
          console.log(`💡 Manual check needed: Try sending /profile manually in Discord with account ${account.username} - there might be an issue`);
        }
      }

      await this.delay(config.COMMAND_DELAY);
    }

    this.accountManager.saveAccounts();
    console.log('\n📊 Post-game profile sync complete!\n');
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
        console.log('   🔒 Access restricted - missing required role');
        return { success: false, accessRestricted: true };
      }

      const gameInfo = this.discordClient.extractGameInfo(gameResponse);
      if (!gameInfo) throw new Error('Could not extract game info');

      console.log(`   🎮 Game created: ${gameInfo.gameId}`);

      console.log('   🧩 Getting solution...');
      const solution = this.gameSolver.getSolution();
      const stats = this.gameSolver.getStats();

      console.log('   📤 Submitting solution...');
      const victoryUrl = await this.gameApiClient.submitGameCompletion(
        gameInfo.gameId,
        solution,
        stats
      );

      console.log('   📄 Waiting for proof generation...');
      const cliData = await this.gameApiClient.pollForCLICommand(victoryUrl);

      console.log('   ⚙️ Executing blockchain transaction...');
      const keyName = account.username.toLowerCase().replace(/[^a-z0-9]/g, '_');
      await this.cliExecutor.executeCommand(cliData, keyName);

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