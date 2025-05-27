export interface ApiResponse<T> {
    status: 'success' | 'error';
    message: string;
    data?: T;
    error?: { code: number; details?: string };
  }
  
  export const successResponse = <T>(message: string, data?: T): ApiResponse<T> => ({
    status: 'success',
    message,
    data
  });
  
  export const errorResponse = (message: string, code: number, details?: string): ApiResponse<never> => ({
    status: 'error',
    message,
    error: { code, details }
  });