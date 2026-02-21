import { Request, Response } from 'express';
import { TransactionService } from '../services/transactionService';
import { logger } from '../utils/logger';
import { JoiValidator } from '../validators/joiValidator';
import os from 'os';

const service = new TransactionService();

export class TransactionController {
  async parseTransactions(req: Request, res: Response): Promise<void> {
    const input = JoiValidator.validateParseInput(req.body);
    res.json(await service.parseTransactions(input));
  }

  async validateTransactions(req: Request, res: Response): Promise<void> {
    const { transactions, wage } = JoiValidator.validateValidateInput(req.body);
    res.json(await service.validateTransactions(transactions, wage));
  }

  async filterTransactions(req: Request, res: Response): Promise<void> {
    const { transactions, q, p, k } = JoiValidator.validateFilterInput(req.body);
    res.json(await service.filterTransactions(transactions, q, p, k));
  }

  async calculateNPSReturns(req: Request, res: Response): Promise<void> {
    const input = JoiValidator.validateNPSInput(req.body);
    res.json(await service.calculateNPSReturns(input));
  }

  async calculateIndexReturns(req: Request, res: Response): Promise<void> {
    const input = JoiValidator.validateIndexInput(req.body);
    res.json(await service.calculateIndexReturns(input));
  }

  async getPerformance(_req: Request, res: Response): Promise<void> {
    const start = process.hrtime.bigint();
    const mem = process.memoryUsage();
    const end = process.hrtime.bigint();

    const durationMs = Number(end - start) / 1_000_000;
    res.json({
      time: `${durationMs.toFixed(3)} ms`,
      memory: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      threads: os.cpus().length
    });
  }
}
