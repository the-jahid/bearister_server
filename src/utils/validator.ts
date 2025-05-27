import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  googleId: z.string().optional(),
  googleProfile: z.any().optional()
}).refine(data => (data.password && !data.googleId) || (!data.password && data.googleId), {
  message: 'Either password or googleId must be provided, but not both'
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const googleLoginSchema = z.object({
  googleId: z.string().min(1, 'Google ID is required'),
  profile: z.any().optional()
});