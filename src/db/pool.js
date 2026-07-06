import pg from 'pg';
import { config } from '../config/index.js';

const { Pool, types } = pg;

// NUMERIC (OID 1700) comes back as a string by default; the domain works with
// JS numbers (amounts are well within double precision for this ledger's scale).
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));
// BIGINT (OID 20) — counters and sequence values.
types.setTypeParser(20, (value) => (value === null ? null : parseInt(value, 10)));

const poolConfig = config.database.url
  ? { connectionString: config.database.url, ssl: config.database.ssl, max: config.database.max }
  : {
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      ssl: config.database.ssl,
      max: config.database.max
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Runs `work(client)` inside a single transaction. Commits on success,
 * rolls back on any error. All multi-step writes go through this.
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Convenience passthrough for single-statement queries. */
export function query(text, params) {
  return pool.query(text, params);
}
