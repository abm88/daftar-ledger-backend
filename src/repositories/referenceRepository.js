import { db, mapRows } from './helpers.js';

export const referenceRepository = {
  async listCities(client) {
    const { rows } = await db(client).query(
      'SELECT code, name, color, sort_order FROM cities ORDER BY sort_order'
    );
    return mapRows(rows);
  },

  async cityExists(code, client) {
    const { rows } = await db(client).query('SELECT 1 FROM cities WHERE code = $1', [code]);
    return rows.length > 0;
  },

  async listAssets(client) {
    const { rows } = await db(client).query(
      `SELECT code, type, name, pashto_name, symbol, decimals, emoji,
              is_base, is_default, default_active, sort_order
       FROM assets ORDER BY sort_order`
    );
    return mapRows(rows);
  }
};
