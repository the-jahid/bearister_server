import { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/clerk-sdk-node';
import prisma from '../config/database';


interface AuthenticatedRequest extends Request {
  user?: any;
}

const clerkAuthenticate = async (req: Request, res: Response, next: NextFunction) : Promise<void> => {
  try {
    const sessionToken = req.headers.authorization?.split(' ')[1];
   
    
    const response = await clerkClient.verifyToken(sessionToken || '')
    console.log('response', response);
    next();

   
  } catch (error) {
    console.log(error)
    next()
  }
};

export default clerkAuthenticate;



