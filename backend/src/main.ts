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

/** Stops accepting connections, waits for in-flight requests, then closes the database connection. */
function shutdownOn(server: Server): void {
  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
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
  shutdownOn(server);
}

main().catch((error: unknown) => {
  console.error('Startup failed:', errorMessage(error));
  process.exit(1);
});
