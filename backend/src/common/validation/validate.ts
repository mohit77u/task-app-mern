import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppException, ApiErrorDetail } from '../errors/app.exception';

export type ValidationSource = 'body' | 'query' | 'params';

function toDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.flatMap((issue): ApiErrorDetail[] => {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: [...base, key].join('.'),
        message: 'Unknown field',
      }));
    }
    return [{ field: base.join('.'), message: issue.message }];
  });
}

/**
 * Validates one part of the request against a strict schema (unknown keys are rejected, not stripped). The parsed
 * value goes on `res.locals[source]`: Express 5's `req.query` is a read-only getter, so it cannot be replaced.
 */
export function validate<T>(
  schema: z.ZodType<T>,
  source: ValidationSource,
): RequestHandler {
  const strict = schema instanceof z.ZodObject ? schema.strict() : schema;
  return (req, res, next) => {
    const input: unknown = source === 'body' ? (req.body ?? {}) : req[source];
    const result = strict.safeParse(input);
    if (!result.success) {
      next(AppException.validation(toDetails(result.error)));
      return;
    }
    res.locals[source] = result.data;
    next();
  };
}
