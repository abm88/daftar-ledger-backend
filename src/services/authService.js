import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';
import { withTransaction } from '../db/pool.js';
import { userRepository } from '../repositories/userRepository.js';
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

function signToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phone },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

function sanitize(user) {
  if (!user) return user;
  const { passwordHash, ...rest } = user;
  return rest;
}

export const authService = {
  async register({ phone, email, password, name, shopName, cityCode, registrationNo }) {
    const existing = await userRepository.findByPhone(phone);
    if (existing) throw AppError.conflict('An account with this phone already exists');
    if (email) {
      const byEmail = await userRepository.findByEmail(email);
      if (byEmail) throw AppError.conflict('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    const user = await withTransaction(async (client) => {
      const created = await userRepository.create(client, {
        phone, email, passwordHash, name, shopName, cityCode, registrationNo
      });
      await provisionUserDefaults(client, created.id);
      return created;
    });

    return { user: sanitize(user), token: signToken(user) };
  },

  async login({ phone, email, password }) {
    const user = phone
      ? await userRepository.findByPhone(phone)
      : await userRepository.findByEmail(email);
    if (!user) throw AppError.unauthorized('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw AppError.unauthorized('Invalid credentials');

    return { user: sanitize(user), token: signToken(user) };
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

  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await userRepository.findByIdWithPassword(userId);
    if (!user) throw AppError.notFound('User not found');
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw AppError.unauthorized('Current password is incorrect');
    const passwordHash = await bcrypt.hash(newPassword, config.auth.bcryptRounds);
    await userRepository.updatePassword(userId, passwordHash);
  },

  verifyToken(token) {
    try {
      return jwt.verify(token, config.auth.jwtSecret);
    } catch {
      throw AppError.unauthorized('Invalid or expired token');
    }
  }
};
