import mongoose, { type ClientSession } from 'mongoose';

/** Runs `fn` in a transaction (retried on transient errors), always ends the session, returns fn's result. */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
