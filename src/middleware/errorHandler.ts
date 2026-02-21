import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

export class ValidationError extends Error implements AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  isOperational = true;

  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class BusinessLogicError extends Error implements AppError {
  statusCode = 422;
  code = 'BUSINESS_LOGIC_ERROR';
  isOperational = true;

  constructor(message: string, public operation?: string) {
    super(message);
    this.name = 'BusinessLogicError';
  }
}

export class NotFoundError extends Error implements AppError {
  statusCode = 404;
  code = 'NOT_FOUND';
  isOperational = true;

  constructor(message: string = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.logError(error, {
    url: req.url,
    method: req.method,
    body: req.body,
    headers: req.headers,
    ip: req.ip
  });

  // Determine status code
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';

  // Prepare error response
  const errorResponse = {
    error: {
      code,
      message: error.message,
      timestamp: new Date().toISOString(),
      path: req.url,
      method: req.method,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack
      })
    }
  };

  // Send error response
  res.status(statusCode).json(errorResponse);
};

export const notFoundHandler = (req: Request, res: Response) => {
  const error = new NotFoundError(`Route ${req.method} ${req.url} not found`);
  errorHandler(error, req, res, () => {});
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
