import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  // Log incoming request
  logger.info('Incoming Request', {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length')
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    const duration = Date.now() - startTime;
    
    // Log response
    logger.logRequest(req, res, startTime);
    
    // Log suspicious activity
    if (duration > 1000) {
      logger.warn('Slow Request Detected', {
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
        threshold: '1000ms'
      });
    }

    // Call original end
    return originalEnd.call(this, chunk, encoding, cb);
  };

  next();
};

export const suspiciousActivityLogger = (req: Request, res: Response, next: NextFunction) => {
  const suspiciousPatterns = [
    /\.\./,  // Path traversal
    /<script/i,  // XSS
    /union.*select/i,  // SQL injection
    /drop.*table/i  // SQL injection
  ];

  const url = req.url;
  const userAgent = req.get('User-Agent') || '';
  
  // Check for suspicious patterns
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(url) || pattern.test(userAgent)
  );

  if (isSuspicious) {
    logger.warn('Suspicious Activity Detected', {
      method: req.method,
      url,
      userAgent,
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
  }

  next();
};
