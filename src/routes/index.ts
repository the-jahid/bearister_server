// import { Router, Request, Response, NextFunction } from 'express';
// import clerkAuthenticate from '../middleware/clerkAuthenticate';
// import handleUserWebhook from '../webhooks/clerkUserWebhook';

// import { PrismaClient } from '@prisma/client';

// const prisma = new PrismaClient();

// const router = Router();
// const API_VERSION = 'v1';
// const BASE_PATH = `/api/${API_VERSION}`;

// router.post('/api/userWebhook/clerk', handleUserWebhook );

// router.get(`${BASE_PATH}/try`, clerkAuthenticate,  (req: Request, res: Response, next: NextFunction) => {
//   console.log('Hello world');
//   res.send('Hello world');
// });

// // 
// // get user by ID
// router.get(`${BASE_PATH}/getUser`, clerkAuthenticate,  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   const userId = req.query.userId as string;

//   if (!userId) {
//     res.status(400).json({ error: 'User ID is required' });
//     return;
//   }

//   try {
//     const user = await prisma.user.findUnique({
//       where: {
//         id: userId,
//       },
//     });

//     if (!user) {
//       res.status(404).json({ error: 'User not found' });
//       return;
//     }

//     res.json(user);
//   } catch (error) {
//     console.error('Error fetching user:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });


// // update user by ID
// router.patch(`${BASE_PATH}/updateUser`, clerkAuthenticate,  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   const userId = req.query.userId as string;
//   const updateData = req.body;

//   if (!userId) {
//     res.status(400).json({ error: 'User ID is required' });
//     return;
//   }

//   try {
//     const updatedUser = await prisma.user.update({
//       where: {
//         id: userId,
//       },
//       data: updateData,
//     });

//     res.json(updatedUser);
//   } catch (error) {
//     console.error('Error updating user:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// // delete user by ID
// router.delete(`${BASE_PATH}/deleteUser`, clerkAuthenticate,  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
//   const userId = req.query.userId as string;

//   if (!userId) {
//     res.status(400).json({ error: 'User ID is required' });
//     return;
//   }

//   try {
//     await prisma.user.delete({
//       where: {
//         id: userId,
//       },
//     });

//     res.json({ message: 'User deleted successfully' });
//   } catch (error) {
//     console.error('Error deleting user:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });


// router.use((req: Request, res: Response) => {
//   if (!req.path.startsWith(BASE_PATH) && req.path !== '/' && req.path !== '/health') {
//     res.status(400).json({
//       status: 'error',
//       message: `Invalid API version. Use ${BASE_PATH}/*`,
//       currentVersion: API_VERSION,
//       pathAttempted: req.path
//     });
//   }
// });

// export default router;


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
  ADVANCED: { messages: 500, documents: 50 },
  PRO: { messages: -1, documents: -1 } // -1 means unlimited
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

