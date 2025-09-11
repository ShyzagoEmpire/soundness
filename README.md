# Discord 8Queens Automation

A TypeScript automation tool for Discord's 8Queens puzzle game with integrated blockchain transaction processing. Features smart account management, failure tracking, and continuous operation.

## Features

- **Automated Puzzle Solving**: Instant 8Queens puzzle resolution with optimal pre-computed solutions
- **Multi-Account Management**: Secure token validation with comprehensive role and permission checking
- **Blockchain Integration**: Automated CLI execution for proof submission with dynamic key management
- **Smart Failure Tracking**: Automatic removal of problematic accounts after 3 consecutive failures
- **Continuous Operation**: Hourly automation cycles with clear scheduling and progress tracking
- **Clean Architecture**: Feature-based modular design with comprehensive JSDoc documentation

## Architecture

### Core Components

- **AutomationEngine**: Main orchestrator managing the complete automation workflow
- **AccountManager**: Handles account persistence, failure tracking, and automatic cleanup
- **DiscordClient**: Manages Discord API interactions and slash command execution
- **GameSolver**: Provides optimal 8Queens puzzle solutions with randomized timing
- **GameAPIClient**: Handles HTTP communication with the game backend (3-hour polling support)
- **CLIExecutor**: Executes blockchain transactions with automatic password handling

### Workflow

1. **Initial Setup**: Key store validation and optional account collection
2. **Continuous Cycles**: Hourly automation cycles with profile sync, game execution, and stats updates
3. **Smart Management**: Automatic failure tracking and account cleanup
4. **Blockchain Processing**: CLI command extraction and execution with proof submission

## Installation

```bash
# Clone and setup
git clone https://github.com/ShyzagoEmpire/soundness
cd discord-8queens-automation
npm install

# Environment configuration
cp .env.example .env
# Edit .env with your settings

# Build and run
npm run build
npm start
```

## Configuration

### Environment Variables (.env)

```env
# Discord Configuration
GUILD_ID=your_guild_id
BOT_ID=your_bot_application_id
GENERAL_CHANNEL_ID=your_primary_channel_id
FALLBACK_CHANNEL_ID=your_fallback_channel_id

# Role Requirements (comma-separated)
REQUIRED_ROLES=role_id_1,role_id_2
SPECIAL_ROLES=special_role_id_1,special_role_id_2

# Timing Configuration (milliseconds)
RETRY_INTERVAL=3600000  # 1 hour
COMMAND_DELAY=2000      # 2 seconds

# File and API Configuration
ACCOUNTS_FILE=./data/accounts.json