import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { referenceRepository } from '../repositories/referenceRepository.js';
import {
  balanceStatus, customerBalances, customerBalanceSummary, withRunningBalances, txSign
} from '../domain/positions.js';
import { CUSTOMER_TX_TYPES } from '../config/constants.js';
import { round6 } from '../utils/money.js';

const CUSTOMER_COLOR_COUNT = 6; // gradient palette size in the app

async function assertCity(cityCode) {
  if (cityCode && !(await referenceRepository.cityExists(cityCode))) {
    throw AppError.unprocessable(`Unknown city: ${cityCode}`);
  }
}

export const customerService = {
  /**
   * All accounts with balances, plus the Accounts-screen aggregates. The
   * summary and `total` always cover every account; `search` (name, short
   * name, or phone), `cityCode`, and `status` (deposits | advances | settled)
   * only narrow the returned list — mirroring the app, where the holdings
   * card stays global while the chips filter the rows.
   */
  async list(userId, { search, cityCode, status } = {}) {
    const [customers, allTxs, assets] = await Promise.all([
      customerRepository.listForUser(userId, {}),
      customerTransactionRepository.listAllForUser(userId),
      assetRepository.listActiveForUser(userId)
    ]);
    const currencies = assets.map((a) => a.code);

    const txsByCustomer = new Map();
    for (const tx of allTxs) {
      if (!txsByCustomer.has(tx.customerId)) txsByCustomer.set(tx.customerId, []);
      txsByCustomer.get(tx.customerId).push(tx);
    }

    const enriched = customers.map((customer) => {
      const txs = txsByCustomer.get(customer.id) || [];
      return {
        ...customer,
        balances: customerBalances(txs, currencies),
        transactionCount: txs.length
      };
    });

    const summary = customerBalanceSummary(enriched.map((c) => c.balances));

    let filtered = enriched;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.shortName || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(search)
      );
    }
    if (cityCode) filtered = filtered.filter((c) => c.cityCode === cityCode);
    if (status) {
      filtered = filtered.filter((c) => {
        const s = balanceStatus(c.balances);
        if (status === 'deposits') return s.hasDeposits;
        if (status === 'advances') return s.hasAdvances;
        return s.settled;
      });
    }

    return { customers: filtered, summary, total: enriched.length };
  },

  async getById(userId, id) {
    const customer = await customerRepository.findById(userId, id);
    if (!customer) throw AppError.notFound('Customer not found');
    const [txs, assets] = await Promise.all([
      customerTransactionRepository.listByCustomer(id),
      assetRepository.listActiveForUser(userId)
    ]);
    return {
      ...customer,
      balances: customerBalances(txs, assets.map((a) => a.code)),
      transactionCount: txs.length
    };
  },

  /** Opens an account; opening balances become 'opening' deposit entries. */
  async create(userId, { name, shortName, initial, phone, cityCode, notes, openingBalances }) {
    await assertCity(cityCode);
    const count = await customerRepository.countForUser(userId);

    const customer = await withTransaction(async (client) => {
      const created = await customerRepository.create(userId, {
        name: name.trim(),
        shortName: (shortName || '').trim() || name.trim().split(' ')[0],
        initial: (initial || '').trim() || name.trim().charAt(0),
        phone: (phone || '').trim() || '—',
        cityCode,
        colorIdx: count % CUSTOMER_COLOR_COUNT,
        notes: (notes || '').trim()
      }, client);

      for (const [currency, value] of Object.entries(openingBalances || {})) {
        if (!value || Number.isNaN(value) || value <= 0) continue;
        await customerTransactionRepository.create(userId, {
          customerId: created.id,
          type: CUSTOMER_TX_TYPES.OPENING,
          amount: round6(value),
          currency,
          note: 'Opening deposit'
        }, client);
      }
      return created;
    });

    return this.getById(userId, customer.id);
  },

  async update(userId, id, updates) {
    await assertCity(updates.cityCode);
    const customer = await customerRepository.update(userId, id, updates);
    if (!customer) throw AppError.notFound('Customer not found');
    return this.getById(userId, id);
  },

  async delete(userId, id) {
    const deleted = await customerRepository.delete(userId, id);
    if (!deleted) throw AppError.notFound('Customer not found');
  },

  /** Chronological transactions annotated with running balances. */
  async listTransactions(userId, customerId) {
    const customer = await customerRepository.findById(userId, customerId);
    if (!customer) throw AppError.notFound('Customer not found');
    const txs = await customerTransactionRepository.listByCustomer(customerId);
    return withRunningBalances(txs);
  },

  /**
   * Records a customer transaction (deposit / withdrawal / charge / credit).
   *
   * Cross-currency intake ("received X USD, credit as AFN"): pass conversion
   * { toCurrency, rate } — the account is credited amount × rate in the target
   * currency and the original intake is kept as metadata, exactly like the
   * app's convert toggle.
   */
  async addTransaction(userId, customerId, { type, amount, currency, note, conversion }) {
    const customer = await customerRepository.findById(userId, customerId);
    if (!customer) throw AppError.notFound('Customer not found');
    if (type === CUSTOMER_TX_TYPES.OPENING) {
      throw AppError.unprocessable('Opening entries are created with the account');
    }

    let creditedAmount = amount;
    let creditedCurrency = currency;
    let conversionMeta = null;

    if (conversion) {
      const { toCurrency, rate } = conversion;
      if (!(rate > 0)) throw AppError.unprocessable('Conversion rate must be positive');
      if (toCurrency === currency) {
        throw AppError.unprocessable('Conversion target must differ from the source currency');
      }
      creditedAmount = round6(amount * rate);
      creditedCurrency = toCurrency;
      conversionMeta = {
        receivedAmount: amount,
        receivedCurrency: currency,
        rate,
        creditedAmount,
        creditedCurrency
      };
    }

    const defaultNotes = {
      deposit: 'Cash deposit',
      withdrawal: 'Cash withdrawal',
      charge: 'Paid on behalf',
      credit: 'Advance credit'
    };
    let finalNote = (note || '').trim() || defaultNotes[type] || '';
    if (conversionMeta) {
      const convDesc = `Received ${amount} ${currency} @ ${conversionMeta.rate} → ${creditedCurrency}`;
      finalNote = (note || '').trim() ? `${note.trim()} (${convDesc})` : convDesc;
    }

    const txId = await customerTransactionRepository.create(userId, {
      customerId,
      type,
      amount: creditedAmount,
      currency: creditedCurrency,
      note: finalNote,
      conversion: conversionMeta
    });

    return this.getTransaction(userId, txId);
  },

  /** Transaction detail with the running balance before/after it. */
  async getTransaction(userId, txId) {
    const tx = await customerTransactionRepository.findById(userId, txId);
    if (!tx) throw AppError.notFound('Transaction not found');

    const txs = await customerTransactionRepository.listByCustomer(tx.customerId);
    let before = 0;
    for (const t of txs) {
      if (t.id === txId) break;
      if (t.currency === tx.currency) before += txSign(t.type) * t.amount;
    }
    return {
      ...tx,
      balanceBefore: round6(before),
      balanceAfter: round6(before + txSign(tx.type) * tx.amount)
    };
  },

  async deleteTransaction(userId, txId) {
    const tx = await customerTransactionRepository.findById(userId, txId);
    if (!tx) throw AppError.notFound('Transaction not found');
    await customerTransactionRepository.delete(userId, txId);
    return { customerId: tx.customerId };
  }
};
