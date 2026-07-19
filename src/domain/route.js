import { HAWALA_TYPES } from '../config/constants.js';

/**
 * Derives a hawala's route (from → to) from its direction and the counterparty
 * branch, bridged by the saraf's own city. The route is never free-entered:
 *   send → money leaves here, paid out at the partner branch: local → partner
 *   recv → money originates at the partner branch, paid out here: partner → local
 *
 * `localCity` may be null when the saraf hasn't set a shop city; callers fall
 * back to any explicitly provided cities in that case.
 */
export function deriveRoute({ type, localCity, counterpartyCity }) {
  if (type === HAWALA_TYPES.RECV) {
    return { fromCity: counterpartyCity, toCity: localCity };
  }
  return { fromCity: localCity, toCity: counterpartyCity };
}
