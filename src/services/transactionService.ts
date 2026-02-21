import { logger } from '../utils/logger';

export interface ExpenseInput {
  amount: number;
  timestamp?: string;
  date?: string;
}

export interface Transaction {
  date: string;
  amount: number;
  ceiling: number;
  remanent: number;
}

export interface ValidatorTransaction {
  amount: number;
  date?: string;
  ceiling?: number;
  remanent?: number;
}

export interface QRule {
  start: string;
  end: string;
  fixed: number;
}

export interface PRule {
  start: string;
  end: string;
  extra: number;
}

export interface KPeriod {
  start: string;
  end: string;
}

export interface ParseResult {
  date: string;
  amount: number;
  ceiling: number;
  remanent: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ValidatorValidItem {
  date: string;
  amount: number;
  ceiling: number;
  remanent: number;
}

export interface ValidatorInvalidItem extends ValidatorValidItem {
  message: string;
}

export interface ValidatorResponse {
  valid: ValidatorValidItem[];
  invalid: ValidatorInvalidItem[];
}

export interface FilterResult {
  valid: Array<Transaction & { isInPeriod: true }>;
  invalid: Array<Transaction & { message: string }>;
}

export interface NPSReturnResult {
  transactionsTotalAmount: number;
  transactionsTotalCeiling: number;
  savingsByDates: Array<{
    start: string;
    end: string;
    amount: number;
    profits: number;
    taxBenefit: number;
  }>;
}

export interface IndexReturnResult {
  transactionsTotalAmount: number;
  transactionsTotalCeiling: number;
  savingsByDates: Array<{
    start: string;
    end: string;
    amount: number;
    profits: number;
    taxBenefit: number;
  }>;
}

type Ms = number;

const parseTimestampToMs = (value: string): Ms => {
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return iso;

  const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    return NaN;
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  return Date.UTC(year, month - 1, day, hour, minute, second);
};

const ceilTo100 = (amount: number) => Math.ceil(amount / 100) * 100;

const computeBaseTransaction = (expense: ExpenseInput): Transaction => {
  const amount = parseFloat(expense.amount.toString());
  const date = (expense.timestamp ?? expense.date ?? '').toString();

  const ceiling = ceilTo100(amount);
  const remanent = ceiling - amount;

  return { date, amount, ceiling, remanent };
};

type AdjustedTx = { tx: Transaction; ms: Ms; adjustedRemanent: number };

class MinHeap<T> {
  private data: T[] = [];

  constructor(private less: (a: T, b: T) => boolean) {}

  size() {
    return this.data.length;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  push(item: T) {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.less(this.data[i]!, this.data[p]!)) {
        const tmp = this.data[i]!;
        this.data[i] = this.data[p]!;
        this.data[p] = tmp;
        i = p;
      } else {
        break;
      }
    }
  }

  private bubbleDown(i: number) {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;

      if (l < n && this.less(this.data[l]!, this.data[smallest]!)) smallest = l;
      if (r < n && this.less(this.data[r]!, this.data[smallest]!)) smallest = r;

      if (smallest !== i) {
        const tmp = this.data[i]!;
        this.data[i] = this.data[smallest]!;
        this.data[smallest] = tmp;
        i = smallest;
      } else {
        break;
      }
    }
  }
}

const lowerBound = (arr: Ms[], target: Ms) => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const upperBound = (arr: Ms[], target: Ms) => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const mergeIntervals = (intervals: Array<{ startMs: Ms; endMs: Ms }>) => {
  if (intervals.length === 0) return [] as Array<{ startMs: Ms; endMs: Ms }>;
  intervals.sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: Ms; endMs: Ms }> = [];
  let cur = { ...intervals[0]! };
  for (let i = 1; i < intervals.length; i++) {
    const nxt = intervals[i]!;
    if (nxt.startMs <= cur.endMs) {
      cur.endMs = Math.max(cur.endMs, nxt.endMs);
    } else {
      merged.push(cur);
      cur = { ...nxt };
    }
  }
  merged.push(cur);
  return merged;
};

const inAnyMergedInterval = (merged: Array<{ startMs: Ms; endMs: Ms }>, ms: Ms) => {
  // binary search merged intervals
  let lo = 0;
  let hi = merged.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = merged[mid]!;
    if (ms < it.startMs) hi = mid - 1;
    else if (ms > it.endMs) lo = mid + 1;
    else return true;
  }
  return false;
};

