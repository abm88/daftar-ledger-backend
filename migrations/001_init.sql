-- Daftar ledger schema — initial migration.
-- Money columns use NUMERIC(20,6): enough precision for AFN cash piles and
-- fractional metal grams alike. All business data is scoped per user (saraf).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive emails

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- Cities used for hawala routing (KBL, HRT, MZR, JAL out of the box).
CREATE TABLE cities (
  code        VARCHAR(8) PRIMARY KEY,
  name        TEXT NOT NULL,
  color       VARCHAR(16) NOT NULL DEFAULT '#A8541A',
  sort_order  INT NOT NULL DEFAULT 0
);

-- Asset registry: fiat currencies (whole units) and metals (grams).
-- AFN is the base — every rate is quoted "1 {asset} = N AFN".
CREATE TABLE assets (
  code            VARCHAR(12) PRIMARY KEY,
  type            VARCHAR(12) NOT NULL CHECK (type IN ('currency', 'metal')),
  name            TEXT NOT NULL,
  pashto_name     TEXT NOT NULL DEFAULT '',
  symbol          VARCHAR(8) NOT NULL,
  decimals        SMALLINT NOT NULL DEFAULT 0,
  emoji           VARCHAR(8) NOT NULL DEFAULT '',
  is_base         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Assets a saraf cannot deactivate (USD, AFN, PKR — core daily flow).
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Whether the asset starts active for a newly registered saraf.
  default_active  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Users (sarafs) and per-user configuration
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            CITEXT,
  phone            VARCHAR(32) NOT NULL,
  password_hash    TEXT NOT NULL,
  name             TEXT NOT NULL,
  shop_name        TEXT NOT NULL DEFAULT '',
  city_code        VARCHAR(8) REFERENCES cities(code),
  registration_no  TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_phone_key ON users (phone);
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE email IS NOT NULL;

-- Saraf-configurable defaults + operational counters.
CREATE TABLE user_settings (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reporting_currency  VARCHAR(12) NOT NULL DEFAULT 'AFN' REFERENCES assets(code),
  trade_currency      VARCHAR(12) NOT NULL DEFAULT 'USD' REFERENCES assets(code),
  -- Next hawala pickup code (6-digit, sequential, zero-padded on display).
  next_hawala_code    BIGINT NOT NULL DEFAULT 100001,
  last_cash_count_at  TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-saraf asset activation (overrides assets.default_active).
CREATE TABLE user_assets (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code  VARCHAR(12) NOT NULL REFERENCES assets(code),
  active      BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, asset_code)
);

-- Current buy/sell rate per asset ("1 asset = N AFN"). prev_sell backs the
-- unrealized revaluation P&L; delta_pct is the % move of sell vs prev_sell.
CREATE TABLE rates (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code  VARCHAR(12) NOT NULL REFERENCES assets(code),
  buy         NUMERIC(20,6) NOT NULL CHECK (buy > 0),
  sell        NUMERIC(20,6) NOT NULL CHECK (sell > 0),
  prev_sell   NUMERIC(20,6),
  delta_pct   NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_code)
);

-- Immutable audit trail of every rate save.
CREATE TABLE rate_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code  VARCHAR(12) NOT NULL REFERENCES assets(code),
  buy         NUMERIC(20,6) NOT NULL,
  sell        NUMERIC(20,6) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rate_history_user_asset_idx ON rate_history (user_id, asset_code, recorded_at DESC);

-- Physical cash drawer (صندوق) — balance per asset. Metals are in grams.
CREATE TABLE cash_drawer (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code  VARCHAR(12) NOT NULL REFERENCES assets(code),
  balance     NUMERIC(20,6) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_code)
);

-- ---------------------------------------------------------------------------
-- Counterparties (fellow sarafs) and hawalas
-- ---------------------------------------------------------------------------

