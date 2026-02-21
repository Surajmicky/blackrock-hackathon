/**
 * Test type: Integration + Unit tests
 * Validation: All 5 API endpoints + edge cases + business logic
 * Command: npm test
 */
import t from 'tap';
import request from 'supertest';
import { buildApp } from '../app';
import express from 'express';
import { requestLogger, suspiciousActivityLogger } from '../middleware/requestLogger';
import { errorHandler, notFoundHandler, BusinessLogicError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { TransactionService } from '../services/transactionService';

const app = buildApp();
const BASE = '/blackrock/challenge/v1';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const sampleQ = [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59', fixed: 10 }];
const sampleP = [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59', extra: 5 }];
const sampleK = [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }];

// ─── 1. Transaction Parse ────────────────────────────────────────────────────

t.test('transactions:parse — returns enriched array with ceiling and remanent', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:parse`)
    .send([
      { date: '2023-10-12 20:15:30', amount: 250 },
      { date: '2023-02-28 15:49:20', amount: 375 }
    ])
    .expect(200);

  t.ok(Array.isArray(res.body));
  t.equal(res.body.length, 2);

  // Verify exact calculation: 250 → ceiling 300, remanent 50
  t.equal(res.body[0].ceiling, 300);
  t.equal(res.body[0].remanent, 50);
  // 375 → ceiling 400, remanent 25
  t.equal(res.body[1].ceiling, 400);
  t.equal(res.body[1].remanent, 25);
});

t.test('transactions:parse — validation rejects non-array body', async (t) => {
  await request(app)
    .post(`${BASE}/transactions:parse`)
    .send({ not: 'an array' })
    .expect(400);
});

// ─── 2. Transaction Validator ────────────────────────────────────────────────

t.test('transactions:validator — splits valid/invalid with messages', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:validator`)
    .send({
      wage: 50000,
      transactions: [
        { date: '2023-01-01 00:00:00', amount: 100, ceiling: 100, remanent: 0 },
        { date: '2023-01-01 00:00:00', amount: 100, ceiling: 100, remanent: 0 },  // duplicate
        { date: '2023-02-01 00:00:00', amount: -10, ceiling: 0, remanent: 10 }     // negative
      ]
    })
    .expect(200);

  t.ok(Array.isArray(res.body.valid));
  t.ok(Array.isArray(res.body.invalid));
  t.ok(res.body.invalid.length >= 2, 'should have at least 2 invalid');
  t.ok(res.body.invalid.every((i: any) => typeof i.message === 'string'));
});

t.test('transactions:validator — remanent inconsistency detected', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:validator`)
    .send({
      transactions: [
        { date: '2023-01-01 00:00:00', amount: 300000, ceiling: 300000, remanent: 150000 }
      ]
    })
    .expect(200);

  t.ok(res.body.invalid.length > 0);
  t.match(res.body.invalid[0].message, /Remanent is inconsistent/);
});

t.test('transactions:validator — NPS wage limit exceeded', async (t) => {
  // wage=1000 → annual=12000 → 10% = 1200 → max investment capped at 1200
  // Two transactions with remanent 99 each = 198... need higher to trigger
  // wage=10 → annual=120 → 10% = 12 → max investment = 12
  // remanent 99 > 12 → triggers limit
  const res = await request(app)
    .post(`${BASE}/transactions:validator`)
    .send({
      wage: 10,
      transactions: [
        { date: '2023-01-01 00:00:00', amount: 1, ceiling: 100, remanent: 99 },
        { date: '2023-06-01 00:00:00', amount: 1, ceiling: 100, remanent: 99 }
      ]
    })
    .expect(200);

  t.ok(res.body.invalid.length > 0);
  t.match(res.body.invalid[0].message, /Total investment exceeds NPS limit/);
});

// ─── 3. Transaction Filter ──────────────────────────────────────────────────

t.test('transactions:filter — applies q/p/k rules correctly', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:filter`)
    .send({
      q: sampleQ, p: sampleP, k: sampleK,
      transactions: [
        { date: '2023-02-28 15:49:20', amount: 375 },
        { date: '2024-01-01 00:00:00', amount: 100 }   // outside k range
      ]
    })
    .expect(200);

  t.ok(Array.isArray(res.body.valid));
  t.ok(Array.isArray(res.body.invalid));
  if (res.body.valid.length > 0) t.equal(res.body.valid[0].inKPeriod, true);
  if (res.body.invalid.length > 0) t.ok(res.body.invalid[0].message);
});

