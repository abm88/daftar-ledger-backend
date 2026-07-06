import { asyncHandler } from '../utils/asyncHandler.js';
import { fxService } from '../services/fxService.js';
import { parsePagination, paginatedResponse } from '../utils/pagination.js';

export const fxController = {
  list: asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const { items, total } = await fxService.listTrades(req.userId, pagination);
    res.json(paginatedResponse(items, total, pagination));
  }),

  create: asyncHandler(async (req, res) => {
    const trade = await fxService.createTrade(req.userId, req.body);
    res.status(201).json({ trade });
  }),

  positions: asyncHandler(async (req, res) => {
    const positions = await fxService.positions(req.userId);
    res.json({ positions });
  })
};
