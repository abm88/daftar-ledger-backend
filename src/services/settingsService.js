import { AppError } from '../utils/AppError.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';

export const settingsService = {
  async get(userId) {
    const settings = await settingsRepository.getForUser(userId);
    if (!settings) throw AppError.notFound('Settings not found');
    const { nextHawalaCode, ...rest } = settings;
    return rest;
  },

  /** Updates reporting/trade currency defaults; both must be active assets. */
  async update(userId, { reportingCurrency, tradeCurrency }) {
    const active = await assetRepository.listActiveForUser(userId);
    const activeCodes = new Set(active.map((a) => a.code));
    for (const code of [reportingCurrency, tradeCurrency]) {
      if (code && !activeCodes.has(code)) {
        throw AppError.unprocessable(`Asset ${code} is not active`);
      }
    }
    const updated = await settingsRepository.update(userId, { reportingCurrency, tradeCurrency });
    const { nextHawalaCode, ...rest } = updated;
    return rest;
  }
};
