import { db, toCamel } from './helpers.js';

export const sessionRepository = {
  async create({ id, userId, expiresAt }, client) {
    await db(client).query(
      'INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [id, userId, expiresAt]
    );
  },

  /** Returns the session only if it is neither revoked nor expired. */
  async findActive(id, client) {
    const { rows } = await db(client).query(
      `SELECT id, user_id, created_at, expires_at
       FROM user_sessions
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [id]
    );
    return toCamel(rows[0]);
  },

  async revoke(id, client) {
    await db(client).query(
      'UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [id]
    );
  },

  /** Kills every other device's session, e.g. after a password change. */
  async revokeAllForUserExcept(userId, keepSessionId, client) {
    await db(client).query(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [userId, keepSessionId]
    );
  }
};
