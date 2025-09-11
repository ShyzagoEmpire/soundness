import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

/**
 * Application configuration loaded from environment variables with fallback defaults
 * @throws {Error} When CLI_PASSWORD is not provided
 */
export const config: AppConfig = {
  GUILD_ID: process.env.GUILD_ID || '1341336526713257984',
  BOT_ID: process.env.BOT_ID || '1399503586651668480',
  GENERAL_CHANNEL_ID: process.env.GENERAL_CHANNEL_ID || '1341336527296401410',
  FALLBACK_CHANNEL_ID: process.env.FALLBACK_CHANNEL_ID,
  REQUIRED_ROLES: (process.env.REQUIRED_ROLES || '1351811717042016358,1371585936789606451').split(','),
  SPECIAL_ROLES: (process.env.SPECIAL_ROLES || '1397143403447451741,1397569441910489199,1397235702810546228,1397836509754822772,1397470961867034644').split(','),
  ACCOUNTS_FILE: process.env.ACCOUNTS_FILE || './data/accounts.json',
  RETRY_INTERVAL: parseInt(process.env.RETRY_INTERVAL || '3600000'),
  COMMAND_DELAY: parseInt(process.env.COMMAND_DELAY || '2000'),
  API_BASE_URL: process.env.API_BASE_URL || 'https://fun.soundness.xyz',
  CLI_PASSWORD: process.env.CLI_PASSWORD || ''
};

if (!config.CLI_PASSWORD) {
  throw new Error('CLI_PASSWORD environment variable is required');
}