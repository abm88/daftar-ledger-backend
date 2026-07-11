/**
 * Seeds reference data (cities, asset registry). Idempotent — safe to re-run.
 *
 * With --demo it also creates a demo saraf account mirroring the prototype's
 * sample data (counterparties, customers, hawalas, FX trades, investments):
 *   email demo@daftar.af / password daftar123
 */
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../src/db/pool.js';
import { CITIES, ASSETS, DEFAULT_RATES } from '../src/db/referenceData.js';
import { provisionUserDefaults } from '../src/services/authService.js';

async function seedReferenceData() {
  await withTransaction(async (client) => {
    for (const city of CITIES) {
      await client.query(
        `INSERT INTO cities (code, name, color, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = $2, color = $3, sort_order = $4`,
        [city.code, city.name, city.color, city.sortOrder]
      );
    }
    for (const a of ASSETS) {
      await client.query(
        `INSERT INTO assets
           (code, type, name, pashto_name, symbol, decimals, emoji, is_base, is_default, default_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (code) DO UPDATE SET
           type = $2, name = $3, pashto_name = $4, symbol = $5, decimals = $6,
           emoji = $7, is_base = $8, is_default = $9, default_active = $10, sort_order = $11`,
        [a.code, a.type, a.name, a.pashtoName, a.symbol, a.decimals, a.emoji,
         a.isBase, a.isDefault, a.defaultActive, a.sortOrder]
      );
    }
  });
  console.log(`seeded ${CITIES.length} cities, ${ASSETS.length} assets`);
}

const DAY = 86_400_000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

