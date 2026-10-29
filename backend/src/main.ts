import 'dotenv/config';
import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { redactMongoUri } from './common/utils/redact';
import { validateEnv } from './config/env.validation';
import { ensureIndexes } from './models';

function errorMessage(error: unknown): string {
  return redactMongoUri(error instanceof Error ? error.message : String(error));
}

/** How long in-flight requests get to finish before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

/** Stops accepting connections, waits for in-flight requests, then closes the database connection. */
function shutdownOn(server: Server): void {
  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
    // A hung request (or keep-alive socket) must not stall the shutdown forever.
    setTimeout(() => {
      console.error(
        `Shutdown took longer than ${SHUTDOWN_GRACE_MS} ms, exiting`,
      );
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    server.close(() => {
      mongoose
        .disconnect()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error('Error while disconnecting:', errorMessage(error));
          process.exit(1);
        });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main(): Promise<void> {
  // Never log the env or the URI: both carry secrets.
  const env = validateEnv(process.env);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  await ensureIndexes();
  const server = createApp(env).listen(env.PORT, () => {
    console.log(
      `API listening on port ${env.PORT} (database: ${env.MONGODB_DB ?? 'from the connection string'})`,
    );
  });
  // E.g. EADDRINUSE: fail loudly instead of running with no listener.
  server.on('error', (error) => {
    console.error('Server error:', errorMessage(error));
    process.exit(1);
  });
  shutdownOn(server);
}

main().catch((error: unknown) => {
  console.error('Startup failed:', errorMessage(error));
  process.exit(1);
});
