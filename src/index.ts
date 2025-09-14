import { AutomationEngine } from './core/AutomationEngine';
import { ErrorHandler } from './utils';

/**
 * Application entry point with enhanced error handling
 */
async function main(): Promise<void> {
  try {
    const automation = new AutomationEngine();
    await automation.start();
  } catch (error) {
    ErrorHandler.handle(error, 'Application startup');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  ErrorHandler.log(`Unhandled Rejection at: ${promise}, reason: ${reason}`, 'Process');
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  ErrorHandler.handle(error, 'Uncaught Exception');
  process.exit(1);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  ErrorHandler.log('Received SIGINT, shutting down gracefully...', 'Process');
  process.exit(0);
});

process.on('SIGTERM', () => {
  ErrorHandler.log('Received SIGTERM, shutting down gracefully...', 'Process');
  process.exit(0);
});

main();