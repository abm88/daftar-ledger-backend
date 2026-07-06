import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProduction: env === 'production',
  port: Number(process.env.PORT || 3000),
  database: {
    url: process.env.DATABASE_URL || null,
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'daftar',
    user: process.env.PGUSER || 'daftar',
    password: process.env.PGPASSWORD || 'daftar',
    ssl: (process.env.PGSSLMODE || 'disable') === 'require'
      ? { rejectUnauthorized: false }
      : false,
    max: Number(process.env.PGPOOL_MAX || 10)
  },
  auth: {
    jwtSecret: env === 'production'
      ? required('JWT_SECRET')
      : (process.env.JWT_SECRET || 'dev-only-insecure-secret'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10)
  },
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim())
};
