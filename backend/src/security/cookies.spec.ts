import express from 'express';
import request from 'supertest';
import { testEnv } from '../../test/mongo';
import type { Env } from '../config/env.validation';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from './cookies';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function appFor(env: Env): express.Express {
  const app = express();
  app.get('/set', (_req, res) => {
    setAuthCookies(res, env, { access: 'A', refresh: 'R' });
    res.end();
  });
  app.get('/set-access-only', (_req, res) => {
    setAuthCookies(res, env, { access: 'A' });
    res.end();
  });
  app.get('/clear', (_req, res) => {
    clearAuthCookies(res, env);
    res.end();
  });
  return app;
}

async function setCookies(env: Env, path: string): Promise<string[]> {
  const res = await request(appFor(env)).get(path);
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header ?? [];
}

function cookieNamed(cookies: string[], name: string): string {
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`no ${name} cookie in ${cookies.join(' | ')}`);
  return found;
}

describe('auth cookies', () => {
  it('uses the cookie names from the original app', () => {
    expect(ACCESS_COOKIE).toBe('access_token');
    expect(REFRESH_COOKIE).toBe('refresh_token');
  });

  it.each([
    [ACCESS_COOKIE, 'A', '/api'],
    [REFRESH_COOKIE, 'R', '/api/v1/auth'],
  ])(
    '%s: value, Path, HttpOnly, SameSite, host-only, Max-Age 1 year',
    async (name, value, path) => {
      const cookie = cookieNamed(await setCookies(testEnv(), '/set'), name);
      const parts = cookie.split('; ');
      expect(parts[0]).toBe(`${name}=${value}`);
      expect(parts).toContain(`Path=${path}`);
      expect(parts).toContain('HttpOnly');
      expect(parts).toContain('SameSite=Lax');
      expect(parts).toContain(`Max-Age=${ONE_YEAR_SECONDS}`);
      expect(parts).not.toContain('Secure');
      expect(cookie).not.toMatch(/Domain=/i);
    },
  );

  it('sets Secure and SameSite from the environment', async () => {
    const env = testEnv({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'strict' });
    const cookies = await setCookies(env, '/set');
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      const parts = cookieNamed(cookies, name).split('; ');
      expect(parts).toContain('Secure');
      expect(parts).toContain('SameSite=Strict');
    }
  });

  it('only sets the access cookie when no refresh token is given (grace refresh)', async () => {
    const cookies = await setCookies(testEnv(), '/set-access-only');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^access_token=A;/);
  });

  it('clears both cookies with matching Path and flags so the browser deletes them', async () => {
    const cookies = await setCookies(testEnv(), '/clear');
    expect(cookies).toHaveLength(2);
    for (const [name, path] of [
      [ACCESS_COOKIE, '/api'],
      [REFRESH_COOKIE, '/api/v1/auth'],
    ]) {
      const parts = cookieNamed(cookies, name).split('; ');
      expect(parts[0]).toBe(`${name}=`);
      expect(parts).toContain(`Path=${path}`);
      expect(parts).toContain('HttpOnly');
      expect(parts.some((p) => p.startsWith('Expires=Thu, 01 Jan 1970'))).toBe(
        true,
      );
      expect(parts.some((p) => p.startsWith('Max-Age'))).toBe(false);
    }
  });
});
