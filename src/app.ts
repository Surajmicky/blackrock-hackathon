import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import { TransactionController } from './controllers/transactionController';
import { errorHandler, notFoundHandler, asyncHandler } from './middleware/errorHandler';
import { requestLogger, suspiciousActivityLogger } from './middleware/requestLogger';
import { logger } from './utils/logger';

const app = express();

// Middleware
app.use(express.json({ limit: '250mb' }));
app.use(cors());
app.use(requestLogger);
app.use(suspiciousActivityLogger);

// Routes
const transactionController = new TransactionController();

// POST /blackrock/challenge/v1/transactions:parse
app.post('/blackrock/challenge/v1/transactions\\:parse', 
  asyncHandler(transactionController.parseTransactions.bind(transactionController))
);

// POST /blackrock/challenge/v1/transactions:validator
app.post('/blackrock/challenge/v1/transactions\\:validator', 
  asyncHandler(transactionController.validateTransactions.bind(transactionController))
);

// POST /blackrock/challenge/v1/transactions:filter
app.post('/blackrock/challenge/v1/transactions\\:filter', 
  asyncHandler(transactionController.filterTransactions.bind(transactionController))
);

// POST /blackrock/challenge/v1/returns:nps
app.post('/blackrock/challenge/v1/returns\\:nps', 
  asyncHandler(transactionController.calculateNPSReturns.bind(transactionController))
);

// POST /blackrock/challenge/v1/returns:index
app.post('/blackrock/challenge/v1/returns\\:index', 
  asyncHandler(transactionController.calculateIndexReturns.bind(transactionController))
);

// GET /blackrock/challenge/v1/performance
app.get('/blackrock/challenge/v1/performance', 
  asyncHandler(transactionController.getPerformance.bind(transactionController))
);

// Health check
app.get('/health', asyncHandler((_req: Request, res: Response) => {
  logger.info('Health check accessed');
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}));

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BlackRock Challenge API',
      version: '1.0.0'
    },
    servers: [{ url: 'http://localhost:5477' }],
    paths: {
      '/blackrock/challenge/v1/transactions:parse': {
        post: {
          summary: 'Calculate ceiling and remanent for each transaction',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      amount: { type: 'number' },
                      timestamp: { type: 'string' },
                      date: { type: 'string' }
                    },
                    required: ['amount']
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Parsed transactions',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        date: { type: 'string' },
                        amount: { type: 'number' },
                        ceiling: { type: 'number' },
                        remanent: { type: 'number' }
                      },
                      required: ['date', 'amount', 'ceiling', 'remanent']
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/blackrock/challenge/v1/transactions:validator': {
        post: {
          summary: 'Flag invalid (negative amounts) and duplicate transactions',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    wage: { type: 'number' },
                    transactions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          amount: { type: 'number' },
                          timestamp: { type: 'string', format: 'date-time' },
                          date: { type: 'string', format: 'date-time' },
                          ceiling: { type: 'number' },
                          remanent: { type: 'number' }
                        },
                        required: ['amount']
                      }
                    }
                  },
                  required: ['transactions']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Validation results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      valid: { type: 'array' },
                      invalid: { type: 'array' }
                    },
                    required: ['valid', 'invalid']
                  }
                }
              }
            }
          }
        }
      },
      '/blackrock/challenge/v1/transactions:filter': {
        post: {
          summary: 'Validate transactions according to q/p/k periods and return valid/invalid transactions',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    wage: { type: 'number' },
                    transactions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          amount: { type: 'number' },
                          timestamp: { type: 'string' },
                          date: { type: 'string' }
                        },
                        required: ['amount']
                      }
                    },
                    q: { type: 'array' },
                    p: { type: 'array' },
                    k: { type: 'array' }
                  },
                  required: ['transactions', 'q', 'p', 'k']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Valid and invalid transactions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      valid: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            date: { type: 'string' },
                            amount: { type: 'number' },
                            ceiling: { type: 'number' },
                            remanent: { type: 'number' },
                            isInPeriod: { type: 'boolean' }
                          },
                          required: ['date', 'amount', 'ceiling', 'remanent', 'isInPeriod']
                        }
                      },
                      invalid: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            date: { type: 'string' },
                            amount: { type: 'number' },
                            ceiling: { type: 'number' },
                            remanent: { type: 'number' },
                            message: { type: 'string' }
                          },
                          required: ['date', 'amount', 'ceiling', 'remanent', 'message']
                        }
                      }
                    },
                    required: ['valid', 'invalid']
                  }
                }
              }
            }
          }
        }
      },
      '/blackrock/challenge/v1/returns:nps': {
        post: {
          summary: 'Calculate NPS returns with tax benefit by k periods',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    age: { type: 'integer' },
                    wage: { type: 'number' },
                    inflation: { type: 'number' },
                    transactions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          amount: { type: 'number' },
                          timestamp: { type: 'string' },
                          date: { type: 'string' }
                        },
                        required: ['amount']
                      }
                    },
                    q: { type: 'array' },
                    p: { type: 'array' },
                    k: { type: 'array' }
                  },
                  required: ['age', 'wage', 'inflation', 'transactions', 'q', 'p', 'k']
                }
              }
            }
          },
          responses: {
            '200': { description: 'NPS returns' }
          }
        }
      },
      '/blackrock/challenge/v1/returns:index': {
        post: {
          summary: 'Calculate index returns by k periods',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    age: { type: 'integer' },
                    inflation: { type: 'number' },
                    transactions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          amount: { type: 'number' },
                          timestamp: { type: 'string' },
                          date: { type: 'string' }
                        },
                        required: ['amount']
                      }
                    },
                    q: { type: 'array' },
                    p: { type: 'array' },
                    k: { type: 'array' }
                  },
                  required: ['age', 'inflation', 'transactions', 'q', 'p', 'k']
                }
              }
            }
          },
          responses: {
            '200': { description: 'Index returns' }
          }
        }
      },
      '/blackrock/challenge/v1/performance': {
        get: {
          summary: 'Return response time, memory usage, thread count',
          responses: {
            '200': { description: 'Performance metrics' }
          }
        }
      },
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': { description: 'OK' }
          }
        }
      }
    }
  },
  apis: []
});

app.get('/docs.json', asyncHandler((_req: Request, res: Response) => {
  res.json(swaggerSpec);
}));

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Build app function
export const buildApp = () => {
  return app;
};
