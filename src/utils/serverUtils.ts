import { logger } from './logger';

export const handleUncaughtException = (err: Error) => {
  logger.error('Uncaught Exception:', {
    message: err.message,
    stack: err.stack
  });
  return 1;
};

export const handleUnhandledRejection = (reason: Error | any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection:', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise
  });
  return 1;
};

export const logServerStart = (port: number | string, env: string) => {
  logger.info({
    message: 'Server started successfully',
    port,
    environment: env,
    timestamp: new Date().toISOString()
  });
};