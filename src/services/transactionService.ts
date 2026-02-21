import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface QRule { start: string; end: string; fixed: number; }
export interface PRule { start: string; end: string; extra: number; }
export interface KPeriod { start: string; end: string; }

export interface ReturnsInput {
  age: number;
  wage?: number;
  inflation: number;
  transactions: ExpenseInput[];
  q: QRule[];
  p: PRule[];
  k: KPeriod[];
}

interface SavingsByDate {
  start: string;
  end: string;
  amount: number;
  profits: number;
  taxBenefit: number;
}

interface ReturnsResult {
  transactionsTotalAmount: number;
  transactionsTotalCeiling: number;
  savingsByDates: SavingsByDate[];
}

type Ms = number;

// ─── Pure Helpers ────────────────────────────────────────────────────────────

const parseTs = (value: string): Ms => {
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return iso;

  const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;

  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
};

const formatTs = (ms: Ms): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

const normalizeTs = (value: string): string => {
  const ms = parseTs(value);
  return Number.isNaN(ms) ? value : formatTs(ms);
};

const ceilTo100 = (amount: number): number => Math.ceil(amount / 100) * 100;

const normalizeInflation = (v: number): number => {
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > 1 ? v / 100 : v;
};

// ─── Binary Search ───────────────────────────────────────────────────────────

const lowerBound = (arr: Ms[], target: Ms): number => {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < target) lo = mid + 1; else hi = mid;
  }
  return lo;
};

const upperBound = (arr: Ms[], target: Ms): number => {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= target) lo = mid + 1; else hi = mid;
  }
  return lo;
};

// ─── Interval Utilities ──────────────────────────────────────────────────────

interface Interval { startMs: Ms; endMs: Ms; }

const mergeIntervals = (intervals: Interval[]): Interval[] => {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.startMs - b.startMs);
  const merged: Interval[] = [{ ...intervals[0]! }];
  for (let i = 1; i < intervals.length; i++) {
    const cur = merged[merged.length - 1]!;
    const nxt = intervals[i]!;
    if (nxt.startMs <= cur.endMs) {
      cur.endMs = Math.max(cur.endMs, nxt.endMs);
    } else {
      merged.push({ ...nxt });
    }
  }
  return merged;
};

const inAnyInterval = (merged: Interval[], ms: Ms): boolean => {
  let lo = 0, hi = merged.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = merged[mid]!;
    if (ms < it.startMs) hi = mid - 1;
    else if (ms > it.endMs) lo = mid + 1;
    else return true;
  }
  return false;
};

// ─── Min Heap ────────────────────────────────────────────────────────────────

class MinHeap<T> {
  private d: T[] = [];
  constructor(private less: (a: T, b: T) => boolean) { }

  get size() { return this.d.length; }
  peek(): T | undefined { return this.d[0]; }

  push(item: T) {
    this.d.push(item);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.d[i]!, this.d[p]!)) {
        [this.d[i], this.d[p]] = [this.d[p]!, this.d[i]!];
        i = p;
      } else break;
    }
  }

  pop(): T | undefined {
    if (this.d.length === 0) return undefined;
    const top = this.d[0];
    const last = this.d.pop();
    if (this.d.length > 0 && last !== undefined) {
      this.d[0] = last;
      let i = 0;
      const n = this.d.length;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < n && this.less(this.d[l]!, this.d[s]!)) s = l;
        if (r < n && this.less(this.d[r]!, this.d[s]!)) s = r;
        if (s !== i) { [this.d[i], this.d[s]] = [this.d[s]!, this.d[i]!]; i = s; }
        else break;
      }
    }
    return top;
  }
}

// ─── Core Processing ─────────────────────────────────────────────────────────

const buildTransaction = (expense: ExpenseInput): Transaction => {
  const amount = +expense.amount;
  const date = normalizeTs((expense.timestamp ?? expense.date ?? '').toString());
  const ceiling = ceilTo100(amount);
  return { date, amount, ceiling, remanent: ceiling - amount };
};

interface AdjustedTx { tx: Transaction; ms: Ms; adjustedRemanent: number; }

