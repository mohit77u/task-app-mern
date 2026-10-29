import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.validation';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuthCookieOptions {
  access: CookieOptions;
  refresh: CookieOptions;
}

/**
 * The only place cookie attributes are defined. Both cookies live as long as the refresh token (1 year by default):
 * the access JWT enforces its own 30 minute expiry, and keeping its cookie around lets the API answer TOKEN_EXPIRED
 * rather than the browser silently deleting the cookie and making expiry indistinguishable from "never logged in".
 * No `domain` is set, so cookies are host-only and never leak to sibling subdomains.
 */
export function authCookieOptions(env: Env): AuthCookieOptions {
  const common: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  };
  return {
    access: { ...common, path: '/api' },
    // Limited to the auth routes so the long-lived credential is not sent with every API call.
    refresh: { ...common, path: '/api/v1/auth' },
  };
}

/** Browsers only delete a cookie when path and flags match, so reuse the originals without the lifetime. */
function clearOptions(options: CookieOptions): CookieOptions {
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest;
}

/** Sets the access cookie, and the refresh cookie when one was issued (a grace-window refresh issues none). */
export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: { access: string; refresh?: string },
): void {
  const options = authCookieOptions(env);
  res.cookie(ACCESS_COOKIE, tokens.access, options.access);
  if (tokens.refresh !== undefined)
    res.cookie(REFRESH_COOKIE, tokens.refresh, options.refresh);
}

export function clearAuthCookies(res: Response, env: Env): void {
  const options = authCookieOptions(env);
  res.clearCookie(ACCESS_COOKIE, clearOptions(options.access));
  res.clearCookie(REFRESH_COOKIE, clearOptions(options.refresh));
}

/** A non-empty string cookie, or undefined. Requires cookie-parser to have run. */
export function readCookie(req: Request, name: string): string | undefined {
  const cookies = (req as { cookies?: Record<string, unknown> }).cookies;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
