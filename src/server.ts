import app from './app';
import prisma from './config/database';
import { logger } from './utils/logger';
import { handleUncaughtException, handleUnhandledRejection, logServerStart } from './utils/serverUtils';

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Process-level error handlers
process.on('uncaughtException', (err) => {
  process.exit(handleUncaughtException(err));
});

process.on('unhandledRejection', (reason, promise) => {
  process.exit(handleUnhandledRejection(reason, promise));
});

// Shutdown handler
const shutdown = async (server: any, exitCode: number = 0) => {
  try {
    server.close(() => logger.info('HTTP server closed'));
    await prisma.$disconnect();
    logger.info('Prisma database connection closed');
    process.exit(exitCode);
  } catch (error) {
    logger.error('Shutdown error:', error);
    process.exit(1);
  }
};

const startServer = async () => {
  try {
    // Database connection
    await prisma.$connect();
    logger.info('Successfully connected to PostgreSQL via Prisma');

    // Start server
    const server = app.listen(PORT, () => logServerStart(PORT, NODE_ENV));

    // Server error handling
    server.on('error', (error) => {
      logger.error('Server error:', error);
      shutdown(server, 1);
    });

    // Graceful shutdown
    const shutdownHandler = async (signal: string) => {
      logger.info(`${signal} received: initiating graceful shutdown`);
      await shutdown(server);
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));

  } catch (error) {
    logger.error('Server startup failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

// Initialize server
startServer().catch(async (error) => {
  logger.error('Critical startup error:', error);
  await prisma.$disconnect();
  process.exit(1);
});