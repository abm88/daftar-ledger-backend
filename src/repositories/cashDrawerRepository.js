import { db, mapRows } from './helpers.js';

export const cashDrawerRepository = {
  async listForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT asset_code, balance, updated_at FROM cash_drawer WHERE user_id = $1`,
      [userId]
    );
    return mapRows(rows);
  },

  /** Balances keyed by asset code. */
  async mapForUser(userId, client) {
    const list = await this.listForUser(userId, client);
    const map = {};
    for (const row of list) map[row.assetCode] = row.balance;
    return map;
  },

  async getBalance(userId, assetCode, client) {
    const { rows } = await db(client).query(
      'SELECT balance FROM cash_drawer WHERE user_id = $1 AND asset_code = $2',
      [userId, assetCode]
    );
    return rows.length > 0 ? rows[0].balance : 0;
  },

  /** Sets an absolute balance (cash count / initial setup). */
  async setBalance(userId, assetCode, balance, client) {
    await db(client).query(
      `INSERT INTO cash_drawer (user_id, asset_code, balance, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, asset_code) DO UPDATE SET balance = $3, updated_at = now()`,
      [userId, assetCode, balance]
    );
  },

  /** Applies a signed delta (FX legs, investments). */
  async adjustBalance(userId, assetCode, delta, client) {
    await db(client).query(
      `INSERT INTO cash_drawer (user_id, asset_code, balance, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, asset_code) DO UPDATE SET
         balance = cash_drawer.balance + $3, updated_at = now()`,
      [userId, assetCode, delta]
    );
  },

  async insertZeroBalances(userId, assetCodes, client) {
    for (const code of assetCodes) {
      await db(client).query(
        `INSERT INTO cash_drawer (user_id, asset_code, balance)
         VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
        [userId, code]
      );
    }
  }
};
