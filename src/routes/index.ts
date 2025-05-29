import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient, PlanType, SubscriptionStatus } from '@prisma/client';
import cron from 'node-cron';
import clerkAuthenticate from '../middleware/clerkAuthenticate';
import handleUserWebhook from '../webhooks/clerkUserWebhook';

const prisma = new PrismaClient();
const router = Router();

const API_VERSION = 'v1';
const BASE_PATH = `/api/${API_VERSION}`;

// Plan limits configuration
const PLAN_LIMITS = {
  BASIC: { messages: 20, documents: 0 },
  CORE: { messages: 100, documents: 10 },
  ADVANCED: { messages: 700, documents: 50 },
  PRO: { messages: 1500, documents: 400 } // -1 means unlimited
};

// Error response helper
const sendError = (res: Response, status: number, message: string, error?: any) => {
  console.error(message, error);
  res.status(status).json({
    status: 'error',
    message,
    timestamp: new Date().toISOString()
  });
};

// Success response helper
const sendSuccess = (res: Response, data: any, message?: string) => {
  res.json({
    status: 'success',
    message: message || 'Operation completed successfully',
    data,
    timestamp: new Date().toISOString()
  });
};

// Validation helpers
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidPlanType = (plan: string): plan is PlanType => {
  return Object.values(PlanType).includes(plan as PlanType);
};

const isValidSubscriptionStatus = (status: string): status is SubscriptionStatus => {
  return Object.values(SubscriptionStatus).includes(status as SubscriptionStatus);
};

// Reset user limits based on their plan
const resetUserLimits = async (userId: string, planType: PlanType) => {
  const limits = PLAN_LIMITS[planType];
  await prisma.user.update({
    where: { id: userId },
    data: {
      messageLeft: limits.messages,
      documentLeft: limits.documents,
      messagesUsed: 0,
      documentsUsed: 0
    }
  });
};

// Cron job to reset monthly limits and handle subscription expiry
cron.schedule('0 0 1 * *', async () => {
  console.log('Running monthly subscription and limits reset...');
  
  try {
    const now = new Date();
    
    // Find expired subscriptions
    const expiredUsers = await prisma.user.findMany({
      where: {
        subscriptionEndDate: {
          lt: now
        },
        subscriptionStatus: {
          not: SubscriptionStatus.CANCELED
        }
      }
    });

    // Reset expired users to BASIC plan
    for (const user of expiredUsers) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          planType: PlanType.BASIC,
          subscriptionStatus: SubscriptionStatus.UNPAID,
          subscriptionEndDate: null,
          subscriptioStartDate: null, // Note: keeping the typo from your schema
          messageLeft: PLAN_LIMITS.BASIC.messages,
          documentLeft: PLAN_LIMITS.BASIC.documents,
          messagesUsed: 0,
          documentsUsed: 0
        }
      });
    }

    // Reset limits for all active users
    const activeUsers = await prisma.user.findMany({
      where: {
        subscriptionStatus: SubscriptionStatus.ACTIVE
      }
    });

    for (const user of activeUsers) {
      await resetUserLimits(user.id, user.planType);
    }

    console.log(`Monthly reset completed. ${expiredUsers.length} expired subscriptions processed, ${activeUsers.length} active users reset.`);
  } catch (error) {
    console.error('Error in monthly cron job:', error);
  }
});

// Cron job to check daily for subscription status updates
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily subscription status check...');
  
  try {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    
    // Find subscriptions expiring in 3 days
    const soonToExpire = await prisma.user.findMany({
      where: {
        subscriptionEndDate: {
          gte: now,
          lte: threeDaysFromNow
        },
        subscriptionStatus: SubscriptionStatus.ACTIVE
      }
    });

    // Update status to PAST_DUE for subscriptions expiring soon
    for (const user of soonToExpire) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: SubscriptionStatus.PAST_DUE
        }
      });
    }

    console.log(`Daily check completed. ${soonToExpire.length} subscriptions marked as PAST_DUE.`);
  } catch (error) {
    console.error('Error in daily cron job:', error);
  }
});

// Webhook endpoint
router.post('/api/userWebhook/clerk', handleUserWebhook);

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test endpoint
router.get(`${BASE_PATH}/try`, clerkAuthenticate, (req: Request, res: Response) => {
  console.log('Hello world');
  sendSuccess(res, null, 'Hello world');
});

