export class CustomError extends Error {
    statusCode: number;
    
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
      this.name = 'CustomError';
      
      // Maintain proper stack trace
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  // Common error creators
  export const createValidationError = (message: string) => 
    new CustomError(message, 400);
  
  export const createUnauthorizedError = (message: string = 'Unauthorized') => 
    new CustomError(message, 401);
  
  export const createForbiddenError = (message: string = 'Forbidden') => 
    new CustomError(message, 403);
  
  export const createNotFoundError = (message: string = 'Resource not found') => 
    new CustomError(message, 404);