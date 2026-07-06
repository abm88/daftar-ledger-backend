import { createApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Daftar API listening on port ${config.port} (${config.env})`);
});

async function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received — shutting down`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  // Hard-exit if connections refuse to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
