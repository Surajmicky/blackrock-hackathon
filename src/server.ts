import { buildApp } from './app';
import { logger } from './utils/logger';

const start = async () => {
  const app = buildApp();
  const port = 5477;

  try {
    const server = app.listen(port, '0.0.0.0', () => {
      logger.info('Server listening', { port });
    });

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal as any, () => {
        logger.info(`Received ${signal}, closing server...`);
        server.close(() => {
          process.exit(0);
        });
      });
    });
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
};

start();
