import { asyncHandler } from '../utils/asyncHandler.js';
import { customerService } from '../services/customerService.js';
import { statementService } from '../services/statementService.js';

export const customerController = {
  list: asyncHandler(async (req, res) => {
    const result = await customerService.list(req.userId, {
      search: req.query.search,
      cityCode: req.query.city,
      status: req.query.status
    });
    res.json(result);
  }),

  get: asyncHandler(async (req, res) => {
    const customer = await customerService.getById(req.userId, req.params.id);
    res.json({ customer });
  }),

  create: asyncHandler(async (req, res) => {
    const customer = await customerService.create(req.userId, req.body);
    res.status(201).json({ customer });
  }),

  update: asyncHandler(async (req, res) => {
    const customer = await customerService.update(req.userId, req.params.id, req.body);
    res.json({ customer });
  }),

  remove: asyncHandler(async (req, res) => {
    await customerService.delete(req.userId, req.params.id);
    res.status(204).end();
  }),

  transactions: asyncHandler(async (req, res) => {
    const transactions = await customerService.listTransactions(req.userId, req.params.id);
    res.json({ transactions });
  }),

  addTransaction: asyncHandler(async (req, res) => {
    const transaction = await customerService.addTransaction(req.userId, req.params.id, req.body);
    res.status(201).json({ transaction });
  }),

  statement: asyncHandler(async (req, res) => {
    const statement = await statementService.customerStatement(
      req.userId, req.params.id, req.query
    );
    res.json(statement);
  })
};
