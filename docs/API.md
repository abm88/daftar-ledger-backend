# Daftar API Reference

Base URL: `/api/v1` · All request/response bodies are JSON.

Authenticated endpoints require `Authorization: Bearer <token>` (JWT from
register/login). Every business resource is scoped to the authenticated saraf.

Errors use a single shape:

```json
{ "error": { "message": "…", "details": [ { "path": "amount", "message": "…" } ] } }
```

`400` validation · `401` auth · `404` not found · `409` conflict ·
`422` business rule violation · `500` unexpected.

---

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + DB connectivity (no auth, not under `/api/v1`) |

## Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create a saraf account. Provisions settings, asset activations, zeroed cash drawer, and starting rates. Returns `{ user, token }`. |
| POST | `/auth/login` | Login with `phone` or `email` + `password`. Returns `{ user, token }`. |
| GET | `/auth/me` | Current profile. |
| PUT | `/auth/me` | Update profile (`name`, `shopName`, `cityCode`, `registrationNo`, `email`). |
| PUT | `/auth/me/password` | Change password (`currentPassword`, `newPassword`). |

**Register body**

```json
{
  "phone": "+93700000002",
  "email": "saraf@example.af",
  "password": "min8chars",
  "name": "Haji Rahmat",
  "shopName": "Sarai Shahzada",
  "cityCode": "KBL",
  "registrationNo": "AFG-0421"
}
```

## Reference data

| Method | Path | Description |
|---|---|---|
| GET | `/cities` | Hawala routing cities (KBL, HRT, MZR, JAL). No auth. |

## Assets

Currencies (USD, AFN, PKR, EUR, GBP, SAR, AED) and metals (GOLD, SILVER — in
grams; response includes `tolaGrams` = 11.6638 for tola display). AFN is the
base asset. USD/AFN/PKR are core and cannot be deactivated.

| Method | Path | Description |
|---|---|---|
| GET | `/assets` | Registry with the saraf's `active` flag per asset. |
| PATCH | `/assets/:code/activation` | Body `{ "active": true|false }`. 422 when deactivating a core asset. |

## Rates

Quoted **"1 asset = N AFN"**, with independent `buy` and `sell`. Saving a rate
moves the previous sell into `prevSell` (feeds revaluation P&L) and records
`deltaPct` plus an immutable history row. Cross rates between active non-AFN
currencies (e.g. `USD_PKR`) are derived and returned alongside.

| Method | Path | Description |
|---|---|---|
| GET | `/rates` | `{ rates: [...], crosses: [{ pair, buy, sell }] }` |
| PUT | `/rates` | Body `{ "rates": { "USD": { "buy": 71.2, "sell": 71.9 }, ... } }` |
| GET | `/rates/history?asset=USD&limit=100` | Audit trail of saves. |

## Cash drawer (صندوق)

| Method | Path | Description |
|---|---|---|
| GET | `/cash-drawer` | Per-asset balances with AFN/reporting equivalents, tola for metals, revaluation P&L per cell, drawer totals, `lastCountAt`. |
| PUT | `/cash-drawer/count` | Cash count. Body `{ "counts": { "USD": 12450, "AFN": 1850000 } }` — omitted assets stay untouched (partial counts allowed). |
| POST | `/cash-drawer/initial-setup` | First-run opening balances. Body `{ "amounts": { "USD": 8000 } }`. Sets balances **and** records matching `opening` investment entries. |
| GET | `/cash-drawer/today-movement` | Today's inflow/outflow/net per asset from customer cash transactions and FX trade legs (account-funded hawala debits excluded — no cash moved). |

## Counterparties (fellow sarafs)

| Method | Path | Description |
|---|---|---|
| GET | `/counterparties?search=` | All counterparties with per-currency open positions (positive = they owe us). |
| POST | `/counterparties` | Create. `openingBalances` map is signed: positive = they owe us, negative = we owe them (stored as paid sentinel entries, code `000000`). |
| GET | `/counterparties/:id` | Detail + positions + hawala count. |
| PUT | `/counterparties/:id` | Update profile fields. |
| DELETE | `/counterparties/:id` | Remove (cascades their hawala history). |
| GET | `/counterparties/:id/hawalas` | Full hawala ledger, chronological. |
| POST | `/counterparties/:id/settle` | Settle up: writes offsetting `settle` entries zeroing every open position. Body `{ "settleCurrency": "USD", "note": "…" }`. 422 if nothing is open. |
| GET | `/counterparties/:id/statement?from=&to=` | Printable statement data. |

**Position semantics** — paid entries only: `send` +amount, `recv` −amount,
`settle` +signed delta. Pending hawalas do not move positions until paid.

## Hawalas

| Method | Path | Description |
|---|---|---|
| GET | `/hawalas?status=&currency=&counterpartyId=&search=&limit=&offset=` | Filterable ledger (search matches sender/receiver/code). Opening-balance sentinels excluded by default; pass `includeOpening=true` to include. |
| GET | `/hawalas/pending` | Pending pickups, newest first. |
| GET | `/hawalas/next-code` | Peek the next pickup code (form pre-fill; does not claim it). |
| POST | `/hawalas` | Issue a hawala (status `pending`). |
| GET | `/hawalas/:id` | Detail incl. counterparty info. |
| POST | `/hawalas/:id/mark-paid` | Recipient collected — flips to `paid` (positions update). 409 if already paid. |

