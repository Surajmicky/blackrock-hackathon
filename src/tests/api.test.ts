import t from 'tap';
import request from 'supertest';
import { buildApp } from '../app';
import express from 'express';
import { requestLogger, suspiciousActivityLogger } from '../middleware/requestLogger';
import { errorHandler, notFoundHandler, BusinessLogicError } from '../middleware/errorHandler';
import { Logger, LogLevel, logger } from '../utils/logger';
import { TransactionController } from '../controllers/transactionController';
import { TransactionService } from '../services/transactionService';

const app = buildApp();

const basePath = '/blackrock/challenge/v1';

const q = [
  { start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59', fixed: 10 }
];

const p = [
  { start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59', extra: 5 }
];

const k = [
  { start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }
];

t.test('transactions:parse - accepts raw array and returns raw array', async (t) => {
  const payload = [
    { date: '2023-10-12 20:15:30', amount: 250 },
    { date: '2023-02-28 15:49:20', amount: 375 }
  ];

  const res = await request(app)
    .post(`${basePath}/transactions:parse`)
    .send(payload)
    .expect(200);

  t.ok(Array.isArray(res.body), 'response should be an array');
  t.equal(res.body.length, 2);
  t.same(Object.keys(res.body[0]).sort(), ['amount', 'ceiling', 'date', 'remanent'].sort());
});

t.test('transactions:validator - splits valid/invalid with messages', async (t) => {
  const payload = {
    wage: 50000,
    transactions: [
      { date: '2023-01-01 00:00:00', amount: 100, ceiling: 100, remanent: 0 },
      { date: '2023-01-01 00:00:00', amount: 100, ceiling: 100, remanent: 0 },
      { date: '2023-02-01 00:00:00', amount: -10, ceiling: 0, remanent: 10 }
    ]
  };

  const res = await request(app)
    .post(`${basePath}/transactions:validator`)
    .send(payload)
    .expect(200);

  t.ok(res.body);
  t.ok(Array.isArray(res.body.valid));
  t.ok(Array.isArray(res.body.invalid));
  t.ok(res.body.invalid.length >= 1);
  t.ok(res.body.invalid[0].message, 'invalid items should include message');
});

t.test('transactions:filter - accepts raw transactions and returns valid with isInPeriod', async (t) => {
  const payload = {
    wage: 50000,
    q,
    p,
    k,
    transactions: [
      { date: '2023-02-28 15:49:20', amount: 375 },
      { date: '2024-01-01 00:00:00', amount: 100 }
    ]
  };

  const res = await request(app)
    .post(`${basePath}/transactions:filter`)
    .send(payload)
    .expect(200);

  t.ok(Array.isArray(res.body.valid));
  t.ok(Array.isArray(res.body.invalid));

  if (res.body.valid.length > 0) {
    t.equal(res.body.valid[0].isInPeriod, true);
  }

  if (res.body.invalid.length > 0) {
    t.ok(res.body.invalid[0].message);
  }
});

t.test('returns:nps - returns required metrics', async (t) => {
  const payload = {
    age: 30,
    wage: 50000,
    inflation: 0.055,
    q,
    p,
    k,
    transactions: [
      { date: '2023-02-28 15:49:20', amount: 375 },
      { date: '2023-10-12 20:15:30', amount: 250 }
    ]
  };

  const res = await request(app)
    .post(`${basePath}/returns:nps`)
    .send(payload)
    .expect(200);

  t.type(res.body.transactionsTotalAmount, 'number');
  t.type(res.body.transactionsTotalCeiling, 'number');
  t.ok(Array.isArray(res.body.savingsByDates));
});

t.test('returns:index - returns required metrics', async (t) => {
  const payload = {
    age: 30,
    inflation: 0.055,
    q,
    p,
    k,
    transactions: [
      { date: '2023-02-28 15:49:20', amount: 375 },
      { date: '2023-10-12 20:15:30', amount: 250 }
    ]
  };

  const res = await request(app)
    .post(`${basePath}/returns:index`)
    .send(payload)
    .expect(200);

  t.type(res.body.transactionsTotalAmount, 'number');
  t.type(res.body.transactionsTotalCeiling, 'number');
  t.ok(Array.isArray(res.body.savingsByDates));
});

t.test('performance - returns time/memory/threads', async (t) => {
  const res = await request(app)
    .get(`${basePath}/performance`)
    .expect(200);

  t.type(res.body.time, 'string');
  t.type(res.body.memory, 'string');
  t.type(res.body.threads, 'number');
});

t.test('health + docs.json endpoints', async (t) => {
  const health = await request(app).get('/health').expect(200);
  t.equal(health.body.status, 'ok');
  t.type(health.body.timestamp, 'string');

  const docs = await request(app).get('/docs.json').expect(200);
  t.equal(docs.body.openapi, '3.0.0');
});

t.test('notFoundHandler - unknown route returns 404 with error envelope', async (t) => {
  const res = await request(app)
    .get('/blackrock/challenge/v1/does-not-exist')
    .expect(404);

  t.ok(res.body?.error);
  t.equal(res.body.error.code, 'NOT_FOUND');
  t.match(res.body.error.message, /Route GET/);
  t.equal(res.body.error.path, '/blackrock/challenge/v1/does-not-exist');
});

t.test('errorHandler - validation error includes stack in development', async (t) => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  const res = await request(app)
    .post(`${basePath}/transactions:parse`)
    .send({ not: 'an array' })
    .expect(400);

  t.ok(res.body?.error);
  t.equal(res.body.error.code, 'VALIDATION_ERROR');
  t.type(res.body.error.stack, 'string');

  process.env.NODE_ENV = prev;
});

t.test('TransactionService.validateTransactions unit - missing date, ceiling/remanent inconsistencies', async (t) => {
  const svc = new TransactionService();
  const res = await svc.validateTransactions([
    { amount: 100, ceiling: 100, remanent: 0 },
    { date: '2023-01-01 00:00:00', amount: 101, ceiling: 100, remanent: -1 },
    { date: '2023-01-02 00:00:00', amount: 150, ceiling: 300, remanent: 50 },
    { date: '2023-01-03 00:00:00', amount: 150, ceiling: 200, remanent: 40 }
  ]);
  t.ok(res.invalid.length >= 3);
});

t.test('TransactionService.filterTransactions unit - invalid date reaches service branch', async (t) => {
  const svc = new TransactionService();
  const res = await svc.filterTransactions(
    [{ date: 'not-a-date', amount: 10 }],
    q,
    p,
    k
  );
  t.ok(res.invalid.length >= 1);
  t.ok(res.invalid[0].message);
});

t.test('transactions:filter edge case - outside k period returns invalid', async (t) => {
  const payload = {
    q,
    p,
    k: [{ start: '2023-01-01 00:00:00', end: '2023-01-01 00:00:01' }],
    transactions: [{ date: '2023-02-28 15:49:20', amount: 375 }]
  };

  const res = await request(app)
    .post(`${basePath}/transactions:filter`)
    .send(payload)
    .expect(200);

  t.equal(res.body.valid.length, 0);
  t.ok(res.body.invalid.length >= 1);
});

t.test('Joi filter business rules - invalid period ordering returns 400', async (t) => {
  const payload = {
    q: [{ start: '2023-01-02 00:00:00', end: '2023-01-01 00:00:00', fixed: 1 }],
    p: [],
    k: [],
    transactions: [{ date: '2023-01-01 00:00:00', amount: 10 }]
  };

  await request(app)
    .post(`${basePath}/transactions:filter`)
    .send(payload)
    .expect(400);
});

t.test('suspiciousActivityLogger - suspicious url triggers warning branch (no crash)', async (t) => {
  await request(app)
    .get('/../../etc/passwd')
    .expect(404);
  t.pass('request completed');
});

t.test('requestLogger slow-request branch + BusinessLogicError path (custom app)', async (t) => {
  const slowApp = express();
  slowApp.use(express.json());
  slowApp.use(requestLogger);
  slowApp.use(suspiciousActivityLogger);

  slowApp.get('/slow', async (_req, _res, next) => {
    setTimeout(() => next(new BusinessLogicError('slow failure', 'slow')), 1100);
  });

  slowApp.use(notFoundHandler);
  slowApp.use(errorHandler);

  const res = await request(slowApp)
    .get('/slow')
    .expect(422);

  t.equal(res.body.error.code, 'BUSINESS_LOGIC_ERROR');
});

t.test('errorHandler 500 fallback code path (custom app)', async (t) => {
  const eapp = express();
  eapp.use(express.json());
  eapp.get('/boom', (_req, _res, next) => next(new Error('boom')));
  eapp.use(notFoundHandler);
  eapp.use(errorHandler);

  const res = await request(eapp).get('/boom').expect(500);
  t.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
});

t.test('suspiciousActivityLogger warn branch via direct invocation', async (t) => {
  let warned = false;
  const origWarn = (logger as any).warn;
  (logger as any).warn = () => {
    warned = true;
  };

  const req: any = {
    url: '/../..',
    method: 'GET',
    get: (h: string) => (h === 'User-Agent' ? 'union select' : undefined),
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' }
  };
  suspiciousActivityLogger(req as any, {} as any, () => {});

  (logger as any).warn = origWarn;
  t.equal(warned, true);
});

t.test('controller catch blocks are executed when service throws', async (t) => {
  const c = new TransactionController() as any;
  c.transactionService = {
    parseTransactions: async () => {
      throw new Error('fail');
    }
  };

  const req: any = { body: [], method: 'POST', url: `${basePath}/transactions:parse` };
  const res: any = { json: () => {} };
  await t.rejects(c.parseTransactions(req, res));
});

t.test('logger debug branch (Logger instance)', async (t) => {
  const prev = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = LogLevel.DEBUG;

  const l = new Logger();
  l.debug('debug message', { a: 1 });
  l.info('info message');
  l.warn('warn message');
  l.error('error message');

  process.env.LOG_LEVEL = prev;
  t.pass('logger methods executed');
});
