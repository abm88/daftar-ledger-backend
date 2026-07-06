import { AppError } from '../utils/AppError.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { TOLA_GRAMS } from '../config/constants.js';

export const assetService = {
  async list(userId) {
    const assets = await assetRepository.listForUser(userId);
    return assets.map((a) => ({
      ...a,
      // Metals are stored in grams; expose the tola factor for display.
      tolaGrams: a.type === 'metal' ? TOLA_GRAMS : undefined
    }));
  },

  async setActivation(userId, assetCode, active) {
    const assets = await assetRepository.listForUser(userId);
    const asset = assets.find((a) => a.code === assetCode);
    if (!asset) throw AppError.notFound(`Unknown asset: ${assetCode}`);
    if (asset.isDefault && !active) {
      throw AppError.unprocessable(`${assetCode} is a core asset and cannot be deactivated`);
    }
    await assetRepository.setActivation(userId, assetCode, active);
    return { ...asset, active };
  }
};
