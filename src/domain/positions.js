import {
  CREDIT_TX_TYPES, FLAT_THRESHOLD, HAWALA_STATUS, HAWALA_TYPES
} from '../config/constants.js';

/**
 * Counterparty position per currency, from hawala rows.
 * Only PAID entries count. Positive = they owe us, negative = we owe them.
 *   send   → +amount
 *   recv   → −amount
 *   settle → +amount (settle rows store the signed delta directly)
 */
export function counterpartyPositions(hawalas, currencies) {
  const positions = {};
  for (const code of currencies) positions[code] = 0;
  for (const h of hawalas) {
    if (h.status !== HAWALA_STATUS.PAID) continue;
    if (positions[h.currency] === undefined) positions[h.currency] = 0;
    if (h.type === HAWALA_TYPES.SEND) positions[h.currency] += h.amount;
    else if (h.type === HAWALA_TYPES.RECV) positions[h.currency] -= h.amount;
    else if (h.type === HAWALA_TYPES.SETTLE) positions[h.currency] += h.amount;
  }
  return positions;
}

/**
 * Customer balance per currency (positive = saraf owes the customer).
 *   opening / deposit            → +amount
 *   withdrawal / charge / credit → −amount
 */
export function customerBalances(transactions, currencies) {
  const balances = {};
  for (const code of currencies) balances[code] = 0;
  for (const tx of transactions) {
    if (balances[tx.currency] === undefined) balances[tx.currency] = 0;
    balances[tx.currency] += txSign(tx.type) * tx.amount;
  }
  return balances;
}

export function txSign(type) {
  return CREDIT_TX_TYPES.includes(type) ? 1 : -1;
}

/**
 * Classifies a customer's balance map against the flat threshold.
 * A customer can hold deposits in one currency and owe in another, so the
 * two flags are independent; `settled` means every balance is within the
 * threshold.
 */
export function balanceStatus(balances, threshold = FLAT_THRESHOLD) {
  let hasDeposits = false;
  let hasAdvances = false;
  for (const value of Object.values(balances)) {
    if (value > threshold) hasDeposits = true;
    else if (value < -threshold) hasAdvances = true;
  }
  return { hasDeposits, hasAdvances, settled: !hasDeposits && !hasAdvances };
}

/**
 * Aggregates many customers' balance maps into the Accounts-screen summary:
 * per-currency custodial holdings (deposits held, advances outstanding, net)
 * and how many customers sit in each status bucket.
 */
export function customerBalanceSummary(balanceMaps, threshold = FLAT_THRESHOLD) {
  const holdings = {};
  const statusCounts = { withDeposits: 0, withAdvances: 0, settled: 0 };

  for (const balances of balanceMaps) {
    const status = balanceStatus(balances, threshold);
    if (status.settled) statusCounts.settled += 1;
    if (status.hasDeposits) statusCounts.withDeposits += 1;
    if (status.hasAdvances) statusCounts.withAdvances += 1;

    for (const [currency, value] of Object.entries(balances)) {
      if (!holdings[currency]) holdings[currency] = { deposits: 0, advances: 0, net: 0 };
      if (value > threshold) holdings[currency].deposits += value;
      else if (value < -threshold) holdings[currency].advances += Math.abs(value);
      holdings[currency].net = holdings[currency].deposits - holdings[currency].advances;
    }
  }
  return { holdings, statusCounts };
}

/**
 * Annotates chronologically-ordered transactions with the running balance
 * (in each transaction's own currency) before and after the entry.
 */
export function withRunningBalances(transactions) {
  const running = {};
  return transactions.map((tx) => {
    const before = running[tx.currency] || 0;
    const after = before + txSign(tx.type) * tx.amount;
    running[tx.currency] = after;
    return { ...tx, balanceBefore: before, balanceAfter: after };
  });
}
