import { Webhook } from 'svix';
import { NextFunction, Request, Response } from 'express';
import { WebhookEvent } from '@clerk/clerk-sdk-node';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Handles user-related webhook events from Clerk
 */
const handleUserWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const WEBHOOK_SECRET = process.env.USER_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      logger.error('Missing webhook secret environment variable');
      res.status(500).json({ 
        status: 'error', 
        message: 'Server configuration error' 
      });
      return;
    }

    // Get the Svix headers for verification
    const svixHeaders = {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string
    };

    // Validate headers
    if (!svixHeaders['svix-id'] || !svixHeaders['svix-timestamp'] || !svixHeaders['svix-signature']) {
      logger.warn('Missing Svix headers', { headers: req.headers });
      res.status(400).json({ 
        status: 'error', 
        message: 'Missing verification headers' 
      });
      return;
    }
     
    // Get the request body
    const payload = req.body;
    const body = JSON.stringify(payload);

    // Create webhook instance with secret
    const webhook = new Webhook(WEBHOOK_SECRET);
    let event: WebhookEvent;

    // Verify the webhook signature
    try {
      event = webhook.verify(body, svixHeaders) as WebhookEvent;
    } catch (err) {
      logger.error('Webhook verification failed', { error: err });
      res.status(400).json({ 
        status: 'error', 
        message: 'Invalid webhook signature' 
      });
      return;
    }

    // Get event information
    const { id } = event.data;
    const eventType = event.type;
    
    logger.info(`Processing user webhook: ${eventType}`, { userId: id });

    // Only process user-related events
    if (eventType.startsWith('user.')) {
      switch (eventType) {
        case 'user.created':
          await handleUserCreated(event.data);
          break;
          
        case 'user.updated':
          await handleUserUpdated(event.data);
          break;
          
        case 'user.deleted':
          await handleUserDeleted(event.data);
          break;
          
        default:
          logger.info(`Unhandled user webhook type: ${eventType}`);
      }
      
      res.status(200).json({ 
        status: 'success',
        message: 'User webhook processed successfully' 
      });
      return;
    } else {
      // Not a user event, pass to the next webhook handler
      logger.info(`Non-user webhook received: ${eventType}, forwarding to next handler`);
      return next();
    }
  } catch (error) {
    logger.error('Error processing user webhook', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Avoid sending multiple responses
    if (!res.headersSent) {
      res.status(500).json({ 
        status: 'error', 
        message: 'Error processing webhook' 
      });
    }
    return;
  }
};

/**
 * Handle user creation event
 */
async function handleUserCreated(userData: any): Promise<void> {
  const { id, email_addresses } = userData;
  const primaryEmail = email_addresses.find(
    (email: any) => email.id === userData.primary_email_address_id
  );

  if (!primaryEmail) {
    logger.warn('No primary email found for user', { userId: id });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        oauthId: id,
        email: primaryEmail.email_address,
        username: userData.username || primaryEmail.email_address.split('@')[0]
      }
    });
    
    logger.info('User created successfully', { 
      userId: user.id, 
      email: user.email 
    });
  } catch (error) {
    logger.error('Failed to create user', { 
      userId: id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Handle user update event
 */
async function handleUserUpdated(userData: any): Promise<void> {
  const { id, email_addresses } = userData;
  const primaryEmail = email_addresses.find(
    (email: any) => email.id === userData.primary_email_address_id
  );

  if (!primaryEmail) {
    logger.warn('No primary email found for user update', { userId: id });
    return;
  }

  try {
    const user = await prisma.user.update({
      where: { oauthId: id },
      data: {
        email: primaryEmail.email_address,
        username: userData.username || primaryEmail.email_address.split('@')[0]
      }
    });
    
    logger.info('User updated successfully', { 
      userId: user.id, 
      email: user.email 
    });
  } catch (error) {
    logger.error('Failed to update user', { 
      userId: id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Handle user deletion event
 */
async function handleUserDeleted(userData: any): Promise<void> {
  const { id } = userData;
  
  try {
    await prisma.user.delete({
      where: { oauthId: id }
    });
    
    logger.info('User deleted successfully', { userId: id });
  } catch (error) {
    logger.error('Failed to delete user', { 
      userId: id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

export default handleUserWebhook;