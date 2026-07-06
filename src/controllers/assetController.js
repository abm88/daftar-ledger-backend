import { asyncHandler } from '../utils/asyncHandler.js';
import { assetService } from '../services/assetService.js';

export const assetController = {
  list: asyncHandler(async (req, res) => {
    const assets = await assetService.list(req.userId);
    res.json({ assets });
  }),

  setActivation: asyncHandler(async (req, res) => {
    const asset = await assetService.setActivation(
      req.userId,
      req.params.code.toUpperCase(),
      req.body.active
    );
    res.json({ asset });
  })
};
