import { asyncHandler } from '../utils/asyncHandler.js';
import { teamService } from '../services/teamService.js';

export const teamController = {
  list: asyncHandler(async (req, res) => {
    const result = await teamService.list(req.userId);
    res.json(result);
  }),

  get: asyncHandler(async (req, res) => {
    const member = await teamService.getById(req.userId, req.params.id);
    res.json({ member });
  }),

  create: asyncHandler(async (req, res) => {
    const member = await teamService.create(req.userId, req.body);
    res.status(201).json({ member });
  }),

  update: asyncHandler(async (req, res) => {
    const member = await teamService.update(req.userId, req.params.id, req.body);
    res.json({ member });
  }),

  remove: asyncHandler(async (req, res) => {
    await teamService.delete(req.userId, req.params.id);
    res.status(204).end();
  })
};
