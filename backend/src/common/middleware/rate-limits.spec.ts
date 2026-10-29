import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { testEnv } from '../../../test/mongo';
import { RoleCode } from '../enums/role-code';
import { errorHandler } from '../errors/error-handler';
import { loginKey, rateLimits, refreshKey } from './rate-limits';
import { requestId } from './request-id';

/** Sets `req.user` from an `x-user` header so the user-keyed limiters can be driven without a database. */
const fakeUser: RequestHandler = (req, _res, next) => {
  const id = req.header('x-user');
  if (id) req.user = { id, role: RoleCode.EMPLOYEE };
  next();
};

function appWith(limiter: RequestHandler): Express {
  const app = express();
  app.use(requestId);
  app.use(cookieParser());
  app.use(express.json());
  app.use(fakeUser);
  app.post('/hit', limiter, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

async function hit(
  app: Express,
  times: number,
  build: (t: request.Test) => request.Test = (t) => t,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    statuses.push((await build(request(app).post('/hit'))).status);
  }
  return statuses;
}

const enabled = (): ReturnType<typeof rateLimits> =>
  rateLimits(testEnv({ THROTTLING_ENABLED: 'true' }));

describe('rateLimits', () => {
  it('login: 5 per minute per normalised email, then 429 with Retry-After and the error contract', async () => {
    const app = appWith(enabled().login);
    const send = (email: string) => (t: request.Test) => t.send({ email });
    expect(await hit(app, 3, send('a@x.com'))).toEqual([200, 200, 200]);
    // Case and surrounding whitespace do not open a new bucket.
    expect(await hit(app, 2, send('  A@X.com '))).toEqual([200, 200]);

    const res = await request(app).post('/hit').send({ email: 'a@x.com' });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(res.body).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      details: [],
      requestId: expect.any(String),
      path: '/hit',
    });

    expect(await hit(app, 1, send('b@x.com'))).toEqual([200]);
  });

  it('login without an email falls back to the client IP', async () => {
    const app = appWith(enabled().login);
    expect(await hit(app, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(await hit(app, 1)).toEqual([429]);
  });

  it('refresh: 30 per minute per refresh cookie, keyed by a hash rather than the token', async () => {
    const app = appWith(enabled().refresh);
    const withCookie = (token: string) => (t: request.Test) =>
      t.set('Cookie', `refresh_token=${token}`);
    const statuses = await hit(app, 31, withCookie('token-one'));
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(await hit(app, 1, withCookie('token-two'))).toEqual([200]);

    const key = refreshKey('abcdefghijklmnopqrstuvwxyz0123456789', 'ip:x');
    expect(key).toMatch(/^refresh:[0-9a-f]{16}$/);
    expect(key).not.toContain('abcdefghijklmnop');
  });

  it('userAction: 20 per minute per user id', async () => {
    const app = appWith(enabled().userAction);
    const as = (id: string) => (t: request.Test) => t.set('x-user', id);
    const statuses = await hit(app, 21, as('user-a'));
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(await hit(app, 1, as('user-b'))).toEqual([200]);
  });

  it('anonymous: 100 per minute per IP, regardless of any user on the request', async () => {
    const app = appWith(enabled().anonymous);
    const statuses = await hit(app, 101);
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses[100]).toBe(429);
    expect(await hit(app, 1, (t) => t.set('x-user', 'user-a'))).toEqual([429]);
  });

  // Unit check of the key only; test/throttling.http.spec.ts proves it is mounted behind jwtAuth in the real app.
  it('authenticated: 100 per minute per user id', async () => {
    const app = appWith(enabled().authenticated);
    const as = (id: string) => (t: request.Test) => t.set('x-user', id);
    const statuses = await hit(app, 101, as('user-a'));
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses[100]).toBe(429);
    expect(await hit(app, 1, as('user-b'))).toEqual([200]);
  });

  it('the login key is a hash of the normalised email, never the raw email', () => {
    const fake = (email: unknown) =>
      ({ body: { email }, ip: '1.2.3.4' }) as never;
    const key = loginKey(fake('  Someone@Example.COM '));
    expect(key).toMatch(/^login:[0-9a-f]{32}$/);
    expect(key).not.toContain('someone');
    expect(loginKey(fake('someone@example.com'))).toBe(key);
    expect(loginKey(fake('x'.repeat(100_000)))).toHaveLength(
      'login:'.length + 32,
    );
    expect(loginKey(fake(undefined))).toBe('ip:1.2.3.4');
  });

  it('THROTTLING_ENABLED=false turns every limiter into a pass-through', async () => {
    const limits = rateLimits(testEnv({ THROTTLING_ENABLED: 'false' }));
    const app = appWith(limits.login);
    const statuses = await hit(app, 8, (t) => t.send({ email: 'a@x.com' }));
    expect(statuses.every((s) => s === 200)).toBe(true);
    const userApp = appWith(limits.userAction);
    expect(
      (await hit(userApp, 25, (t) => t.set('x-user', 'u'))).every(
        (s) => s === 200,
      ),
    ).toBe(true);
  });
});