// CREATE - Create new user
router.post(`${BASE_PATH}/users`, clerkAuthenticate, 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, oauthId, username, planType = PlanType.BASIC } = req.body;

      // Validation
      if (!email || !oauthId) {
        sendError(res, 400, 'Email and oauthId are required');
        return;
      }

      if (!isValidEmail(email)) {
        sendError(res, 400, 'Invalid email format');
        return;
      }

      if (planType && !isValidPlanType(planType)) {
        sendError(res, 400, 'Invalid plan type');
        return;
      }

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { oauthId }
          ]
        }
      });

      if (existingUser) {
        sendError(res, 409, 'User with this email or oauthId already exists');
        return;
      }

      const limits = PLAN_LIMITS[planType as PlanType];
      const userData = {
        email,
        oauthId,
        username: username || null,
        planType: planType as PlanType,
        messageLeft: limits.messages,
        documentLeft: limits.documents
      };

      const user = await prisma.user.create({
        data: userData
      });

      sendSuccess(res, user, 'User created successfully');
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// READ - Get user by oauthId (main identifier)
router.get(`${BASE_PATH}/users/:oauthId`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { oauthId } = req.params;

      if (!oauthId) {
        sendError(res, 400, 'OAuth ID is required');
        return;
      }

      const user = await prisma.user.findUnique({
        where: { oauthId }
      });

      if (!user) {
        sendError(res, 404, 'User not found');
        return;
      }

      sendSuccess(res, user);
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// READ - Get user by email
router.get(`${BASE_PATH}/users/email/:email`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.params;

      if (!email || !isValidEmail(email)) {
        sendError(res, 400, 'Valid email is required');
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        sendError(res, 404, 'User not found');
        return;
      }

      sendSuccess(res, user);
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// READ - Get user by internal ID
router.get(`${BASE_PATH}/users/id/:id`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        sendError(res, 400, 'User ID is required');
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id }
      });

      if (!user) {
        sendError(res, 404, 'User not found');
        return;
      }

      sendSuccess(res, user);
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// READ - Get all users (with pagination)
router.get(`${BASE_PATH}/users`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Optional filters
      const filters: any = {};
      if (req.query.planType && isValidPlanType(req.query.planType as string)) {
        filters.planType = req.query.planType;
      }
      if (req.query.status && isValidSubscriptionStatus(req.query.status as string)) {
        filters.subscriptionStatus = req.query.status;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: filters,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where: filters })
      ]);

      sendSuccess(res, {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// UPDATE - Update user by oauthId
router.patch(`${BASE_PATH}/users/:oauthId`, 
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { oauthId } = req.params;
      const { 
        incrementMessage, 
        incrementDocument, 
        messagesUsed, 
        documentsUsed,
        planType,
        ...updateData 
      } = req.body;

      if (!oauthId) {
        sendError(res, 400, 'OAuth ID is required');
        return;
      }

      // Remove fields that shouldn't be updated directly
      delete updateData.id;
      delete updateData.createdAt;
      delete updateData.updatedAt;

      // Validate update data
      if (updateData.email && !isValidEmail(updateData.email)) {
        sendError(res, 400, 'Invalid email format');
        return;
      }

      if (planType && !isValidPlanType(planType)) {
        sendError(res, 400, 'Invalid plan type');
        return;
      }

      if (updateData.subscriptionStatus && !isValidSubscriptionStatus(updateData.subscriptionStatus)) {
        sendError(res, 400, 'Invalid subscription status');
        return;
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { oauthId }
      });

      if (!existingUser) {
        sendError(res, 404, 'User not found');
        return;
      }

      // Handle plan type changes with automatic subscription setup
      if (planType && planType !== existingUser.planType) {
        console.log(`Processing plan change from ${existingUser.planType} to ${planType} for user ${oauthId}`);
        
        const newPlan = planType as PlanType;
        const limits = PLAN_LIMITS[newPlan];
        
        // Always reset usage limits for new plan
        updateData.messageLeft = limits.messages;
        updateData.documentLeft = limits.documents;
        updateData.messagesUsed = 0;
        updateData.documentsUsed = 0;
        updateData.planType = newPlan;

        const now = new Date();

        // Handle different plan upgrade scenarios
        if (newPlan === 'CORE' || newPlan === 'ADVANCED' || newPlan === 'PRO') {
          // Upgrading to a paid plan
          const subscriptionEnd = new Date(now);
          subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1); // Add 1 month
          
          updateData.subscriptioStartDate = now; // Note: keeping the typo from your schema
          updateData.subscriptionEndDate = subscriptionEnd;
          updateData.subscriptionStatus = 'ACTIVE' as SubscriptionStatus;
          
          console.log(`User ${oauthId} upgraded to ${newPlan} plan. Subscription ends: ${subscriptionEnd}`);
          
        } else if (newPlan === 'BASIC') {
          // Downgrading to BASIC
          updateData.subscriptionStatus = 'CANCELED' as SubscriptionStatus;
          updateData.subscriptionEndDate = null;
          updateData.subscriptioStartDate = null;
          
          console.log(`User ${oauthId} downgraded to BASIC plan`);
        }
      }

      // Handle usage updates (only if not changing plan type)
      if (!planType && (incrementMessage || incrementDocument || messagesUsed !== undefined || documentsUsed !== undefined)) {
        // Handle incremental updates
        if (incrementMessage === true) {
          updateData.messagesUsed = existingUser.messagesUsed + 1;
          // Only decrease if not unlimited (-1)
          if (existingUser.messageLeft !== -1) {
            updateData.messageLeft = Math.max(0, existingUser.messageLeft - 1);
          }
        }

        if (incrementDocument === true) {
          updateData.documentsUsed = existingUser.documentsUsed + 1;
          // Only decrease if not unlimited (-1)
          if (existingUser.documentLeft !== -1) {
            updateData.documentLeft = Math.max(0, existingUser.documentLeft - 1);
          }
        }

        // Handle direct usage updates (only if not using increment)
        if (incrementMessage !== true && messagesUsed !== undefined) {
          const newMessagesUsed = Math.max(0, messagesUsed);
          updateData.messagesUsed = newMessagesUsed;
          // Only adjust if not unlimited (-1)
          if (existingUser.messageLeft !== -1) {
            const usageDifference = newMessagesUsed - existingUser.messagesUsed;
            updateData.messageLeft = Math.max(0, existingUser.messageLeft - usageDifference);
          }
        }

        if (incrementDocument !== true && documentsUsed !== undefined) {
          const newDocumentsUsed = Math.max(0, documentsUsed);
          updateData.documentsUsed = newDocumentsUsed;
          // Only adjust if not unlimited (-1)
          if (existingUser.documentLeft !== -1) {
            const usageDifference = newDocumentsUsed - existingUser.documentsUsed;
            updateData.documentLeft = Math.max(0, existingUser.documentLeft - usageDifference);
          }
        }
      }

      // Handle manual subscription date updates (if provided explicitly and not auto-generated)
      if (updateData.subscriptioStartDate && typeof updateData.subscriptioStartDate === 'string') {
        updateData.subscriptioStartDate = new Date(updateData.subscriptioStartDate);
      }
      if (updateData.subscriptionEndDate && typeof updateData.subscriptionEndDate === 'string') {
        updateData.subscriptionEndDate = new Date(updateData.subscriptionEndDate);
      }

      // Check if there are any valid updates
      if (Object.keys(updateData).length === 0) {
        sendError(res, 400, 'No valid updates provided');
        return;
      }

      console.log('Update data being sent to Prisma:', updateData);

      const updatedUser = await prisma.user.update({
        where: { oauthId },
        data: updateData
      });

      sendSuccess(res, updatedUser, 'User updated successfully');
    } catch (error) {
      console.error('Error in update user endpoint:', error);
      
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const prismaError = error as any;
        if (prismaError.code === 'P2002') {
          sendError(res, 409, 'Email or oauthId already exists');
          return;
        }
        if (prismaError.code === 'P2025') {
          sendError(res, 404, 'User not found');
          return;
        }
      }
      sendError(res, 500, 'Internal server error', error);
    }
  }
);


