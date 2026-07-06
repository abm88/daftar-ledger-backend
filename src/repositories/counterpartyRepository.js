import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = 'id, user_id, name, short_name, initial, phone, city_code, tier, created_at, updated_at';

export const counterpartyRepository = {
  async listForUser(userId, { search } = {}, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM counterparties
       WHERE user_id = $1
         AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR short_name ILIKE '%' || $2 || '%')
       ORDER BY created_at DESC`,
      [userId, search || null]
    );
    return mapRows(rows);
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM counterparties WHERE user_id = $1 AND id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, { name, shortName, initial, phone, cityCode, tier }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO counterparties (user_id, name, short_name, initial, phone, city_code, tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [userId, name, shortName, initial, phone, cityCode, tier]
    );
    return toCamel(rows[0]);
  },

  async update(userId, id, { name, shortName, initial, phone, cityCode, tier }, client) {
    const { rows } = await db(client).query(
      `UPDATE counterparties SET
         name = COALESCE($3, name),
         short_name = COALESCE($4, short_name),
         initial = COALESCE($5, initial),
         phone = COALESCE($6, phone),
         city_code = COALESCE($7, city_code),
         tier = COALESCE($8, tier),
         updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [userId, id, name ?? null, shortName ?? null, initial ?? null, phone ?? null, cityCode ?? null, tier ?? null]
    );
    return toCamel(rows[0]);
  },

  async delete(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM counterparties WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