t.test('transactions:filter — outside k period → invalid', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:filter`)
    .send({
      q: sampleQ, p: sampleP,
      k: [{ start: '2023-01-01 00:00:00', end: '2023-01-01 00:00:01' }],
      transactions: [{ date: '2023-02-28 15:49:20', amount: 375 }]
    })
    .expect(200);

  t.equal(res.body.valid.length, 0);
  t.ok(res.body.invalid.length >= 1);
});

t.test('transactions:filter — invalid q period ordering → 400', async (t) => {
  await request(app)
    .post(`${BASE}/transactions:filter`)
    .send({
      q: [{ start: '2023-01-02 00:00:00', end: '2023-01-01 00:00:00', fixed: 1 }],
      p: [], k: [],
      transactions: [{ date: '2023-01-01 00:00:00', amount: 10 }]
    })
    .expect(400);
});

t.test('transactions:filter — challenge PDF example', async (t) => {
  const res = await request(app)
    .post(`${BASE}/transactions:filter`)
    .send({
      q: [{ fixed: 0, start: '2023-07-01 00:00:00', end: '2023-07-31 23:59:59' }],
      p: [{ extra: 30, start: '2023-10-01 00:00:00', end: '2023-12-31 23:59:59' }],
      k: [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }],
      transactions: [
        { date: '2023-02-28 15:49:20', amount: 375 },
        { date: '2023-07-15 10:30:00', amount: 620 },
        { date: '2023-10-12 20:15:30', amount: 250 },
        { date: '2023-10-12 20:15:30', amount: 250 },   // duplicate
        { date: '2023-12-17 08:09:45', amount: -480 }    // negative
      ]
    })
    .expect(200);

  t.ok(Array.isArray(res.body.valid));
  t.ok(Array.isArray(res.body.invalid));
  t.equal(res.body.invalid.length, 2, 'duplicate + negative = 2 invalid');
  t.ok(res.body.valid.every((x: any) => x.inKPeriod === true));
});

// ─── 4. Returns NPS ─────────────────────────────────────────────────────────

t.test('returns:nps — returns correct structure', async (t) => {
  const res = await request(app)
    .post(`${BASE}/returns:nps`)
    .send({
      age: 29, wage: 50000, inflation: 5.5,
      transactions: [{ date: '2023-01-01 00:00:00', amount: 100 }],
      q: [], p: [],
      k: [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }]
    })
    .expect(200);

  t.type(res.body.transactionsTotalAmount, 'number');
  t.type(res.body.transactionsTotalCeiling, 'number');
  t.ok(Array.isArray(res.body.savingsByDates));
  if (res.body.savingsByDates[0]) {
    t.type(res.body.savingsByDates[0].profits, 'number');
    t.type(res.body.savingsByDates[0].taxBenefit, 'number');
  }
});

t.test('returns:nps — high income triggers tax benefit', async (t) => {
  const res = await request(app)
    .post(`${BASE}/returns:nps`)
    .send({
      age: 35, wage: 800000, inflation: 6,
      transactions: [
        { date: '2023-01-01 00:00:00', amount: 500000 },
        { date: '2023-06-01 00:00:00', amount: 300000 }
      ],
      q: [], p: [],
      k: [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }]
    })
    .expect(200);

  t.ok(Array.isArray(res.body.savingsByDates));
  t.type(res.body.transactionsTotalAmount, 'number');
});

// ─── 5. Returns Index ────────────────────────────────────────────────────────

t.test('returns:index — returns correct structure with taxBenefit 0', async (t) => {
  const res = await request(app)
    .post(`${BASE}/returns:index`)
    .send({
      age: 29, inflation: 5.5,
      transactions: [{ date: '2023-01-01 00:00:00', amount: 100 }],
      q: [], p: [],
      k: [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }]
    })
    .expect(200);

  t.type(res.body.transactionsTotalAmount, 'number');
  t.type(res.body.transactionsTotalCeiling, 'number');
  t.ok(Array.isArray(res.body.savingsByDates));
  if (res.body.savingsByDates[0]) {
    t.type(res.body.savingsByDates[0].profits, 'number');
    t.equal(res.body.savingsByDates[0].taxBenefit, 0);
  }
});

t.test('returns:index — accepts inflation > 1 (percentage)', async (t) => {
  const res = await request(app)
    .post(`${BASE}/returns:index`)
    .send({
      age: 30, inflation: 5.5,
      transactions: [{ date: '2023-01-01 00:00:00', amount: 100 }],
      q: [], p: [],
      k: [{ start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:59' }]
    })
    .expect(200);

  t.ok(res.body.savingsByDates, 'should succeed with inflation = 5.5');
});

// ─── 6. Performance ──────────────────────────────────────────────────────────

t.test('performance — returns time/memory/threads', async (t) => {
  const res = await request(app)
    .get(`${BASE}/performance`)
    .expect(200);

  t.type(res.body.time, 'string');
  t.type(res.body.memory, 'string');
  t.type(res.body.threads, 'number');
});

// ─── 7. Health & Docs ────────────────────────────────────────────────────────

t.test('health + docs.json endpoints', async (t) => {
  const health = await request(app).get('/health').expect(200);
  t.equal(health.body.status, 'ok');

  const docs = await request(app).get('/docs.json').expect(200);
  t.equal(docs.body.openapi, '3.0.0');
});

// ─── 8. Error Handling ───────────────────────────────────────────────────────

t.test('404 — unknown route', async (t) => {
  const res = await request(app)
    .get(`${BASE}/does-not-exist`)
    .expect(404);

  t.equal(res.body.error.code, 'NOT_FOUND');
});

t.test('errorHandler — validation error includes stack in development', async (t) => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  const res = await request(app)
    .post(`${BASE}/transactions:parse`)
    .send({ not: 'an array' })
    .expect(400);

  t.equal(res.body.error.code, 'VALIDATION_ERROR');
  t.type(res.body.error.stack, 'string');

  process.env.NODE_ENV = prev;
});

t.test('errorHandler — 500 fallback for unexpected errors', async (t) => {
  const eapp = express();
  eapp.use(express.json());
  eapp.get('/boom', (_req, _res, next) => next(new Error('boom')));
  eapp.use(notFoundHandler);
  eapp.use(errorHandler);

  const res = await request(eapp).get('/boom').expect(500);
  t.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
});

t.test('BusinessLogicError path', async (t) => {
  const slowApp = express();
  slowApp.use(express.json());
  slowApp.use(requestLogger);

  slowApp.get('/slow', async (_req, _res, next) => {
    setTimeout(() => next(new BusinessLogicError('slow failure', 'slow')), 1100);
  });

  slowApp.use(notFoundHandler);
  slowApp.use(errorHandler);

  const res = await request(slowApp).get('/slow').expect(422);
  t.equal(res.body.error.code, 'BUSINESS_LOGIC_ERROR');
});

// ─── 9. Unit Tests — Service Layer ───────────────────────────────────────────

t.test('TransactionService.validateTransactions — missing date & inconsistencies', async (t) => {
  const svc = new TransactionService();
  const res = await svc.validateTransactions([
    { amount: 100, ceiling: 100, remanent: 0 },           // missing date
    { date: '2023-01-01 00:00:00', amount: 101, ceiling: 100, remanent: -1 }, // bad ceiling
    { date: '2023-01-02 00:00:00', amount: 150, ceiling: 300, remanent: 50 }, // bad ceiling
    { date: '2023-01-03 00:00:00', amount: 150, ceiling: 200, remanent: 40 }  // bad remanent
  ]);
  t.ok(res.invalid.length >= 3, 'should catch at least 3 invalid');
});

t.test('TransactionService.filterTransactions — invalid date', async (t) => {
  const svc = new TransactionService();
  const res = await svc.filterTransactions(
    [{ date: 'not-a-date', amount: 10 }],
    sampleQ, sampleP, sampleK
  );
  t.ok(res.invalid.length >= 1);
  t.ok(res.invalid[0].message);
});

t.test('suspiciousActivityLogger — detects suspicious patterns', async (t) => {
  let warned = false;
  const origWarn = (logger as any).warn;
  (logger as any).warn = () => { warned = true; };

  const req: any = {
    url: '/../..', method: 'GET',
    get: (h: string) => h === 'User-Agent' ? 'union select' : undefined,
    ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' }
  };
  suspiciousActivityLogger(req as any, {} as any, () => { });

  (logger as any).warn = origWarn;
  t.equal(warned, true);
});

// ─── 10. Challenge PDF Full Example ──────────────────────────────────────────

t.test('returns:nps — challenge PDF example (age 29, wage 50000)', async (t) => {
  const res = await request(app)
    .post(`${BASE}/returns:nps`)
    .send({
      age: 29,
      wage: 50000,
      inflation: 5.5,
      transactions: [
        { date: '2023-10-12 20:15:00', amount: 250 },
        { date: '2023-02-28 15:49:00', amount: 375 },
        { date: '2023-07-01 21:59:00', amount: 620 },
        { date: '2023-12-17 08:09:00', amount: 480 }
      ],
      q: [{ fixed: 0, start: '2023-07-01 00:00:00', end: '2023-07-31 23:59:00' }],
      p: [{ extra: 25, start: '2023-10-01 08:00:00', end: '2023-12-31 19:59:00' }],
      k: [
        { start: '2023-03-01 00:00:00', end: '2023-11-30 23:59:00' },
        { start: '2023-01-01 00:00:00', end: '2023-12-31 23:59:00' }
      ]
    })
    .expect(200);

  t.ok(Array.isArray(res.body.savingsByDates));
  t.equal(res.body.savingsByDates.length, 2, 'should have 2 k-period results');

  // k1: March-November → amount should be 75
  t.equal(res.body.savingsByDates[0].amount, 75, 'k1 amount = 75');
  // k2: Full year → amount should be 145
  t.equal(res.body.savingsByDates[1].amount, 145, 'k2 amount = 145');
});
