import Joi from 'joi';
import { ValidationError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

// ─── Shared Schemas ──────────────────────────────────────────────────────────

const timestampSchema = Joi.alternatives()
  .try(
    Joi.string().isoDate(),
    Joi.string().pattern(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  )
  .messages({
    'alternatives.match': 'Must be a valid datetime (ISO or "YYYY-MM-DD HH:mm:ss")'
  });

const qRuleSchema = Joi.object({
  start: timestampSchema.required(),
  end: timestampSchema.required(),
  fixed: Joi.number().required()
});

const pRuleSchema = Joi.object({
  start: timestampSchema.required(),
  end: timestampSchema.required(),
  extra: Joi.number().required()
});

const kPeriodSchema = Joi.object({
  start: timestampSchema.required(),
  end: timestampSchema.required()
});

const transactionSchema = Joi.object({
  amount: Joi.number().required(),
  timestamp: timestampSchema,
  date: timestampSchema
})
  .or('timestamp', 'date')
  .unknown(false);

const parsedTransactionSchema = Joi.object({
  date: timestampSchema.required(),
  amount: Joi.number().required(),
  ceiling: Joi.number().required(),
  remanent: Joi.number().required()
}).unknown(false);

// ─── Endpoint Schemas ────────────────────────────────────────────────────────

const parseSchema = Joi.array()
  .items(transactionSchema)
  .min(1)
  .max(1_000_000)
  .required()
  .messages({
    'array.base': 'Request body must be an array of transactions',
    'array.min': 'At least one transaction is required',
    'array.max': 'Maximum 1,000,000 transactions allowed'
  });

const validateSchema = Joi.object({
  wage: Joi.number().positive().optional(),
  transactions: Joi.array()
    .items(parsedTransactionSchema)
    .min(1)
    .max(1_000_000)
    .required()
});

const filterSchema = Joi.object({
  wage: Joi.number().positive().optional(),
  transactions: Joi.array().items(transactionSchema).min(1).max(1_000_000).required(),
  q: Joi.array().items(qRuleSchema).required(),
  p: Joi.array().items(pRuleSchema).required(),
  k: Joi.array().items(kPeriodSchema).required()
});

const returnsBaseSchema = {
  age: Joi.number().integer().min(0).max(120).required(),
  wage: Joi.number().positive().required(),
  inflation: Joi.number().min(0).max(100).required(),
  transactions: Joi.array().items(transactionSchema).min(1).max(1_000_000).required(),
  q: Joi.array().items(qRuleSchema).required(),
  p: Joi.array().items(pRuleSchema).required(),
  k: Joi.array().items(kPeriodSchema).min(1).required()
};

const npsSchema = Joi.object({ ...returnsBaseSchema }).unknown(false);

const indexSchema = Joi.object({
  ...returnsBaseSchema,
  wage: Joi.number().positive().optional() // wage is optional for index
}).unknown(false);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseTimestamp = (value: string): number => {
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return iso;

  const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return NaN;

  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
};

const validatePeriodOrdering = (
  items: Array<{ start: string; end: string }>,
  label: string
) => {
  for (const item of items) {
    const s = parseTimestamp(item.start);
    const e = parseTimestamp(item.end);
    if (Number.isNaN(s) || Number.isNaN(e)) {
      throw new ValidationError(`${label} dates must be valid`);
    }
    if (s > e) {
      throw new ValidationError(`${label} start must be before end`);
    }
  }
};

// ─── Validator Class ─────────────────────────────────────────────────────────

export class JoiValidator {
  private static validate<T>(schema: Joi.Schema, body: unknown, label: string): T {
    const { error, value } = schema.validate(body);
    if (error) {
      const msg = error.details.map((d) => d.message).join(', ');
      logger.warn(`${label} validation failed`, { errors: error.details });
      throw new ValidationError(msg);
    }
    return value as T;
  }

  static validateParseInput(body: unknown) {
    return this.validate<any[]>(parseSchema, body, 'Parse');
  }

  static validateValidateInput(body: unknown) {
    return this.validate<{ wage?: number; transactions: any[] }>(
      validateSchema, body, 'Validator'
    );
  }

  static validateFilterInput(body: unknown) {
    const value = this.validate<any>(filterSchema, body, 'Filter');
    validatePeriodOrdering(value.q, 'Q rule');
    validatePeriodOrdering(value.p, 'P rule');
    validatePeriodOrdering(value.k, 'K period');
    return value;
  }

  static validateNPSInput(body: unknown) {
    return this.validate<any>(npsSchema, body, 'NPS');
  }

  static validateIndexInput(body: unknown) {
    return this.validate<any>(indexSchema, body, 'Index');
  }
}
