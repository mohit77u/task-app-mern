import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Env } from '../src/config/env.validation';
import { RefreshTokenModel, RoleModel, UserModel } from '../src/models';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/security/cookies';
import { hashPassword } from '../src/security/password';
import { hashRefreshToken } from '../src/security/refresh-token-util';
import { clearTestDb, startTestDb, stopTestDb, testEnv } from './mongo';

const EMAIL = 'emp@example.com';
const PASSWORD = 'Employee#123';
const ORIGIN = 'http://localhost:5173';

interface SessionCookies {
  access: string;
  refresh: string;
}

function setCookieHeaders(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = setCookieHeaders(res).find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0].slice(name.length + 1);
}

// Un-skipped in Task 9, once src/app.ts provides createApp.
describe.skip('auth over HTTP', () => {
  const env = testEnv();
  let createApp: (env: Env) => Express;
  let app: Express;
  let userId: string;

  beforeAll(async () => {
    // Loaded lazily so this file type-checks before src/app.ts exists.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ createApp } = require('../src/app') as {
      createApp: (env: Env) => Express;
    });
    await startTestDb();
    app = createApp(env);
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    const role = await RoleModel.create({ code: 'EMPLOYEE', name: 'Employee' });
    const user = await UserModel.create({
      name: 'Emp One',
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      roleId: role._id,
    });
    userId = user._id.toHexString();
  });

  function login(email = EMAIL, password = PASSWORD): request.Test {
    return request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password });
  }

  async function loginCookies(): Promise<SessionCookies> {
    const res = await login().expect(200);
    const access = cookieValue(res, ACCESS_COOKIE);
    const refresh = cookieValue(res, REFRESH_COOKIE);
    if (!access || !refresh) throw new Error('login did not set cookies');
    return { access, refresh };
  }

  function refresh(token: string): request.Test {
    return request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `${REFRESH_COOKIE}=${token}`);
  }

  function me(access: string): request.Test {
    return request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${ACCESS_COOKIE}=${access}`);
  }

  it('login sets both cookies with their Paths and returns the user', async () => {
    const res = await login().expect(200);
    expect(res.body.user).toMatchObject({ id: userId, email: EMAIL });
    const cookies = setCookieHeaders(res);
    const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    const refreshCookie = cookies.find((c) =>
      c.startsWith(`${REFRESH_COOKIE}=`),
    );
    expect(access).toMatch(/; Path=\/api;/);
    expect(access).toMatch(/HttpOnly/);
    expect(refreshCookie).toMatch(/; Path=\/api\/v1\/auth;/);
    expect(refreshCookie).toMatch(/HttpOnly/);

    const meRes = await me(cookieValue(res, ACCESS_COOKIE)!).expect(200);
    expect(meRes.body).toMatchObject({ id: userId, email: EMAIL });
  });

  it('answers a wrong password and an unknown email with identical bodies', async () => {
    const wrong = await login(EMAIL, 'wrong-password').expect(401);
    const unknown = await login('nobody@example.com', PASSWORD).expect(401);
    const strip = (body: Record<string, unknown>) => {
      const { requestId: _r, timestamp: _t, ...rest } = body;
      return rest;
    };
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password',
    });
    expect(setCookieHeaders(wrong)).toHaveLength(0);
  });

  it('an expired access cookie gives TOKEN_EXPIRED, then refresh returns a new pair', async () => {
    const session = await loginCookies();
    const expired = jwt.sign(
      { sub: userId, role: 'EMPLOYEE' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    const res = await me(expired).expect(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');

    const refreshed = await refresh(session.refresh).expect(200);
    expect(refreshed.body).toEqual({ refreshed: true });
    const access = cookieValue(refreshed, ACCESS_COOKIE);
    const nextRefresh = cookieValue(refreshed, REFRESH_COOKIE);
    expect(access).toBeTruthy();
    expect(nextRefresh).toBeTruthy();
    expect(nextRefresh).not.toBe(session.refresh);
    await me(access!).expect(200);
  });

  it('a second refresh with the same token inside the grace window only sets a new access cookie', async () => {
    const session = await loginCookies();
    await refresh(session.refresh).expect(200);
    const again = await refresh(session.refresh).expect(200);
    expect(cookieValue(again, ACCESS_COOKIE)).toBeTruthy();
    expect(cookieValue(again, REFRESH_COOKIE)).toBeUndefined();
  });

  it('replaying a rotated refresh token after the grace window is 401 and kills the newest token too', async () => {
    const session = await loginCookies();
    const rotated = await refresh(session.refresh).expect(200);
    const newest = cookieValue(rotated, REFRESH_COOKIE)!;
    // Move the rotation outside the 10 s grace window.
    await RefreshTokenModel.updateOne(
      { tokenHash: hashRefreshToken(session.refresh) },
      { revokedAt: new Date(Date.now() - 11_000) },
    );

    const replay = await refresh(session.refresh).expect(401);
    expect(replay.body.code).toBe('UNAUTHENTICATED');
    // The dead cookies are cleared so the client does not retry them forever.
    expect(cookieValue(replay, REFRESH_COOKIE)).toBe('');
    await refresh(newest).expect(401);
  });

  it('logout revokes the session: refresh afterwards is 401 and cookies are cleared', async () => {
    const session = await loginCookies();
    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', `${REFRESH_COOKIE}=${session.refresh}`)
      .expect(204);
    expect(cookieValue(out, ACCESS_COOKIE)).toBe('');
    expect(cookieValue(out, REFRESH_COOKIE)).toBe('');
    await refresh(session.refresh).expect(401);
  });

  it('logout works with an expired access token', async () => {
    const session = await loginCookies();
    const expired = jwt.sign(
      { sub: userId, role: 'EMPLOYEE' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', [
        `${ACCESS_COOKIE}=${expired}`,
        `${REFRESH_COOKIE}=${session.refresh}`,
      ])
      .expect(204);
    await refresh(session.refresh).expect(401);
  });

  it('a user soft-deleted after login gets 401 on /auth/me and on /auth/refresh (Review Focus 5)', async () => {
    const session = await loginCookies();
    await me(session.access).expect(200);
    await UserModel.updateOne({ _id: userId }, { deletedAt: new Date() });

    const meRes = await me(session.access).expect(401);
    expect(meRes.body.code).toBe('UNAUTHENTICATED');
    const refreshRes = await refresh(session.refresh).expect(401);
    expect(refreshRes.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed login body with 422', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'not-an-email', password: '' })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