const applyQP = (baseTxs: Transaction[], q: QRule[], p: PRule[]): AdjustedTx[] => {
  const txs: AdjustedTx[] = baseTxs
    .map((tx) => ({ tx, ms: parseTs(tx.date), adjustedRemanent: tx.remanent }))
    .sort((a, b) => a.ms - b.ms);

  const qEvents = q
    .map((r) => ({ startMs: parseTs(r.start), endMs: parseTs(r.end), fixed: r.fixed }))
    .sort((a, b) => a.startMs - b.startMs);

  const pEvents = p
    .map((r) => ({ startMs: parseTs(r.start), endMs: parseTs(r.end), extra: r.extra }))
    .sort((a, b) => a.startMs - b.startMs);

  // Max-heap by startMs for q (latest start wins)
  const qHeap = new MinHeap<{ startMs: Ms; endMs: Ms; fixed: number }>(
    (a, b) => a.startMs > b.startMs
  );
  // Min-heap by endMs for p expiry tracking
  const pHeap = new MinHeap<{ endMs: Ms; extra: number }>((a, b) => a.endMs < b.endMs);
  let pSum = 0, qi = 0, pi = 0;

  for (const item of txs) {
    const t = item.ms;

    // Activate q rules where start <= t
    while (qi < qEvents.length && qEvents[qi]!.startMs <= t) qHeap.push(qEvents[qi++]!);
    // Remove expired q
    while (qHeap.size > 0 && (qHeap.peek()!.endMs < t || Number.isNaN(qHeap.peek()!.endMs))) qHeap.pop();

    // Activate p rules where start <= t
    while (pi < pEvents.length && pEvents[pi]!.startMs <= t) {
      pSum += pEvents[pi]!.extra;
      pHeap.push({ endMs: pEvents[pi]!.endMs, extra: pEvents[pi]!.extra });
      pi++;
    }
    // Remove expired p
    while (pHeap.size > 0 && pHeap.peek()!.endMs < t) {
      pSum -= pHeap.pop()!.extra;
    }

    // Apply q override then p addition
    const qTop = qHeap.peek();
    let rem = item.tx.remanent;
    if (qTop && qTop.startMs <= t && t <= qTop.endMs) rem = qTop.fixed;
    rem += pSum;

    item.adjustedRemanent = rem;
    item.tx.remanent = rem;
  }

  return txs;
};

// ─── Tax Calculation ─────────────────────────────────────────────────────────

const TAX_SLABS = [
  { limit: 700_000, rate: 0 },
  { limit: 1_000_000, rate: 0.10 },
  { limit: 1_200_000, rate: 0.15 },
  { limit: 1_500_000, rate: 0.20 },
  { limit: Infinity, rate: 0.30 }
];

const calculateTax = (income: number): number => {
  let tax = 0, prev = 0;
  for (const { limit, rate } of TAX_SLABS) {
    if (income <= prev) break;
    tax += Math.min(income, limit) - prev > 0 ? (Math.min(income, limit) - prev) * rate : 0;
    prev = limit;
  }
  return tax;
};

const calculateTaxBenefit = (annualIncome: number, deduction: number): number =>
  calculateTax(annualIncome) - calculateTax(annualIncome - deduction);

// ─── Service ─────────────────────────────────────────────────────────────────

export class TransactionService {
  async parseTransactions(transactions: ExpenseInput[]): Promise<Transaction[]> {
    logger.info('Parsing transactions', { count: transactions.length });
    return transactions.map(buildTransaction);
  }

