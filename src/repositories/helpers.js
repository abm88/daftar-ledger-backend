import { pool } from '../db/pool.js';

/** snake_case → camelCase for a single DB row. */
export function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

export function mapRows(rows) {
  return rows.map(toCamel);
}

/** Repositories accept an optional transaction client; default to the pool. */
export function db(client) {
  return client || pool;
}