// DELETE - Delete user by oauthId
router.delete(`${BASE_PATH}/users/:oauthId`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { oauthId } = req.params;

      if (!oauthId) {
        sendError(res, 400, 'OAuth ID is required');
        return;
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { oauthId }
      });

      if (!existingUser) {
        sendError(res, 404, 'User not found');
        return;
      }

      await prisma.user.delete({
        where: { oauthId }
      });

      sendSuccess(res, { id: existingUser.id, oauthId }, 'User deleted successfully');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const prismaError = error as any;
        if (prismaError.code === 'P2025') {
          sendError(res, 404, 'User not found');
          return;
        }
      }
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// DELETE - Delete user by internal ID (alternative endpoint)
router.delete(`${BASE_PATH}/users/id/:id`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        sendError(res, 400, 'User ID is required');
        return;
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id }
      });

      if (!existingUser) {
        sendError(res, 404, 'User not found');
        return;
      }

      await prisma.user.delete({
        where: { id }
      });

      sendSuccess(res, { id, oauthId: existingUser.oauthId }, 'User deleted successfully');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const prismaError = error as any;
        if (prismaError.code === 'P2025') {
          sendError(res, 404, 'User not found');
          return;
        }
      }
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// Catch-all for invalid API versions
router.use((req: Request, res: Response) => {
  if (!req.path.startsWith(BASE_PATH) && !req.path.startsWith('/api/userWebhook') && req.path !== '/health') {
    res.status(400).json({
      status: 'error',
      message: `Invalid API version. Use ${BASE_PATH}/*`,
      currentVersion: API_VERSION,
      pathAttempted: req.path,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;