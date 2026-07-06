import { AppError } from '../utils/AppError.js';

/**
 * Validates a request part against a zod schema and replaces it with the
 * parsed (coerced, defaulted) value.
 */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }));
    return next(AppError.badRequest('Validation failed', details));
  }
  req[part] = result.data;
  return next();
};
