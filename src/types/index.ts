/**
 * Represents a Discord account with validation status and game statistics
 */
export interface AccountData {
  id: string;
  token: string;
  username: string;
  globalName: string;
  roles: Array<{ id: string; name: string }>;
  stats: {
    played: number;
    wins: number;
    winRate: number;
    badgesEarned: number;
  };
  status: 'confirmed' | 'pending';
  executableChannel: 'general' | 'fallback' | null;
}

/**
 * Storage structure for persisting account data to JSON file
 */
export interface AccountsStorage {
  accounts: AccountData[];
  lastUpdated: string;
  version: string;
}

/**
 * Parsed game information from Discord bot response
 */
export interface GameInfo {
  gameId: string;
  gameUrl?: string;
  title: string;
  timestamp: string;
}

/**
 * Game statistics and solution data for 8Queens puzzle
 */
export interface GameStats {
  moves: number;
  duration: string;
  efficiency: number;
  solution: boolean[][];
}

/**
 * Application configuration loaded from environment variables
 */
export interface AppConfig {
  GUILD_ID: string;
  BOT_ID: string;
  GENERAL_CHANNEL_ID: string;
  FALLBACK_CHANNEL_ID?: string;
  REQUIRED_ROLES: string[];
  SPECIAL_ROLES: string[];
  ACCOUNTS_FILE: string;
  RETRY_INTERVAL: number;
  COMMAND_DELAY: number;
  API_BASE_URL: string;
  CLI_PASSWORD: string;
}

/**
 * Result of game execution attempt
 */
export interface GameExecutionResult {
  success: boolean;
  rateLimited?: boolean;
  accessRestricted?: boolean;
  error?: string;
}