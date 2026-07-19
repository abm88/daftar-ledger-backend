/**
 * Domain constants shared across layers.
 * Mirrors the semantics of the Daftar app exactly.
 */

export const ASSET_TYPES = Object.freeze({ CURRENCY: 'currency', METAL: 'metal' });

/** 1 tola = 11.6638 g — standard South Asian / Afghan jeweler unit for metals. */
export const TOLA_GRAMS = 11.6638;

/** Base asset every rate is quoted against ("1 {asset} = N AFN"). */
export const BASE_ASSET = 'AFN';

export const HAWALA_TYPES = Object.freeze({ SEND: 'send', RECV: 'recv', SETTLE: 'settle' });
export const HAWALA_STATUS = Object.freeze({ PENDING: 'pending', PAID: 'paid' });
export const SENDER_MODES = Object.freeze({ CASH: 'cash', ACCOUNT: 'account' });
export const COMMISSION_MODES = Object.freeze({ PERCENT: 'percent', FIXED: 'fixed' });
/** How a received hawala is paid out to the recipient. */
export const PAYOUT_METHODS = Object.freeze({ CASH: 'cash', ACCOUNT: 'account' });

/** Sentinel code used for opening-balance and settlement ledger entries. */
export const SENTINEL_CODE = '000000';
/** First real hawala pickup code (codes are 6-digit, sequential, zero-padded). */
export const FIRST_HAWALA_CODE = 100001;

export const CUSTOMER_TX_TYPES = Object.freeze({
  OPENING: 'opening',
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
  CHARGE: 'charge',
  CREDIT: 'credit'
});

/** Transaction types that increase what the saraf owes the customer. */
export const CREDIT_TX_TYPES = Object.freeze(['opening', 'deposit']);

export const FX_SIDES = Object.freeze({ BUY: 'buy', SELL: 'sell' });

export const INVESTMENT_TYPES = Object.freeze({
  OPENING: 'opening',
  ADDITION: 'addition',
  WITHDRAWAL: 'withdrawal'
});

export const COUNTERPARTY_TIERS = Object.freeze(['core', 'regular']);

/** Roles a team member (partner or staff) can hold. */
export const TEAM_ROLES = Object.freeze(['Partner', 'Owner', 'Cashier', 'Runner', 'Staff']);

/**
 * Customer-list status filter (Accounts screen chips):
 *   deposits — holds funds with the saraf in at least one currency
 *   advances — owes the saraf in at least one currency
 *   settled  — every balance within the flat threshold
 */
export const CUSTOMER_STATUS_FILTERS = Object.freeze(['deposits', 'advances', 'settled']);

export const PNL_PERIODS = Object.freeze(['today', 'week', 'month', 'all']);

/**
 * Amount tolerance used by balance checks (matches the app's 0.5-unit slack
 * for rounding across currencies).
 */
export const BALANCE_TOLERANCE = 0.5;

/** Threshold below which a position is considered flat/zero. */
export const FLAT_THRESHOLD = 0.5;
