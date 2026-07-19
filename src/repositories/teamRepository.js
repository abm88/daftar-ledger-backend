import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `id, user_id, name, role, phone, initial, created_at, updated_at`;

export const teamRepository = {
  async listForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM team_members
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return mapRows(rows);
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM team_members WHERE user_id = $1 AND id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, { name, role, phone, initial }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO team_members (user_id, name, role, phone, initial)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [userId, name, role, phone, initial]
    );
    return toCamel(rows[0]);
  },

  async update(userId, id, { name, role, phone, initial }, client) {
    const { rows } = await db(client).query(
      `UPDATE team_members SET
         name = COALESCE($3, name),
         role = COALESCE($4, role),
         phone = COALESCE($5, phone),
         initial = COALESCE($6, initial),
         updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [userId, id, name ?? null, role ?? null, phone ?? null, initial ?? null]
    );
    return toCamel(rows[0]);
  },

  async delete(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM team_members WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