CREATE TABLE counterparties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  initial     VARCHAR(8) NOT NULL DEFAULT '',
  phone       VARCHAR(32) NOT NULL DEFAULT '—',
  city_code   VARCHAR(8) NOT NULL REFERENCES cities(code),
  tier        VARCHAR(12) NOT NULL DEFAULT 'regular' CHECK (tier IN ('core', 'regular')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX counterparties_user_idx ON counterparties (user_id, created_at DESC);

-- Customers holding an account with the saraf.
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  initial     VARCHAR(8) NOT NULL DEFAULT '',
  phone       VARCHAR(32) NOT NULL DEFAULT '—',
  city_code   VARCHAR(8) NOT NULL REFERENCES cities(code),
  color_idx   SMALLINT NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customers_user_idx ON customers (user_id, created_at DESC);

-- Hawala ledger entries against a counterparty.
--   send   → we sent value on their behalf → they owe us    → position +amount
--   recv   → they sent value on our behalf → we owe them    → position −amount
--   settle → offsetting delta written by a settlement       → position +amount (signed)
-- Opening balances and settlements carry the '000000' sentinel code.
CREATE TABLE hawalas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counterparty_id     UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  type                VARCHAR(8) NOT NULL CHECK (type IN ('send', 'recv', 'settle')),
  from_city           VARCHAR(8) NOT NULL REFERENCES cities(code),
  to_city             VARCHAR(8) NOT NULL REFERENCES cities(code),
  sender_name         TEXT NOT NULL DEFAULT '—',
  receiver_name       TEXT NOT NULL DEFAULT '—',
  -- settle rows store a signed delta; send/recv rows are positive amounts.
  amount              NUMERIC(20,6) NOT NULL,
  currency            VARCHAR(12) NOT NULL REFERENCES assets(code),
  commission_mode     VARCHAR(8) NOT NULL DEFAULT 'percent' CHECK (commission_mode IN ('percent', 'fixed')),
  commission_pct      NUMERIC(8,4) NOT NULL DEFAULT 0,
  commission_amount   NUMERIC(20,6) NOT NULL DEFAULT 0,
  code                VARCHAR(6) NOT NULL,
  status              VARCHAR(8) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  -- Set when the hawala was funded from a customer account instead of cash.
  sender_customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
  is_opening          BOOLEAN NOT NULL DEFAULT FALSE,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);

CREATE INDEX hawalas_user_idx ON hawalas (user_id, created_at DESC);
CREATE INDEX hawalas_cp_idx ON hawalas (counterparty_id, created_at DESC);
CREATE INDEX hawalas_status_idx ON hawalas (user_id, status) WHERE status = 'pending';
CREATE INDEX hawalas_code_idx ON hawalas (user_id, code);

-- ---------------------------------------------------------------------------
-- Customer account transactions
-- ---------------------------------------------------------------------------

-- Balance semantics (positive balance = saraf owes the customer):
--   opening / deposit            → +amount
--   withdrawal / charge / credit → −amount
CREATE TABLE customer_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type         VARCHAR(12) NOT NULL
               CHECK (type IN ('opening', 'deposit', 'withdrawal', 'charge', 'credit')),
  amount       NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  currency     VARCHAR(12) NOT NULL REFERENCES assets(code),
  note         TEXT NOT NULL DEFAULT '',
  -- Set when this entry was generated by an account-funded hawala.
  hawala_id    UUID REFERENCES hawalas(id) ON DELETE SET NULL,
  -- Cross-currency intake metadata:
  -- { receivedAmount, receivedCurrency, rate, creditedAmount, creditedCurrency }
  conversion   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX customer_transactions_customer_idx
  ON customer_transactions (customer_id, created_at ASC);
CREATE INDEX customer_transactions_user_idx
  ON customer_transactions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- FX trades and owner investments
-- ---------------------------------------------------------------------------

-- Currency exchange trades. side = buy when acquiring a non-AFN asset with AFN,
-- sell when disposing of a held non-AFN asset. realized_pl (in AFN) is computed
-- at trade time from the weighted-average cost basis; null for acquisitions.
-- from_afn_value / to_afn_value snapshot the AFN value of each leg at trade
-- time so cost bases stay deterministic regardless of later rate edits.
CREATE TABLE fx_trades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side           VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  from_currency  VARCHAR(12) NOT NULL REFERENCES assets(code),
  to_currency    VARCHAR(12) NOT NULL REFERENCES assets(code),
  from_amount    NUMERIC(20,6) NOT NULL CHECK (from_amount > 0),
  to_amount      NUMERIC(20,6) NOT NULL CHECK (to_amount > 0),
  rate           NUMERIC(20,8) NOT NULL CHECK (rate > 0),
  from_afn_value NUMERIC(20,6) NOT NULL DEFAULT 0,
  to_afn_value   NUMERIC(20,6) NOT NULL DEFAULT 0,
  realized_pl    NUMERIC(20,6),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency)
);

CREATE INDEX fx_trades_user_idx ON fx_trades (user_id, created_at ASC);

-- Owner equity movements: opening capital, later additions, withdrawals.
-- Each entry also moves the cash drawer for its asset.
CREATE TABLE investments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_code  VARCHAR(12) NOT NULL REFERENCES assets(code),
  amount      NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  type        VARCHAR(12) NOT NULL CHECK (type IN ('opening', 'addition', 'withdrawal')),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX investments_user_idx ON investments (user_id, created_at DESC);
