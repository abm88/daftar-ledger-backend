import { AppError } from '../utils/AppError.js';
import { authService } from '../services/authService.js';

/**
 * Requires a valid `Authorization: Bearer <jwt>` whose backing session is
 * still live (not signed out, not expired); attaches req.userId and
 * req.sessionId.
 */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing Authorization bearer token'));
  }
  try {
    const { userId, sessionId } = await authService.authenticate(token);
    req.userId = userId;
    req.sessionId = sessionId;
    return next();
  } catch (err) {
    return next(err);
  }
}
