import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const MAX_INCOMING_ID_LENGTH = 100;

/** Registered first so even malformed bodies and unknown paths reach the error handler with an id. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  // Honour an upstream id for end-to-end tracing, but never trust unbounded input.
  req.id =
    incoming && incoming.length <= MAX_INCOMING_ID_LENGTH
      ? incoming
      : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
