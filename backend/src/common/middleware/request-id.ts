import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_INCOMING_ID = /^[\w-]{1,128}$/;

/** Registered first so even malformed bodies and unknown paths reach the error handler with an id. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  // Honour an upstream id for end-to-end tracing, but never trust unbounded or odd-charset input.
  req.id =
    incoming && SAFE_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
