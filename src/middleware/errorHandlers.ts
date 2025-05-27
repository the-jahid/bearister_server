import { Request, Response, NextFunction } from 'express';
import { CustomError } from '../utils/errorHandler';
import { logger } from '../utils/logger';

interface PrismaError {
  code: string;
  meta?: { target?: string };
}

export const prismaErrorHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (error.code && error.code.startsWith('P')) {
    const prismaError = error as PrismaError;
    const errorMap: Record<string, { status: number; message: string }> = {
      'P2002': { status: 409, message: `Duplicate entry: ${prismaError.meta?.target}` },
      'P2003': { status: 400, message: 'Foreign key constraint failed' },
      'P2025': { status: 404, message: 'Record not found' },
      'P1001': { status: 503, message: 'Database connection failed' },
      'P1009': { status: 503, message: 'Database connection timeout' }
    };

    const errorInfo = errorMap[prismaError.code] || {
      status: 500,
      message: 'Database error occurred'
    };
    next(new CustomError(errorInfo.message, errorInfo.status));
  } else {
    next(error);
  }
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  next(new CustomError(`Resource not found: ${req.method} ${req.path}`, 404));
};

export const globalErrorHandler = (error: Error | CustomError, req: Request, res: Response, next: NextFunction) => {
  const isCustomError = error instanceof CustomError;
  const statusCode = isCustomError ? (error as CustomError).statusCode : 500;
  const message = isCustomError ? error.message : 'Internal Server Error';

  logger.error({
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    statusCode
  });

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};