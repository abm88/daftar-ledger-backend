import { asyncHandler } from '../utils/asyncHandler.js';
import { settingsService } from '../services/settingsService.js';

export const settingsController = {
  get: asyncHandler(async (req, res) => {
    const settings = await settingsService.get(req.userId);
    res.json({ settings });
  }),

  update: asyncHandler(async (req, res) => {
    const settings = await settingsService.update(req.userId, req.body);
    res.json({ settings });
  })
};
