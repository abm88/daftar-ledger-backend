import { AppError } from '../utils/AppError.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { fxTradeRepository } from '../repositories/fxTradeRepository.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { counterpartyRepository } from '../repositories/counterpartyRepository.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { counterpartyPositions } from '../domain/positions.js';
import { assetToAfn, afnToReporting } from '../domain/rateMath.js';
import {
  BASE_ASSET, HAWALA_STATUS, HAWALA_TYPES, PNL_PERIODS, CREDIT_TX_TYPES
} from '../config/constants.js';
import { round6 } from '../utils/money.js';

function periodBounds(period) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  switch (period) {
    case 'today': return { from: todayStart, to: now, label: 'Today' };
    case 'week': return { from: new Date(todayStart.getTime() - 6 * 86_400_000), to: now, label: 'Last 7 days' };
    case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, label: 'This month' };
    default: return { from: new Date(0), to: now, label: 'All time' };
  }
}

const inWindow = (ts, { from, to }) => {
  const t = new Date(ts);
  return t >= from && t <= to;
};

export const reportService = {
  /**
   * P&L for a period, all figures in AFN plus a reporting-currency translation:
   *  - realized FX trading profit (sum of realized_pl in the window)
   *  - hawala commission revenue (paid hawalas, commission converted to AFN)
   *  - unrealized revaluation on drawer holdings (today/all only — snapshot,
   *    not a flow), from the last rate move (sell − prevSell) × balance
   */
  async pnl(userId, period = 'all') {
    if (!PNL_PERIODS.includes(period)) {
      throw AppError.badRequest(`period must be one of: ${PNL_PERIODS.join(', ')}`);
    }
    const bounds = periodBounds(period);

    const [fxTrades, hawalas, drawer, rates, assets, settings] = await Promise.all([
      fxTradeRepository.listChronological(userId),
      hawalaRepository.listAllWithCounterparty(userId),
      cashDrawerRepository.mapForUser(userId),
      rateRepository.mapForUser(userId),
      assetRepository.listActiveForUser(userId),
      settingsRepository.getForUser(userId)
    ]);
    const reporting = settings.reportingCurrency;

    // Realized: FX trades.
    let fxRealized = 0;
    const fxBreakdown = [];
    for (const t of fxTrades) {
      if (t.realizedPl == null || !inWindow(t.createdAt, bounds)) continue;
      fxRealized += t.realizedPl;
      fxBreakdown.push({
        kind: 'fx',
        id: t.id,
        at: t.createdAt,
        label: `Sold ${t.fromAmount} ${t.fromCurrency} → ${t.toCurrency} @ ${t.rate}`,
        amountAfn: round6(t.realizedPl)
      });
    }

    // Realized: hawala commissions on paid, non-settle hawalas. Revenue is
    // recognized when the hawala is marked paid, not when it was issued —
    // otherwise a hawala issued last week and paid today never shows up in
    // today's (or this week's) P&L.
    let hawalaCommission = 0;
    const hawalaBreakdown = [];
    for (const h of hawalas) {
      if (h.type === HAWALA_TYPES.SETTLE || h.isOpening) continue;
      if (h.status !== HAWALA_STATUS.PAID) continue;
      const realizedAt = h.paidAt || h.createdAt;
      if (!inWindow(realizedAt, bounds)) continue;
      const commissionAfn = assetToAfn(rates, h.currency, h.commissionAmount);
      if (commissionAfn === 0) continue;
      hawalaCommission += commissionAfn;
      hawalaBreakdown.push({
        kind: 'hawala',
        id: h.id,
        at: realizedAt,
        label: `${h.type === 'send' ? 'Sent' : 'Received'} hawala · ${h.fromCity}→${h.toCity} · ` +
               (h.commissionMode === 'fixed'
                 ? `${h.commissionAmount} ${h.currency} fee on ${h.amount} ${h.currency}`
                 : `${h.commissionPct}% on ${h.amount} ${h.currency}`),
        counterparty: h.counterpartyShortName,
        amountAfn: round6(commissionAfn)
      });
    }

    // Unrealized: revaluation snapshot (today / all only).
    let unrealizedReval = 0;
    const revalBreakdown = [];
    if (period === 'today' || period === 'all') {
      for (const asset of assets) {
        if (asset.code === BASE_ASSET) continue;
        const balance = drawer[asset.code] || 0;
        const rate = rates[asset.code];
        if (balance <= 0 || !rate) continue;
        const prev = rate.prevSell ?? rate.sell;
        const diff = (rate.sell - prev) * balance;
        if (Math.abs(diff) < 0.5) continue;
        unrealizedReval += diff;
        revalBreakdown.push({
          kind: 'reval',
          at: new Date().toISOString(),
          label: `Reval ${asset.code} · ${balance} · rate ${prev} → ${rate.sell}`,
          amountAfn: round6(diff)
        });
      }
    }

    const realizedTotal = fxRealized + hawalaCommission;
    const grandTotal = realizedTotal + unrealizedReval;
    const entries = [...fxBreakdown, ...hawalaBreakdown, ...revalBreakdown]
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    const toReporting = (v) => round6(afnToReporting(rates, v, reporting));
    return {
      period: { key: period, label: bounds.label, from: bounds.from, to: bounds.to },
      reportingCurrency: reporting,
      afn: {
        fxRealized: round6(fxRealized),
        hawalaCommission: round6(hawalaCommission),
        unrealizedReval: round6(unrealizedReval),
        realizedTotal: round6(realizedTotal),
        grandTotal: round6(grandTotal)
      },
      reporting: {
        fxRealized: toReporting(fxRealized),
        hawalaCommission: toReporting(hawalaCommission),
        unrealizedReval: toReporting(unrealizedReval),
        realizedTotal: toReporting(realizedTotal),
        grandTotal: toReporting(grandTotal)
      },
      counts: { fxTrades: fxBreakdown.length, hawalas: hawalaBreakdown.length },
      entries
    };
  },

  /**
   * Unified activity feed — hawalas, settlements, customer transactions, and
   * FX trades in one reverse-chronological stream, mirroring the app's
   * general ledger. `kind` filter: hawala | settle | custtx | fx.
   */
  async activityFeed(userId, { kind, search, from, to, limit = 100, offset = 0 } = {}) {
    const [hawalas, custTxs, fxTrades] = await Promise.all([
      hawalaRepository.listAllWithCounterparty(userId),
      customerTransactionRepository.listAllForUser(userId),
      fxTradeRepository.listChronological(userId)
    ]);

    const items = [];

    for (const h of hawalas) {
      if (h.isOpening) continue;
      if (h.type === HAWALA_TYPES.SETTLE) {
        items.push({
          kind: 'settle',
          id: h.id,
          at: h.createdAt,
          title: `Settlement · ${h.counterpartyShortName}`,
          subtitle: h.note || 'Position offset',
          amount: Math.abs(h.amount),
          direction: h.amount >= 0 ? 'in' : 'out',
          currency: h.currency,
          ref: { type: 'counterparty', id: h.counterpartyId }
        });
        continue;
      }
      const isSend = h.type === HAWALA_TYPES.SEND;
      items.push({
        kind: 'hawala',
        id: h.id,
        at: h.createdAt,
        title: `${isSend ? 'Sent' : 'Received'} hawala · ${h.counterpartyShortName}`,
        subtitle: `${h.fromCity} → ${h.toCity} · ${h.senderName} → ${h.receiverName}` +
                  (h.status === 'pending' ? ' · pending' : ''),
        amount: h.amount,
        direction: isSend ? 'out' : 'in',
        currency: h.currency,
        status: h.status,
        code: h.code,
        ref: { type: 'hawala', id: h.id }
      });
    }

    for (const tx of custTxs) {
      if (tx.type === 'opening') continue;
      const isCredit = CREDIT_TX_TYPES.includes(tx.type) || tx.type === 'credit';
      const labels = { deposit: 'Deposit', withdrawal: 'Withdrawal', charge: 'Charge', credit: 'Credit advance' };
      items.push({
        kind: 'custtx',
        id: tx.id,
        at: tx.createdAt,
        title: `${tx.hawalaId ? 'Hawala debit' : labels[tx.type]} · ${tx.customerName}`,
        subtitle: tx.note || 'Customer account',
        amount: tx.amount,
        direction: isCredit ? 'in' : 'out',
        currency: tx.currency,
        drcr: isCredit ? 'CR' : 'DR',
        ref: { type: 'customerTransaction', id: tx.id, customerId: tx.customerId }
      });
    }

    for (const t of fxTrades) {
      const isSell = t.side === 'sell';
      let plSuffix = '';
      if (typeof t.realizedPl === 'number' && Math.abs(t.realizedPl) >= 0.5) {
        plSuffix = ` · ${t.realizedPl >= 0 ? '+' : '−'}${Math.abs(round6(t.realizedPl))} AFN ${t.realizedPl >= 0 ? 'profit' : 'loss'}`;
      }
      items.push({
        kind: 'fx',
        id: t.id,
        at: t.createdAt,
        title: `${isSell ? 'Sold' : 'Bought'} ${t.fromCurrency} → ${t.toCurrency}`,
        subtitle: `${t.fromAmount} ${t.fromCurrency} @ ${t.rate}${plSuffix}`,
        amount: t.toAmount,
        direction: 'in',
        currency: t.toCurrency,
        realizedPlAfn: t.realizedPl,
        ref: { type: 'fxTrade', id: t.id }
      });
    }

    let filtered = items;
    if (kind) filtered = filtered.filter((i) => i.kind === kind);
    if (from) filtered = filtered.filter((i) => new Date(i.at) >= new Date(from));
    if (to) filtered = filtered.filter((i) => new Date(i.at) <= new Date(to));
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((i) =>
        i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q) ||
        (i.code && i.code.includes(q))
      );
    }
    filtered.sort((a, b) => new Date(b.at) - new Date(a.at));

    return {
      items: filtered.slice(offset, offset + limit),
      pagination: {
        total: filtered.length,
        limit,
        offset,
        hasMore: offset + limit < filtered.length
      }
    };
  },

  /**
   * Home-screen aggregate: drawer totals, global counterparty position,
   * pending hawalas, today's realized P&L, today's cash movement, and counts.
   */
  async dashboard(userId) {
    const [hawalas, assets, settings, fxTrades, counterparties, customers] = await Promise.all([
      hawalaRepository.listAllWithCounterparty(userId),
      assetRepository.listActiveForUser(userId),
      settingsRepository.getForUser(userId),
      fxTradeRepository.listChronological(userId),
      counterpartyRepository.listForUser(userId, {}),
      customerRepository.listForUser(userId, {})
    ]);
    const currencies = assets.map((a) => a.code);

    const globalPositions = counterpartyPositions(hawalas, currencies);

    const pending = hawalas
      .filter((h) => h.status === HAWALA_STATUS.PENDING)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((h) => ({
        id: h.id, code: h.code, type: h.type, amount: h.amount, currency: h.currency,
        fromCity: h.fromCity, toCity: h.toCity, senderName: h.senderName,
        receiverName: h.receiverName, counterpartyId: h.counterpartyId,
        counterpartyShortName: h.counterpartyShortName, createdAt: h.createdAt
      }));

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let todayRealizedPl = 0;
    for (const t of fxTrades) {
      if (t.realizedPl != null && new Date(t.createdAt) >= todayStart) {
        todayRealizedPl += t.realizedPl;
      }
    }

    return {
      globalPositions,
      pendingHawalas: pending,
      todayRealizedPlAfn: round6(todayRealizedPl),
      counts: {
        counterparties: counterparties.length,
        customers: customers.length,
        pendingHawalas: pending.length
      },
      defaults: {
        reportingCurrency: settings.reportingCurrency,
        tradeCurrency: settings.tradeCurrency
      }
    };
  }
};
