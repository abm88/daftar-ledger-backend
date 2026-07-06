import { AppError } from '../utils/AppError.js';
import { authService } from '../services/authService.js';

/** Requires a valid `Authorization: Bearer <jwt>`; attaches req.userId. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing Authorization bearer token'));
  }
  try {
    const payload = authService.verifyToken(token);
    req.userId = payload.sub;
    return next();
  } catch (err) {
    return next(err);
  }
}
