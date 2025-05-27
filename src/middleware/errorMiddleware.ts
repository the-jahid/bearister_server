import { Request, Response, NextFunction } from 'express';
import { CustomError } from '../utils/errorHandler';
import { logger } from '../utils/logger';

export const errorMiddleware = (
  error: Error | CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.error({
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method
  });

  // Determine if it's a custom error
  const isCustomError = error instanceof CustomError;
  
  const statusCode = isCustomError 
    ? (error as CustomError).statusCode 
    : 500;
  
  const message = isCustomError 
    ? error.message 
    : 'Internal Server Error';

  // Send error response
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};