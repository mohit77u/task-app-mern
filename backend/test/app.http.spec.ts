import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/security/cookies';
import { DEMO, EVIL_ORIGIN, expectErrorBody, ORIGIN, seedDemo } from './http';
import { startTestDb, stopTestDb, testEnv } from './mongo';

/** Cross-cutting behaviour of the assembled middleware stack. */
describe('app assembly over HTTP', () => {
  const env = testEnv();
  let app: Express;

  beforeAll(async () => {
    await startTestDb();
    await seedDemo(env);
    app = createApp(env);
  });
  afterAll(stopTestDb);

  it('every response carries X-Request-Id, including errors and unknown routes', async () => {
    for (const path of ['/api/health', '/api/v1/tasks', '/nowhere']) {
      const res = await request(app).get(path);
      expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
    }
  });

  it('unknown routes outside /api/v1 answer 404 with the contract body', async () => {
    const res = await request(app).get('/api/unknown').expect(404);
    expectErrorBody(res.body, 404, 'NOT_FOUND');
    await request(app).get('/').expect(404);
  });

  it('sets helmet security headers', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('login sets the access cookie on Path=/api and the refresh cookie on Path=/api/v1/auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send(DEMO.admin)
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
    expect(access).toMatch(/; Path=\/api;/);
    expect(refresh).toMatch(/; Path=\/api\/v1\/auth;/);
    for (const cookie of [access, refresh]) {
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).not.toMatch(/Domain=/);
    }
  });

  describe('CORS', () => {
    it('an allowed origin gets credentialed CORS headers', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', ORIGIN)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('a preflight from an allowed origin is answered with the allow-list and max-age 600', async () => {
      const res = await request(app)
        .options('/api/v1/tasks')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'PATCH')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-methods']).toContain('PATCH');
      expect(res.headers['access-control-max-age']).toBe('600');
    });

    it('a disallowed origin gets no CORS headers (and no error on reads)', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', EVIL_ORIGIN)
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('Origin check', () => {
    it('a POST from a disallowed origin is 403 FORBIDDEN before authentication runs', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', EVIL_ORIGIN)
        .send(DEMO.admin)
        .expect(403);
      expectErrorBody(res.body, 403, 'FORBIDDEN');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('a POST without an Origin header passes', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(DEMO.admin)
        .expect(200);
      expect(res.body.user.email).toBe(DEMO.admin.email);
    });
  });

  it('bodies over 100kb are refused with 413 and the contract body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@x.com', password: 'x'.repeat(110_000) }))
      .expect(413);
    expectErrorBody(res.body, 413, 'VALIDATION_ERROR');
  });
});
