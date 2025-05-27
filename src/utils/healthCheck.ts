import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { CustomError } from './errorHandler';
import { logger } from './logger';

export const healthCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'success',
      message: 'Server is operational',
      data: {
        uptime: process.uptime(),
        database: 'connected',
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    next(new CustomError('Service unavailable: Database connection failed', 503));
  }
};