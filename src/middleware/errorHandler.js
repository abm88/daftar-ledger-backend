import { AppError } from '../utils/AppError.js';
import { config } from '../config/index.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { message: err.message, details: err.details ?? undefined }
    });
  }

  // Malformed JSON body.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON body' } });
  }

  // Foreign-key violations surface as 422 (bad reference), everything else 500.
  if (err.code === '23503') {
    return res.status(422).json({ error: { message: 'Referenced resource does not exist' } });
  }

  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: {
      message: 'Internal server error',
      ...(config.isProduction ? {} : { detail: err.message })
    }
  });
}