async function seedDemo() {
  const email = 'demo@daftar.af';
  const phone = '+93700000001';
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log('demo user already exists — skipping demo seed');
    return;
  }

  await withTransaction(async (client) => {
    const passwordHash = await bcrypt.hash('daftar123', 10);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (phone, email, password_hash, name, shop_name, city_code, registration_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [phone, email, passwordHash, 'Haji Rahmat', 'Sarai Shahzada', 'KBL', 'AFG-0421']
    );
    const userId = user.id;
    await provisionUserDefaults(client, userId);

    // Rates as shown on the prototype's rate sheet.
    for (const [code, r] of Object.entries(DEFAULT_RATES)) {
      await client.query(
        `UPDATE rates SET buy = $3, sell = $4, prev_sell = $5,
           delta_pct = CASE WHEN $5::numeric > 0 THEN (($4::numeric - $5::numeric) / $5::numeric) * 100 ELSE 0 END
         WHERE user_id = $1 AND asset_code = $2`,
        [userId, code, r.buy, r.sell, r.prev]
      );
    }

    // Cash drawer.
    const drawer = { USD: 12450, AFN: 1850000, PKR: 425000 };
    for (const [code, balance] of Object.entries(drawer)) {
      await client.query(
        'UPDATE cash_drawer SET balance = $3, updated_at = now() WHERE user_id = $1 AND asset_code = $2',
        [userId, code, balance]
      );
    }
    await client.query(
      'UPDATE user_settings SET last_cash_count_at = now() WHERE user_id = $1',
      [userId]
    );

    // Counterparties + hawalas.
    const cps = [
      { name: 'Sarai Shahzada — Haji Yusuf', shortName: 'H. Yusuf', phone: '+93 70 000 1234', city: 'KBL', initial: 'ي', tier: 'core' },
      { name: 'Sarai Qandahari — Agha Naseem', shortName: 'A. Naseem', phone: '+93 70 000 5678', city: 'HRT', initial: 'ن', tier: 'core' },
      { name: 'Shahr-e-Naw Saraf — Khalid', shortName: 'Khalid', phone: '+93 70 000 9012', city: 'KBL', initial: 'خ', tier: 'regular' },
      { name: 'Sarai Mazar — Haji Qasim', shortName: 'H. Qasim', phone: '+93 70 000 3456', city: 'MZR', initial: 'ق', tier: 'core' }
    ];
    const cpIds = [];
    for (const cp of cps) {
      const { rows: [row] } = await client.query(
        `INSERT INTO counterparties (user_id, name, short_name, phone, city_code, initial, tier)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [userId, cp.name, cp.shortName, cp.phone, cp.city, cp.initial, cp.tier]
      );
      cpIds.push(row.id);
    }

    const hawalas = [
      { cp: 0, type: 'send', from: 'KBL', to: 'HRT', sender: 'Mirwais Khan', receiver: 'Abdul Rahman', amount: 5000, currency: 'USD', pct: 1.0, code: '101246', status: 'pending', at: ago(0, 2) },
      { cp: 0, type: 'recv', from: 'HRT', to: 'KBL', sender: 'Mohammad Ali', receiver: 'Karim Shah', amount: 240000, currency: 'AFN', pct: 0.8, code: '101243', status: 'paid', at: ago(1) },
      { cp: 0, type: 'send', from: 'KBL', to: 'MZR', sender: 'Zia Walid', receiver: 'Haji Baba', amount: 850000, currency: 'PKR', pct: 1.2, code: '101242', status: 'paid', at: ago(2) },
      { cp: 1, type: 'send', from: 'HRT', to: 'KBL', sender: 'Ahmad Zia', receiver: 'Sultan Mohammad', amount: 3200, currency: 'USD', pct: 1.0, code: '101244', status: 'pending', at: ago(0, 4) },
      { cp: 1, type: 'recv', from: 'KBL', to: 'HRT', sender: 'Fawad Ahmad', receiver: 'Haji Noor', amount: 180000, currency: 'AFN', pct: 0.8, code: '101241', status: 'paid', at: ago(3) },
      { cp: 2, type: 'send', from: 'KBL', to: 'JAL', sender: 'Bilal Khan', receiver: 'Amir Khan', amount: 120000, currency: 'PKR', pct: 1.5, code: '101245', status: 'pending', at: ago(0, 1) },
      { cp: 3, type: 'recv', from: 'MZR', to: 'KBL', sender: 'Reza Khan', receiver: 'Mustafa Ali', amount: 2100, currency: 'USD', pct: 1.0, code: '101240', status: 'paid', at: ago(4) }
    ];
    for (const h of hawalas) {
      await client.query(
        `INSERT INTO hawalas
           (user_id, counterparty_id, type, from_city, to_city, sender_name, receiver_name,
            amount, currency, commission_mode, commission_pct, commission_amount, code, status, created_at, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'percent',$10,$11,$12,$13,$14,$15)`,
        [userId, cpIds[h.cp], h.type, h.from, h.to, h.sender, h.receiver, h.amount, h.currency,
         h.pct, (h.amount * h.pct) / 100, h.code, h.status, h.at, h.status === 'paid' ? h.at : null]
      );
    }
    await client.query(
      'UPDATE user_settings SET next_hawala_code = 101247 WHERE user_id = $1',
      [userId]
    );

    // Customers + transactions.
    const customers = [
      { name: 'Haji Dawood', shortName: 'Dawood', phone: '+93 70 100 2345', city: 'KBL', colorIdx: 0, initial: 'د', notes: 'Timber importer, monthly account', openedDays: 80 },
      { name: 'Mohammad Karim', shortName: 'M. Karim', phone: '+93 70 100 6789', city: 'KBL', colorIdx: 1, initial: 'م', notes: 'Dry fruit exporter', openedDays: 101 },
      { name: 'Sultan Aziz', shortName: 'S. Aziz', phone: '+93 70 100 1122', city: 'HRT', colorIdx: 2, initial: 'س', notes: 'Carpet merchant', openedDays: 49 }
    ];
    const custIds = [];
    for (const c of customers) {
      const { rows: [row] } = await client.query(
        `INSERT INTO customers (user_id, name, short_name, phone, city_code, color_idx, initial, notes, opened_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [userId, c.name, c.shortName, c.phone, c.city, c.colorIdx, c.initial, c.notes, ago(c.openedDays)]
      );
      custIds.push(row.id);
    }

    const custTxs = [
      { c: 0, type: 'opening', amount: 8500, currency: 'USD', days: 80, note: 'Opening deposit' },
      { c: 0, type: 'deposit', amount: 3200, currency: 'USD', days: 68, note: 'Cash deposit' },
      { c: 0, type: 'withdrawal', amount: 450000, currency: 'AFN', days: 62, note: 'Cash withdrawal for timber purchase' },
      { c: 0, type: 'charge', amount: 180000, currency: 'PKR', days: 52, note: 'Paid to Peshawar supplier on behalf' },
      { c: 0, type: 'deposit', amount: 1800, currency: 'USD', days: 39, note: 'Weekly deposit' },
      { c: 0, type: 'withdrawal', amount: 2500, currency: 'USD', days: 21, note: 'Cash withdrawal' },
      { c: 0, type: 'credit', amount: 600000, currency: 'AFN', days: 13, note: 'Short-term advance (to be settled)' },
      { c: 0, type: 'deposit', amount: 2100, currency: 'USD', days: 5, note: 'Cash deposit' },
      { c: 1, type: 'opening', amount: 4200, currency: 'USD', days: 101, note: 'Opening deposit' },
      { c: 1, type: 'deposit', amount: 1500, currency: 'USD', days: 57, note: 'Cash deposit' },
      { c: 1, type: 'withdrawal', amount: 280000, currency: 'AFN', days: 39, note: 'Market expenses' },
      { c: 2, type: 'opening', amount: 1200, currency: 'USD', days: 49, note: 'Opening deposit' },
      { c: 2, type: 'deposit', amount: 900, currency: 'USD', days: 32, note: 'Weekly deposit' }
    ];
    for (const t of custTxs) {
      await client.query(
        `INSERT INTO customer_transactions (user_id, customer_id, type, amount, currency, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, custIds[t.c], t.type, t.amount, t.currency, t.note, ago(t.days)]
      );
    }

    // FX trades (realized figures as in the prototype).
    const fx = [
      { side: 'buy', from: 'PKR', to: 'USD', fromAmt: 1410000, toAmt: 5000, rate: 282, realized: null, days: 3, note: 'Opening USD stock' },
      { side: 'buy', from: 'AFN', to: 'PKR', fromAmt: 84000, toAmt: 300000, rate: 0.28, realized: null, days: 2, note: 'PKR replenish' },
      { side: 'sell', from: 'USD', to: 'AFN', fromAmt: 2000, toAmt: 144000, rate: 72, realized: 1000, days: 1, note: 'Walk-in exchange' },
      { side: 'sell', from: 'PKR', to: 'AFN', fromAmt: 100000, toAmt: 28100, rate: 0.281, realized: 100, days: 0, note: 'Morning exchange' }
    ];
    for (const t of fx) {
      const fromAfn = t.from === 'AFN' ? t.fromAmt : t.fromAmt * DEFAULT_RATES[t.from].sell;
      const toAfn = t.to === 'AFN' ? t.toAmt : t.toAmt * DEFAULT_RATES[t.to].sell;
      await client.query(
        `INSERT INTO fx_trades
           (user_id, side, from_currency, to_currency, from_amount, to_amount, rate,
            from_afn_value, to_afn_value, realized_pl, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [userId, t.side, t.from, t.to, t.fromAmt, t.toAmt, t.rate, fromAfn, toAfn, t.realized, t.note, ago(t.days, 3)]
      );
    }

    // Investments.
    const investments = [
      { asset: 'USD', amount: 8000, type: 'opening', days: 90, note: 'Shop opening — USD stock' },
      { asset: 'AFN', amount: 1500000, type: 'opening', days: 90, note: 'Shop opening — AFN cash' },
      { asset: 'PKR', amount: 200000, type: 'opening', days: 90, note: 'Shop opening — PKR float' },
      { asset: 'USD', amount: 3000, type: 'addition', days: 60, note: 'Top-up from personal savings' },
      { asset: 'AFN', amount: 250000, type: 'addition', days: 30, note: 'Reinvested first month profits' },
      { asset: 'PKR', amount: 150000, type: 'addition', days: 14, note: 'PKR liquidity injection' },
      { asset: 'AFN', amount: 50000, type: 'withdrawal', days: 7, note: 'Personal expenses' }
    ];
    for (const inv of investments) {
      await client.query(
        `INSERT INTO investments (user_id, asset_code, amount, type, note, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, inv.asset, inv.amount, inv.type, inv.note, ago(inv.days)]
      );
    }
  });

  console.log('demo saraf created — email demo@daftar.af, password daftar123');
}

async function main() {
  await seedReferenceData();
  if (process.argv.includes('--demo')) {
    await seedDemo();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
