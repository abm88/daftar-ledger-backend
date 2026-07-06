import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { investmentRepository } from '../repositories/investmentRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { fxTradeRepository } from '../repositories/fxTradeRepository.js';
import { assetToAfn, assetToReporting } from '../domain/rateMath.js';
import { BASE_ASSET, TOLA_GRAMS, CUSTOMER_TX_TYPES } from '../config/constants.js';
import { round6 } from '../utils/money.js';

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const cashDrawerService = {
  /**
   * Full drawer snapshot: per-asset balance, AFN & reporting equivalents,
   * tola display for metals, revaluation P&L from the last rate move, and the
   * drawer total in the reporting currency.
   */
  async getDrawer(userId) {
    const [balances, assets, rates, settings] = await Promise.all([
      cashDrawerRepository.mapForUser(userId),
      assetRepository.listActiveForUser(userId),
      rateRepository.mapForUser(userId),
      settingsRepository.getForUser(userId)
    ]);
    const reporting = settings.reportingCurrency;

    let totalAfn = 0;
    let totalRevalAfn = 0;
    const items = assets.map((asset) => {
      const balance = balances[asset.code] || 0;
      const afnValue = assetToAfn(rates, asset.code, balance);
      totalAfn += afnValue;

      // Revaluation: (sell − prevSell) × holding, for non-base assets.
      let revaluationAfn = 0;
      const rate = rates[asset.code];
      if (asset.code !== BASE_ASSET && rate && balance > 0) {
        const prev = rate.prevSell ?? rate.sell;
        revaluationAfn = (rate.sell - prev) * balance;
        totalRevalAfn += revaluationAfn;
      }

      return {
        assetCode: asset.code,
        type: asset.type,
        name: asset.name,
        symbol: asset.symbol,
        decimals: asset.decimals,
        balance,
        tola: asset.type === 'metal' ? round6(balance / TOLA_GRAMS) : undefined,
        afnValue: round6(afnValue),
        reportingValue: round6(assetToReporting(rates, asset.code, balance, reporting)),
        revaluationAfn: round6(revaluationAfn)
      };
    });

    return {
      items,
      totals: {
        afn: round6(totalAfn),
        reporting: round6(assetToReporting(rates, BASE_ASSET, totalAfn, reporting)),
        reportingCurrency: reporting,
        revaluationAfn: round6(totalRevalAfn)
      },
      lastCountAt: settings.lastCashCountAt
    };
  },

  /**
   * Cash count — sets absolute balances for the assets provided. Assets left
   * out are untouched, so the saraf can count part of the drawer.
   */
  async recordCount(userId, counts) {
    const entries = Object.entries(counts || {});
    if (entries.length === 0) throw AppError.badRequest('Provide at least one counted amount');

    const assets = await assetRepository.listActiveForUser(userId);
    const activeCodes = new Set(assets.map((a) => a.code));

    await withTransaction(async (client) => {
      for (const [assetCode, value] of entries) {
        if (!activeCodes.has(assetCode)) {
          throw AppError.unprocessable(`Asset ${assetCode} is not active`);
        }
        if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
          throw AppError.unprocessable(`Invalid count for ${assetCode}`);
        }
        await cashDrawerRepository.setBalance(userId, assetCode, round6(value), client);
      }
      await settingsRepository.touchLastCashCount(userId, client);
    });

    return this.getDrawer(userId);
  },

  /**
   * Initial setup — sets opening drawer balances and records each as an
   * 'opening' investment entry, exactly like the app's first-run flow.
   */
  async initialSetup(userId, amounts) {
    const entries = Object.entries(amounts || {}).filter(([, v]) => v > 0);
    if (entries.length === 0) throw AppError.badRequest('Enter at least one opening amount');

    const assets = await assetRepository.listActiveForUser(userId);
    const byCode = Object.fromEntries(assets.map((a) => [a.code, a]));

    await withTransaction(async (client) => {
      for (const [assetCode, value] of entries) {
        const asset = byCode[assetCode];
        if (!asset) throw AppError.unprocessable(`Asset ${assetCode} is not active`);
        if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
          throw AppError.unprocessable(`Invalid amount for ${assetCode}`);
        }
        await cashDrawerRepository.setBalance(userId, assetCode, round6(value), client);
        await investmentRepository.create(userId, {
          assetCode,
          amount: round6(value),
          type: 'opening',
          note: `Initial setup · ${asset.name}`
        }, client);
      }
      await settingsRepository.touchLastCashCount(userId, client);
    });

    return this.getDrawer(userId);
  },

  /**
   * Today's drawer movement per currency. Counts physical-cash events only:
   *  - customer deposits (in), withdrawals/charges (out), credits/openings (in)
   *  - hawala-linked account debits are excluded (no cash moved)
   *  - FX trades: from-leg out, to-leg in
   */
  async todayMovement(userId) {
    const since = startOfToday();
    const [assets, custTxs, fxTrades] = await Promise.all([
      assetRepository.listActiveForUser(userId),
      customerTransactionRepository.listAllForUser(userId),
      fxTradeRepository.listChronological(userId)
    ]);

    const movement = {};
    for (const a of assets) movement[a.code] = { inflow: 0, outflow: 0 };
    const bucket = (code) => {
      if (!movement[code]) movement[code] = { inflow: 0, outflow: 0 };
      return movement[code];
    };

    for (const tx of custTxs) {
      if (new Date(tx.createdAt) < since) continue;
      if (tx.hawalaId) continue; // account-mode hawala debit — no cash moved
      const b = bucket(tx.currency);
      if (tx.type === CUSTOMER_TX_TYPES.DEPOSIT) b.inflow += tx.amount;
      else if (tx.type === CUSTOMER_TX_TYPES.WITHDRAWAL || tx.type === CUSTOMER_TX_TYPES.CHARGE) {
        b.outflow += tx.amount;
      } else b.inflow += tx.amount; // credit / opening
    }

    for (const trade of fxTrades) {
      if (new Date(trade.createdAt) < since) continue;
      bucket(trade.fromCurrency).outflow += trade.fromAmount;
      bucket(trade.toCurrency).inflow += trade.toAmount;
    }

    return Object.entries(movement).map(([assetCode, m]) => ({
      assetCode,
      inflow: round6(m.inflow),
      outflow: round6(m.outflow),
      net: round6(m.inflow - m.outflow)
    }));
  }
};
