import { db, mapRows, toCamel } from './helpers.js';

const COLUMNS = `
  id, user_id, side, from_currency, to_currency, from_amount, to_amount,
  rate, from_afn_value, to_afn_value, realized_pl, note, created_at
`;

export const fxTradeRepository = {
  /** Chronological (oldest first) — cost-basis walks depend on this ordering. */
  async listChronological(userId, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM fx_trades
       WHERE user_id = $1
       ORDER BY created_at ASC, id ASC`,
      [userId]
    );
    return mapRows(rows);
  },

  async listPage(userId, { limit, offset }, client) {
    const { rows: countRows } = await db(client).query(
      'SELECT COUNT(*)::int AS total FROM fx_trades WHERE user_id = $1',
      [userId]
    );
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM fx_trades
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return { items: mapRows(rows), total: countRows[0].total };
  },

  async findById(userId, id, client) {
    const { rows } = await db(client).query(
      `SELECT ${COLUMNS} FROM fx_trades WHERE user_id = $1 AND id = $2`,
      [userId, id]
    );
    return toCamel(rows[0]);
  },

  async create(userId, trade, client) {
    const { rows } = await db(client).query(
      `INSERT INTO fx_trades
         (user_id, side, from_currency, to_currency, from_amount, to_amount,
          rate, from_afn_value, to_afn_value, realized_pl, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${COLUMNS}`,
      [
        userId, trade.side, trade.fromCurrency, trade.toCurrency,
        trade.fromAmount, trade.toAmount, trade.rate,
        trade.fromAfnValue, trade.toAfnValue, trade.realizedPl, trade.note || ''
      ]
    );
    return toCamel(rows[0]);
  }
};
