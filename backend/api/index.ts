import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { validateEnv } from '../src/config/env.validation';
import { ensureIndexes } from '../src/models';
import { createServerlessHandler } from '../src/serverless';

// Vercel entry: every /api/* request is rewritten here (see vercel.json). One Express app per warm instance.
export default createServerlessHandler(async () => {
  const env = validateEnv(process.env);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  await ensureIndexes();
  return createApp(env);
});
