import { FuelBot } from './bot';
import { getLogger } from './logger';

async function main(): Promise<void> {
  const bot = new FuelBot();
  await bot.start();

  process.on('SIGINT', () => {
    getLogger().info('SIGINT received');
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    getLogger().info('SIGTERM received');
    bot.stop();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    getLogger().fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
    bot.stop();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    getLogger().error({ reason }, 'Unhandled rejection');
  });
}

main();
