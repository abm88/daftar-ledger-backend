/**
 * Operational error with an HTTP status. Anything not an AppError that reaches
 * the error handler is treated as an unexpected 500.
 */
export class AppError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError(400, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, message);
  }

  static conflict(message, details) {
    return new AppError(409, message, details);
  }

  static unprocessable(message, details) {
    return new AppError(422, message, details);
  }
}
