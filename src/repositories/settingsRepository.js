import { db, toCamel } from './helpers.js';

export const settingsRepository = {
  async getForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT user_id, reporting_currency, trade_currency, next_hawala_code,
              last_cash_count_at, updated_at
       FROM user_settings WHERE user_id = $1`,
      [userId]
    );
    return toCamel(rows[0]);
  },

  async insertDefaults(userId, client) {
    await db(client).query(
      `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId]
    );
  },

  async update(userId, { reportingCurrency, tradeCurrency }, client) {
    const { rows } = await db(client).query(
      `UPDATE user_settings SET
         reporting_currency = COALESCE($2, reporting_currency),
         trade_currency = COALESCE($3, trade_currency),
         updated_at = now()
       WHERE user_id = $1
       RETURNING user_id, reporting_currency, trade_currency, next_hawala_code, last_cash_count_at, updated_at`,
      [userId, reportingCurrency ?? null, tradeCurrency ?? null]
    );
    return toCamel(rows[0]);
  },

  async touchLastCashCount(userId, client) {
    await db(client).query(
      'UPDATE user_settings SET last_cash_count_at = now(), updated_at = now() WHERE user_id = $1',
      [userId]
    );
  },

  /**
   * Atomically claims the next hawala code for the user. The row lock from
   * UPDATE ... RETURNING serializes concurrent issuances.
   */
  async claimNextHawalaCode(userId, client) {
    const { rows } = await db(client).query(
      `UPDATE user_settings SET next_hawala_code = next_hawala_code + 1
       WHERE user_id = $1
       RETURNING next_hawala_code - 1 AS claimed`,
      [userId]
    );
    return rows[0].claimed;
  },

  /** Reads the next code without claiming it (form pre-fill). */
  async peekNextHawalaCode(userId, client) {
    const { rows } = await db(client).query(
      'SELECT next_hawala_code FROM user_settings WHERE user_id = $1',
      [userId]
    );
    return rows[0]?.next_hawala_code;
  }
};
