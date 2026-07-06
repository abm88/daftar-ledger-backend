import { asyncHandler } from '../utils/asyncHandler.js';
import { rateService } from '../services/rateService.js';

export const rateController = {
  list: asyncHandler(async (req, res) => {
    const result = await rateService.list(req.userId);
    res.json(result);
  }),

  update: asyncHandler(async (req, res) => {
    const rates = await rateService.update(req.userId, req.body.rates);
    res.json({ rates });
  }),

  history: asyncHandler(async (req, res) => {
    const history = await rateService.history(req.userId, req.query.asset, req.query.limit);
    res.json({ history });
  })
};
