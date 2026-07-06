import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `
  t.id, t.user_id, t.customer_id, t.type, t.amount, t.currency, t.note,
  t.hawala_id, t.conversion, t.created_at
`;

export const customerTransactionRepository = {
  /** Chronological (oldest first) — running balances depend on this ordering. */
  async listByCustomer(customerId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM customer_transactions t
       WHERE t.customer_id = $1
       ORDER BY t.created_at ASC, t.id ASC`,
      [customerId]
    );
    return mapRows(rows);
  },

  async listAllForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS}, c.name AS customer_name, c.short_name AS customer_short_name,
              c.city_code AS customer_city
       FROM customer_transactions t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.user_id = $1
       ORDER BY t.created_at ASC, t.id ASC`,
      [userId]
    );
    return mapRows(rows);
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS}, c.name AS customer_name, c.short_name AS customer_short_name,
              c.city_code AS customer_city
       FROM customer_transactions t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.user_id = $1 AND t.id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, tx, client) {
    const { rows } = await db(client).query(
      `INSERT INTO customer_transactions
         (user_id, customer_id, type, amount, currency, note, hawala_id, conversion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        userId, tx.customerId, tx.type, tx.amount, tx.currency, tx.note || '',
        tx.hawalaId || null, tx.conversion ? JSON.stringify(tx.conversion) : null
      ]
    );
    return rows[0].id;
  },

  async delete(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM customer_transactions WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
