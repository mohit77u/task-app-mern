import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';
import { fromMongoError } from './mongo-errors';

/** Shape of the errors raised by Express's body parsers (the `http-errors` objects from `body-parser`/`raw-body`). */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}

const MESSAGE_BY_TYPE: Record<string, string> = {
  'entity.parse.failed': 'Request body is not valid JSON',
  'entity.too.large': 'Request body is too large',
  'parameters.too.many': 'Request body has too many parameters',
  'encoding.unsupported': 'Unsupported request body encoding',
  'charset.unsupported': 'Unsupported request body charset',
};

/** The parser's own message is not passed on: it echoes fragments of the body and engine internals. */
function fromBodyParserError(error: unknown): AppException | undefined {
  if (!isBodyParserError(error)) return undefined;
  return new AppException(
    error.status,
    ErrorCode.VALIDATION_ERROR,
    MESSAGE_BY_TYPE[error.type] ?? 'Invalid request body',
  );
}

function resolve(error: unknown): AppException {
  if (error instanceof AppException) return error;
  return (
    fromBodyParserError(error) ??
    fromMongoError(error) ??
    new AppException(500, ErrorCode.INTERNAL_ERROR, 'Something went wrong')
  );
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const resolved = resolve(error);
  if (resolved.statusCode >= 500) {
    // Full detail goes to the logs, correlated by request id; the client only ever sees the generic message.
    console.error(
      `[${req.id}] ${req.method} ${req.originalUrl}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
  if (resolved.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(resolved.retryAfterSeconds));
  }
  res.status(resolved.statusCode).json({
    statusCode: resolved.statusCode,
    code: resolved.code,
    message: resolved.message,
    details: resolved.details,
    requestId: req.id,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppException.notFound(`Route ${req.method} ${req.path}`));
};
