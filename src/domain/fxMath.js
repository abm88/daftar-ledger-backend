import { BASE_ASSET } from '../config/constants.js';

/**
 * FX trade math. Rates on a trade are always quoted canonically:
 * "1 {pair base} = N {quote}", where the pair base is the asset with the
 * lower registry sort order (USD < AFN < PKR < EUR < ...). This mirrors the
 * app exactly for USD/AFN/PKR and extends consistently to every asset.
 */

/** Returns the canonical base of a currency pair given a sortOrder lookup. */
export function canonicalPairBase(fromCur, toCur, sortOrderOf) {
  return sortOrderOf(fromCur) <= sortOrderOf(toCur) ? fromCur : toCur;
}

/** Amount received on the `to` leg for a trade quoted at the canonical rate. */
export function computeToAmount(fromCur, toCur, fromAmount, rate, sortOrderOf) {
  const base = canonicalPairBase(fromCur, toCur, sortOrderOf);
  return fromCur === base ? fromAmount * rate : fromAmount / rate;
}

/** buy = acquiring a non-AFN asset with AFN; anything else disposes held stock. */
export function deriveSide(fromCur) {
  return fromCur === BASE_ASSET ? 'buy' : 'sell';
}

/**
 * Weighted-average cost basis (in AFN) for current holdings of `currency`,
 * walked over trades in chronological order.
 *
 * Trades are rows with: fromCurrency, toCurrency, fromAmount, toAmount,
 * fromAfnValue (AFN value of the from-leg snapshotted at trade time).
 *
 * Acquisitions add quantity at their AFN cost (exact for AFN-funded buys,
 * snapshot value for cross-currency buys); disposals remove quantity at the
 * running average cost.
 */
export function weightedAverageCost(trades, currency) {
  let qty = 0;
  let totalCostAfn = 0;
  for (const t of trades) {
    if (t.toCurrency === currency) {
      qty += t.toAmount;
      totalCostAfn += t.fromCurrency === BASE_ASSET ? t.fromAmount : t.fromAfnValue;
    } else if (t.fromCurrency === currency) {
      const avg = qty > 0 ? totalCostAfn / qty : 0;
      totalCostAfn -= avg * t.fromAmount;
      qty -= t.fromAmount;
    }
  }
  return {
    qty,
    totalCostAfn,
    avgCost: qty > 0.001 ? totalCostAfn / qty : 0
  };
}

/**
 * Realized P&L (AFN) for disposing `fromAmount` of a held currency:
 * proceeds (AFN value of the to-leg) minus average cost of the disposed lot.
 * Returns null for acquisitions (buys from AFN) — nothing is realized.
 */
export function computeRealizedPl({ fromCur, fromAmount, priorTrades, proceedsAfn }) {
  if (fromCur === BASE_ASSET) return null;
  const { avgCost } = weightedAverageCost(priorTrades, fromCur);
  return proceedsAfn - avgCost * fromAmount;
}
