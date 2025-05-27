
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes';
import { requestLogger } from './utils/requestLogger';
import { healthCheck } from './utils/healthCheck';
import { notFoundHandler, prismaErrorHandler, globalErrorHandler } from './middleware/errorHandlers';

const app: Application = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Routes
app.get('/health', healthCheck);

app.use(routes);

// Error handling
app.use(notFoundHandler);
app.use(prismaErrorHandler);
app.use(globalErrorHandler);

export default app;