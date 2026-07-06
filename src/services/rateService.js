import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { BASE_ASSET } from '../config/constants.js';
import { round6 } from '../utils/money.js';

/**
 * Rates are quoted "1 {asset} = N AFN". Cross rates between two non-AFN
 * assets are derived through AFN (e.g. USD/PKR = USD.sell ÷ PKR.sell),
 * matching how the app re-derives USD_PKR on every rate save.
 */
export const rateService = {
  async list(userId) {
    const [rates, assets] = await Promise.all([
      rateRepository.listForUser(userId),
      assetRepository.listForUser(userId)
    ]);
    const rateMap = Object.fromEntries(rates.map((r) => [r.assetCode, r]));
    const active = assets.filter((a) => a.active);

    const base = { assetCode: BASE_ASSET, buy: 1, sell: 1, prevSell: 1, deltaPct: 0 };
    const perAsset = active
      .map((a) => (a.code === BASE_ASSET ? base : rateMap[a.code]))
      .filter(Boolean);

    // Derived crosses between active non-AFN currencies (USD/PKR etc.).
    const crosses = [];
    const currencies = active.filter((a) => a.type === 'currency' && a.code !== BASE_ASSET);
    for (let i = 0; i < currencies.length; i++) {
      for (let j = i + 1; j < currencies.length; j++) {
        const a = rateMap[currencies[i].code];
        const b = rateMap[currencies[j].code];
        if (!a || !b || !b.sell) continue;
        crosses.push({
          pair: `${currencies[i].code}_${currencies[j].code}`,
          buy: round6(a.buy / b.buy),
          sell: round6(a.sell / b.sell)
        });
      }
    }

    return { rates: perAsset, crosses };
  },

  /**
   * Bulk-saves buy/sell per asset. For each changed asset the previous sell
   * becomes prevSell (feeding revaluation P&L) and the % delta is recorded,
   * plus an immutable rate_history row.
   */
  async update(userId, updates) {
    if (!updates || Object.keys(updates).length === 0) {
      throw AppError.badRequest('No rates provided');
    }
    const assets = await assetRepository.listForUser(userId);
    const known = new Set(assets.map((a) => a.code));

    return withTransaction(async (client) => {
      const current = await rateRepository.mapForUser(userId, client);
      const saved = [];
      for (const [assetCode, { buy, sell }] of Object.entries(updates)) {
        if (assetCode === BASE_ASSET) {
          throw AppError.unprocessable('AFN is the base asset; its rate is fixed at 1');
        }
        if (!known.has(assetCode)) throw AppError.notFound(`Unknown asset: ${assetCode}`);
        if (!(buy > 0) || !(sell > 0)) {
          throw AppError.unprocessable(`Rates for ${assetCode} must be positive`);
        }
        const prevSell = current[assetCode]?.sell ?? sell;
        const deltaPct = prevSell > 0 ? ((sell - prevSell) / prevSell) * 100 : 0;
        const row = await rateRepository.upsert(userId, assetCode, {
          buy: round6(buy), sell: round6(sell), prevSell, deltaPct: round6(deltaPct)
        }, client);
        await rateRepository.recordHistory(userId, assetCode, { buy, sell }, client);
        saved.push(row);
      }
      return saved;
    });
  },

  async history(userId, assetCode, limit = 100) {
    return rateRepository.listHistory(userId, assetCode, Math.min(limit, 500));
  }
};