const applyQpOptimized = (
  baseTxs: Transaction[],
  q: QRule[],
  p: PRule[]
): AdjustedTx[] => {
  const txs: AdjustedTx[] = baseTxs
    .map((tx) => ({
      tx,
      ms: parseTimestampToMs(tx.date),
      adjustedRemanent: tx.remanent
    }))
    .sort((a, b) => a.ms - b.ms);

  const qEvents = q
    .map((r) => ({
      startMs: parseTimestampToMs(r.start),
      endMs: parseTimestampToMs(r.end),
      fixed: r.fixed
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const pEvents = p
    .map((r) => ({
      startMs: parseTimestampToMs(r.start),
      endMs: parseTimestampToMs(r.end),
      extra: r.extra
    }))
    .sort((a, b) => a.startMs - b.startMs);

  // Q: choose active with latest start (max startMs). Use max-heap by startMs.
  const qMaxHeap = new MinHeap<{ startMs: Ms; endMs: Ms; fixed: number }>((a, b) => a.startMs > b.startMs);

  // P: sum all active extras. Maintain active extras and remove by end.
  const pMinEndHeap = new MinHeap<{ endMs: Ms; extra: number }>((a, b) => a.endMs < b.endMs);
  let pExtraSum = 0;

  let qi = 0;
  let pi = 0;

  for (const item of txs) {
    const t = item.ms;

    // add q events that start <= t
    while (qi < qEvents.length && qEvents[qi]!.startMs <= t) {
      qMaxHeap.push(qEvents[qi]!);
      qi++;
    }
    // remove expired q from top
    while (qMaxHeap.size() > 0 && (qMaxHeap.peek()!.endMs < t || Number.isNaN(qMaxHeap.peek()!.endMs))) {
      qMaxHeap.pop();
    }

    // add p events that start <= t
    while (pi < pEvents.length && pEvents[pi]!.startMs <= t) {
      pMinEndHeap.push({ endMs: pEvents[pi]!.endMs, extra: pEvents[pi]!.extra });
      pExtraSum += pEvents[pi]!.extra;
      pi++;
    }
    // remove expired p (end < t)
    while (pMinEndHeap.size() > 0 && pMinEndHeap.peek()!.endMs < t) {
      const expired = pMinEndHeap.pop();
      if (expired) pExtraSum -= expired.extra;
    }

    // apply q override if active
    const qTop = qMaxHeap.peek();
    let rem = item.tx.remanent;
    if (qTop && qTop.startMs <= t && t <= qTop.endMs) {
      rem = qTop.fixed;
    }
    rem += pExtraSum;
    item.adjustedRemanent = rem;
    item.tx.remanent = rem;
  }

  return txs;
};

export class TransactionService {
  // Parse transactions - calculate ceiling and remanent
  async parseTransactions(transactions: ExpenseInput[]): Promise<ParseResult[]> {
    logger.info('Starting transaction parsing', { count: transactions.length });
    
    const results = transactions.map((tx, idx) => {
      const base = computeBaseTransaction(tx);
      
      if ((process.env.LOG_LEVEL?.toUpperCase() === 'DEBUG') && transactions.length <= 1000) {
        logger.logTransaction(`tx_${idx}`, 'parse', {
          date: base.date,
          amount: base.amount,
          ceiling: base.ceiling,
          remanent: base.remanent
        });
      }
      
      return {
        date: base.date,
        amount: base.amount,
        ceiling: base.ceiling,
        remanent: base.remanent
      };
    });
    
    logger.info('Transaction parsing completed', { processed: results.length });
    return results;
  }

  // Validate transactions - check for negative amounts and duplicates
  async validateTransactions(transactions: ValidatorTransaction[], wage?: number): Promise<ValidatorResponse> {
    logger.info('Starting transaction validation', { count: transactions.length });
    
    const timestampCounts = new Map<string, number>();
    const valid: ValidatorValidItem[] = [];
    const invalid: ValidatorInvalidItem[] = [];
    
    // First pass: count timestamps
    for (const tx of transactions) {
      const timestamp = tx.date;
      if (timestamp) {
        timestampCounts.set(timestamp, (timestampCounts.get(timestamp) ?? 0) + 1);
      }
    }

    let investedTotal = 0;
    
    // Second pass: validate each transaction
    for (const tx of transactions) {
      const amount = parseFloat(tx.amount.toString());
      const timestamp = tx.date;
      const date = timestamp ?? '';

      const expectedCeiling = Math.ceil(amount / 100) * 100;
      const expectedRemanent = expectedCeiling - amount;
      const ceiling = typeof tx.ceiling === 'number' ? tx.ceiling : expectedCeiling;
      const remanent = typeof tx.remanent === 'number' ? tx.remanent : expectedRemanent;
      
      // Validation Rules: Negative amounts → invalid
      if (amount < 0) {
        logger.warn('Negative amount detected', { 
          timestamp,
          amount: tx.amount 
        });
        
        invalid.push({ date, amount, ceiling, remanent, message: 'Negative amounts are not allowed' });
        continue;
      }

      if (!timestamp) {
        invalid.push({ date, amount, ceiling, remanent, message: 'Timestamp must be a valid ISO date' });
        continue;
      }

      if (typeof tx.ceiling === 'number' && tx.ceiling < amount) {
        invalid.push({ date, amount, ceiling, remanent, message: 'Ceiling must be greater than or equal to amount' });
        continue;
      }

      if (typeof tx.ceiling === 'number' && tx.ceiling !== expectedCeiling) {
        invalid.push({ date, amount, ceiling, remanent, message: 'Ceiling is inconsistent' });
        continue;
      }

      if (typeof tx.remanent === 'number' && tx.remanent !== expectedRemanent) {
        invalid.push({ date, amount, ceiling, remanent, message: 'Remanent is inconsistent' });
        continue;
      }
      
      // Validation Rules: Duplicate timestamps → invalid
      const count = timestampCounts.get(timestamp) ?? 0;
      if (count > 1) {
        logger.warn('Duplicate timestamp detected', { 
          timestamp,
          duplicateCount: count - 1
        });
        
        invalid.push({ date, amount, ceiling, remanent, message: 'Duplicate transaction' });
        continue;
      }
      
      investedTotal += remanent;
      valid.push({ date, amount, ceiling, remanent });
    }

    if (typeof wage === 'number') {
      const maxInvestment = Math.min(200000, wage * 12 * 0.10);
      if (investedTotal > maxInvestment) {
        const message = `Total investment exceeds NPS limit of ₹${maxInvestment}`;
        for (const item of valid) {
          invalid.push({ ...item, message });
        }
        valid.length = 0;
      }
    }
    
    const validCount = valid.length;
    const invalidCount = invalid.length;
    
    logger.info('Transaction validation completed', { 
      total: validCount + invalidCount,
      valid: validCount,
      invalid: invalidCount
    });
    
    return { valid, invalid };
  }

  // Filter transactions - apply q/p/k rules
  async filterTransactions(
    transactions: ExpenseInput[], 
    q: QRule[], 
    p: PRule[], 
    k: KPeriod[]
  ): Promise<FilterResult> {
    logger.info('Starting transaction filtering', { 
      transactionCount: transactions.length,
      qRules: q.length,
      pRules: p.length,
      kPeriods: k.length
    });
    
    const startTime = Date.now();

    const baseTxs = transactions.map(computeBaseTransaction);
    const adjusted = applyQpOptimized(baseTxs, q, p);

    const kIntervals = k
      .map((period) => ({
        startMs: parseTimestampToMs(period.start),
        endMs: parseTimestampToMs(period.end)
      }))
      .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs) && x.startMs <= x.endMs);

    const mergedK = mergeIntervals(kIntervals);

    const valid: Array<Transaction & { isInPeriod: true }> = [];
    const invalid: Array<Transaction & { message: string }> = [];

    for (const item of adjusted) {
      const tx = item.tx;
      const ms = item.ms;

      if (Number.isNaN(ms)) {
        invalid.push({ ...tx, message: 'Invalid date' });
        continue;
      }

      if (!inAnyMergedInterval(mergedK, ms)) {
        invalid.push({ ...tx, message: 'Transaction outside evaluation periods' });
        continue;
      }

      valid.push({ ...tx, isInPeriod: true });
    }
    
    const duration = Date.now() - startTime;
    logger.logPerformance('transaction_filter', duration, { 
      transactionCount: transactions.length,
      rulesApplied: { q: q.length, p: p.length, k: k.length }
    });
    
    return { valid, invalid };
  }

  async calculateNPSReturns(input: {
    age: number;
    wage: number;
    inflation: number;
    transactions: ExpenseInput[];
    q: QRule[];
    p: PRule[];
    k: KPeriod[];
  }): Promise<NPSReturnResult> {
    const { age, wage, inflation, transactions, q, p, k } = input;
    logger.info('Calculating NPS returns', { age, wage, inflation, txCount: transactions.length });

    const baseTxs = transactions.map(computeBaseTransaction);
    const adjusted = applyQpOptimized(baseTxs, q, p);
    const times = adjusted.map((x) => x.ms);
    const prefix: number[] = [0];
    for (let i = 0; i < adjusted.length; i++) {
      prefix[i + 1] = prefix[i]! + adjusted[i]!.adjustedRemanent;
    }

    const kSums = k.map((period) => {
      const startMs = parseTimestampToMs(period.start);
      const endMs = parseTimestampToMs(period.end);
      const l = lowerBound(times, startMs);
      const r = upperBound(times, endMs);
      const amount = (prefix[r] ?? 0) - (prefix[l] ?? 0);
      return { start: period.start, end: period.end, amount };
    });

    const mergedK = mergeIntervals(
      kSums
        .map((x) => ({ startMs: parseTimestampToMs(x.start), endMs: parseTimestampToMs(x.end) }))
        .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs) && x.startMs <= x.endMs)
    );

    let transactionsTotalAmount = 0;
    let transactionsTotalCeiling = 0;
    for (const it of adjusted) {
      if (!Number.isNaN(it.ms) && inAnyMergedInterval(mergedK, it.ms)) {
        transactionsTotalAmount += it.tx.amount;
        transactionsTotalCeiling += it.tx.ceiling;
      }
    }

    const t = Math.max(60 - age, 5);
    const r = 0.0711;
    const annualIncome = wage * 12;

    const savingsByDates = kSums.map((x) => {
      const A = x.amount * Math.pow(1 + r, t);
      const AReal = A / Math.pow(1 + inflation, t);
      const profits = AReal - x.amount;

      const deduction = Math.min(x.amount, annualIncome * 0.10, 200000);
      const taxBenefit = this.calculateTaxDifference(annualIncome, deduction);
      return { start: x.start, end: x.end, amount: x.amount, profits, taxBenefit };
    });

    return { transactionsTotalAmount, transactionsTotalCeiling, savingsByDates };
  }

  async calculateIndexReturns(input: {
    age: number;
    inflation: number;
    transactions: ExpenseInput[];
    q: QRule[];
    p: PRule[];
    k: KPeriod[];
  }): Promise<IndexReturnResult> {
    const { age, inflation, transactions, q, p, k } = input;
    logger.info('Calculating Index returns', { age, inflation, txCount: transactions.length });

    const baseTxs = transactions.map(computeBaseTransaction);
    const adjusted = applyQpOptimized(baseTxs, q, p);
    const times = adjusted.map((x) => x.ms);
    const prefix: number[] = [0];
    for (let i = 0; i < adjusted.length; i++) {
      prefix[i + 1] = prefix[i]! + adjusted[i]!.adjustedRemanent;
    }

    const kSums = k.map((period) => {
      const startMs = parseTimestampToMs(period.start);
      const endMs = parseTimestampToMs(period.end);
      const l = lowerBound(times, startMs);
      const r = upperBound(times, endMs);
      const amount = (prefix[r] ?? 0) - (prefix[l] ?? 0);
      return { start: period.start, end: period.end, amount };
    });

    const mergedK = mergeIntervals(
      kSums
        .map((x) => ({ startMs: parseTimestampToMs(x.start), endMs: parseTimestampToMs(x.end) }))
        .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs) && x.startMs <= x.endMs)
    );

    let transactionsTotalAmount = 0;
    let transactionsTotalCeiling = 0;
    for (const it of adjusted) {
      if (!Number.isNaN(it.ms) && inAnyMergedInterval(mergedK, it.ms)) {
        transactionsTotalAmount += it.tx.amount;
        transactionsTotalCeiling += it.tx.ceiling;
      }
    }

    const t = Math.max(60 - age, 5);
    const r = 0.1449;
    const savingsByDates = kSums.map((x) => {
      const A = x.amount * Math.pow(1 + r, t);
      const AReal = A / Math.pow(1 + inflation, t);
      const profits = AReal - x.amount;
      return { start: x.start, end: x.end, amount: x.amount, profits, taxBenefit: 0 };
    });

    return { transactionsTotalAmount, transactionsTotalCeiling, savingsByDates };
  }

  // Helper method for tax calculations
  private calculateTaxDifference(income: number, deduction: number): number {
    const taxWithoutDeduction = this.calculateTax(income);
    const taxWithDeduction = this.calculateTax(income - deduction);
    return taxWithoutDeduction - taxWithDeduction;
  }

  private calculateTax(income: number): number {
    // Tax Function from problem statement
    // 0 to 700000 → 0%
    if (income <= 700000) return 0;
    
    // 700001 to 1000000 → 10% on amount above 700000
    if (income <= 1000000) return (income - 700000) * 0.10;
    
    // 1000001 to 1200000 → 15% on amount above 1000000
    if (income <= 1200000) return 30000 + (income - 1000000) * 0.15;
    
    // 1200001 to 1500000 → 20% on amount above 1200000
    if (income <= 1500000) return 30000 + 30000 + (income - 1200000) * 0.20;
    
    // above 1500000 → 30% on amount above 1500000
    return 30000 + 30000 + 60000 + (income - 1500000) * 0.30;
  }
}
