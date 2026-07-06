import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { counterpartyRepository } from '../repositories/counterpartyRepository.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { referenceRepository } from '../repositories/referenceRepository.js';
import { counterpartyPositions } from '../domain/positions.js';
import { SENTINEL_CODE, FLAT_THRESHOLD } from '../config/constants.js';
import { round6 } from '../utils/money.js';

async function assertCity(cityCode) {
  if (cityCode && !(await referenceRepository.cityExists(cityCode))) {
    throw AppError.unprocessable(`Unknown city: ${cityCode}`);
  }
}

export const counterpartyService = {
  /** All counterparties with their per-currency open positions. */
  async list(userId, { search } = {}) {
    const [counterparties, allHawalas, assets] = await Promise.all([
      counterpartyRepository.listForUser(userId, { search }),
      hawalaRepository.listAllWithCounterparty(userId),
      assetRepository.listActiveForUser(userId)
    ]);
    const currencies = assets.map((a) => a.code);
    const byCp = new Map();
    for (const h of allHawalas) {
      if (!byCp.has(h.counterpartyId)) byCp.set(h.counterpartyId, []);
      byCp.get(h.counterpartyId).push(h);
    }
    return counterparties.map((cp) => ({
      ...cp,
      positions: counterpartyPositions(byCp.get(cp.id) || [], currencies)
    }));
  },

  async getById(userId, id) {
    const cp = await counterpartyRepository.findById(userId, id);
    if (!cp) throw AppError.notFound('Counterparty not found');
    const [hawalas, assets] = await Promise.all([
      hawalaRepository.listByCounterparty(id),
      assetRepository.listActiveForUser(userId)
    ]);
    return {
      ...cp,
      positions: counterpartyPositions(hawalas, assets.map((a) => a.code)),
      hawalaCount: hawalas.length
    };
  },

  /**
   * Creates a counterparty. Opening balances become synthetic paid ledger
   * entries carrying the '000000' sentinel: positive = they owe us (send),
   * negative = we owe them (recv).
   */
  async create(userId, { name, shortName, initial, phone, cityCode, tier, openingBalances }) {
    await assertCity(cityCode);
    return withTransaction(async (client) => {
      const cp = await counterpartyRepository.create(userId, {
        name: name.trim(),
        shortName: (shortName || '').trim() || name.trim().split(' ')[0],
        initial: (initial || '').trim() || name.trim().charAt(0),
        phone: (phone || '').trim() || '—',
        cityCode,
        tier: tier || 'regular'
      }, client);

      for (const [currency, value] of Object.entries(openingBalances || {})) {
        if (!value || Number.isNaN(value)) continue;
        await hawalaRepository.create(userId, {
          counterpartyId: cp.id,
          type: value > 0 ? 'send' : 'recv',
          fromCity: cityCode,
          toCity: cityCode,
          senderName: 'Opening balance',
          receiverName: 'Opening balance',
          amount: round6(Math.abs(value)),
          currency,
          commissionMode: 'percent',
          commissionPct: 0,
          commissionAmount: 0,
          code: SENTINEL_CODE,
          status: 'paid',
          isOpening: true,
          note: 'Opening balance'
        }, client);
      }
      return cp;
    }).then((cp) => this.getById(userId, cp.id));
  },

  async update(userId, id, updates) {
    await assertCity(updates.cityCode);
    const cp = await counterpartyRepository.update(userId, id, updates);
    if (!cp) throw AppError.notFound('Counterparty not found');
    return this.getById(userId, id);
  },

  async delete(userId, id) {
    const deleted = await counterpartyRepository.delete(userId, id);
    if (!deleted) throw AppError.notFound('Counterparty not found');
  },

  /**
   * Settles every open position with the counterparty by writing offsetting
   * 'settle' entries (delta = −position), zeroing the balance — the app's
   * "Settle up" flow. settleCurrency/rates are recorded in the note for the
   * paper trail.
   */
  async settle(userId, id, { settleCurrency, note }) {
    const cp = await counterpartyRepository.findById(userId, id);
    if (!cp) throw AppError.notFound('Counterparty not found');

    return withTransaction(async (client) => {
      const [hawalas, assets] = await Promise.all([
        hawalaRepository.listByCounterparty(id, client),
        assetRepository.listActiveForUser(userId, client)
      ]);
      const positions = counterpartyPositions(hawalas, assets.map((a) => a.code));

      const settled = [];
      for (const [currency, position] of Object.entries(positions)) {
        if (Math.abs(position) < FLAT_THRESHOLD) continue;
        await hawalaRepository.create(userId, {
          counterpartyId: id,
          type: 'settle',
          fromCity: cp.cityCode,
          toCity: cp.cityCode,
          senderName: '—',
          receiverName: '—',
          amount: round6(-position),
          currency,
          commissionMode: 'percent',
          commissionPct: 0,
          commissionAmount: 0,
          code: SENTINEL_CODE,
          status: 'paid',
          note: note || `Settled in ${settleCurrency || 'USD'} @ rate sheet`
        }, client);
        settled.push({ currency, clearedPosition: position });
      }

      if (settled.length === 0) {
        throw AppError.unprocessable('No open positions to settle');
      }
      return { counterpartyId: id, settled };
    });
  }
};
