import { SoundnessAutomation } from './src/core/SoundnessAutomation';
import { Logger } from './src/utils/Logger';
import { CONFIG } from './src/config/environments';

async function main(): Promise<void> {
    try {
        Logger.info('🚀 Starting Soundness Automation System');
        
        const automation = new SoundnessAutomation();
        await automation.initialize();
        await automation.start();
        
    } catch (error) {
        Logger.error(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    Logger.info('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    Logger.info('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Start the application
main().catch((error) => {
    Logger.error(`Unhandled error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
});