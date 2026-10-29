import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { DEMO, expectErrorBody, ORIGIN, seedDemo, signIn } from './http';
import { startTestDb, stopTestDb, testEnv } from './mongo';

/** Each test builds its own app, so every limiter starts with an empty in-memory store. */
describe('throttling over HTTP (THROTTLING_ENABLED=true)', () => {
  const env = testEnv({ THROTTLING_ENABLED: 'true' });

  beforeAll(async () => {
    await startTestDb();
    await seedDemo(env);
  });
  afterAll(stopTestDb);

  function login(app: Express, email: string): request.Test {
    return request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password: 'wrong-password' });
  }

  it('the 6th login for one email within a minute is 429 with Retry-After; another email is unaffected', async () => {
    const app = createApp(env);
    for (let i = 0; i < 5; i += 1) {
      // Varying case and whitespace still counts against the same email.
      await login(
        app,
        i % 2 ? '  Priya@TaskApp.dev ' : DEMO.priya.email,
      ).expect(401);
    }
    const res = await login(app, DEMO.priya.email).expect(429);
    expectErrorBody(res.body, 429, 'RATE_LIMITED');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // The login limiter reads the parsed body, so a different email has its own bucket.
    await login(app, DEMO.rahul.email).expect(401);
    // Even the right password is refused while the email is locked out.
    await request(app).post('/api/v1/auth/login').send(DEMO.priya).expect(429);
  });

  it('health is never throttled, even past the global limit', async () => {
    const app = createApp(env);
    for (let i = 0; i < 110; i += 1) {
      await request(app).get('/api/health').expect(200);
    }
    // Meanwhile anything else from the same client is limited at 100/min.
    for (let i = 0; i < 100; i += 1) {
      await request(app).get('/api/nope').expect(404);
    }
    const limited = await request(app).get('/api/nope').expect(429);
    expectErrorBody(limited.body, 429, 'RATE_LIMITED');
    await request(app).get('/api/health').expect(200);
  });

  it('signed-in traffic is limited per user, not per IP: user A is cut off at 101 while user B (same IP) is not', async () => {
    const app = createApp(env);
    const [a, b] = await Promise.all([
      signIn(app, DEMO.priya),
      signIn(app, DEMO.rahul),
    ]);
    for (let i = 0; i < 100; i += 1) {
      await a.agent.get('/api/v1/dashboard').expect(200);
    }
    const limited = await a.agent.get('/api/v1/dashboard').expect(429);
    expectErrorBody(limited.body, 429, 'RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    await b.agent.get('/api/v1/dashboard').expect(200);
    // The user bucket is separate from the anonymous IP bucket: the same client can still reach the auth routes.
    await request(app).post('/api/v1/auth/logout').expect(204);
  });

  it('anonymous traffic to the auth routes is limited per IP at 100/min', async () => {
    const app = createApp(env);
    for (let i = 0; i < 100; i += 1) {
      await request(app).post('/api/v1/auth/logout').expect(204);
    }
    const limited = await request(app).post('/api/v1/auth/logout').expect(429);
    expectErrorBody(limited.body, 429, 'RATE_LIMITED');
    // An unknown auth path shares the same IP bucket.
    await request(app).get('/api/v1/auth/nope').expect(429);
    await request(app).get('/api/health').expect(200);
  });

  it('refresh is limited to 30/min per refresh cookie', async () => {
    const app = createApp(env);
    const refresh = (token: string): request.Test =>
      request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${token}`);
    for (let i = 0; i < 30; i += 1) await refresh('bogus-one').expect(401);
    await refresh('bogus-one').expect(429);
    await refresh('bogus-two').expect(401);
  });

  it('comments and transitions share a 20/min budget per user', async () => {
    const app = createApp(env);
    const admin = await signIn(app, DEMO.admin);
    const list = await admin.agent.get('/api/v1/tasks?limit=1').expect(200);
    const taskId = (list.body as { items: { id: string }[] }).items[0].id;
    const comment = (): request.Test =>
      admin.agent
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Origin', ORIGIN)
        .send({ body: 'ping' });
    for (let i = 0; i < 19; i += 1) await comment().expect(201);
    // The 20th action is a transition attempt (invalid, but it still counts).
    await admin.agent
      .post(`/api/v1/tasks/${taskId}/transition`)
      .set('Origin', ORIGIN)
      .send({ to: 'PENDING' })
      .expect((res) => expect(res.status).not.toBe(429));
    const res = await comment().expect(429);
    expectErrorBody(res.body, 429, 'RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
    // Reading is not a limited action.
    await admin.agent.get(`/api/v1/tasks/${taskId}/comments`).expect(200);

    const priya = await signIn(app, DEMO.priya);
    const own = await priya.agent.get('/api/v1/tasks?limit=1').expect(200);
    const ownId = (own.body as { items: { id: string }[] }).items[0].id;
    await priya.agent
      .post(`/api/v1/tasks/${ownId}/comments`)
      .set('Origin', ORIGIN)
      .send({ body: 'still allowed' })
      .expect(201);
  });
});
