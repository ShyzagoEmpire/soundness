import { AutomationEngine } from './core/AutomationEngine';

/**
 * Application entry point - initializes and starts the automation engine
 */
async function main(): Promise<void> {
  const automation = new AutomationEngine();
  await automation.start();
}

main().catch(console.error);