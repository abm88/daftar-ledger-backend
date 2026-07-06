/**
 * Money helpers. Amounts are handled as JS numbers and rounded to 6 decimal
 * places at write boundaries — comfortably beyond any display precision used
 * by the app (0–3 decimals) while keeping arithmetic float noise out of the DB.
 */

export function round6(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** True when |value| is below the given threshold (defaults to a hair above float noise). */
export function isZero(value, threshold = 1e-9) {
  return Math.abs(value) < threshold;
}
