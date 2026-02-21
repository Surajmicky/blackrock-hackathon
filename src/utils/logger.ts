import fs from 'fs';
import path from 'path';

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

export class Logger {
  private logFile: string;
  private logLevel: LogLevel;

  constructor() {
    this.logFile = path.join(process.cwd(), 'app.log');
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
  }

  private writeLog(level: LogLevel, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };

    // Console output
    console.log(JSON.stringify(logEntry));

    // File output
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.logFile, logLine);
  }

  error(message: string, data?: any) {
    this.writeLog(LogLevel.ERROR, message, data);
  }

  warn(message: string, data?: any) {
    this.writeLog(LogLevel.WARN, message, data);
  }

  info(message: string, data?: any) {
    this.writeLog(LogLevel.INFO, message, data);
  }

  debug(message: string, data?: any) {
    if (this.logLevel === LogLevel.DEBUG) {
      this.writeLog(LogLevel.DEBUG, message, data);
    }
  }

  // Request logging
  logRequest(req: any, res: any, startTime: number) {
    const duration = Date.now() - startTime;
    this.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress
    });
  }

  // Business logic logging
  logTransaction(transactionId: string, operation: string, result: any) {
    this.info('Transaction Processing', {
      transactionId,
      operation,
      result,
      timestamp: new Date().toISOString()
    });
  }

  // Error logging with context
  logError(error: Error, context?: any) {
    this.error('Application Error', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });
  }

  // Performance logging
  logPerformance(operation: string, duration: number, metadata?: any) {
    this.info('Performance Metric', {
      operation,
      duration: `${duration}ms`,
      ...metadata
    });
  }
}

export const logger = new Logger();
