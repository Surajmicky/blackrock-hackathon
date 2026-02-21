import Joi from 'joi';
import { ValidationError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

// Transaction schema
const timestampSchema = Joi.alternatives()
  .try(
    Joi.string().isoDate().messages({
      'string.isoDate': 'Timestamp must be a valid date'
    }),
    Joi.string().pattern(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).messages({
      'string.pattern.base': 'Timestamp must be in format "YYYY-MM-DD HH:mm:ss"'
    })
  )
  .messages({
    'alternatives.match': 'Timestamp must be a valid date'
  });

export const transactionSchema = Joi.object({
  amount: Joi.number().required().messages({
    'number.base': 'Amount must be a number',
    'any.required': 'Amount is required'
  }),
  timestamp: timestampSchema.messages({
    'any.required': 'Timestamp is required'
  }),
  date: timestampSchema
})
  .or('timestamp', 'date')
  .unknown(false);

// Validator transaction schema (supports parsed fields + date alias)
export const validatorTransactionSchema = Joi.object({
  amount: Joi.number().required().messages({
    'number.base': 'Amount must be a number',
    'any.required': 'Amount is required'
  }),
  timestamp: timestampSchema,
  date: timestampSchema,
  ceiling: Joi.number().messages({
    'number.base': 'Ceiling must be a number'
  }),
  remanent: Joi.number().messages({
    'number.base': 'Remanent must be a number'
  })
})
  .or('timestamp', 'date')
  .unknown(false);

export const parsedTransactionSchema = Joi.object({
  date: timestampSchema.required().messages({
    'any.required': 'Date is required'
  }),
  amount: Joi.number().required().messages({
    'number.base': 'Amount must be a number',
    'any.required': 'Amount is required'
  }),
  ceiling: Joi.number().required().messages({
    'number.base': 'Ceiling must be a number',
    'any.required': 'Ceiling is required'
  }),
  remanent: Joi.number().required().messages({
    'number.base': 'Remanent must be a number',
    'any.required': 'Remanent is required'
  })
}).unknown(false);

// Q Rule schema
export const qRuleSchema = Joi.object({
  start: timestampSchema.required().messages({
    'any.required': 'Q rule start date is required'
  }),
  end: timestampSchema.required().messages({
    'any.required': 'Q rule end date is required'
  }),
  fixed: Joi.number().required().messages({
    'number.base': 'Q rule fixed value must be a number',
    'any.required': 'Q rule fixed value is required'
  })
});

// P Rule schema
export const pRuleSchema = Joi.object({
  start: timestampSchema.required().messages({
    'any.required': 'P rule start date is required'
  }),
  end: timestampSchema.required().messages({
    'any.required': 'P rule end date is required'
  }),
  extra: Joi.number().required().messages({
    'number.base': 'P rule extra value must be a number',
    'any.required': 'P rule extra value is required'
  })
});

// K Period schema
export const kPeriodSchema = Joi.object({
  start: timestampSchema.required().messages({
    'any.required': 'K period start date is required'
  }),
  end: timestampSchema.required().messages({
    'any.required': 'K period end date is required'
  })
});

// Parse endpoint schema (request body is a raw array)
export const parseSchema = Joi.array().items(transactionSchema).min(1).max(1000000).required().messages({
  'array.base': 'Transactions must be an array',
  'array.min': 'At least one transaction is required',
  'array.max': 'Maximum 1000000 transactions allowed per request',
  'any.required': 'Transactions array is required'
});

// Validator endpoint schema
export const validateSchema = Joi.object({
  wage: Joi.number().positive().optional().messages({
    'number.positive': 'Wage must be a positive number',
  }),
  transactions: Joi.array().items(parsedTransactionSchema).min(1).max(1000000).required().messages({
    'array.base': 'Transactions must be an array',
    'array.min': 'At least one transaction is required',
    'array.max': 'Maximum 1000000 transactions allowed per request',
    'any.required': 'Transactions array is required'
  })
});

// Filter endpoint schema
export const filterSchema = Joi.object({
  wage: Joi.number().positive().optional().messages({
    'number.positive': 'Wage must be a positive number',
  }),
  transactions: Joi.array().items(transactionSchema).min(1).max(1000000).required().messages({
    'array.base': 'Transactions must be an array',
    'array.min': 'At least one transaction is required',
    'array.max': 'Maximum 1000000 transactions allowed per request',
    'any.required': 'Transactions array is required'
  }),
  q: Joi.array().items(qRuleSchema).required().messages({
    'array.base': 'Q rules must be an array',
    'any.required': 'Q rules array is required'
  }),
  p: Joi.array().items(pRuleSchema).required().messages({
    'array.base': 'P rules must be an array',
    'any.required': 'P rules array is required'
  }),
  k: Joi.array().items(kPeriodSchema).required().messages({
    'array.base': 'K periods must be an array',
    'any.required': 'K periods array is required'
  })
});

// NPS returns schema
export const npsSchema = Joi.object({
  age: Joi.number().integer().min(0).max(120).required().messages({
    'number.base': 'Age must be a number',
    'number.integer': 'Age must be an integer',
    'number.min': 'Age cannot be negative',
    'number.max': 'Age cannot exceed 120 years',
    'any.required': 'Age is required'
  }),
  wage: Joi.number().positive().required().messages({
    'number.positive': 'Wage must be a positive number',
    'any.required': 'Wage is required'
  }),
  inflation: Joi.number().min(0).max(1).required().messages({
    'number.base': 'Inflation must be a number',
    'any.required': 'Inflation is required'
  }),
  transactions: Joi.array().items(transactionSchema).min(1).max(1000000).required(),
  q: Joi.array().items(qRuleSchema).required(),
  p: Joi.array().items(pRuleSchema).required(),
  k: Joi.array().items(kPeriodSchema).required()
});

// Index returns schema
export const indexSchema = Joi.object({
  age: Joi.number().integer().min(0).max(120).required().messages({
    'number.base': 'Age must be a number',
    'number.integer': 'Age must be an integer',
    'number.min': 'Age cannot be negative',
    'number.max': 'Age cannot exceed 120 years',
    'any.required': 'Age is required'
  }),
  inflation: Joi.number().min(0).max(1).required().messages({
    'number.base': 'Inflation must be a number',
    'any.required': 'Inflation is required'
  }),
  transactions: Joi.array().items(transactionSchema).min(1).max(1000000).required(),
  q: Joi.array().items(qRuleSchema).required(),
  p: Joi.array().items(pRuleSchema).required(),
  k: Joi.array().items(kPeriodSchema).required()
});

export class JoiValidator {

  private static parseTimestamp(value: string): number {
    const iso = Date.parse(value);
    if (!Number.isNaN(iso)) return iso;

    const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return NaN;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }
  
  // Validate parse endpoint
  static validateParseInput(body: any) {
    const { error, value } = parseSchema.validate(body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Parse input validation failed', { 
        errors: error.details, 
        input: body 
      });
      throw new ValidationError(errorMessage);
    }
    
    logger.info('Parse input validated with Joi', {
      transactionCount: value.length
    });
    return value;
  }

  // Validate validator endpoint
  static validateValidateInput(body: any) {
    const { error, value } = validateSchema.validate(body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Validator input validation failed', { 
        errors: error.details, 
        input: body 
      });
      throw new ValidationError(errorMessage);
    }
    
    logger.info('Validator input validated with Joi', { 
      transactionCount: value.transactions.length 
    });
    return value;
  }

  // Validate filter endpoint
  static validateFilterInput(body: any) {
    const { error, value } = filterSchema.validate(body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Filter input validation failed', { 
        errors: error.details, 
        input: body 
      });
      throw new ValidationError(errorMessage);
    }
    
    // Additional business validation
    this.validateFilterBusinessRules(value);
    
    logger.info('Filter input validated with Joi', { 
      transactionCount: value.transactions.length,
      qRules: value.q.length,
      pRules: value.p.length,
      kPeriods: value.k.length
    });
    return value;
  }

  // Validate NPS returns endpoint
  static validateNPSInput(body: any) {
    const { error, value } = npsSchema.validate(body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('NPS input validation failed', { 
        errors: error.details, 
        input: body 
      });
      throw new ValidationError(errorMessage);
    }
    
    logger.info('NPS input validated with Joi', value);
    return value;
  }

  // Validate Index returns endpoint
  static validateIndexInput(body: any) {
    const { error, value } = indexSchema.validate(body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Index input validation failed', { 
        errors: error.details, 
        input: body 
      });
      throw new ValidationError(errorMessage);
    }
    
    logger.info('Index input validated with Joi', value);
    return value;
  }

  // Additional business validation for filter endpoint
  private static validateFilterBusinessRules(value: any) {
    // Validate Q rules
    for (const rule of value.q) {
      const startMs = this.parseTimestamp(rule.start);
      const endMs = this.parseTimestamp(rule.end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        throw new ValidationError('Q rule start date must be a valid date');
      }
      if (startMs > endMs) {
        throw new ValidationError('Q rule start must be before end');
      }
    }

    // Validate P rules
    for (const rule of value.p) {
      const startMs = this.parseTimestamp(rule.start);
      const endMs = this.parseTimestamp(rule.end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        throw new ValidationError('P rule dates must be valid');
      }
      if (startMs > endMs) {
        throw new ValidationError('P rule start must be before end');
      }
    }

    // Validate K periods
    for (const period of value.k) {
      const startMs = this.parseTimestamp(period.start);
      const endMs = this.parseTimestamp(period.end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        throw new ValidationError('K period dates must be valid');
      }
      if (startMs > endMs) {
        throw new ValidationError('K period start must be before end');
      }
    }
  }
}
