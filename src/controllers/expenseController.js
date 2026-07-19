import { asyncHandler } from '../utils/asyncHandler.js';
import { expenseService } from '../services/expenseService.js';

export const expenseController = {
  list: asyncHandler(async (req, res) => {
    const expenses = await expenseService.list(req.userId, {
      teamMemberId: req.query.teamMemberId
    });
    res.json({ expenses });
  }),

  get: asyncHandler(async (req, res) => {
    const expense = await expenseService.getById(req.userId, req.params.id);
    res.json({ expense });
  }),

  create: asyncHandler(async (req, res) => {
    const expense = await expenseService.create(req.userId, req.body);
    res.status(201).json({ expense });
  }),

  remove: asyncHandler(async (req, res) => {
    await expenseService.delete(req.userId, req.params.id);
    res.status(204).end();
  })
};
