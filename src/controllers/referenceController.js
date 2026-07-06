import { asyncHandler } from '../utils/asyncHandler.js';
import { referenceRepository } from '../repositories/referenceRepository.js';

export const referenceController = {
  cities: asyncHandler(async (_req, res) => {
    const cities = await referenceRepository.listCities();
    res.json({ cities });
  })
};
