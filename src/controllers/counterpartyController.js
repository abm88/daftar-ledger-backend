import { asyncHandler } from '../utils/asyncHandler.js';
import { counterpartyService } from '../services/counterpartyService.js';
import { statementService } from '../services/statementService.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';

export const counterpartyController = {
  list: asyncHandler(async (req, res) => {
    const counterparties = await counterpartyService.list(req.userId, { search: req.query.search });
    res.json({ counterparties });
  }),

  get: asyncHandler(async (req, res) => {
    const counterparty = await counterpartyService.getById(req.userId, req.params.id);
    res.json({ counterparty });
  }),

  create: asyncHandler(async (req, res) => {
    const counterparty = await counterpartyService.create(req.userId, req.body);
    res.status(201).json({ counterparty });
  }),

  update: asyncHandler(async (req, res) => {
    const counterparty = await counterpartyService.update(req.userId, req.params.id, req.body);
    res.json({ counterparty });
  }),

  remove: asyncHandler(async (req, res) => {
    await counterpartyService.delete(req.userId, req.params.id);
    res.status(204).end();
  }),

  hawalas: asyncHandler(async (req, res) => {
    // Ownership check via service (404 for other users' counterparties).
    await counterpartyService.getById(req.userId, req.params.id);
    const hawalas = await hawalaRepository.listByCounterparty(req.params.id);
    res.json({ hawalas });
  }),

  settle: asyncHandler(async (req, res) => {
    const result = await counterpartyService.settle(req.userId, req.params.id, req.body);
    res.status(201).json(result);
  }),

  statement: asyncHandler(async (req, res) => {
    const statement = await statementService.counterpartyStatement(
      req.userId, req.params.id, req.query
    );
    res.json(statement);
  })
};
