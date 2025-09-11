import * as pty from 'node-pty';
import { CLIData } from '../types';
import { config } from '../config/environment';

/**
 * Executes soundness-cli blockchain commands with automatic password handling
 */
export class CLIExecutor {
  /**
   * Executes CLI command with dynamic key name substitution
   * @param cliData - CLI command data from victory page
   * @param keyName - Key name to use for transaction
   */
  public async executeCommand(cliData: CLIData, keyName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const modifiedCommand = cliData.fullCommand.replace(
        /--key-name="[^"]*"/,
        `--key-name="${keyName}"`
      );

      const parsedArgs = this.parseCommand(modifiedCommand);
      const command = parsedArgs.shift();

      if (!command) {
        reject(new Error('No command found'));
        return;
      }

      let fullOutput = '';
      let passwordSent = false;

      const ptyProcess = pty.spawn(command, parsedArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: process.env
      });

      ptyProcess.onData(data => {
        const output = data.toString();
        fullOutput += output;

        if (output.toLowerCase().includes('enter password to decrypt the secret key:') && !passwordSent) {
          passwordSent = true;
          ptyProcess.write(`${config.CLI_PASSWORD}\r`);
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          const status = fullOutput.match(/✅ Status:\s*(.*)/)?.[1] ?? 'Success';
          const digest = fullOutput.match(/🔗 Transaction Digest:\s*(\S+)/)?.[1] ?? 'N/A';
          const suiscanLink = fullOutput.match(/🔍 Suiscan Link:\s*(\S+)/)?.[1] ?? 'N/A';
          const proofId = fullOutput.match(/📦 Proof Blob ID:\s*(\S+)/)?.[1] ?? 'N/A';

          console.log('\n🎉 Transaction Submitted Successfully');
          console.log(`   Status: ${status}`);
          console.log(`   Key Used: ${keyName}`);
          console.log(`   Transaction: ${digest}`);
          console.log(`   Proof ID: ${proofId}`);
          console.log(`   Explorer: ${suiscanLink}\n`);

          resolve();
        } else {
          reject(new Error(`CLI execution failed with code ${exitCode}`));
        }
      });
    });
  }

  /**
   * Parses command string into array of arguments, handling quoted strings
   */
  private parseCommand(commandString: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < commandString.length; i++) {
      const char = commandString[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }
}