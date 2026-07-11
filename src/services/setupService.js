import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { investmentRepository } from '../repositories/investmentRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { cashDrawerService } from './cashDrawerService.js';
import { BASE_ASSET } from '../config/constants.js';
import { round6 } from '../utils/money.js';

/**
 * First-run shop setup — the app's 3-step "Welcome to Daftar" wizard:
 *   1. Assets   — which currencies/metals the saraf deals in (AFN locked on)
 *   2. Currency — reporting + trade currency, picked from the enabled ones
 *   3. Amounts  — opening drawer balances, each doubling as 'opening' equity
 */
export const setupService = {
  /**
   * Setup is needed until the drawer holds something or any investment
   * exists — the same rule the app uses for its home-screen welcome card.
   */
  async isSetupNeeded(userId) {
    const [balances, investments] = await Promise.all([
      cashDrawerRepository.mapForUser(userId),
      investmentRepository.listForUser(userId)
    ]);
    const hasBalance = Object.values(balances).some((v) => v > 0);
    return !hasBalance && investments.length === 0;
  },

  async status(userId) {
    return { setupNeeded: await this.isSetupNeeded(userId) };
  },

  /**
   * Commits the whole wizard in one transaction. Mirrors the prototype:
   * AFN is always enabled; reporting/trade must be enabled currencies;
   * amounts apply only to enabled assets, set absolute drawer balances, and
   * each writes an 'opening' investment entry. Assets and settings left out
   * of `amounts` keep their current drawer balances (re-running the wizard
   * from Shop → Initial Setup replaces only what was entered).
   */
  async complete(userId, { activeAssets, reportingCurrency, tradeCurrency, amounts }) {
    const registry = await assetRepository.listForUser(userId);
    const byCode = Object.fromEntries(registry.map((a) => [a.code, a]));

    const enabled = new Set(activeAssets);
    enabled.add(BASE_ASSET); // AFN is the base bridge currency — always on
    for (const code of enabled) {
      if (!byCode[code]) throw AppError.unprocessable(`Unknown asset: ${code}`);
    }

    for (const code of [reportingCurrency, tradeCurrency]) {
      const asset = byCode[code];
      const label = code === reportingCurrency ? 'Reporting' : 'Trade';
      if (!asset || asset.type !== 'currency') {
        throw AppError.unprocessable(`${label} currency must be a currency asset`);
      }
      if (!enabled.has(code)) {
        throw AppError.unprocessable(`${label} currency ${code} is not among the enabled assets`);
      }
    }

    const amountEntries = Object.entries(amounts || {});
    if (amountEntries.length === 0) {
      throw AppError.badRequest('Enter at least one opening amount');
    }
    for (const [code, value] of amountEntries) {
      if (!enabled.has(code)) {
        throw AppError.unprocessable(`Asset ${code} is not among the enabled assets`);
      }
      if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
        throw AppError.unprocessable(`Invalid amount for ${code}`);
      }
    }

    await withTransaction(async (client) => {
      for (const asset of registry) {
        await assetRepository.setActivation(userId, asset.code, enabled.has(asset.code), client);
      }
      await settingsRepository.update(userId, { reportingCurrency, tradeCurrency }, client);
      for (const [code, value] of amountEntries) {
        await cashDrawerRepository.setBalance(userId, code, round6(value), client);
        await investmentRepository.create(userId, {
          assetCode: code,
          amount: round6(value),
          type: 'opening',
          note: `Initial setup · ${byCode[code].name}`
        }, client);
      }
      await settingsRepository.touchLastCashCount(userId, client);
    });

    const [drawer, settings, assets] = await Promise.all([
      cashDrawerService.getDrawer(userId),
      settingsRepository.getForUser(userId),
      assetRepository.listForUser(userId)
    ]);
    return {
      setupNeeded: false,
      settings: {
        reportingCurrency: settings.reportingCurrency,
        tradeCurrency: settings.tradeCurrency
      },
      assets: assets.map((a) => ({ code: a.code, active: a.active })),
      drawer
    };
  }
};
