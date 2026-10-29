import { Router, type RequestHandler } from 'express';
import mongoose from 'mongoose';
import { AppException } from '../../common/errors/app.exception';

/** Mongoose's `connection.readyState` value for an open connection. */
const CONNECTED = mongoose.ConnectionStates.connected;

const check: RequestHandler = async (_req, res) => {
  const db = mongoose.connection.db;
  if (mongoose.connection.readyState !== CONNECTED || !db) {
    throw AppException.serviceUnavailable('Database unavailable');
  }
  try {
    await db.admin().ping();
  } catch {
    throw AppException.serviceUnavailable('Database unavailable');
  }
  res.json({ status: 'ok', db: 'up' });
};

/**
 * `GET|HEAD /health`, mounted under `/api` (version-neutral) and public: the target of the host's health check and
 * the uptime ping that keeps a free instance warm. Express answers HEAD from the GET route, without a body.
 */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', check);
  return router;
}
