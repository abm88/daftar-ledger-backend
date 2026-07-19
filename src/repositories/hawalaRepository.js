import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `
  h.id, h.user_id, h.counterparty_id, h.type, h.from_city, h.to_city,
  h.sender_name, h.receiver_name, h.amount, h.currency,
  h.commission_mode, h.commission_pct, h.commission_amount,
  h.code, h.status, h.sender_customer_id, h.is_opening, h.note,
  h.payout_method, h.payout_customer_id, h.created_at, h.paid_at
`;

const WITH_CP = `
  ${COLUMNS},
  cp.name AS counterparty_name, cp.short_name AS counterparty_short_name,
  cp.city_code AS counterparty_city
`;

export const hawalaRepository = {
  async listForUser(userId, { status, currency, counterpartyId, search, includeOpening = true, limit, offset } = {}, client) {
    const params = [userId, status || null, currency || null, counterpartyId || null, search || null, includeOpening];
    const where = `
      h.user_id = $1
      AND ($2::text IS NULL OR h.status = $2)
      AND ($3::text IS NULL OR h.currency = $3)
      AND ($4::uuid IS NULL OR h.counterparty_id = $4)
      AND ($5::text IS NULL OR h.sender_name ILIKE '%' || $5 || '%'
           OR h.receiver_name ILIKE '%' || $5 || '%' OR h.code = $5)
      AND ($6::boolean OR h.is_opening = FALSE)
    `;
    const { rows: countRows } = await db(client).query(
      `SELECT COUNT(*)::int AS total FROM hawalas h WHERE ${where}`, params
    );
    const { rows } = await db(client).query(
      `SELECT ${WITH_CP}
       FROM hawalas h
       JOIN counterparties cp ON cp.id = h.counterparty_id
       WHERE ${where}
       ORDER BY h.created_at DESC
       LIMIT $7 OFFSET $8`,
      [...params, limit ?? 100, offset ?? 0]
    );
    return { items: mapRows(rows), total: countRows[0].total };
  },

  async listByCounterparty(counterpartyId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM hawalas h
       WHERE h.counterparty_id = $1
       ORDER BY h.created_at ASC`,
      [counterpartyId]
    );
    return mapRows(rows);
  },

  /** All hawalas for a user, joined with counterparty info (positions, feeds, P&L). */
  async listAllWithCounterparty(userId, client) {
    const { rows } = await db(client).query(
      `SELECT ${WITH_CP}
       FROM hawalas h
       JOIN counterparties cp ON cp.id = h.counterparty_id
       WHERE h.user_id = $1
       ORDER BY h.created_at ASC`,
      [userId]
    );
    return mapRows(rows);
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${WITH_CP}
       FROM hawalas h
       JOIN counterparties cp ON cp.id = h.counterparty_id
       WHERE h.user_id = $1 AND h.id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, hawala, client) {
    const { rows } = await db(client).query(
      `INSERT INTO hawalas
         (user_id, counterparty_id, type, from_city, to_city, sender_name, receiver_name,
          amount, currency, commission_mode, commission_pct, commission_amount,
          code, status, sender_customer_id, is_opening, note, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text,$15,$16,$17,
               CASE WHEN $14::text = 'paid' THEN now() ELSE NULL END)
       RETURNING id`,
      [
        userId, hawala.counterpartyId, hawala.type, hawala.fromCity, hawala.toCity,
        hawala.senderName, hawala.receiverName, hawala.amount, hawala.currency,
        hawala.commissionMode, hawala.commissionPct, hawala.commissionAmount,
        hawala.code, hawala.status, hawala.senderCustomerId || null,
        hawala.isOpening || false, hawala.note || ''
      ]
    );
    return rows[0].id;
  },

  /**
   * Marks a pending hawala paid out, recording the payout method and (for
   * account payouts) the credited customer. paid_at is the payout timestamp.
   */
  async markPaid(userId, id, { method = 'cash', payoutCustomerId = null } = {}, client) {
    const { rows } = await db(client).query(
      `UPDATE hawalas
         SET status = 'paid', paid_at = now(),
             payout_method = $3, payout_customer_id = $4
       WHERE user_id = $1 AND id = $2 AND status = 'pending'
       RETURNING id`,
      [userId, id, method, payoutCustomerId]
    );
    return rows.length > 0;
  },

  async deleteById(userId, id, client) {
    const { rowCount } = await db(client).query(
      'DELETE FROM hawalas WHERE user_id = $1 AND id = $2',
      [userId, id]
    );
    return rowCount > 0;
  }
};
