import { asyncHandler } from '../utils/asyncHandler.js';
import { setupService } from '../services/setupService.js';

export const setupController = {
  status: asyncHandler(async (req, res) => {
    res.json(await setupService.status(req.userId));
  }),

  complete: asyncHandler(async (req, res) => {
    res.status(201).json(await setupService.complete(req.userId, req.body));
  })
};
