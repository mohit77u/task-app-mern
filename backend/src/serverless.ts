import type { Express, Request, RequestHandler, Response } from 'express';
import { redactMongoUri } from './common/utils/redact';

/**
 * Wraps app creation for a serverless platform: the app (and its database connection) is built on the first request
 * of an instance and reused by later ones. A failed start is not cached, so the next request tries again.
 */
export function createServerlessHandler(
  load: () => Promise<Express>,
): RequestHandler {
  let appPromise: Promise<Express> | undefined;
  return async (req: Request, res: Response): Promise<void> => {
    try {
      appPromise ??= load();
      const app = await appPromise;
      app(req, res);
    } catch (error) {
      appPromise = undefined;
      // Never send or log the raw error: it can carry the connection string.
      console.error(
        'Startup failed:',
        redactMongoUri(error instanceof Error ? error.message : String(error)),
      );
      res.status(503).json({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
      });
    }
  };
}
