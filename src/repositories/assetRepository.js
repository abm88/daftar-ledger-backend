import { db, mapRows } from './helpers.js';

export const assetRepository = {
  /** Full registry joined with the user's activation flags. */
  async listForUser(userId, client) {
    const { rows } = await db(client).query(
      `SELECT a.code, a.type, a.name, a.pashto_name, a.symbol, a.decimals, a.emoji,
              a.is_base, a.is_default, a.sort_order,
              COALESCE(ua.active, a.default_active) AS active
       FROM assets a
       LEFT JOIN user_assets ua ON ua.asset_code = a.code AND ua.user_id = $1
       ORDER BY a.sort_order`,
      [userId]
    );
    return mapRows(rows);
  },

  async listActiveForUser(userId, client) {
    const assets = await this.listForUser(userId, client);
    return assets.filter((a) => a.active);
  },

  async setActivation(userId, assetCode, active, client) {
    await db(client).query(
      `INSERT INTO user_assets (user_id, asset_code, active)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, asset_code) DO UPDATE SET active = $3`,
      [userId, assetCode, active]
    );
  },

  async insertDefaults(userId, assets, client) {
    for (const a of assets) {
      await db(client).query(
        `INSERT INTO user_assets (user_id, asset_code, active)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, a.code, a.defaultActive]
      );
    }
  }
};
