import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';
import { counterpartyRepository } from '../repositories/counterpartyRepository.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { referenceRepository } from '../repositories/referenceRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { commissionAmount } from '../domain/commission.js';
import { formatHawalaCode } from '../domain/codes.js';
import { deriveRoute } from '../domain/route.js';
import {
  COMMISSION_MODES, SENDER_MODES, HAWALA_STATUS, HAWALA_TYPES, PAYOUT_METHODS
} from '../config/constants.js';
import { round6 } from '../utils/money.js';

export const hawalaService = {
  async list(userId, filters) {
    return hawalaRepository.listForUser(userId, filters);
  },

  async listPending(userId) {
    const { items } = await hawalaRepository.listForUser(userId, {
      status: HAWALA_STATUS.PENDING, includeOpening: false, limit: 200, offset: 0
    });
    return items;
  },

  async getById(userId, id) {
    const hawala = await hawalaRepository.findById(userId, id);
    if (!hawala) throw AppError.notFound('Hawala not found');
    return hawala;
  },

  /** Next pickup code without claiming it — for form pre-fill. */
  async peekNextCode(userId) {
    const next = await settingsRepository.peekNextHawalaCode(userId);
    return formatHawalaCode(next);
  },

  /**
   * Resolves the route (from → to). It is auto-derived from direction + the
   * counterparty branch, bridged by the saraf's own city — never free-entered.
   * Explicit fromCity/toCity are only used as a fallback when the saraf hasn't
   * set a shop city yet.
   */
  async _resolveRoute(userId, { type, counterpartyCity, input }) {
    const user = await userRepository.findById(userId);
    const derived = deriveRoute({ type, localCity: user?.cityCode, counterpartyCity });
    const fromCity = derived.fromCity || input.fromCity;
    const toCity = derived.toCity || input.toCity;
    if (!fromCity || !toCity) {
      throw AppError.unprocessable('Cannot derive route — set your shop city first');
    }
    for (const city of [fromCity, toCity]) {
      if (!(await referenceRepository.cityExists(city))) {
        throw AppError.unprocessable(`Unknown city: ${city}`);
      }
    }
    return { fromCity, toCity };
  },

  /**
   * Issues a hawala (status: pending).
   *
   * SEND
   *   senderMode 'cash'    — sender pays at the counter; senderName is free text.
   *   senderMode 'account' — funded from a customer account: writes a linked
   *   'withdrawal' transaction for amount + commission. The account may go
   *   negative — the debit simply adds to the customer's outstanding balance.
   *   The pickup code is claimed atomically from the per-user sequence.
   *
   * RECEIVE
   *   Recorded with zero financial impact — no cash/account movement. It carries
   *   the origin branch's pickup code (entered by the saraf) and is paid out
   *   later via markPaid.
   *
   * Commission is percent (of amount) or a fixed fee in the hawala currency.
   */
  async issue(userId, input) {
    const {
      type, counterpartyId, amount, currency,
      senderMode, senderName, senderCustomerId, receiverName,
      commissionMode, commissionPct, commissionFixed, note, code: providedCode
    } = input;

    const isRecv = type === HAWALA_TYPES.RECV;

    const counterparty = await counterpartyRepository.findById(userId, counterpartyId);
    if (!counterparty) throw AppError.notFound('Counterparty not found');

    const { fromCity, toCity } = await this._resolveRoute(userId, {
      type, counterpartyCity: counterparty.cityCode, input
    });

    // Percent commission defaults to 1% for sends but 0 for receives — the
    // origin office usually keeps the fee, so the payout hands over the full
    // sum. Deriving the effective pct up front keeps the stored pct and the
    // computed commission amount in agreement.
    const effectivePct = commissionMode === COMMISSION_MODES.PERCENT
      ? (commissionPct ?? (isRecv ? 0 : 1.0))
      : 0;
    const commission = round6(commissionAmount({
      amount, commissionMode, commissionPct: effectivePct, commissionFixed
    }));

    return withTransaction(async (client) => {
      // ---- RECEIVE: recorded pending, zero financial impact ----
      if (isRecv) {
        const hawalaId = await hawalaRepository.create(userId, {
          counterpartyId,
          type,
          fromCity,
          toCity,
          senderName: (senderName || '').trim(),
          receiverName: receiverName.trim(),
          amount: round6(amount),
          currency,
          commissionMode,
          commissionPct: effectivePct,
          commissionAmount: commission,
          code: providedCode.trim(),
          status: HAWALA_STATUS.PENDING,
          senderCustomerId: null,
          note: note || ''
        }, client);
        return hawalaRepository.findById(userId, hawalaId, client);
      }

      // ---- SEND: claims a code; account funding debits the sender now ----
      let resolvedSenderName = (senderName || '').trim();
      let customer = null;

      if (senderMode === SENDER_MODES.ACCOUNT) {
        customer = await customerRepository.findById(userId, senderCustomerId, client);
        if (!customer) throw AppError.notFound('Sender customer account not found');
        resolvedSenderName = customer.name;
      } else if (!resolvedSenderName) {
        throw AppError.unprocessable('Sender name is required for cash hawalas');
      }

      const sequence = await settingsRepository.claimNextHawalaCode(userId, client);
      const code = formatHawalaCode(sequence);

      const hawalaId = await hawalaRepository.create(userId, {
        counterpartyId,
        type,
        fromCity,
        toCity,
        senderName: resolvedSenderName,
        receiverName: receiverName.trim(),
        amount: round6(amount),
        currency,
        commissionMode,
        // Keep the app's convention: pct is 0 for fixed-mode hawalas.
        commissionPct: effectivePct,
        commissionAmount: commission,
        code,
        status: HAWALA_STATUS.PENDING,
        senderCustomerId: customer ? customer.id : null,
        note: note || ''
      }, client);

      if (customer) {
        const commissionNote = commissionMode === COMMISSION_MODES.FIXED
          ? `incl. ${commission} ${currency} commission`
          : `incl. ${effectivePct.toFixed(1)}% commission`;
        await customerTransactionRepository.create(userId, {
          customerId: customer.id,
          type: 'withdrawal',
          amount: round6(amount + commission),
          currency,
          note: `Hawala to ${receiverName.trim()} · code ${code} (${commissionNote})`,
          hawalaId
        }, client);
      }

      return hawalaRepository.findById(userId, hawalaId, client);
    });
  },

  /**
   * Marks a pending hawala as paid out.
   *   method 'cash'    — status → paid, paidOutTs recorded, no account entry.
   *   method 'account' — status → paid, plus a deposit of (amount − fee) to the
   *   chosen customer, linked via hawalaId; payoutCustomerId records who. Only
   *   received hawalas can be paid out to an account.
   */
  async markPaid(userId, id, { method = PAYOUT_METHODS.CASH, payoutCustomerId = null } = {}) {
    const hawala = await hawalaRepository.findById(userId, id);
    if (!hawala) throw AppError.notFound('Hawala not found');
    if (hawala.status === HAWALA_STATUS.PAID) {
      throw AppError.conflict('Hawala is already paid');
    }
    if (method === PAYOUT_METHODS.ACCOUNT && hawala.type !== HAWALA_TYPES.RECV) {
      throw AppError.unprocessable('Account payout only applies to received hawalas');
    }

    return withTransaction(async (client) => {
      let creditCustomerId = null;

      if (method === PAYOUT_METHODS.ACCOUNT) {
        const customer = await customerRepository.findById(userId, payoutCustomerId, client);
        if (!customer) throw AppError.notFound('Payout customer account not found');
        creditCustomerId = customer.id;

        const fee = Number(hawala.commissionAmount) || 0;
        const net = round6(Number(hawala.amount) - fee);
        const feeNote = fee > 0 ? ` (net of ${round6(fee)} ${hawala.currency} fee)` : '';
        await customerTransactionRepository.create(userId, {
          customerId: customer.id,
          type: 'deposit',
          amount: net,
          currency: hawala.currency,
          note: `Hawala received from ${hawala.senderName} · code ${hawala.code}${feeNote}`,
          hawalaId: id
        }, client);
      }

      await hawalaRepository.markPaid(userId, id, { method, payoutCustomerId: creditCustomerId }, client);
      return hawalaRepository.findById(userId, id, client);
    });
  },

  /**
   * Cancels a pending hawala: removes the record and reverses any linked
   * customer transactions (e.g. an account-funded send's debit), so no phantom
   * balance remains. Paid hawalas cannot be cancelled.
   */
  async cancel(userId, id) {
    const hawala = await hawalaRepository.findById(userId, id);
    if (!hawala) throw AppError.notFound('Hawala not found');
    if (hawala.status !== HAWALA_STATUS.PENDING) {
      throw AppError.conflict('Only pending hawalas can be cancelled');
    }

    const reversedTransactions = await withTransaction(async (client) => {
      const count = await customerTransactionRepository.deleteByHawala(userId, id, client);
      await hawalaRepository.deleteById(userId, id, client);
      return count;
    });

    return { id, reversedTransactions };
  }
};
