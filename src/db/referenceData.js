/**
 * Canonical reference data, mirroring the Daftar prototype's registries.
 * Seeded into the database; the DB rows are the runtime source of truth.
 */

export const CITIES = [
  { code: 'KBL', name: 'Kabul', color: '#A8541A', sortOrder: 1 },
  { code: 'HRT', name: 'Herat', color: '#2E6B4E', sortOrder: 2 },
  { code: 'MZR', name: 'Mazar', color: '#7B3D14', sortOrder: 3 },
  { code: 'JAL', name: 'Jalalabad', color: '#B89447', sortOrder: 4 }
];

export const ASSETS = [
  { code: 'USD', type: 'currency', name: 'US Dollar', pashtoName: 'ډالر', symbol: '$', decimals: 2, emoji: '🇺🇸', isBase: false, isDefault: true, defaultActive: true, sortOrder: 1 },
  { code: 'AFN', type: 'currency', name: 'Afghani', pashtoName: 'افغانۍ', symbol: '؋', decimals: 0, emoji: '🇦🇫', isBase: true, isDefault: true, defaultActive: true, sortOrder: 2 },
  { code: 'PKR', type: 'currency', name: 'Pakistani Rupee', pashtoName: 'روپۍ', symbol: '₨', decimals: 0, emoji: '🇵🇰', isBase: false, isDefault: true, defaultActive: true, sortOrder: 3 },
  { code: 'EUR', type: 'currency', name: 'Euro', pashtoName: 'یورو', symbol: '€', decimals: 2, emoji: '🇪🇺', isBase: false, isDefault: false, defaultActive: false, sortOrder: 4 },
  { code: 'GBP', type: 'currency', name: 'British Pound', pashtoName: 'پاؤنډ', symbol: '£', decimals: 2, emoji: '🇬🇧', isBase: false, isDefault: false, defaultActive: false, sortOrder: 5 },
  { code: 'SAR', type: 'currency', name: 'Saudi Riyal', pashtoName: 'ریال', symbol: '﷼', decimals: 2, emoji: '🇸🇦', isBase: false, isDefault: false, defaultActive: false, sortOrder: 6 },
  { code: 'AED', type: 'currency', name: 'UAE Dirham', pashtoName: 'درهم', symbol: 'د.إ', decimals: 2, emoji: '🇦🇪', isBase: false, isDefault: false, defaultActive: false, sortOrder: 7 },
  { code: 'GOLD', type: 'metal', name: 'Gold', pashtoName: 'طلا', symbol: 'g', decimals: 2, emoji: '🟡', isBase: false, isDefault: false, defaultActive: false, sortOrder: 8 },
  { code: 'SILVER', type: 'metal', name: 'Silver', pashtoName: 'سپین زر', symbol: 'g', decimals: 1, emoji: '⚪', isBase: false, isDefault: false, defaultActive: false, sortOrder: 9 }
];

/**
 * Starting rates for a new saraf ("1 asset = N AFN"). The saraf edits these
 * from the Rates screen; prev backs the revaluation P&L.
 */
export const DEFAULT_RATES = {
  USD: { buy: 71.2, sell: 71.8, prev: 71.5 },
  PKR: { buy: 0.245, sell: 0.252, prev: 0.25 },
  EUR: { buy: 76.5, sell: 77.3, prev: 77.0 },
  GBP: { buy: 89.2, sell: 90.1, prev: 89.8 },
  SAR: { buy: 18.95, sell: 19.2, prev: 19.1 },
  AED: { buy: 19.4, sell: 19.65, prev: 19.55 },
  GOLD: { buy: 5680, sell: 5750, prev: 5720 },
  SILVER: { buy: 65, sell: 68, prev: 67 }
};
