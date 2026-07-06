import { COMMISSION_MODES } from '../config/constants.js';

/**
 * Commission owed on a hawala.
 *  - percent mode: amount × pct / 100
 *  - fixed mode:   the explicit fee in the hawala's currency
 */
export function commissionAmount({ amount, commissionMode, commissionPct, commissionFixed }) {
  if (commissionMode === COMMISSION_MODES.FIXED) {
    return commissionFixed || 0;
  }
  const pct = Number.isFinite(commissionPct) ? commissionPct : 1.0;
  return (amount * pct) / 100;
}