**Issue body**

```json
{
  "type": "send",
  "counterpartyId": "<uuid>",
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

- `senderMode: "cash"` — `senderName` required.
- `senderMode: "account"` — `senderCustomerId` required. Validates the customer
  holds `amount + commission` in the hawala currency (0.5 tolerance) and writes
  a linked `withdrawal` on their account for the debit total; the transaction
  carries `hawalaId` and is excluded from cash-movement reports.
- `commissionMode: "fixed"` — `commissionFixed` (fee in the hawala currency)
  required; `percent` uses `commissionPct` (default 1.0).
- The 6-digit pickup code is claimed atomically from a per-saraf sequence.

## Customers & account transactions

| Method | Path | Description |
|---|---|---|
| GET | `/customers?search=&city=` | Customers with per-currency balances (positive = saraf owes customer). |
| POST | `/customers` | Open an account. `openingBalances` (positive amounts) become `opening` deposit entries. |
| GET | `/customers/:id` | Detail + balances. |
| PUT | `/customers/:id` | Update profile/notes. |
| DELETE | `/customers/:id` | Close account (cascades transactions). |
| GET | `/customers/:id/transactions` | Chronological entries with running `balanceBefore`/`balanceAfter` per currency. |
| POST | `/customers/:id/transactions` | Record `deposit` / `withdrawal` / `charge` / `credit`. |
| GET | `/customers/:id/statement?from=&to=` | Statement data: entries + running balances + totals + closing balances. |
| GET | `/transactions/:id` | Single entry with before/after balance. |
| DELETE | `/transactions/:id` | Delete an entry (app's delete flow). |
| GET | `/transactions/:id/receipt` | Plain-text receipt matching the app's share format. |

**Balance semantics** — `opening`/`deposit` credit (+); `withdrawal`/`charge`/
`credit` (advance) debit (−).

**Cross-currency intake** — add `conversion`:

```json
{
  "type": "deposit",
  "amount": 1000,
  "currency": "USD",
  "conversion": { "toCurrency": "AFN", "rate": 71.8 }
}
```

Credits `71,800 AFN` and stores the original intake as metadata on the entry.

## FX trades

| Method | Path | Description |
|---|---|---|
| GET | `/fx/trades?limit=&offset=` | Trade ledger, newest first. |
| POST | `/fx/trades` | Execute an exchange. |
| GET | `/fx/positions` | Open position per non-AFN currency: `qty`, `avgCostAfn` (weighted average), `marketRateAfn`, `marketValueAfn`, `unrealizedPlAfn`. |

**Trade body**

```json
{ "fromCurrency": "USD", "toCurrency": "AFN", "fromAmount": 2000, "rate": 72, "note": "" }
```

- Rate is canonical: "1 {pair base} = N {quote}", the base being the
  lower-sort-order asset (USD < AFN < PKR < …). `toAmount` is derived
  server-side (× when from is base, ÷ otherwise).
- Validates drawer stock (`fromAmount ≤ balance + 0.5`), then moves both legs.
- `side` derives from the funding leg: AFN→X is a `buy`; X→anything is a `sell`.
- Sells compute `realizedPl` (AFN) = proceeds − weighted-average cost of the
  disposed lot. Buys have `realizedPl: null`.
- AFN values of both legs are snapshotted at trade time so later rate edits
  never rewrite historical cost bases.

## Investments (owner equity)

| Method | Path | Description |
|---|---|---|
| GET | `/investments` | Entries + per-asset totals (invested/withdrawn/net) + net total in the reporting currency. |
| POST | `/investments` | Body `{ "assetCode": "USD", "amount": 3000, "type": "addition", "note": "" }`. Types: `opening`, `addition` (drawer +), `withdrawal` (drawer −). |

## Settings

| Method | Path | Description |
|---|---|---|
| GET | `/settings` | `reportingCurrency` (drives P&L/valuation displays), `tradeCurrency` (form default), `lastCashCountAt`. |
| PUT | `/settings` | Update either default; both must be active assets. |

## Reports

| Method | Path | Description |
|---|---|---|
| GET | `/reports/dashboard` | Home-screen aggregate: global counterparty positions, pending hawalas, today's realized P&L, entity counts, defaults. |
| GET | `/reports/pnl?period=today\|week\|month\|all` | P&L in AFN + reporting currency: realized FX, hawala commission (paid hawalas, converted to AFN), unrealized revaluation (today/all only), with a per-entry breakdown. |
| GET | `/reports/activity?kind=&search=&from=&to=&limit=&offset=` | Unified feed: hawalas, settlements, customer transactions, FX trades — the app's general ledger. `kind`: `hawala`, `settle`, `custtx`, `fx`. |
| GET | `/reports/ledger-statement?period=&kind=` | Exportable ledger statement with AFN-valued in/out/net totals. |
