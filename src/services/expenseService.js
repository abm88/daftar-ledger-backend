import { AppError } from '../utils/AppError.js';
import { expenseRepository } from '../repositories/expenseRepository.js';
import { teamRepository } from '../repositories/teamRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { round6 } from '../utils/money.js';

/**
 * Serializes a stored expense to the app's shape. `ts` (epoch ms) and `date`
 * (YYYY-MM-DD) are derived from created_at so the client keeps the prototype's
 * `{ ts, date }` contract without persisting redundant display fields.
 */
export function serializeExpense(row) {
  if (!row) return row;
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  return {
    id: row.id,
    teamMemberId: row.teamMemberId,
    teamMemberName: row.teamMemberName,
    teamMemberRole: row.teamMemberRole,
    amount: Number(row.amount),
    currency: row.currency,
    note: row.note || '',
    createdAt: row.createdAt,
    ts: createdAt.getTime(),
    date: createdAt.toISOString().slice(0, 10)
  };
}

export const expenseService = {
  async list(userId, { teamMemberId } = {}) {
    const rows = await expenseRepository.listAllForUser(userId, { teamMemberId });
    return rows.map(serializeExpense);
  },

  async getById(userId, id) {
    const row = await expenseRepository.findById(userId, id);
    if (!row) throw AppError.notFound('Expense not found');
    return serializeExpense(row);
  },

  /**
   * Records an expense against a team member. No cash/account movement — an
   * expense is an outflow entry in the ledger only, it never mutates the drawer.
   */
  async create(userId, { teamMemberId, amount, currency, note }) {
    const member = await teamRepository.findById(userId, teamMemberId);
    if (!member) throw AppError.notFound('Team member not found');

    const assets = await assetRepository.listActiveForUser(userId);
    if (!assets.some((a) => a.code === currency)) {
      throw AppError.unprocessable(`Currency ${currency} is not an active asset`);
    }

    const id = await expenseRepository.create(userId, {
      teamMemberId,
      amount: round6(amount),
      currency,
      note: (note || '').trim()
    });
    return this.getById(userId, id);
  },

  async delete(userId, id) {
    const deleted = await expenseRepository.delete(userId, id);
    if (!deleted) throw AppError.notFound('Expense not found');
  }
};
