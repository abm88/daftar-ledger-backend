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

Jump to: [Architecture](#architecture) · [Quick start](#quick-start-docker) ·
[**API documentation**](#api-documentation) · [Deployment](#deploying-to-digitalocean) ·
[Domain notes](#domain-notes)

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

Demo login after `seed:demo`: email `demo@daftar.af`, password `daftar123`.

## Testing

```bash
npm test        # domain unit tests (node:test, no DB needed)
```

---

# API Documentation

**Base URL:** `/api/v1` (the exception is `GET /health`, which sits at the
root). All request and response bodies are JSON
(`Content-Type: application/json`).

### Authentication

Register or log in with **email + password** to receive a JWT, then send it
on every other call:

```
Authorization: Bearer <token>
```

Each token is bound to a server-side session; `POST /auth/logout` revokes
that session, so a signed-out token is rejected even before its JWT expiry.

Only `POST /auth/register`, `POST /auth/login`, `GET /cities`, and
`GET /health` are public. Every business resource is scoped to the
authenticated saraf — users can never see or touch each other's data.

### Error format

All errors share one shape. `details` appears on validation failures.

```json
{
  "error": {
    "message": "Validation failed",
    "details": [{ "path": "amount", "message": "Number must be greater than 0" }]
  }
}
```

| Status | Meaning |
|---|---|
| `400` | Malformed request / failed validation |
| `401` | Missing, invalid, or signed-out token; bad credentials |
| `404` | Resource not found (or belongs to another saraf) |
| `409` | Conflict (duplicate phone/email, hawala already paid) |
| `422` | Business rule violation (insufficient balance, inactive asset, …) |
| `500` | Unexpected server error |

### Pagination

List endpoints that page accept `?limit=` (default 50, max 200) and
`?offset=` (default 0) and return:

```json
{ "items": [ ... ], "pagination": { "total": 12, "limit": 50, "offset": 0, "hasMore": false } }
```

### Endpoint index

| Group | Endpoints |
|---|---|
| [Health](#health) | `GET /health` |
| [Auth](#auth) | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `PUT /auth/me` · `PUT /auth/me/password` |
| [Cities](#cities) | `GET /cities` |
| [Assets](#assets) | `GET /assets` · `PATCH /assets/:code/activation` |
| [Rates](#rates) | `GET /rates` · `PUT /rates` · `GET /rates/history` |
| [Cash drawer](#cash-drawer) | `GET /cash-drawer` · `PUT /cash-drawer/count` · `POST /cash-drawer/initial-setup` · `GET /cash-drawer/today-movement` |
| [Counterparties](#counterparties) | `GET /counterparties` · `POST /counterparties` · `GET /counterparties/:id` · `PUT /counterparties/:id` · `DELETE /counterparties/:id` · `GET /counterparties/:id/hawalas` · `POST /counterparties/:id/settle` · `GET /counterparties/:id/statement` |
| [Hawalas](#hawalas) | `GET /hawalas` · `GET /hawalas/pending` · `GET /hawalas/next-code` · `POST /hawalas` · `GET /hawalas/:id` · `POST /hawalas/:id/mark-paid` |
| [Customers](#customers) | `GET /customers` · `POST /customers` · `GET /customers/:id` · `PUT /customers/:id` · `DELETE /customers/:id` · `GET /customers/:id/transactions` · `POST /customers/:id/transactions` · `GET /customers/:id/statement` |
| [Transactions](#transactions) | `GET /transactions/:id` · `DELETE /transactions/:id` · `GET /transactions/:id/receipt` |
| [FX trades](#fx-trades) | `GET /fx/trades` · `POST /fx/trades` · `GET /fx/positions` |
| [Investments](#investments) | `GET /investments` · `POST /investments` |
| [Settings](#settings) | `GET /settings` · `PUT /settings` |
| [Reports](#reports) | `GET /reports/dashboard` · `GET /reports/pnl` · `GET /reports/activity` · `GET /reports/ledger-statement` |

---

## Health

### `GET /health`

Liveness probe including database connectivity. Public, not under `/api/v1`.

**Response `200`** (`503` with `"status": "degraded"` when the DB is down):

```json
{ "status": "ok", "database": "up" }
```

---

## Auth

### `POST /auth/register`

Creates a saraf account and provisions everything a fresh shop needs:
settings, per-asset activation flags, a zeroed cash drawer, and starting
rates. Signing up also starts a session — the returned token is ready to
use immediately. Public.

**Payload** — `email` (unique, case-insensitive), `password` (min 6 chars),
and `name` are required, matching the app's signup screen; the rest is
optional profile data that can also be added later via `PUT /auth/me`:

```json
{
  "email": "rahmat@example.af",
  "password": "secret123",
  "name": "Haji Rahmat",
  "phone": "+93700000002",
  "shopName": "Sarai Shahzada",
  "cityCode": "KBL",
  "registrationNo": "AFG-0421"
}
```

**Response `201`** (`409` if the email — or phone, when provided — is
already registered):

```json
{
  "user": {
    "id": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
    "email": "rahmat@example.af",
    "phone": "+93700000002",
    "name": "Haji Rahmat",
    "shopName": "Sarai Shahzada",
    "cityCode": "KBL",
    "registrationNo": "AFG-0421",
    "createdAt": "2026-07-08T14:25:49.122Z",
    "updatedAt": "2026-07-08T14:25:49.122Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### `POST /auth/login`

Log in with `email` + `password`. Public.

**Payload:**

```json
{ "email": "rahmat@example.af", "password": "secret123" }
```

**Response `200`** — same `{ user, token }` shape as register. `401` with a
deliberately vague `"Email or password is incorrect"` on bad credentials
(never reveals whether the email exists).

### `POST /auth/logout`

Signs out the presented token by revoking its server-side session. The
token stops working immediately, even though the JWT itself has not
expired. Idempotent — signing out twice is fine.

**Response `200`:**

```json
{ "message": "Signed out" }
```

### `GET /auth/me`

Current saraf's profile.

**Response `200`:** `{ "user": { ...same user shape as register... } }`

### `PUT /auth/me`

Updates profile fields. All optional; only provided fields change.

**Payload:**

```json
{ "name": "Haji Rahmat", "shopName": "Sarai Shahzada — Kabul", "cityCode": "KBL", "registrationNo": "AFG-0421", "email": "new@example.af", "phone": "+93700000002" }
```

**Response `200`:** `{ "user": { ...updated user... } }`

### `PUT /auth/me/password`

Changes the password (min 6 chars) and signs out every other active
session; only the session that made the change stays valid.

**Payload:**

```json
{ "currentPassword": "secret123", "newPassword": "secret456" }
```

**Response `200`** (`401` when the current password is wrong):

```json
{ "message": "Password updated" }
```

---

## Cities

### `GET /cities`

Hawala routing cities. Public.

**Response `200`:**

```json
{
  "cities": [
    { "code": "KBL", "name": "Kabul", "color": "#A8541A", "sortOrder": 1 },
    { "code": "HRT", "name": "Herat", "color": "#2E6B4E", "sortOrder": 2 },
    { "code": "MZR", "name": "Mazar", "color": "#7B3D14", "sortOrder": 3 },
    { "code": "JAL", "name": "Jalalabad", "color": "#B89447", "sortOrder": 4 }
  ]
}
```

---

## Assets

Currencies are whole-unit fiat; metals are tracked in **grams** and carry
`tolaGrams` (11.6638) for tola display. AFN is the base asset every rate is
quoted against. USD, AFN, and PKR are core (`isDefault: true`) and cannot be
deactivated.

### `GET /assets`

The full registry with this saraf's `active` flag per asset.

**Response `200`** (array of 9; two shown):

```json
{
  "assets": [
    {
      "code": "USD", "type": "currency", "name": "US Dollar", "pashtoName": "ډالر",
      "symbol": "$", "decimals": 2, "emoji": "🇺🇸",
      "isBase": false, "isDefault": true, "sortOrder": 1, "active": true
    },
    {
      "code": "GOLD", "type": "metal", "name": "Gold", "pashtoName": "طلا",
      "symbol": "g", "decimals": 2, "emoji": "🟡",
      "isBase": false, "isDefault": false, "sortOrder": 8, "active": false,
      "tolaGrams": 11.6638
    }
  ]
}
```

### `PATCH /assets/:code/activation`

Activates or deactivates an asset for this saraf.

**Payload:**

```json
{ "active": true }
```

**Response `200`** (`422` when deactivating a core asset, `404` unknown code):

```json
{
  "asset": {
    "code": "GOLD", "type": "metal", "name": "Gold", "pashtoName": "طلا",
    "symbol": "g", "decimals": 2, "emoji": "🟡",
    "isBase": false, "isDefault": false, "sortOrder": 8, "active": true
  }
}
```

---

## Rates

Rates are quoted **"1 asset = N AFN"** with independent `buy` and `sell`.
Saving a rate moves the prior sell into `prevSell` (which drives revaluation
P&L), records the % move in `deltaPct`, and appends an immutable history row.
Cross rates between active non-AFN currencies are derived through AFN.

### `GET /rates`

**Response `200`:**

```json
{
  "rates": [
    { "assetCode": "USD", "buy": 71.2, "sell": 71.9, "prevSell": 71.8, "deltaPct": 0.139276, "updatedAt": "2026-07-08T14:25:49.597Z" },
    { "assetCode": "AFN", "buy": 1, "sell": 1, "prevSell": 1, "deltaPct": 0 },
    { "assetCode": "PKR", "buy": 0.245, "sell": 0.252, "prevSell": 0.25, "deltaPct": 0.8, "updatedAt": "2026-07-08T14:25:49.122Z" },
    { "assetCode": "GOLD", "buy": 5700, "sell": 5800, "prevSell": 5750, "deltaPct": 0.869565, "updatedAt": "2026-07-08T14:25:49.597Z" }
  ],
  "crosses": [
    { "pair": "USD_PKR", "buy": 290.612245, "sell": 285.31746 }
  ]
}
```

### `PUT /rates`

Bulk-saves buy/sell for one or more assets.

**Payload:**

```json
{
  "rates": {
    "USD":  { "buy": 71.2,  "sell": 71.9 },
    "GOLD": { "buy": 5700,  "sell": 5800 }
  }
}
```

**Response `200`** (`422` for AFN — the base is fixed at 1 — or non-positive
values):

```json
{
  "rates": [
    { "assetCode": "USD", "buy": 71.2, "sell": 71.9, "prevSell": 71.8, "deltaPct": 0.139276, "updatedAt": "2026-07-08T14:25:49.597Z" },
    { "assetCode": "GOLD", "buy": 5700, "sell": 5800, "prevSell": 5750, "deltaPct": 0.869565, "updatedAt": "2026-07-08T14:25:49.597Z" }
  ]
}
```

### `GET /rates/history?asset=USD&limit=100`

Audit trail of rate saves, newest first. Both query params optional
(`asset` filters to one code; `limit` max 500).

**Response `200`:**

```json
{
  "history": [
    { "assetCode": "USD", "buy": 71.2, "sell": 71.9, "recordedAt": "2026-07-08T14:25:49.597Z" }
  ]
}
```

---

## Cash drawer

The saraf's physical cash (صندوق), one balance per asset.

### `GET /cash-drawer`

Full snapshot: per-asset balance, AFN and reporting-currency equivalents,
tola for metals, revaluation P&L from the last rate move, and totals.

**Response `200`:**

```json
{
  "items": [
    { "assetCode": "USD", "type": "currency", "name": "US Dollar", "symbol": "$", "decimals": 2,
      "balance": 12400, "afnValue": 891560, "reportingValue": 891560, "revaluationAfn": 1240 },
    { "assetCode": "AFN", "type": "currency", "name": "Afghani", "symbol": "؋", "decimals": 0,
      "balance": 1850000, "afnValue": 1850000, "reportingValue": 1850000, "revaluationAfn": 0 },
    { "assetCode": "GOLD", "type": "metal", "name": "Gold", "symbol": "g", "decimals": 2,
      "balance": 116.638, "tola": 10, "afnValue": 676500.4, "reportingValue": 676500.4, "revaluationAfn": 5831.9 }
  ],
  "totals": {
    "afn": 3525160.4,
    "reporting": 3525160.4,
    "reportingCurrency": "AFN",
    "revaluationAfn": 7921.9
  },
  "lastCountAt": "2026-07-08T14:25:49.641Z"
}
```

### `PUT /cash-drawer/count`

Records a cash count — sets **absolute** balances for the assets provided.
Assets left out stay untouched, so partial counts are fine. Updates
`lastCountAt`.

**Payload:**

```json
{ "counts": { "USD": 12400, "AFN": 1850000 } }
```

**Response `200`:** the full drawer snapshot (same shape as `GET /cash-drawer`).
`422` for negative counts or inactive assets.

### `POST /cash-drawer/initial-setup`

First-run flow: sets opening drawer balances **and** records each amount as an
`opening` investment entry.

**Payload** (only positive amounts):

```json
{ "amounts": { "USD": 12450, "AFN": 1850000, "PKR": 425000, "GOLD": 116.638 } }
```

**Response `201`:** the full drawer snapshot.

### `GET /cash-drawer/today-movement`

Today's physical cash flow per asset: customer deposits in, withdrawals and
charges out, FX from-leg out / to-leg in. Account-funded hawala debits are
excluded (no cash moved).

**Response `200`:**

```json
{
  "movement": [
    { "assetCode": "USD", "inflow": 12700, "outflow": 2000, "net": 10700 },
    { "assetCode": "AFN", "inflow": 215900, "outflow": 72000, "net": 143900 },
    { "assetCode": "PKR", "inflow": 0, "outflow": 0, "net": 0 }
  ]
}
```

---

## Counterparties

Fellow sarafs the shop exchanges hawalas with. **Positions** are per-currency
open balances computed from *paid* ledger entries: `send` +amount (they owe
us), `recv` −amount (we owe them), `settle` applies its signed delta. Pending
hawalas don't move positions until paid.

### `GET /counterparties?search=`

All counterparties with positions. `search` (optional) matches name/short name.

**Response `200`:**

```json
{
  "counterparties": [
    {
      "id": "33c63456-e871-4c0e-8daf-40da5e1b8008",
      "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
      "name": "Sarai Qandahari — Agha Naseem",
      "shortName": "A. Naseem",
      "initial": "ن",
      "phone": "+93 70 000 5678",
      "cityCode": "HRT",
      "tier": "core",
      "createdAt": "2026-07-08T14:25:49.656Z",
      "updatedAt": "2026-07-08T14:25:49.656Z",
      "positions": { "USD": 2000, "AFN": -50000, "PKR": 0, "GOLD": 0 }
    }
  ]
}
```

### `POST /counterparties`

Creates a counterparty. `openingBalances` is a **signed** map: positive =
they owe us, negative = we owe them; each becomes a paid sentinel ledger
entry (code `000000`, `isOpening: true`).

**Payload** — `name` and `cityCode` required:

```json
{
  "name": "Sarai Qandahari — Agha Naseem",
  "shortName": "A. Naseem",
  "initial": "ن",
  "phone": "+93 70 000 5678",
  "cityCode": "HRT",
  "tier": "core",
  "openingBalances": { "USD": 2000, "AFN": -50000 }
}
```

**Response `201`:**

```json
{
  "counterparty": {
    "id": "33c63456-e871-4c0e-8daf-40da5e1b8008",
    "name": "Sarai Qandahari — Agha Naseem",
    "shortName": "A. Naseem",
    "initial": "ن",
    "phone": "+93 70 000 5678",
    "cityCode": "HRT",
    "tier": "core",
    "createdAt": "2026-07-08T14:25:49.656Z",
    "updatedAt": "2026-07-08T14:25:49.656Z",
    "positions": { "USD": 2000, "AFN": -50000, "PKR": 0, "GOLD": 0 },
    "hawalaCount": 2
  }
}
```

### `GET /counterparties/:id`

Detail with positions and hawala count — same shape as the create response.
`404` if not found or owned by another saraf.

### `PUT /counterparties/:id`

Partial update of `name`, `shortName`, `initial`, `phone`, `cityCode`, `tier`.

**Payload:**

```json
{ "tier": "regular", "phone": "+93 70 000 9999" }
```

**Response `200`:** the updated counterparty (same shape as `GET`).

### `DELETE /counterparties/:id`

Removes the counterparty and its hawala history. **Response `204`** (no body).

### `GET /counterparties/:id/hawalas`

The counterparty's full ledger, chronological (includes opening-balance and
settlement sentinel entries).

**Response `200`:** `{ "hawalas": [ ...hawala objects, see Hawalas... ] }`

### `POST /counterparties/:id/settle`

Settles up: writes an offsetting `settle` entry per open currency position,
zeroing the balance. History is never mutated — the ledger stays append-only.

**Payload** (both optional):

```json
{ "settleCurrency": "USD", "note": "Monthly settlement" }
```

**Response `201`** (`422` when no position is open):

```json
{
  "counterpartyId": "33c63456-e871-4c0e-8daf-40da5e1b8008",
  "settled": [
    { "currency": "USD", "clearedPosition": 7000 },
    { "currency": "AFN", "clearedPosition": -50000 }
  ]
}
```

### `GET /counterparties/:id/statement?from=&to=`

Printable statement data. `from`/`to` (ISO dates, optional) window the
entries; positions always reflect the full history.

**Response `200`:**

```json
{
  "counterparty": { "id": "33c63456-…", "name": "Sarai Qandahari — Agha Naseem", "...": "…" },
  "entries": [ { "...": "hawala objects, chronological" } ],
  "positions": { "USD": 0, "AFN": 0, "PKR": 0, "GOLD": 0 },
  "generatedAt": "2026-07-08T14:25:49.860Z"
}
```

---

## Hawalas

A hawala ledger entry. `type` is `send` (value sent on the counterparty's
behalf) or `recv` (received on ours); `settle` rows are system-written by
settlements. Pickup `code`s are 6-digit, sequential per saraf, claimed
atomically (`000000` is reserved for sentinels).

**The hawala object** (returned everywhere):

```json
{
  "id": "b7d2e9ef-b703-4142-800d-14ce6d35eb37",
  "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
  "counterpartyId": "33c63456-e871-4c0e-8daf-40da5e1b8008",
  "type": "send",
  "fromCity": "KBL",
  "toCity": "HRT",
  "senderName": "Mirwais Khan",
  "receiverName": "Abdul Rahman",
  "amount": 5000,
  "currency": "USD",
  "commissionMode": "percent",
  "commissionPct": 1,
  "commissionAmount": 50,
  "code": "100001",
  "status": "pending",
  "senderCustomerId": null,
  "isOpening": false,
  "note": "",
  "createdAt": "2026-07-08T14:25:49.733Z",
  "paidAt": null,
  "counterpartyName": "Sarai Qandahari — Agha Naseem",
  "counterpartyShortName": "A. Naseem",
  "counterpartyCity": "HRT"
}
```

### `GET /hawalas`

Filterable, paginated ledger.

| Query param | Description |
|---|---|
| `status` | `pending` \| `paid` |
| `currency` | asset code, e.g. `USD` |
| `counterpartyId` | UUID |
| `search` | matches sender name, receiver name, or exact code |
| `includeOpening` | `true` to include opening-balance sentinels (default excluded) |
| `limit`, `offset` | pagination |

**Response `200`:**

```json
{
  "items": [ { "...": "hawala objects, newest first" } ],
  "pagination": { "total": 1, "limit": 50, "offset": 0, "hasMore": false }
}
```

### `GET /hawalas/pending`

Pending pickups, newest first: `{ "hawalas": [ ... ] }`

### `GET /hawalas/next-code`

Peeks the next pickup code for form pre-fill — does **not** claim it.

**Response `200`:**

```json
{ "code": "100001" }
```

### `POST /hawalas`

Issues a hawala (status `pending`).

**Payload — cash-funded sender** (walk-in pays at the counter):

```json
{
  "type": "send",
  "counterpartyId": "33c63456-e871-4c0e-8daf-40da5e1b8008",
  "fromCity": "KBL",
  "toCity": "HRT",
  "amount": 5000,
  "currency": "USD",
  "receiverName": "Abdul Rahman",
  "senderMode": "cash",
  "senderName": "Mirwais Khan",
  "commissionMode": "percent",
  "commissionPct": 1.0,
  "note": ""
}
```

**Payload — account-funded sender with a fixed fee** (debited from a customer
account):

```json
{
  "type": "send",
  "counterpartyId": "33c63456-e871-4c0e-8daf-40da5e1b8008",
  "fromCity": "KBL",
  "toCity": "HRT",
  "amount": 2000,
  "currency": "USD",
  "receiverName": "Karim Shah",
  "senderMode": "account",
  "senderCustomerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
  "commissionMode": "fixed",
  "commissionFixed": 35
}
```

Rules:

- `senderMode: "cash"` requires `senderName`; `"account"` requires
  `senderCustomerId` (the sender name resolves to the customer's name).
- Account mode validates the customer holds `amount + commission` in the
  hawala currency (0.5 tolerance) — `422` otherwise — and writes a linked
  `withdrawal` on their account for the debit total, tagged with `hawalaId`.
- `commissionMode: "percent"` uses `commissionPct` (default 1.0);
  `"fixed"` requires `commissionFixed`, a fee in the hawala currency.
- `type` is `send` or `recv`. Cities must exist in `/cities`.

**Response `201`:** `{ "hawala": { ... } }` — the account-funded example
returns:

```json
{
  "hawala": {
    "id": "2c15cdad-0dd4-4c11-8c39-b859c55e804c",
    "type": "send",
    "senderName": "Haji Dawood",
    "receiverName": "Karim Shah",
    "amount": 2000,
    "currency": "USD",
    "commissionMode": "fixed",
    "commissionPct": 0,
    "commissionAmount": 35,
    "code": "100002",
    "status": "pending",
    "senderCustomerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
    "...": "…full hawala object"
  }
}
```

### `GET /hawalas/:id`

Single hawala with counterparty info: `{ "hawala": { ... } }`

### `POST /hawalas/:id/mark-paid`

The recipient collected the money — flips `pending` → `paid`, stamps
`paidAt`, and the amount starts counting in counterparty positions and
commission P&L. No payload.

**Response `200`** (`409` when already paid):

```json
{ "hawala": { "...": "…", "status": "paid", "paidAt": "2026-07-08T14:25:49.751Z" } }
```

---

## Customers

Account holders at the shop. **Balances** are per-currency; positive = the
saraf owes the customer. `opening`/`deposit` credit (+); `withdrawal` /
`charge` (paid on their behalf) / `credit` (advance given) debit (−).

### `GET /customers?search=&city=`

**Response `200`:**

```json
{
  "customers": [
    {
      "id": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
      "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
      "name": "Haji Dawood",
      "shortName": "Dawood",
      "initial": "د",
      "phone": "+93 70 100 2345",
      "cityCode": "KBL",
      "colorIdx": 0,
      "notes": "Timber importer, monthly account",
      "openedAt": "2026-07-08T14:25:49.683Z",
      "createdAt": "2026-07-08T14:25:49.683Z",
      "updatedAt": "2026-07-08T14:25:49.683Z",
      "balances": { "USD": 8500, "AFN": 0, "PKR": 0, "GOLD": 0 },
      "transactionCount": 1
    }
  ]
}
```

### `POST /customers`

Opens an account. `openingBalances` (positive amounts) become `opening`
deposit entries.

**Payload** — `name` and `cityCode` required:

```json
{
  "name": "Haji Dawood",
  "shortName": "Dawood",
  "initial": "د",
  "phone": "+93 70 100 2345",
  "cityCode": "KBL",
  "notes": "Timber importer, monthly account",
  "openingBalances": { "USD": 8500 }
}
```

**Response `201`:** `{ "customer": { ...same shape as list item... } }`

### `GET /customers/:id`

Detail with balances — same shape as the list item. `404` if not yours.

### `PUT /customers/:id`

Partial update of `name`, `shortName`, `initial`, `phone`, `cityCode`, `notes`.

**Payload:** `{ "notes": "Timber importer — monthly settlement" }`
**Response `200`:** the updated customer.

### `DELETE /customers/:id`

Closes the account and its transaction history. **Response `204`.**

### `GET /customers/:id/transactions`

Chronological entries annotated with the running balance (in each entry's own
currency) before and after it.

**Response `200`:**

```json
{
  "transactions": [
    {
      "id": "3568629a-9065-485d-9988-e98a36696384",
      "customerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
      "type": "opening",
      "amount": 8500,
      "currency": "USD",
      "note": "Opening deposit",
      "hawalaId": null,
      "conversion": null,
      "createdAt": "2026-07-08T14:25:49.683Z",
      "balanceBefore": 0,
      "balanceAfter": 8500
    }
  ]
}
```

### `POST /customers/:id/transactions`

Records a `deposit`, `withdrawal`, `charge`, or `credit` (opening entries are
created with the account and can't be posted here).

**Payload — plain:**

```json
{ "type": "deposit", "amount": 3200, "currency": "USD", "note": "Cash deposit" }
```

**Payload — cross-currency intake** ("received 1,000 USD, credit the account
in AFN at 71.9"):

```json
{
  "type": "deposit",
  "amount": 1000,
  "currency": "USD",
  "conversion": { "toCurrency": "AFN", "rate": 71.9 }
}
```

**Response `201`** — the conversion example credits `amount × rate` in the
target currency and keeps the original intake as metadata:

```json
{
  "transaction": {
    "id": "1123e87c-3632-4897-9e00-236e0dc62bc2",
    "customerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
    "type": "deposit",
    "amount": 71900,
    "currency": "AFN",
    "note": "Received 1000 USD @ 71.9 → AFN",
    "hawalaId": null,
    "conversion": {
      "receivedAmount": 1000,
      "receivedCurrency": "USD",
      "rate": 71.9,
      "creditedAmount": 71900,
      "creditedCurrency": "AFN"
    },
    "createdAt": "2026-07-08T14:25:49.711Z",
    "customerName": "Haji Dawood",
    "customerShortName": "Dawood",
    "customerCity": "KBL",
    "balanceBefore": 0,
    "balanceAfter": 71900
  }
}
```

### `GET /customers/:id/statement?from=&to=`

Statement data: windowed entries with running balances, per-currency
credit/debit totals, and closing balances over the full history.

**Response `200`:**

```json
{
  "customer": { "id": "4fac4aa5-…", "name": "Haji Dawood", "...": "…" },
  "entries": [ { "...": "transactions with balanceBefore/balanceAfter" } ],
  "closingBalances": { "USD": 9665, "AFN": 71900, "PKR": 0, "GOLD": 0 },
  "totals": {
    "USD": { "credits": 11700, "debits": 2035 },
    "AFN": { "credits": 71900, "debits": 0 }
  },
  "generatedAt": "2026-07-08T14:25:49.844Z"
}
```

---

## Transactions

Direct access to individual customer transactions.

### `GET /transactions/:id`

Entry detail with customer info and running balance before/after.

**Response `200`:**

```json
{
  "transaction": {
    "id": "0bea2683-4320-4233-bb51-02e3838d4829",
    "customerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea",
    "type": "deposit",
    "amount": 3200,
    "currency": "USD",
    "note": "Cash deposit",
    "hawalaId": null,
    "conversion": null,
    "createdAt": "2026-07-08T14:25:49.705Z",
    "customerName": "Haji Dawood",
    "customerShortName": "Dawood",
    "customerCity": "KBL",
    "balanceBefore": 8500,
    "balanceAfter": 11700
  }
}
```

### `DELETE /transactions/:id`

Deletes an entry (the app's swipe-to-delete). Later balances recompute
automatically since balances are always derived from the ledger.

**Response `200`:**

```json
{ "deleted": true, "customerId": "4fac4aa5-9b6f-468b-bf09-5aa58009e9ea" }
```

### `GET /transactions/:id/receipt`

Plain-text receipt in the app's share format, plus the full transaction.

**Response `200`:**

```json
{
  "receipt": "Daftar — You Received\nHaji Dawood\n+3200 USD\n2026-07-08T14:25:49.705Z\nCash deposit\nNew balance: +11700 USD",
  "transaction": { "...": "…same shape as GET /transactions/:id" }
}
```

---

## FX trades

Currency exchange with correct P&L accounting.

**Rate convention:** the rate is always quoted canonically — "1 {pair base} =
N {quote}" — where the pair base is the asset with the lower registry sort
order (USD < AFN < PKR < EUR < …). The server derives `toAmount` (multiplies
when the from-leg is the base, divides otherwise), so `USD→AFN, 2000 @ 72`
and `AFN→USD, 144000 @ 72` are both valid and symmetric.

### `POST /fx/trades`

Executes an exchange in one transaction: validates drawer stock
(`fromAmount ≤ balance + 0.5`, else `422`), snapshots the AFN value of both
legs at today's rates, computes realized P&L on disposals, and moves both
drawer legs.

- `side` is derived: `AFN→X` is a **buy** (acquisition, `realizedPl: null`);
  `X→anything` is a **sell**.
- Sell P&L = proceeds (AFN) − cost of the disposed lot. The lot is costed at
  the **weighted average** of prior FX buys; any portion not covered by trade
  history (stock that entered via initial setup or investments) is costed at
  the current market rate, so only the spread vs market is realized.

**Payload:**

```json
{ "fromCurrency": "USD", "toCurrency": "AFN", "fromAmount": 2000, "rate": 72, "note": "Walk-in exchange" }
```

**Response `201`:**

```json
{
  "trade": {
    "id": "0c320684-42ef-48df-b268-3744abbcd5b5",
    "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
    "side": "sell",
    "fromCurrency": "USD",
    "toCurrency": "AFN",
    "fromAmount": 2000,
    "toAmount": 144000,
    "rate": 72,
    "fromAfnValue": 143800,
    "toAfnValue": 144000,
    "realizedPl": 200,
    "note": "Walk-in exchange",
    "createdAt": "2026-07-08T14:28:04.954Z",
    "pairBase": "USD"
  }
}
```

### `GET /fx/trades?limit=&offset=`

Trade ledger, newest first, paginated.

**Response `200`:**

```json
{
  "items": [
    {
      "id": "772072b7-68f6-41ab-bbe7-13fb774618ca",
      "side": "sell",
      "fromCurrency": "PKR",
      "toCurrency": "AFN",
      "fromAmount": 100000,
      "toAmount": 28100,
      "rate": 0.281,
      "fromAfnValue": 25200,
      "toAfnValue": 28100,
      "realizedPl": 100,
      "note": "Morning exchange",
      "createdAt": "2026-07-06T11:45:12.730Z"
    }
  ],
  "pagination": { "total": 4, "limit": 1, "offset": 0, "hasMore": true }
}
```

### `GET /fx/positions`

Open FX position per non-AFN currency: quantity from the trade history,
weighted-average cost, market rate/value, unrealized P&L. Negative `qty`
renders as a short position in the app.

**Response `200`:**

```json
{
  "positions": [
    {
      "currency": "USD",
      "qty": 3000,
      "avgCostAfn": 71.064,
      "marketRateAfn": 71.8,
      "marketValueAfn": 215400,
      "unrealizedPlAfn": 2208,
      "totalCostAfn": 213192
    }
  ]
}
```

---

## Investments

Owner equity movements. Each entry also moves the cash drawer: `opening` and
`addition` put cash in, `withdrawal` takes it out.

### `POST /investments`

**Payload:**

```json
{ "assetCode": "USD", "amount": 3000, "type": "addition", "note": "Top-up from personal savings" }
```

**Response `201`** (`422` for inactive assets):

```json
{
  "investment": {
    "id": "ce453308-527b-4e64-9909-089ca55c18f1",
    "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
    "assetCode": "USD",
    "amount": 3000,
    "type": "addition",
    "note": "Top-up from personal savings",
    "createdAt": "2026-07-08T14:25:49.777Z"
  }
}
```

### `GET /investments`

All entries (newest first) plus per-asset totals and the net total in the
reporting currency.

**Response `200`:**

```json
{
  "entries": [
    { "id": "ce453308-…", "assetCode": "USD", "amount": 3000, "type": "addition", "note": "Top-up from personal savings", "createdAt": "2026-07-08T14:25:49.777Z" },
    { "id": "b1492de7-…", "assetCode": "USD", "amount": 12450, "type": "opening", "note": "Initial setup · US Dollar", "createdAt": "2026-07-08T14:25:49.619Z" }
  ],
  "perAsset": {
    "USD": { "invested": 15450, "withdrawn": 0, "net": 15450, "count": 2 },
    "AFN": { "invested": 1850000, "withdrawn": 0, "net": 1850000, "count": 1 }
  },
  "totals": { "netReporting": 3744455.4, "reportingCurrency": "AFN" }
}
```

---

## Settings

### `GET /settings`

`reportingCurrency` drives every valuation/P&L display; `tradeCurrency` is
the pre-selected currency for new entries.

**Response `200`:**

```json
{
  "settings": {
    "userId": "e1df5a38-eae4-4acc-aa62-2c53a841c567",
    "reportingCurrency": "AFN",
    "tradeCurrency": "USD",
    "lastCashCountAt": "2026-07-08T14:25:49.641Z",
    "updatedAt": "2026-07-08T14:25:49.650Z"
  }
}
```

### `PUT /settings`

Either or both fields; each must be an **active** asset (`422` otherwise).

**Payload:**

```json
{ "reportingCurrency": "AFN", "tradeCurrency": "USD" }
```

**Response `200`:** the updated settings object.

---

## Reports

### `GET /reports/dashboard`

The home-screen aggregate in one call.

**Response `200`:**

```json
{
  "globalPositions": { "USD": 0, "AFN": 0, "PKR": 0, "GOLD": 0 },
  "pendingHawalas": [
    {
      "id": "2c15cdad-0dd4-4c11-8c39-b859c55e804c",
      "code": "100002",
      "type": "send",
      "amount": 2000,
      "currency": "USD",
      "fromCity": "KBL",
      "toCity": "HRT",
      "senderName": "Haji Dawood",
      "receiverName": "Karim Shah",
      "counterpartyId": "33c63456-e871-4c0e-8daf-40da5e1b8008",
      "counterpartyShortName": "A. Naseem",
      "createdAt": "2026-07-08T14:25:49.739Z"
    }
  ],
  "todayRealizedPlAfn": 200,
  "counts": { "counterparties": 1, "customers": 1, "pendingHawalas": 1 },
  "defaults": { "reportingCurrency": "AFN", "tradeCurrency": "USD" }
}
```

### `GET /reports/pnl?period=today|week|month|all`

P&L for the period, in AFN and translated to the reporting currency:

- **fxRealized** — sum of realized FX P&L in the window
- **hawalaCommission** — commission on *paid* hawalas, converted to AFN.
  Recognized on the date the hawala was **marked paid** (`paidAt`), so a
  hawala issued last week and paid today counts toward today's P&L. Pending
  hawalas contribute nothing until they are paid.
- **unrealizedReval** — rate-move P&L on drawer holdings, `(sell − prevSell) ×
  balance` per non-AFN asset. A snapshot, not a flow — only included for
  `today` and `all`.

**Response `200`:**

```json
{
  "period": { "key": "all", "label": "All time", "from": "1970-01-01T00:00:00.000Z", "to": "2026-07-08T14:25:49.811Z" },
  "reportingCurrency": "AFN",
  "afn": {
    "fxRealized": 200,
    "hawalaCommission": 3595,
    "unrealizedReval": 8121.9,
    "realizedTotal": 3795,
    "grandTotal": 11916.9
  },
  "reporting": {
    "fxRealized": 200,
    "hawalaCommission": 3595,
    "unrealizedReval": 8121.9,
    "realizedTotal": 3795,
    "grandTotal": 11916.9
  },
  "counts": { "fxTrades": 1, "hawalas": 1 },
  "entries": [
    { "kind": "reval", "at": "2026-07-08T14:25:49.813Z", "label": "Reval GOLD · 116.638 · rate 5750 → 5800", "amountAfn": 5831.9 },
    { "kind": "fx", "id": "0c320684-…", "at": "2026-07-08T14:28:04.954Z", "label": "Sold 2000 USD → AFN @ 72", "amountAfn": 200 },
    { "kind": "hawala", "id": "b7d2e9ef-…", "at": "2026-07-08T14:25:49.733Z", "label": "Sent hawala · KBL→HRT · 1% on 5000 USD", "counterparty": "A. Naseem", "amountAfn": 3595 }
  ]
}
```

### `GET /reports/activity`

The unified general-ledger feed: hawalas, settlements, customer transactions,
and FX trades in one reverse-chronological stream.

| Query param | Description |
|---|---|
| `kind` | `hawala` \| `settle` \| `custtx` \| `fx` |
| `search` | matches titles, subtitles, hawala codes |
| `from`, `to` | ISO date window |
| `limit`, `offset` | pagination (default 100) |

**Response `200`:**

```json
{
  "items": [
    {
      "kind": "settle",
      "id": "12a5b23b-9c7e-40d1-8fe3-72050f332e5b",
      "at": "2026-07-08T14:25:49.786Z",
      "title": "Settlement · A. Naseem",
      "subtitle": "Monthly settlement",
      "amount": 7000,
      "direction": "out",
      "currency": "USD",
      "ref": { "type": "counterparty", "id": "33c63456-e871-4c0e-8daf-40da5e1b8008" }
    },
    {
      "kind": "fx",
      "id": "0c320684-42ef-48df-b268-3744abbcd5b5",
      "at": "2026-07-08T14:28:04.954Z",
      "title": "Sold USD → AFN",
      "subtitle": "2000 USD @ 72 · +200 AFN profit",
      "amount": 144000,
      "direction": "in",
      "currency": "AFN",
      "realizedPlAfn": 200,
      "ref": { "type": "fxTrade", "id": "0c320684-42ef-48df-b268-3744abbcd5b5" }
    }
  ],
  "pagination": { "total": 9, "limit": 2, "offset": 0, "hasMore": true }
}
```

Hawala items additionally carry `status` and `code`; customer-transaction
items carry `drcr` (`"CR"`/`"DR"`) and `ref.customerId`.

### `GET /reports/ledger-statement?period=&kind=&from=&to=`

Exportable ledger statement — the feed for a period/kind plus AFN-valued
totals. `period`: `today` | `week` | `month` | `all` (explicit `from`/`to`
override it).

**Response `200`:**

```json
{
  "period": { "key": "all", "from": null, "to": null },
  "kind": "all",
  "entries": [ { "...": "same items as /reports/activity" } ],
  "totals": {
    "entryCount": 9,
    "totalInAfn": 495000,
    "totalOutAfn": 646900,
    "netAfn": -151900
  },
  "generatedAt": "2026-07-08T14:25:49.856Z"
}
```

---

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
  never rewrite the past. Stock without a trade-history basis (initial setup /
  investments) is costed at the current market rate, so a sale realizes only
  the spread vs market.
- **Hawala pickup codes** are 6-digit, sequential per saraf, claimed atomically
  (`000000` is reserved for opening-balance and settlement sentinels).