  async validateTransactions(
    transactions: Array<{ amount: number; date?: string; ceiling?: number; remanent?: number }>,
    wage?: number
  ) {
    logger.info('Validating transactions', { count: transactions.length });

    const timestampCounts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.date) timestampCounts.set(tx.date, (timestampCounts.get(tx.date) ?? 0) + 1);
    }

    const valid: Transaction[] = [];
    const invalid: Array<Transaction & { message: string }> = [];

    for (const tx of transactions) {
      const amount = +tx.amount;
      const date = tx.date ?? '';
      const expectedCeiling = ceilTo100(amount);
      const expectedRemanent = expectedCeiling - amount;
      const ceiling = tx.ceiling ?? expectedCeiling;
      const remanent = tx.remanent ?? expectedRemanent;
      const base = { date, amount, ceiling, remanent };

      if (amount < 0) { invalid.push({ ...base, message: 'Negative amounts are not allowed' }); continue; }
      if (!tx.date) { invalid.push({ ...base, message: 'Timestamp must be a valid ISO date' }); continue; }
      if (tx.ceiling != null && tx.ceiling !== expectedCeiling) { invalid.push({ ...base, message: 'Ceiling is inconsistent' }); continue; }
      if (tx.remanent != null && tx.remanent !== expectedRemanent) { invalid.push({ ...base, message: 'Remanent is inconsistent' }); continue; }
      if ((timestampCounts.get(tx.date) ?? 0) > 1) { invalid.push({ ...base, message: 'Duplicate transaction' }); continue; }

      valid.push(base);
    }

    // NPS wage limit check
    if (typeof wage === 'number') {
      const investedTotal = valid.reduce((s, t) => s + t.remanent, 0);
      const maxInvestment = Math.min(200_000, wage * 12 * 0.10);
      if (investedTotal > maxInvestment) {
        const message = `Total investment exceeds NPS limit of ₹${maxInvestment}`;
        for (const item of valid) invalid.push({ ...item, message });
        valid.length = 0;
      }
    }

    logger.info('Validation completed', { valid: valid.length, invalid: invalid.length });
    return { valid, invalid };
  }

  async filterTransactions(
    transactions: ExpenseInput[],
    q: QRule[], p: PRule[], k: KPeriod[]
  ) {
    const baseTxs = transactions.map(buildTransaction);
    const adjusted = applyQP(baseTxs, q, p);

    const timestampCounts = new Map<string, number>();
    const firstOccurrence = new Map<string, number>();
    for (let i = 0; i < adjusted.length; i++) {
      const ts = adjusted[i]!.tx.date;
      const n = (timestampCounts.get(ts) ?? 0) + 1;
      timestampCounts.set(ts, n);
      if (n === 1) firstOccurrence.set(ts, i);
    }

    const kIntervals = k
      .map((p) => ({ startMs: parseTs(p.start), endMs: parseTs(p.end) }))
      .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs) && x.startMs <= x.endMs);
    const mergedK = mergeIntervals(kIntervals);

    const valid: Array<Transaction & { inKPeriod: true }> = [];
    const invalid: Array<{ date: string; amount: number; message: string }> = [];

    for (let i = 0; i < adjusted.length; i++) {
      const { tx, ms } = adjusted[i]!;

      if (Number.isNaN(ms)) { invalid.push({ date: tx.date, amount: tx.amount, message: 'Invalid date' }); continue; }
      if (!inAnyInterval(mergedK, ms)) { invalid.push({ date: tx.date, amount: tx.amount, message: 'Transaction outside evaluation periods' }); continue; }
      if (tx.amount < 0) { invalid.push({ date: tx.date, amount: tx.amount, message: 'Negative amounts are not allowed' }); continue; }
      if ((timestampCounts.get(tx.date) ?? 0) > 1 && i !== firstOccurrence.get(tx.date)) {
        invalid.push({ date: tx.date, amount: tx.amount, message: 'Duplicate transaction' }); continue;
      }

      valid.push({ ...tx, inKPeriod: true });
    }

    return { valid, invalid };
  }

  // ─── Returns (shared logic for NPS & Index) ──────────────────────────────

  private computeReturns(
    input: ReturnsInput,
    rate: number,
    computeTaxBenefit: (amount: number, annualIncome: number) => number,
    options?: { useNominalProfits?: boolean }
  ): ReturnsResult {
    const { age, wage = 0, inflation, transactions, q, p, k } = input;
    const inflDec = normalizeInflation(inflation);

    const baseTxs = transactions.map(buildTransaction);
    const adjusted = applyQP(baseTxs, q, p);

    // Filter negatives and duplicates (keep first occurrence per timestamp), same as filterTransactions
    const seen = new Set<string>();
    const valid: AdjustedTx[] = [];
    for (const it of adjusted) {
      if (it.tx.amount < 0) continue;
      if (Number.isNaN(it.ms)) continue;
      if (seen.has(it.tx.date)) continue;
      seen.add(it.tx.date);
      valid.push(it);
    }

    const times = valid.map((x) => x.ms);

    // Prefix sums for O(1) range queries
    const prefix = new Float64Array(valid.length + 1);
    for (let i = 0; i < valid.length; i++) {
      prefix[i + 1] = prefix[i]! + valid[i]!.adjustedRemanent;
    }

    const kSums = k.map((period) => {
      const sMs = parseTs(period.start);
      const eMs = parseTs(period.end);
      const l = lowerBound(times, sMs);
      const r = upperBound(times, eMs);
      return {
        start: formatTs(sMs),
        end: formatTs(eMs),
        amount: (prefix[r] ?? 0) - (prefix[l] ?? 0)
      };
    });

    // Totals — only count transactions within merged k intervals
    const mergedK = mergeIntervals(
      kSums
        .map((x) => ({ startMs: parseTs(x.start), endMs: parseTs(x.end) }))
        .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs) && x.startMs <= x.endMs)
    );

    let transactionsTotalAmount = 0;
    let transactionsTotalCeiling = 0;
    for (const it of valid) {
      if (!Number.isNaN(it.ms) && inAnyInterval(mergedK, it.ms)) {
        transactionsTotalAmount += it.tx.amount;
        transactionsTotalCeiling += it.tx.ceiling;
      }
    }

    const t = age < 60 ? 60 - age : 5;
    const annualIncome = wage * 12;
    const growthFactor = Math.pow(1 + rate, t);
    const inflFactor = Math.pow(1 + inflDec, t);

    const useNominal = options?.useNominalProfits ?? false;
    const savingsByDates: SavingsByDate[] = kSums.map((x) => {
      const A = x.amount * growthFactor;
      const AReal = A / inflFactor;
      const profits = useNominal ? A - x.amount : AReal - x.amount;
      const taxBenefit = computeTaxBenefit(x.amount, annualIncome);
      return { start: x.start, end: x.end, amount: x.amount, profits, taxBenefit };
    });

    return { transactionsTotalAmount, transactionsTotalCeiling, savingsByDates };
  }

  async calculateNPSReturns(input: ReturnsInput): Promise<ReturnsResult> {
    logger.info('Calculating NPS returns', { age: input.age, txCount: input.transactions.length });
    return this.computeReturns(input, 0.0711, (amount, annualIncome) => {
      const deduction = Math.min(amount, annualIncome * 0.10, 200_000);
      return calculateTaxBenefit(annualIncome, deduction);
    });
  }

  async calculateIndexReturns(input: ReturnsInput): Promise<ReturnsResult> {
    logger.info('Calculating Index returns', { age: input.age, txCount: input.transactions.length });
    return this.computeReturns(input, 0.1449, () => 0, { useNominalProfits: true });
  }
}
