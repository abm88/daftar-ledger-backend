# Daftar — Ledger Backend

Node.js + PostgreSQL backend for **Daftar**, a ledger app for Afghan sarafs
(money exchangers). It powers everything the app does:

- **Multi-asset cash drawer** — fiat currencies (USD, AFN, PKR, EUR, GBP, SAR,
  AED) and metals (gold/silver in grams, tola display), cash counts, initial
  setup, today's cash movement.
- **Hawala transfers** — issue against counterparty sarafs with percent/fixed
  commissions, sequential 6-digit pickup codes, pending → paid lifecycle,
  cash- or customer-account-funded senders, per-counterparty positions and
  one-tap settlement.
- **Customer accounts** — deposits, withdrawals, charges, credit advances,
  cross-currency intake with conversion metadata, running balances,
  statements and receipts.
- **FX trading** — canonical rate quoting, drawer-stock validation,
  weighted-average cost basis, realized and unrealized P&L, open positions.
- **Owner investments** — opening capital, additions, withdrawals tied to the
  drawer.
- **Rates** — per-asset buy/sell vs AFN with history and derived cross rates.
- **Reports** — P&L (FX + hawala commission + revaluation) by period, unified
  activity feed, dashboard aggregate, exportable ledger statements.

Full endpoint reference: [`docs/API.md`](docs/API.md).

## Architecture

```
src/
├── config/          env config + domain constants
├── db/              pg pool, transaction helper, reference data
├── domain/          pure business rules (positions, FX math, commission) — unit-tested
├── repositories/    SQL data access, one module per aggregate
├── services/        use-cases orchestrating repositories inside transactions
├── controllers/     HTTP request/response mapping
├── routes/          route table + validation wiring
├── middleware/      auth (JWT), zod validation, error handling
└── validators/      request schemas
```

Layering follows the dependency rule: `domain` knows nothing about HTTP or SQL;
`services` depend on repositories and domain; `controllers` only on services.
Multi-step writes (hawala issuance, FX trades, settlements, initial setup) run
inside single database transactions.

Every business row is scoped by `user_id` — one backend serves many sarafs,
each seeing only their own daftar.

## Quick start (Docker)

```bash
docker compose up --build
```

Brings up PostgreSQL 16, runs migrations + reference seeds, and starts the API
on <http://localhost:3000>. Verify: `curl http://localhost:3000/health`.

## Quick start (local Node + Postgres)

```bash
cp .env.example .env          # point PG* at your database
npm install
npm run migrate               # apply migrations/*.sql
npm run seed                  # cities + asset registry (idempotent)
npm run seed:demo             # optional: demo saraf with sample data
npm run dev                   # or: npm start
```

Demo login after `seed:demo`: phone `+93700000001`, password `daftar123`.

### First calls

```bash
# Register a saraf
curl -s -X POST localhost:3000/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"phone":"+93700000002","password":"secret123","name":"Haji Rahmat","shopName":"Sarai Shahzada","cityCode":"KBL"}'

# Authenticated request
TOKEN=...   # from the response above
curl -s localhost:3000/api/v1/cash-drawer -H "authorization: Bearer $TOKEN"
```

## Testing

```bash
npm test        # domain unit tests (node:test, no DB needed)
```

## Deploying to DigitalOcean

### Option A — App Platform (recommended)

1. Push this repo to GitHub and create a **DigitalOcean Managed PostgreSQL**
   cluster (v16).
2. In App Platform, create an app from the repo. The `Dockerfile` is detected
   automatically; the container listens on `$PORT` (set `PORT=3000` or let App
   Platform inject it).
3. Set environment variables:
   - `DATABASE_URL` — the managed database connection string
   - `PGSSLMODE=require`
   - `JWT_SECRET` — long random string (`openssl rand -hex 48`)
   - `NODE_ENV=production`
   - `CORS_ORIGINS` — your app's origin(s)
4. Add a **job** (or one-off console run) executing
   `node scripts/migrate.js && node scripts/seed.js` before first boot and on
   each deploy that ships new migrations.
5. Point the app's health check at `/health`.

### Option B — Droplet

```bash
# on the droplet
git clone <repo> && cd daftar-ledger-backend
cp .env.example .env   # fill in DATABASE_URL / PG*, JWT_SECRET, NODE_ENV=production
docker compose up -d --build      # or: npm ci && npm run migrate && npm run seed && npm start
```

Put nginx (or the DO load balancer) in front for TLS; the app trusts one proxy
hop (`trust proxy`).

## Environment variables

See [`.env.example`](.env.example). `DATABASE_URL` wins over discrete `PG*`
variables; set `PGSSLMODE=require` for DigitalOcean Managed PostgreSQL.

## Domain notes

- **Rates** are quoted "1 asset = N AFN"; AFN is the base. Saving a rate
  captures the previous sell as `prevSell`, which drives unrealized
  revaluation P&L.
- **Counterparty positions** count paid entries only: `send` +, `recv` −,
  `settle` applies its signed delta. Settling writes offsetting entries rather
  than mutating history — the ledger stays append-only.
- **Customer balances**: `opening`/`deposit` credit, `withdrawal`/`charge`/
  `credit` (advance) debit. Positive balance = saraf owes the customer.
- **FX realized P&L** uses a weighted-average cost basis walked over the trade
  history, with AFN leg values snapshotted at trade time so later rate edits
  never rewrite the past.
- **Hawala pickup codes** are 6-digit, sequential per saraf, claimed atomically
  (`000000` is reserved for opening-balance and settlement sentinels).
