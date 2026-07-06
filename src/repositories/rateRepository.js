import { db, mapRows, toCamel } from './helpers.js';

export const rateRepository = {
  async listForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT asset_code, buy, sell, prev_sell, delta_pct, updated_at
       FROM rates WHERE user_id = $1`,
      [userId]
    );
    return mapRows(rows);
  },

  /** Rates keyed by asset code: { USD: { buy, sell, prevSell, deltaPct }, ... } */
  async mapForUser(userId, client) {
    const list = await this.listForUser(userId, client);
    const map = {};
    for (const r of list) map[r.assetCode] = r;
    return map;
  },

  async upsert(userId, assetCode, { buy, sell, prevSell, deltaPct }, client) {
    const { rows } = await db(client).query(
      `INSERT INTO rates (user_id, asset_code, buy, sell, prev_sell, delta_pct, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, asset_code) DO UPDATE SET
         buy = $3, sell = $4, prev_sell = $5, delta_pct = $6, updated_at = now()
       RETURNING asset_code, buy, sell, prev_sell, delta_pct, updated_at`,
      [userId, assetCode, buy, sell, prevSell ?? null, deltaPct ?? 0]
    );
    return toCamel(rows[0]);
  },

  async recordHistory(userId, assetCode, { buy, sell }, client) {
    await db(client).query(
      `INSERT INTO rate_history (user_id, asset_code, buy, sell)
       VALUES ($1, $2, $3, $4)`,
      [userId, assetCode, buy, sell]
    );
  },

  async listHistory(userId, assetCode, limit, client) {
    const { rows } = await db(client).query(
      `SELECT asset_code, buy, sell, recorded_at
       FROM rate_history
       WHERE user_id = $1 AND ($2::text IS NULL OR asset_code = $2)
       ORDER BY recorded_at DESC
       LIMIT $3`,
      [userId, assetCode || null, limit]
    );
    return mapRows(rows);
  }
};
