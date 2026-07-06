import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = 'id, user_id, asset_code, amount, type, note, created_at';

export const investmentRepository = {
  async listForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM investments
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return mapRows(rows);
  },

  async create(userId, { assetCode, amount, type, note }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO investments (user_id, asset_code, amount, type, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [userId, assetCode, amount, type, note || '']
    );
    return toCamel(rows[0]);
  }
};
