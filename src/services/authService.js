import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { userRepository } from '../repositories/userRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { settingsRepository } from '../repositories/settingsRepository.js';
import { assetRepository } from '../repositories/assetRepository.js';
import { cashDrawerRepository } from '../repositories/cashDrawerRepository.js';
import { rateRepository } from '../repositories/rateRepository.js';
import { referenceRepository } from '../repositories/referenceRepository.js';
import { DEFAULT_RATES } from '../db/referenceData.js';

/**
 * Provisions everything a fresh saraf account needs: settings row, per-asset
 * activation flags, zeroed cash drawer, and starting rates. Also used by the
 * demo seeder so both paths stay identical.
 */
export async function provisionUserDefaults(client, userId) {
  await settingsRepository.insertDefaults(userId, client);
  const assets = await referenceRepository.listAssets(client);
  await assetRepository.insertDefaults(userId, assets, client);
  await cashDrawerRepository.insertZeroBalances(userId, assets.map((a) => a.code), client);
  for (const asset of assets) {
    if (asset.isBase) continue;
    const seed = DEFAULT_RATES[asset.code];
    if (!seed) continue;
    await rateRepository.upsert(userId, asset.code, {
      buy: seed.buy,
      sell: seed.sell,
      prevSell: seed.prev,
      deltaPct: seed.prev > 0 ? ((seed.sell - seed.prev) / seed.prev) * 100 : 0
    }, client);
  }
}

/**
 * Issues a JWT bound to a server-side session row. Sign-out revokes the row,
 * which invalidates the token before its own expiry.
 */
async function startSession(user, client) {
  const sessionId = randomUUID();
  const token = jwt.sign(
    { sub: user.id, sid: sessionId, email: user.email },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
  const { exp } = jwt.decode(token);
  await sessionRepository.create(
    { id: sessionId, userId: user.id, expiresAt: new Date(exp * 1000) },
    client
  );
  return token;
}

function sanitize(user) {
  if (!user) return user;
  const { passwordHash, ...rest } = user;
  return rest;
}

export const authService = {
  async register({ email, password, name, phone, shopName, cityCode, registrationNo }) {
    const byEmail = await userRepository.findByEmail(email);
    if (byEmail) throw AppError.conflict('An account with this email already exists');
    if (phone) {
      const byPhone = await userRepository.findByPhone(phone);
      if (byPhone) throw AppError.conflict('An account with this phone already exists');
    }

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const { user, token } = await withTransaction(async (client) => {
      const created = await userRepository.create(client, {
        email, phone, passwordHash, name, shopName, cityCode, registrationNo
      });
      await provisionUserDefaults(client, created.id);
      return { user: created, token: await startSession(created, client) };
    });

    return { user: sanitize(user), token };
  },

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    // Deliberately vague — never reveal whether the email exists.
    if (!user) throw AppError.unauthorized('Email or password is incorrect');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw AppError.unauthorized('Email or password is incorrect');

    return { user: sanitize(user), token: await startSession(user) };
  },

  /** Revokes the session behind the presented token. Idempotent. */
  async logout(sessionId) {
    await sessionRepository.revoke(sessionId);
  },

  /** Verifies the JWT and that its session is still live (not signed out). */
  async authenticate(token) {
    let payload;
    try {
      payload = jwt.verify(token, config.auth.jwtSecret);
    } catch {
      throw AppError.unauthorized('Invalid or expired token');
    }
    const session = payload.sid && await sessionRepository.findActive(payload.sid);
    if (!session) throw AppError.unauthorized('Session has ended — please sign in again');
    return { userId: payload.sub, sessionId: payload.sid };
  },

  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound('User not found');
    return user;
  },

  async updateProfile(userId, updates) {
    if (updates.email) {
      const byEmail = await userRepository.findByEmail(updates.email);
      if (byEmail && byEmail.id !== userId) {
        throw AppError.conflict('An account with this email already exists');
      }
    }
    const user = await userRepository.updateProfile(userId, updates);
    if (!user) throw AppError.notFound('User not found');
    return user;
  },

  async changePassword(userId, sessionId, { currentPassword, newPassword }) {
    const user = await userRepository.findByIdWithPassword(userId);
    if (!user) throw AppError.notFound('User not found');
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw AppError.unauthorized('Current password is incorrect');
    const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    await userRepository.updatePassword(userId, passwordHash);
    // Sign out every other device; the session that changed the password stays.
    await sessionRepository.revokeAllForUserExcept(userId, sessionId);
  }
};
