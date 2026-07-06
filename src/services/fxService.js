import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { fxTradeRepository } from '../repositories/fxTradeRepository.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import {
  canonicalPairBase, computeToAmount, deriveSide, weightedAverageCost, computeRealizedPl
} from '../domain/fxMath.js';
import { assetToAfn } from '../domain/rateMath.js';
import { BASE_ASSET, BALANCE_TOLERANCE } from '../config/constants.js';
import { round6 } from '../utils/money.js';

export const fxService = {
  async listTrades(userId, pagination) {
    return fxTradeRepository.listPage(userId, pagination);
  },

  /**
   * Records an exchange. The rate is quoted canonically — "1 {pair base} = N
   * {quote}" where the base is the lower-sort-order asset — so the to-amount
   * is derived server-side. Validates drawer stock, snapshots AFN leg values,
   * computes realized P&L on disposals from the weighted-average cost basis,
   * and moves both drawer legs, all in one transaction.
   */
  async createTrade(userId, { fromCurrency, toCurrency, fromAmount, rate, note }) {
    if (fromCurrency === toCurrency) {
      throw AppError.unprocessable('Currencies must differ');
    }
    const assets = await assetRepository.listActiveForUser(userId);
    const byCode = Object.fromEntries(assets.map((a) => [a.code, a]));
    for (const code of [fromCurrency, toCurrency]) {
      if (!byCode[code]) throw AppError.unprocessable(`Asset ${code} is not active`);
    }
    const sortOrderOf = (code) => byCode[code].sortOrder;

    return withTransaction(async (client) => {
      const available = await cashDrawerRepository.getBalance(userId, fromCurrency, client);
      if (fromAmount > available + BALANCE_TOLERANCE) {
        throw AppError.unprocessable(
          `Insufficient ${fromCurrency} cash: has ${round6(available)}, needs ${round6(fromAmount)}`
        );
      }

      const toAmount = round6(computeToAmount(fromCurrency, toCurrency, fromAmount, rate, sortOrderOf));
      const side = deriveSide(fromCurrency);
      const rates = await rateRepository.mapForUser(userId, client);
      const fromAfnValue = round6(assetToAfn(rates, fromCurrency, fromAmount));
      const toAfnValue = round6(assetToAfn(rates, toCurrency, toAmount));

      let realizedPl = null;
      if (side === 'sell') {
        const priorTrades = await fxTradeRepository.listChronological(userId, client);
        const proceedsAfn = toCurrency === BASE_ASSET ? toAmount : toAfnValue;
        realizedPl = round6(computeRealizedPl({
          fromCur: fromCurrency, fromAmount, priorTrades, proceedsAfn
        }));
      }

      await cashDrawerRepository.adjustBalance(userId, fromCurrency, -fromAmount, client);
      await cashDrawerRepository.adjustBalance(userId, toCurrency, toAmount, client);

      const trade = await fxTradeRepository.create(userId, {
        side, fromCurrency, toCurrency,
        fromAmount: round6(fromAmount), toAmount, rate,
        fromAfnValue, toAfnValue, realizedPl, note
      }, client);

      return { ...trade, pairBase: canonicalPairBase(fromCurrency, toCurrency, sortOrderOf) };
    });
  },

  /**
   * Open position per non-AFN currency the saraf has ever traded:
   * quantity, weighted-average cost, market rate/value, unrealized P&L.
   */
  async positions(userId) {
    const [trades, rates, assets] = await Promise.all([
      fxTradeRepository.listChronological(userId),
      rateRepository.mapForUser(userId),
      assetRepository.listActiveForUser(userId)
    ]);

    const tradedCurrencies = new Set();
    for (const t of trades) {
      if (t.fromCurrency !== BASE_ASSET) tradedCurrencies.add(t.fromCurrency);
      if (t.toCurrency !== BASE_ASSET) tradedCurrencies.add(t.toCurrency);
    }
    // Always include active non-base currencies so the ledger shows flat rows too.
    for (const a of assets) {
      if (a.code !== BASE_ASSET && a.type === 'currency') tradedCurrencies.add(a.code);
    }

    return [...tradedCurrencies].sort().map((currency) => {
      const { qty, totalCostAfn, avgCost } = weightedAverageCost(trades, currency);
      const marketRate = rates[currency]?.sell || 0;
      const marketValue = qty * marketRate;
      return {
        currency,
        qty: round6(qty),
        avgCostAfn: round6(avgCost),
        marketRateAfn: marketRate,
        marketValueAfn: round6(marketValue),
        unrealizedPlAfn: round6(marketValue - totalCostAfn),
        totalCostAfn: round6(totalCostAfn)
      };
    });
  }
};
