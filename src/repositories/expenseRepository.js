import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `
  e.id, e.user_id, e.team_member_id, e.amount, e.currency, e.note, e.created_at
`;
const WITH_MEMBER = `
  ${COLUMNS},
  tm.name AS team_member_name, tm.role AS team_member_role
`;

export const expenseRepository = {
  /** All expenses for a user, newest first, joined with the team member. */
  async listAllForUser(userId, { teamMemberId } = {}, client) {
    const { rows } = await db(client).query(
      `SELECT ${WITH_MEMBER}
       FROM expenses e
       JOIN team_members tm ON tm.id = e.team_member_id
       WHERE e.user_id = $1
         AND ($2::uuid IS NULL OR e.team_member_id = $2)
       ORDER BY e.created_at DESC`,
      [userId, teamMemberId || null]
    );
    return mapRows(rows);
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${WITH_MEMBER}
       FROM expenses e
       JOIN team_members tm ON tm.id = e.team_member_id
       WHERE e.user_id = $1 AND e.id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, { teamMemberId, amount, currency, note }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO expenses (user_id, team_member_id, amount, currency, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, teamMemberId, amount, currency, note || '']
    );
    return rows[0].id;
  },

  async delete(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM expenses WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
