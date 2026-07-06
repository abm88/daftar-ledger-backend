import { asyncHandler } from '../utils/asyncHandler.js';
import { cashDrawerService } from '../services/cashDrawerService.js';

export const cashDrawerController = {
  get: asyncHandler(async (req, res) => {
    const drawer = await cashDrawerService.getDrawer(req.userId);
    res.json(drawer);
  }),

  recordCount: asyncHandler(async (req, res) => {
    const drawer = await cashDrawerService.recordCount(req.userId, req.body.counts);
    res.json(drawer);
  }),

  initialSetup: asyncHandler(async (req, res) => {
    const drawer = await cashDrawerService.initialSetup(req.userId, req.body.amounts);
    res.status(201).json(drawer);
  }),

  todayMovement: asyncHandler(async (req, res) => {
    const movement = await cashDrawerService.todayMovement(req.userId);
    res.json({ movement });
  })
};