// READ - Get user by ID
router.get(`${BASE_PATH}/users/:id`, clerkAuthenticate,
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

// UPDATE - Update user
router.patch(`${BASE_PATH}/users/:id`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        sendError(res, 400, 'User ID is required');
        return;
      }

      // Validate update data
      if (updateData.email && !isValidEmail(updateData.email)) {
        sendError(res, 400, 'Invalid email format');
        return;
      }

      if (updateData.planType && !isValidPlanType(updateData.planType)) {
        sendError(res, 400, 'Invalid plan type');
        return;
      }

      if (updateData.subscriptionStatus && !isValidSubscriptionStatus(updateData.subscriptionStatus)) {
        sendError(res, 400, 'Invalid subscription status');
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

      // If plan type is being updated, reset limits
      if (updateData.planType && updateData.planType !== existingUser.planType) {
        const limits = PLAN_LIMITS[updateData.planType as PlanType];
        updateData.messageLeft = limits.messages;
        updateData.documentLeft = limits.documents;
        updateData.messagesUsed = 0;
        updateData.documentsUsed = 0;
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData
      });

      sendSuccess(res, updatedUser, 'User updated successfully');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === 'P2002') {
        sendError(res, 409, 'Email or oauthId already exists');
        return;
      }
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// UPDATE - Update subscription
router.patch(`${BASE_PATH}/users/:id/subscription`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { planType, subscriptionStatus, durationMonths = 1 } = req.body;

      if (!id) {
        sendError(res, 400, 'User ID is required');
        return;
      }

      if (!planType || !isValidPlanType(planType)) {
        sendError(res, 400, 'Valid plan type is required');
        return;
      }

      if (!subscriptionStatus || !isValidSubscriptionStatus(subscriptionStatus)) {
        sendError(res, 400, 'Valid subscription status is required');
        return;
      }

      const existingUser = await prisma.user.findUnique({
        where: { id }
      });

      if (!existingUser) {
        sendError(res, 404, 'User not found');
        return;
      }

      const now = new Date();
      const endDate = new Date(now.getTime() + (durationMonths * 30 * 24 * 60 * 60 * 1000));
      const limits = PLAN_LIMITS[planType];

      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          planType,
          subscriptionStatus,
          subscriptioStartDate: now, // Note: keeping the typo from your schema
          subscriptionEndDate: endDate,
          messageLeft: limits.messages,
          documentLeft: limits.documents,
          messagesUsed: 0,
          documentsUsed: 0
        }
      });

      sendSuccess(res, updatedUser, 'Subscription updated successfully');
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// UPDATE - Consume usage (messages/documents)
router.patch(`${BASE_PATH}/users/:id/usage`, clerkAuthenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { type, amount = 1 } = req.body;

      if (!id) {
        sendError(res, 400, 'User ID is required');
        return;
      }

      if (!type || !['message', 'document'].includes(type)) {
        sendError(res, 400, 'Type must be either "message" or "document"');
        return;
      }

      if (amount < 1) {
        sendError(res, 400, 'Amount must be positive');
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id }
      });

      if (!user) {
        sendError(res, 404, 'User not found');
        return;
      }

      // Check if user has enough usage left
      const currentLeft = type === 'message' ? user.messageLeft : user.documentLeft;
      if (currentLeft !== -1 && currentLeft < amount) {
        sendError(res, 403, `Insufficient ${type} quota remaining`);
        return;
      }

      // Update usage
      const updateData: any = {};
      if (type === 'message') {
        updateData.messagesUsed = user.messagesUsed + amount;
        if (user.messageLeft !== -1) {
          updateData.messageLeft = user.messageLeft - amount;
        }
      } else {
        updateData.documentsUsed = user.documentsUsed + amount;
        if (user.documentLeft !== -1) {
          updateData.documentLeft = user.documentLeft - amount;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData
      });

      sendSuccess(res, updatedUser, `${type} usage updated successfully`);
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// DELETE - Delete user
router.delete(`${BASE_PATH}/users/:id`, clerkAuthenticate,
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

      sendSuccess(res, null, 'User deleted successfully');
    } catch (error) {
      sendError(res, 500, 'Internal server error', error);
    }
  }
);

// GET - User statistics
router.get(`${BASE_PATH}/users/:id/stats`, clerkAuthenticate,
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

      const stats = {
        userId: user.id,
        planType: user.planType,
        subscriptionStatus: user.subscriptionStatus,
        usage: {
          messages: {
            used: user.messagesUsed,
            remaining: user.messageLeft === -1 ? 'unlimited' : user.messageLeft,
            total: user.messageLeft === -1 ? 'unlimited' : user.messagesUsed + user.messageLeft
          },
          documents: {
            used: user.documentsUsed,
            remaining: user.documentLeft === -1 ? 'unlimited' : user.documentLeft,
            total: user.documentLeft === -1 ? 'unlimited' : user.documentsUsed + user.documentLeft
          }
        },
        subscription: {
          startDate: user.subscriptioStartDate,
          endDate: user.subscriptionEndDate,
          daysRemaining: user.subscriptionEndDate 
            ? Math.ceil((user.subscriptionEndDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
            : null
        }
      };

      sendSuccess(res, stats);
    } catch (error) {
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







