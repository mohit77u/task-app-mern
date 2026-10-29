import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { expectErrorBody } from './http';
import { startTestDb, stopTestDb, testEnv } from './mongo';

describe('GET|HEAD /api/health', () => {
  let app: Express;

  beforeAll(async () => {
    await startTestDb();
    app = createApp(testEnv());
  });
  afterAll(stopTestDb);

  it('GET is public and answers 200 {status:"ok",db:"up"}', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('HEAD answers 200 without a body', async () => {
    const res = await request(app).head('/api/health').expect(200);
    expect(res.text).toBeUndefined();
  });

  it('is version-neutral: there is no /api/v1/health', async () => {
    // Behind jwtAuth like every other /api/v1 path, so an anonymous caller is told to sign in.
    await request(app).get('/api/v1/health').expect(401);
  });

  // Last: it disconnects the database.
  it('answers 503 SERVICE_UNAVAILABLE when the database is down', async () => {
    await mongoose.disconnect();
    const res = await request(app).get('/api/health').expect(503);
    expectErrorBody(res.body, 503, 'SERVICE_UNAVAILABLE');
  });
});
