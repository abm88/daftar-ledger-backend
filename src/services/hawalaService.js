import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { hawalaRepository } from '../repositories/hawalaRepository.js';
import { counterpartyRepository } from '../repositories/counterpartyRepository.js';
import { customerRepository } from '../repositories/customerRepository.js';
import { customerTransactionRepository } from '../repositories/customerTransactionRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { referenceRepository } from '../repositories/referenceRepository.js';
import { commissionAmount } from '../domain/commission.js';
import { formatHawalaCode } from '../domain/codes.js';
import {
  COMMISSION_MODES, SENDER_MODES, HAWALA_STATUS
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
   * Issues a hawala (status: pending).
   *
   * senderMode 'cash'    — sender pays at the counter; senderName is free text.
   * senderMode 'account' — funded from a customer account: writes a linked
   * 'withdrawal' transaction for amount + commission. The account may go
   * negative — the debit simply adds to the customer's outstanding balance.
   *
   * Commission is percent (of amount) or a fixed fee in the hawala currency.
   * The pickup code is claimed atomically from the per-user sequence.
   */
  async issue(userId, input) {
    const {
      type, counterpartyId, fromCity, toCity, amount, currency,
      senderMode, senderName, senderCustomerId, receiverName,
      commissionMode, commissionPct, commissionFixed, note
    } = input;

    const counterparty = await counterpartyRepository.findById(userId, counterpartyId);
    if (!counterparty) throw AppError.notFound('Counterparty not found');
    for (const city of [fromCity, toCity]) {
      if (!(await referenceRepository.cityExists(city))) {
        throw AppError.unprocessable(`Unknown city: ${city}`);
      }
    }

    const commission = round6(commissionAmount({
      amount, commissionMode, commissionPct, commissionFixed
    }));

    return withTransaction(async (client) => {
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
        commissionPct: commissionMode === COMMISSION_MODES.PERCENT ? (commissionPct ?? 1.0) : 0,
        commissionAmount: commission,
        code,
        status: HAWALA_STATUS.PENDING,
        senderCustomerId: customer ? customer.id : null,
        note: note || ''
      }, client);

      if (customer) {
        const commissionNote = commissionMode === COMMISSION_MODES.FIXED
          ? `incl. ${commission} ${currency} commission`
          : `incl. ${(commissionPct ?? 1.0).toFixed(1)}% commission`;
        await customerTransactionRepository.create(userId, {
          customerId: customer.id,
          type: 'withdrawal',
          amount: round6(amount + commission),
          currency,
          note: `Hawala to ${receiverName.trim()} · ${fromCity} → ${toCity} · code ${code} (${commissionNote})`,
          hawalaId
        }, client);
      }

      return hawalaRepository.findById(userId, hawalaId, client);
    });
  },

  /** Marks a pending hawala as paid out (recipient collected the money). */
  async markPaid(userId, id) {
    const hawala = await hawalaRepository.findById(userId, id);
    if (!hawala) throw AppError.notFound('Hawala not found');
    if (hawala.status === HAWALA_STATUS.PAID) {
      throw AppError.conflict('Hawala is already paid');
    }
    await hawalaRepository.markPaid(userId, id);
    return hawalaRepository.findById(userId, id);
  }
};
