import { Request, Response } from 'express';
import { TransactionService } from '../services/transactionService';
import { logger } from '../utils/logger';
import { JoiValidator } from '../validators/joiValidator';

export class TransactionController {
  private transactionService: TransactionService;

  constructor() {
    this.transactionService = new TransactionService();
  }

  // POST /blackrock/challenge/v1/transactions:parse
  async parseTransactions(req: Request, res: Response): Promise<void> {
    try {
      // Validate input with Joi
      const validatedInput = JoiValidator.validateParseInput(req.body);
      
      // Process with service layer
      const results = await this.transactionService.parseTransactions(validatedInput);
      
      res.json(results);
    } catch (error: any) {
      logger.error('Parse transaction error', error);
      throw error; // Handled by error middleware
    }
  }

  // POST /blackrock/challenge/v1/transactions:validator
  async validateTransactions(req: Request, res: Response): Promise<void> {
    try {
      // Validate input with Joi
      const validatedInput = JoiValidator.validateValidateInput(req.body);
      
      // Process with service layer
      const results = await this.transactionService.validateTransactions(
        validatedInput.transactions,
        validatedInput.wage
      );
      
      res.json(results);
    } catch (error: any) {
      logger.error('Validate transaction error', error);
      throw error;
    }
  }

  // POST /blackrock/challenge/v1/transactions:filter
  async filterTransactions(req: Request, res: Response): Promise<void> {
    try {
      // Validate input with Joi
      const validatedInput = JoiValidator.validateFilterInput(req.body);
      
      // Process with service layer
      const results = await this.transactionService.filterTransactions(
        validatedInput.transactions, 
        validatedInput.q, 
        validatedInput.p, 
        validatedInput.k
      );
      
      res.json(results);
    } catch (error: any) {
      logger.error('Filter transaction error', error);
      throw error;
    }
  }

  // POST /blackrock/challenge/v1/returns:nps
  async calculateNPSReturns(req: Request, res: Response): Promise<void> {
    try {
      // Validate input with Joi
      const validatedInput = JoiValidator.validateNPSInput(req.body);
      
      // Process with service layer
      const result = await this.transactionService.calculateNPSReturns(validatedInput);
      
      res.json(result);
    } catch (error: any) {
      logger.error('NPS calculation error', error);
      throw error;
    }
  }

  // POST /blackrock/challenge/v1/returns:index
  async calculateIndexReturns(req: Request, res: Response): Promise<void> {
    try {
      // Validate input with Joi
      const validatedInput = JoiValidator.validateIndexInput(req.body);
      
      // Process with service layer
      const result = await this.transactionService.calculateIndexReturns(validatedInput);
      
      res.json(result);
    } catch (error: any) {
      logger.error('Index calculation error', error);
      throw error;
    }
  }

  // GET /blackrock/challenge/v1/performance
  async getPerformance(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Performance metrics request received');

      const start = process.hrtime.bigint();
      const memUsage = process.memoryUsage();
      const threads = require('os').cpus().length;

      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      const rssMb = memUsage.rss / 1024 / 1024;

      const performanceData = {
        time: `${durationMs.toFixed(3)} ms`,
        memory: `${rssMb.toFixed(2)} MB`,
        threads
      };

      logger.logPerformance('performance_check', 0, performanceData);
      res.json(performanceData);
    } catch (error: any) {
      logger.error('Performance metrics error', error);
      throw error;
    }
  }

  private calculateTaxDifference(income: number, deduction: number): number {
    const taxWithoutDeduction = this.calculateTax(income);
    const taxWithDeduction = this.calculateTax(income - deduction);
    return taxWithoutDeduction - taxWithDeduction;
  }

  private calculateTax(income: number): number {
    if (income <= 700000) return 0;
    if (income <= 1000000) return (income - 700000) * 0.10;
    if (income <= 1200000) return 30000 + (income - 1000000) * 0.15;
    if (income <= 1500000) return 30000 + 30000 + (income - 1200000) * 0.20;
    return 30000 + 30000 + 60000 + (income - 1500000) * 0.30;
  }
}
