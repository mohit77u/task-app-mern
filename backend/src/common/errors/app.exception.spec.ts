import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';

describe('AppException', () => {
  const cases: [string, AppException, number, ErrorCode][] = [
    [
      'unauthenticated',
      AppException.unauthenticated(),
      401,
      ErrorCode.UNAUTHENTICATED,
    ],
    ['tokenExpired', AppException.tokenExpired(), 401, ErrorCode.TOKEN_EXPIRED],
    ['forbidden', AppException.forbidden(), 403, ErrorCode.FORBIDDEN],
    ['notFound', AppException.notFound(), 404, ErrorCode.NOT_FOUND],
    [
      'validation',
      AppException.validation([]),
      422,
      ErrorCode.VALIDATION_ERROR,
    ],
    [
      'invalidTransition',
      AppException.invalidTransition(),
      422,
      ErrorCode.INVALID_TRANSITION,
    ],
    [
      'stateConflict',
      AppException.stateConflict(),
      409,
      ErrorCode.STATE_CONFLICT,
    ],
    ['conflict', AppException.conflict(), 409, ErrorCode.CONFLICT],
    ['rateLimited', AppException.rateLimited(30), 429, ErrorCode.RATE_LIMITED],
    [
      'serviceUnavailable',
      AppException.serviceUnavailable(),
      503,
      ErrorCode.SERVICE_UNAVAILABLE,
    ],
  ];

  it.each(cases)('%s maps to status and code', (_n, ex, status, code) => {
    expect(ex).toBeInstanceOf(Error);
    expect(ex.statusCode).toBe(status);
    expect(ex.code).toBe(code);
  });

  it('carries details and a custom message', () => {
    const ex = AppException.validation(
      [{ field: 'a', message: 'bad' }],
      'nope',
    );
    expect(ex.details).toEqual([{ field: 'a', message: 'bad' }]);
    expect(ex.message).toBe('nope');
  });

  it('notFound names the resource', () => {
    expect(AppException.notFound('Task').message).toBe('Task not found');
  });

  it('rateLimited keeps the retry delay', () => {
    expect(AppException.rateLimited(12).retryAfterSeconds).toBe(12);
  });
});
