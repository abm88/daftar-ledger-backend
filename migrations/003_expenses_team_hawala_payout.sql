-- Prototype v20: team members, per-person expenses, a two-phase receive
-- lifecycle for hawalas, and photo attachments on customer transactions.

-- ---------------------------------------------------------------------------
-- Team members (ټیم) — partners and staff the saraf records expenses against.
-- Per-user, resettable data: blank for a newly registered saraf.
-- ---------------------------------------------------------------------------
CREATE TABLE team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        VARCHAR(16) NOT NULL DEFAULT 'Staff'
              CHECK (role IN ('Partner', 'Owner', 'Cashier', 'Runner', 'Staff')),
  phone       VARCHAR(32) NOT NULL DEFAULT '',
  initial     VARCHAR(8) NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX team_members_user_idx ON team_members (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Expenses (ورداشتونه) — business costs, each recorded against a team member.
-- `category`/`against` from earlier prototypes are deprecated: an expense is
-- identified by its team member and free-text note only. Expenses appear in
-- the ledger/activity feed as outflows but never move the cash drawer.
-- ---------------------------------------------------------------------------
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_member_id  UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  amount          NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  currency        VARCHAR(12) NOT NULL REFERENCES assets(code),
  note            TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX expenses_user_idx ON expenses (user_id, created_at DESC);
CREATE INDEX expenses_member_idx ON expenses (team_member_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Hawala payout metadata. A received hawala is recorded as `pending` with zero
-- financial impact and only moves to `paid` when it is paid out:
--   cash    → status paid, paid_at stamped, no account entry
--   account → status paid, plus a deposit of (amount − fee) to the chosen
--             customer, linked via hawala_id; payout_customer_id records who.
-- `paid_at` (already present) is the payout timestamp (paidOutTs).
-- ---------------------------------------------------------------------------
ALTER TABLE hawalas
  ADD COLUMN payout_method       VARCHAR(8)
    CHECK (payout_method IS NULL OR payout_method IN ('cash', 'account')),
  ADD COLUMN payout_customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Customer transaction photo attachments (You Received / You Gave). `photos`
-- holds an array of image data URLs / URLs; the legacy single `photo` scalar is
-- kept for backward compatibility and folded into `photos` on read.
-- ---------------------------------------------------------------------------
ALTER TABLE customer_transactions
  ADD COLUMN photos  JSONB,
  ADD COLUMN photo   TEXT;
