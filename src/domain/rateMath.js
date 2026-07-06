import { BASE_ASSET } from '../config/constants.js';

/**
 * Pure conversion helpers over a rates map:
 *   { [assetCode]: { buy, sell, prevSell } }  — quoted "1 asset = N AFN".
 */

/** AFN value of `amount` units of `assetCode` at the current sell rate. */
export function assetToAfn(rates, assetCode, amount) {
  if (assetCode === BASE_ASSET) return amount;
  const rate = rates[assetCode];
  if (!rate || !rate.sell) return 0;
  return amount * rate.sell;
}

/** Converts an amount of any asset into the reporting currency, bridging through AFN. */
export function assetToReporting(rates, assetCode, amount, reportingCurrency) {
  if (assetCode === reportingCurrency) return amount;
  const afnAmount = assetToAfn(rates, assetCode, amount);
  if (reportingCurrency === BASE_ASSET) return afnAmount;
  const reportingRate = rates[reportingCurrency];
  if (!reportingRate || !reportingRate.sell) return afnAmount; // fallback: report in AFN
  return afnAmount / reportingRate.sell;
}

/** AFN amount expressed in the reporting currency. */
export function afnToReporting(rates, afnAmount, reportingCurrency) {
  if (reportingCurrency === BASE_ASSET) return afnAmount;
  const reportingRate = rates[reportingCurrency];
  if (!reportingRate || !reportingRate.sell) return afnAmount;
  return afnAmount / reportingRate.sell;
}
