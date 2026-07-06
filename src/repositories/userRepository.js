import { db, toCamel } from './helpers.js';

const USER_COLUMNS = `
  id, email, phone, name, shop_name, city_code, registration_no, created_at, updated_at
`;

export const userRepository = {
  async create(client, { email, phone, passwordHash, name, shopName, cityCode, registrationNo }) {
    const { rows } = await db(client).query(
      `INSERT INTO users (email, phone, password_hash, name, shop_name, city_code, registration_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${USER_COLUMNS}`,
      [email || null, phone, passwordHash, name, shopName || '', cityCode || null, registrationNo || '']
    );
    return toCamel(rows[0]);
  },

  async findByPhone(phone, client) {
    const { rows } = await db(client).query(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE phone = $1`,
      [phone]
    );
    return toCamel(rows[0]);
  },

  async findByEmail(email, client) {
    const { rows } = await db(client).query(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
      [email]
    );
    return toCamel(rows[0]);
  },

  async findById(id, client) {
    const { rows } = await db(client).query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id]
    );
    return toCamel(rows[0]);
  },

  async findByIdWithPassword(id, client) {
    const { rows } = await db(client).query(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = $1`,
      [id]
    );
    return toCamel(rows[0]);
  },

  async updateProfile(id, { name, shopName, cityCode, registrationNo, email }, client) {
    const { rows } = await db(client).query(
      `UPDATE users SET
         name = COALESCE($2, name),
         shop_name = COALESCE($3, shop_name),
         city_code = COALESCE($4, city_code),
         registration_no = COALESCE($5, registration_no),
         email = COALESCE($6, email),
         updated_at = now()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [id, name ?? null, shopName ?? null, cityCode ?? null, registrationNo ?? null, email ?? null]
    );
    return toCamel(rows[0]);
  },

  async updatePassword(id, passwordHash, client) {
    await db(client).query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [id, passwordHash]
    );
  }
};
