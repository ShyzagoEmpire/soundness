import * as pty from 'node-pty';
import { config } from '../config/environment';
import { Utils, ErrorHandler } from '../utils';

/**
 * Executes soundness-cli blockchain commands with automatic password handling
 */
export class CLIExecutor {
  /**
   * Executes CLI command with dynamic key name substitution
   * @param command - CLI command string
   * @param keyName - Key name to use for transaction
   */
  public async executeCommand(command: string, keyName: string): Promise<void> {
    const modifiedCommand = this.prepareCommand(command, keyName);
    const parsedArgs = Utils.parseCommand(modifiedCommand);
    const commandName = parsedArgs.shift();

    if (!commandName) {
      throw new Error('No command found in CLI command string');
    }

    ErrorHandler.log(`Executing: ${commandName} with key: ${keyName}`, 'CLI');
    
    return this.executePtyCommand(commandName, parsedArgs, keyName);
  }

  /**
   * Prepares command by substituting key name
   */
  private prepareCommand(command: string, keyName: string): string {
    return command.replace(
      /--key-name="[^"]*"/,
      `--key-name="${keyName}"`
    );
  }

  /**
   * Executes command using PTY with password automation
   */
  private async executePtyCommand(
    commandName: string, 
    args: string[], 
    keyName: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let fullOutput = '';
      let passwordSent = false;
      let isCompleted = false;

      const ptyProcess = pty.spawn(commandName, args, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: process.env
      });

      const timeout = setTimeout(() => {
        if (!isCompleted) {
          ptyProcess.kill();
          reject(new Error('CLI command execution timeout (60s)'));
        }
      }, 60000);

      ptyProcess.onData(data => {
        const output = data.toString();
        fullOutput += output;

        // Auto-send password when prompted
        if (output.toLowerCase().includes('enter password to decrypt the secret key:') && !passwordSent) {
          passwordSent = true;
          ErrorHandler.log('Sending password...', 'CLI');
          ptyProcess.write(`${config.CLI_PASSWORD}\r`);
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        isCompleted = true;
        clearTimeout(timeout);
        
        if (exitCode === 0) {
          this.logTransactionSuccess(fullOutput, keyName);
          resolve();
        } else {
          const error = this.extractErrorFromOutput(fullOutput);
          const signalInfo = signal ? ` (signal: ${signal})` : '';
          reject(new Error(`CLI execution failed (code ${exitCode}${signalInfo}): ${error}`));
        }
      });
    });
  }

  /**
   * Logs successful transaction details
   */
  private logTransactionSuccess(output: string, keyName: string): void {
    const status = output.match(/✅ Status:\s*(.*)/)?.[1] ?? 'Success';
    const digest = output.match(/🔗 Transaction Digest:\s*(\S+)/)?.[1] ?? 'N/A';
    const suiscanLink = output.match(/🔍 Suiscan Link:\s*(\S+)/)?.[1] ?? 'N/A';
    const proofId = output.match(/📦 Proof Blob ID:\s*(\S+)/)?.[1] ?? 'N/A';

    console.log('\n🎉 Transaction Submitted Successfully');
    console.log(`   Status: ${status}`);
    console.log(`   Key Used: ${keyName}`);
    console.log(`   Transaction: ${digest}`);
    console.log(`   Proof ID: ${proofId}`);
    console.log(`   Explorer: ${suiscanLink}\n`);
  }

  /**
   * Extracts error information from CLI output
   */
  private extractErrorFromOutput(output: string): string {
    // Look for common error patterns
    const errorPatterns = [
      /Error:\s*(.*?)$/m,
      /Failed:\s*(.*?)$/m,
      /❌\s*(.*?)$/m,
      /ERROR\s*(.*?)$/m
    ];

    for (const pattern of errorPatterns) {
      const match = output.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Return last non-empty line if no specific error pattern found
    const lines = output.split('\n').filter(line => line.trim());
    return lines[lines.length - 1] || 'Unknown CLI error';
  }
}