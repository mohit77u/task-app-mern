import 'dotenv/config';
import mongoose from 'mongoose';
import { validateEnv } from '../../config/env.validation';
import { ensureIndexes } from '../../models';
import { seed } from './seed';

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  try {
    await ensureIndexes();
    const { created } = await seed(env);
    // Counts only: never print the connection string or any password.
    console.log(
      `Seed complete: ${created.roles} roles, ${created.users} users, ${created.tasks} tasks created.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
