import { AppError } from '../utils/AppError.js';
import { teamRepository } from '../repositories/teamRepository.js';
import { expenseRepository } from '../repositories/expenseRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { assetToReporting } from '../domain/rateMath.js';
import { round6 } from '../utils/money.js';
import { serializeExpense } from './expenseService.js';

/** Sum a member's expenses, each converted to the reporting currency. */
function reportingTotal(expenses, rates, reportingCurrency) {
  let total = 0;
  for (const x of expenses) {
    total += assetToReporting(rates, x.currency, Number(x.amount), reportingCurrency);
  }
  return round6(total);
}

export const teamService = {
  /**
   * All team members with their expense count and total (in the reporting
   * currency) — the data behind the Team screen's per-person rows.
   */
  async list(userId) {
    const [members, expenses, rates, settings] = await Promise.all([
      teamRepository.listForUser(userId),
      expenseRepository.listAllForUser(userId),
      rateRepository.mapForUser(userId),
      settingsRepository.getForUser(userId)
    ]);
    const reporting = settings.reportingCurrency;

    const byMember = new Map();
    for (const x of expenses) {
      if (!byMember.has(x.teamMemberId)) byMember.set(x.teamMemberId, []);
      byMember.get(x.teamMemberId).push(x);
    }

    const enriched = members.map((m) => {
      const theirs = byMember.get(m.id) || [];
      return {
        ...m,
        expenseCount: theirs.length,
        expenseTotalReporting: reportingTotal(theirs, rates, reporting)
      };
    });

    return { members: enriched, reportingCurrency: reporting, total: members.length };
  },

  /** One member with their full expense history and reporting-currency total. */
  async getById(userId, id) {
    const member = await teamRepository.findById(userId, id);
    if (!member) throw AppError.notFound('Team member not found');

    const [expenses, rates, settings] = await Promise.all([
      expenseRepository.listAllForUser(userId, { teamMemberId: id }),
      rateRepository.mapForUser(userId),
      settingsRepository.getForUser(userId)
    ]);
    const reporting = settings.reportingCurrency;

    return {
      ...member,
      expenses: expenses.map(serializeExpense),
      expenseCount: expenses.length,
      expenseTotalReporting: reportingTotal(expenses, rates, reporting),
      reportingCurrency: reporting
    };
  },

  async create(userId, { name, role, phone, initial }) {
    const cleanName = name.trim();
    const created = await teamRepository.create(userId, {
      name: cleanName,
      role: role || 'Staff',
      phone: (phone || '').trim(),
      initial: (initial || '').trim() || cleanName.charAt(0).toUpperCase()
    });
    return created;
  },

  async update(userId, id, updates) {
    const patch = { ...updates };
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.phone !== undefined) patch.phone = patch.phone.trim();
    if (patch.initial !== undefined) patch.initial = patch.initial.trim();
    const member = await teamRepository.update(userId, id, patch);
    if (!member) throw AppError.notFound('Team member not found');
    return member;
  },

  async delete(userId, id) {
    const deleted = await teamRepository.delete(userId, id);
    if (!deleted) throw AppError.notFound('Team member not found');
  }
};
