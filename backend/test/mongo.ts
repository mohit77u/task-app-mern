/**
 * Test DB harness: a single-node in-memory MongoDB replica set (so transactions work) wired to Mongoose.
 *
 * Usage in a spec file:
 *   beforeAll(startTestDb);   // first ever run downloads the mongod binary (timeout is raised in test/setup.ts)
 *   afterAll(stopTestDb);     // disconnects Mongoose and stops mongod, leaving no open handles
 *   beforeEach(clearTestDb);  // deletes all documents, keeps collections and indexes
 *
 * `testEnv(overrides?)` returns a validated Env pointing at a fake URI; tests never touch a real database and
 * never read backend/.env.
 */
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { validateEnv, type Env } from '../src/config/env.validation';

let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb(): Promise<void> {
  if (replSet) return;
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // Jest runs specs in a vm context without --experimental-vm-modules, where the driver's own dynamic
  // `import('os')` throws and the handshake loses its `driver` metadata; handing it the module avoids that.
  await mongoose.connect(replSet.getUri(), {
    dbName: 'test',
    runtimeAdapters: { os },
  });
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
    replSet = undefined;
  }
}

export async function clearTestDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return validateEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    FRONTEND_ORIGINS: 'http://localhost:5173',
    THROTTLING_ENABLED: 'false',
    ...overrides,
  });
}
