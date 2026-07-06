import { asyncHandler } from '../utils/asyncHandler.js';
import { investmentService } from '../services/investmentService.js';

export const investmentController = {
  list: asyncHandler(async (req, res) => {
    const result = await investmentService.list(req.userId);
    res.json(result);
  }),

  create: asyncHandler(async (req, res) => {
    const investment = await investmentService.create(req.userId, req.body);
    res.status(201).json({ investment });
  })
};
