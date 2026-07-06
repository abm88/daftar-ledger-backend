import { AppError } from '../utils/AppError.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { counterpartyRepository } from '../repositories/counterpartyRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { withRunningBalances, customerBalances, counterpartyPositions, txSign } from '../domain/positions.js';
import { assetToAfn } from '../domain/rateMath.js';
import { reportService } from './reportService.js';
import { round6 } from '../utils/money.js';

/**
 * Statement read models — the data behind the app's printable statements.
 * Rendering (print/PDF/WhatsApp) is a client concern; the API returns
 * everything the templates need.
 */
export const statementService = {
  /** Customer account statement: entries with running balances + closing balances. */
  async customerStatement(userId, customerId, { from, to } = {}) {
    const customer = await customerRepository.findById(userId, customerId);
    if (!customer) throw AppError.notFound('Customer not found');

    const [allTxs, assets] = await Promise.all([
      customerTransactionRepository.listByCustomer(customerId),
      assetRepository.listActiveForUser(userId)
    ]);
    const annotated = withRunningBalances(allTxs);

    let entries = annotated;
    if (from) entries = entries.filter((t) => new Date(t.createdAt) >= new Date(from));
    if (to) entries = entries.filter((t) => new Date(t.createdAt) <= new Date(to));

    const totals = {};
    for (const tx of allTxs) {
      if (!totals[tx.currency]) totals[tx.currency] = { credits: 0, debits: 0 };
      if (txSign(tx.type) > 0) totals[tx.currency].credits += tx.amount;
      else totals[tx.currency].debits += tx.amount;
    }
    for (const t of Object.values(totals)) {
      t.credits = round6(t.credits);
      t.debits = round6(t.debits);
    }

    return {
      customer,
      entries,
      closingBalances: customerBalances(allTxs, assets.map((a) => a.code)),
      totals,
      generatedAt: new Date().toISOString()
    };
  },

  /** Counterparty statement: hawala history + open positions. */
  async counterpartyStatement(userId, counterpartyId, { from, to } = {}) {
    const counterparty = await counterpartyRepository.findById(userId, counterpartyId);
    if (!counterparty) throw AppError.notFound('Counterparty not found');

    const [hawalas, assets] = await Promise.all([
      hawalaRepository.listByCounterparty(counterpartyId),
      assetRepository.listActiveForUser(userId)
    ]);

    let entries = hawalas;
    if (from) entries = entries.filter((h) => new Date(h.createdAt) >= new Date(from));
    if (to) entries = entries.filter((h) => new Date(h.createdAt) <= new Date(to));

    return {
      counterparty,
      entries,
      positions: counterpartyPositions(hawalas, assets.map((a) => a.code)),
      generatedAt: new Date().toISOString()
    };
  },

  /**
   * General-ledger statement: the unified feed for a period/kind with
   * AFN-valued in/out totals — the app's "Export daftar" view.
   */
  async ledgerStatement(userId, { period = 'all', kind, from, to } = {}) {
    const bounds = (() => {
      if (from || to) return { from, to };
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      switch (period) {
        case 'today': return { from: todayStart, to: now };
        case 'week': return { from: new Date(todayStart.getTime() - 6 * 86_400_000), to: now };
        case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
        default: return {};
      }
    })();

    const feed = await reportService.activityFeed(userId, {
      kind, from: bounds.from, to: bounds.to, limit: 1000, offset: 0
    });
    const rates = await rateRepository.mapForUser(userId);

    let totalInAfn = 0;
    let totalOutAfn = 0;
    for (const item of feed.items) {
      const afn = assetToAfn(rates, item.currency, item.amount);
      if (item.direction === 'in') totalInAfn += afn;
      else totalOutAfn += afn;
    }

    return {
      period: { key: period, from: bounds.from ?? null, to: bounds.to ?? null },
      kind: kind || 'all',
      entries: feed.items,
      totals: {
        entryCount: feed.items.length,
        totalInAfn: round6(totalInAfn),
        totalOutAfn: round6(totalOutAfn),
        netAfn: round6(totalInAfn - totalOutAfn)
      },
      generatedAt: new Date().toISOString()
    };
  }
};
