import { ErrorCode } from './error-codes';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** The only exception type domain code throws, so every failure carries a stable, client-facing `code`. */
export class AppException extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppException';
  }

  static unauthenticated(message = 'Authentication required'): AppException {
    return new AppException(401, ErrorCode.UNAUTHENTICATED, message);
  }

  static tokenExpired(): AppException {
    return new AppException(
      401,
      ErrorCode.TOKEN_EXPIRED,
      'Access token expired',
    );
  }

  static forbidden(
    message = 'You do not have permission to perform this action',
  ): AppException {
    return new AppException(403, ErrorCode.FORBIDDEN, message);
  }

  static notFound(what = 'Resource'): AppException {
    return new AppException(404, ErrorCode.NOT_FOUND, `${what} not found`);
  }

  static validation(
    details: ApiErrorDetail[],
    message = 'Validation failed',
  ): AppException {
    return new AppException(422, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static invalidTransition(
    message = 'Invalid status transition',
  ): AppException {
    return new AppException(422, ErrorCode.INVALID_TRANSITION, message);
  }

  static stateConflict(
    message = 'The resource is not in a state that allows this action',
  ): AppException {
    return new AppException(409, ErrorCode.STATE_CONFLICT, message);
  }

  static conflict(message = 'Resource already exists'): AppException {
    return new AppException(409, ErrorCode.CONFLICT, message);
  }

  static rateLimited(retryAfterSeconds: number): AppException {
    return new AppException(
      429,
      ErrorCode.RATE_LIMITED,
      'Too many requests. Please try again shortly.',
      [],
      retryAfterSeconds,
    );
  }

  static serviceUnavailable(
    message = 'Service temporarily unavailable',
  ): AppException {
    return new AppException(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
