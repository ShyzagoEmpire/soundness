# Soundness

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
cd soundness
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
GUILD_ID=1341336526713257984
BOT_ID=1399503586651668480
GENERAL_CHANNEL_ID=1341336527296401410
FALLBACK_CHANNEL_ID=1391039818988916768

# Role Requirements (comma-separated)
REQUIRED_ROLES=1351811717042016358,1371585936789606451
SPECIAL_ROLES=1397143403447451741,1397569441910489199,1397235702810546228,1397836509754822772,1397470961867034644

# File Configuration
ACCOUNTS_FILE=./data/accounts.json

# Timing Configuration (milliseconds)
RETRY_INTERVAL=3600000
COMMAND_DELAY=2000

# API Configuration
API_BASE_URL=https://fun.soundness.xyz

# CLI Configuration (REQUIRED)
CLI_PASSWORD=your_secure_password_here