/**
 * `npm run dev:memory`: the real API on an in-memory MongoDB replica set, seeded with the demo data. Needs no Atlas
 * URI and never reads backend/.env; everything is thrown away on exit.
 *
 * THROTTLING_ENABLED=false npm run dev:memory   turns rate limiting off.
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { validateEnv } from '../src/config/env.validation';
import { DEMO_USERS } from '../src/database/seed/demo-data';
import { seed } from '../src/database/seed/seed';
import { ensureIndexes } from '../src/models';

const PORT = 4000;

async function main(): Promise<void> {
  // A replica set, because task writes use transactions.
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const env = validateEnv({
    NODE_ENV: 'development',
    PORT: String(PORT),
    MONGODB_URI: replSet.getUri(),
    MONGODB_DB: 'taskmanager-dev',
    // Fresh per run: sessions do not survive a restart, which is fine for a throwaway database.
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    COOKIE_SECURE: 'false',
    FRONTEND_ORIGINS: 'http://localhost:5173',
    THROTTLING_ENABLED: process.env.THROTTLING_ENABLED ?? 'true',
  });

  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  await ensureIndexes();
  const { created } = await seed(env);

  const server: Server = createApp(env).listen(PORT, () => {
    console.log(
      `In-memory API on http://localhost:${PORT}/api (seeded ${created.users} users, ${created.tasks} tasks; throttling ${env.THROTTLING_ENABLED ? 'on' : 'off'})`,
    );
    console.log('Demo accounts (passwords are in the README):');
    for (const user of DEMO_USERS) {
      console.log(`  ${user.role.padEnd(8)} ${user.email}`);
    }
  });

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      mongoose
        .disconnect()
        .then(() => replSet.stop())
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error(
    'dev:memory failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
