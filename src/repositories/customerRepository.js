import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `id, user_id, name, short_name, initial, phone, city_code, color_idx,
                 notes, opened_at, created_at, updated_at`;

export const customerRepository = {
  async listForUser(userId, { search, cityCode } = {}, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM customers
       WHERE user_id = $1
         AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR short_name ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR city_code = $3)
       ORDER BY created_at DESC`,
      [userId, search || null, cityCode || null]
    );
    return mapRows(rows);
  },

  async countForUser(userId, client) {
    const { rows } = await db(client).query(
      'SELECT COUNT(*)::int AS count FROM customers WHERE user_id = $1',
      [userId]
    );
    return rows[0].count;
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM customers WHERE user_id = $1 AND id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, { name, shortName, initial, phone, cityCode, colorIdx, notes }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO customers (user_id, name, short_name, initial, phone, city_code, color_idx, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [userId, name, shortName, initial, phone, cityCode, colorIdx, notes]
    );
    return toCamel(rows[0]);
  },

  async update(userId, id, { name, shortName, initial, phone, cityCode, notes }, client) {
    const { rows } = await db(client).query(
      `UPDATE customers SET
         name = COALESCE($3, name),
         short_name = COALESCE($4, short_name),
         initial = COALESCE($5, initial),
         phone = COALESCE($6, phone),
         city_code = COALESCE($7, city_code),
         notes = COALESCE($8, notes),
         updated_at = now()
       WHERE user_id = $1 AND id = $2
       RETURNING ${COLUMNS}`,
      [userId, id, name ?? null, shortName ?? null, initial ?? null, phone ?? null, cityCode ?? null, notes ?? null]
    );
    return toCamel(rows[0]);
  },

  async delete(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM customers WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
