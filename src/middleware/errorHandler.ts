import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─── Error Classes ───────────────────────────────────────────────────────────

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

// ─── Central Error Handler ───────────────────────────────────────────────────
// Express requires all 4 parameters to recognize this as an error-handling middleware.

export const errorHandler = (
  error: AppError | SyntaxError | Error,
  req: Request,
  res: Response,
  _next: NextFunction  // must be present for Express to treat this as error middleware
) => {
  // Log every error with request context
  logger.logError(error as Error, {
    url: req.url,
    method: req.method,
    body: req.body,
    headers: req.headers,
    ip: req.ip
  });

  // ── Malformed JSON body (SyntaxError from express.json()) ──────────────
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON in request body',
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method
      }
    });
    return;
  }

  // ── Payload too large (from express.json limit) ────────────────────────
  if (error.message?.includes('request entity too large')) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the maximum allowed size',
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method
      }
    });
    return;
  }

  // ── Known operational errors ───────────────────────────────────────────
  const appError = error as AppError;
  const statusCode = appError.statusCode || 500;
  const code = appError.code || 'INTERNAL_SERVER_ERROR';

  const errorResponse: Record<string, unknown> = {
    code,
    message: statusCode === 500
      ? 'An unexpected error occurred'
      : error.message,
    timestamp: new Date().toISOString(),
    path: req.url,
    method: req.method
  };

  // Include stack trace only in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  res.status(statusCode).json({ error: errorResponse });
};

// ─── 404 Handler ─────────────────────────────────────────────────────────────

export const notFoundHandler = (req: Request, res: Response) => {
  const error = new NotFoundError(`Route ${req.method} ${req.url} not found`);
  errorHandler(error, req, res, (() => { }) as NextFunction);
};

// ─── Async Wrapper ───────────────────────────────────────────────────────────
// Catches both sync throws and rejected promises, forwarding to errorHandler.

export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
