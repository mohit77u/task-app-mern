import mongoose from 'mongoose';
import { clearTestDb, startTestDb, stopTestDb, testEnv } from './mongo';

describe('test mongo harness', () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(clearTestDb);

  const Thing = mongoose.model(
    'HarnessThing',
    new mongoose.Schema({ name: { type: String, unique: true } }),
  );

  it('supports committed transactions (replica set)', async () => {
    await Thing.init();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Thing.create([{ name: 'a' }], { session });
      });
    } finally {
      await session.endSession();
    }
    expect(await Thing.countDocuments()).toBe(1);
  });

  it('clearTestDb removes documents but keeps indexes', async () => {
    await Thing.create({ name: 'b' });
    await clearTestDb();
    expect(await Thing.countDocuments()).toBe(0);
    const names = (await Thing.collection.indexes()).map((i) => i.name);
    expect(names).toContain('name_1');
  });

  it('testEnv builds a valid env with throttling off and overrides applied', () => {
    const env = testEnv();
    expect(env.NODE_ENV).toBe('test');
    expect(env.THROTTLING_ENABLED).toBe(false);
    expect(env.FRONTEND_ORIGINS).toEqual(['http://localhost:5173']);
    expect(testEnv({ THROTTLING_ENABLED: 'true' }).THROTTLING_ENABLED).toBe(
      true,
    );
  });
});
