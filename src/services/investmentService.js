import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { investmentRepository } from '../repositories/investmentRepository.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { assetToReporting } from '../domain/rateMath.js';
import { INVESTMENT_TYPES } from '../config/constants.js';
import { round6 } from '../utils/money.js';

export const investmentService = {
  /**
   * All equity entries plus per-asset totals (invested / withdrawn / net),
   * the grand total in the reporting currency, and the Investments screen's
   * headline: current equity (drawer holdings at today's rates) vs. net
   * invested capital, with the return in absolute and percent terms.
   * Equity is cash holdings only — receivables and payables are excluded,
   * matching the app's simplification.
   */
  async list(userId) {
    const [entries, rates, settings, drawer, assets] = await Promise.all([
      investmentRepository.listForUser(userId),
      rateRepository.mapForUser(userId),
      settingsRepository.getForUser(userId),
      cashDrawerRepository.mapForUser(userId),
      assetRepository.listActiveForUser(userId)
    ]);
    const reporting = settings.reportingCurrency;

    const perAsset = {};
    let netReporting = 0;
    for (const entry of entries) {
      if (!perAsset[entry.assetCode]) {
        perAsset[entry.assetCode] = { invested: 0, withdrawn: 0, net: 0, count: 0 };
      }
      const bucket = perAsset[entry.assetCode];
      bucket.count += 1;
      if (entry.type === INVESTMENT_TYPES.WITHDRAWAL) {
        bucket.withdrawn += entry.amount;
        bucket.net -= entry.amount;
      } else {
        bucket.invested += entry.amount;
        bucket.net += entry.amount;
      }
      const inReporting = assetToReporting(rates, entry.assetCode, entry.amount, reporting);
      netReporting += entry.type === INVESTMENT_TYPES.WITHDRAWAL ? -inReporting : inReporting;
    }

    for (const bucket of Object.values(perAsset)) {
      bucket.invested = round6(bucket.invested);
      bucket.withdrawn = round6(bucket.withdrawn);
      bucket.net = round6(bucket.net);
    }

    let currentEquityReporting = 0;
    for (const asset of assets) {
      const balance = drawer[asset.code] || 0;
      if (balance === 0) continue;
      currentEquityReporting += assetToReporting(rates, asset.code, balance, reporting);
    }
    const netReturnReporting = currentEquityReporting - netReporting;
    const netReturnPct = netReporting > 0 ? (netReturnReporting / netReporting) * 100 : 0;

    return {
      entries,
      perAsset,
      totals: { netReporting: round6(netReporting), reportingCurrency: reporting },
      equity: {
        currentReporting: round6(currentEquityReporting),
        netReturnReporting: round6(netReturnReporting),
        netReturnPct: round6(netReturnPct),
        reportingCurrency: reporting
      }
    };
  },

  /**
   * Records an owner equity movement and moves the drawer with it — an
   * addition puts cash in, a withdrawal takes it out.
   */
  async create(userId, { assetCode, amount, type, note }) {
    const assets = await assetRepository.listActiveForUser(userId);
    if (!assets.some((a) => a.code === assetCode)) {
      throw AppError.unprocessable(`Asset ${assetCode} is not active`);
    }

    return withTransaction(async (client) => {
      const entry = await investmentRepository.create(userId, {
        assetCode, amount: round6(amount), type, note: (note || '').trim()
      }, client);
      const delta = type === INVESTMENT_TYPES.WITHDRAWAL ? -amount : amount;
      await cashDrawerRepository.adjustBalance(userId, assetCode, round6(delta), client);
      return entry;
    });
  }
};
