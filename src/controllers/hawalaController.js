import { asyncHandler } from '../utils/asyncHandler.js';
import { hawalaService } from '../services/hawalaService.js';
import { parsePagination, paginatedResponse } from '../utils/pagination.js';

export const hawalaController = {
  list: asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const { items, total } = await hawalaService.list(req.userId, {
      status: req.query.status,
      currency: req.query.currency,
      counterpartyId: req.query.counterpartyId,
      search: req.query.search,
      includeOpening: req.query.includeOpening ?? false,
      ...pagination
    });
    res.json(paginatedResponse(items, total, pagination));
  }),

  pending: asyncHandler(async (req, res) => {
    const hawalas = await hawalaService.listPending(req.userId);
    res.json({ hawalas });
  }),

  nextCode: asyncHandler(async (req, res) => {
    const code = await hawalaService.peekNextCode(req.userId);
    res.json({ code });
  }),

  get: asyncHandler(async (req, res) => {
    const hawala = await hawalaService.getById(req.userId, req.params.id);
    res.json({ hawala });
  }),

  issue: asyncHandler(async (req, res) => {
    const hawala = await hawalaService.issue(req.userId, req.body);
    res.status(201).json({ hawala });
  }),

  markPaid: asyncHandler(async (req, res) => {
    const hawala = await hawalaService.markPaid(req.userId, req.params.id);
    res.json({ hawala });
  })
};
