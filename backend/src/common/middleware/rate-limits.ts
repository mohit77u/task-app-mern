import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import type { Env } from '../../config/env.validation';
import { readCookie, REFRESH_COOKIE } from '../../security/cookies';
import { AppException } from '../errors/app.exception';

export interface RateLimits {
  /** 100/min per user when signed in, otherwise per IP. */
  global: RequestHandler;
  /** 5/min per normalised email (falls back to IP). Must run after `express.json()`. */
  login: RequestHandler;
  /** 30/min per refresh cookie (falls back to IP). Must run after `cookieParser()`. */
  refresh: RequestHandler;
  /** 20/min per user for transitions and comments. Must run after `jwtAuth`. */
  userAction: RequestHandler;
}

const WINDOW_MS = 60_000;

const passThrough: RequestHandler = (_req, _res, next) => next();

/** The client IP, with IPv6 addresses collapsed to their /56 so one host cannot rotate through its own subnet. */
export function ipKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

export function userKey(req: Request): string {
  return req.user ? `user:${req.user.id}` : ipKey(req);
}

/** Reads the email from the already-parsed JSON body, so the login limiter must sit after `express.json()`. */
export function loginKey(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string' || email.trim() === '') return ipKey(req);
  return `login:${email.trim().toLowerCase()}`;
}

/** Hashed so the refresh token itself never sits in the limiter's store. */
export function refreshKey(
  token: string | undefined,
  fallbackKey: string,
): string {
  if (!token) return fallbackKey;
  const digest = createHash('sha256').update(token).digest('hex');
  return `refresh:${digest.slice(0, 16)}`;
}

/** Seconds until the caller's window resets, at least 1. */
function retryAfterSeconds(req: Request): number {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } })
    .rateLimit?.resetTime;
  const ms = resetTime ? resetTime.getTime() - Date.now() : WINDOW_MS;
  return Math.max(1, Math.ceil(ms / 1000));
}

function limiter(
  limit: number,
  keyGenerator: (req: Request) => string,
): RequestHandler {
  const options: Partial<Options> = {
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    // Routed through the app's error pipeline so the 429 body follows the error contract and carries Retry-After.
    handler: (req, _res, next) => {
      next(AppException.rateLimited(retryAfterSeconds(req)));
    },
  };
  return rateLimit(options);
}

/**
 * The app's rate limiters, each with its own in-memory store (one instance per `createApp`). With
 * `THROTTLING_ENABLED=false` every limiter is a pass-through.
 */
export function rateLimits(env: Env): RateLimits {
  if (!env.THROTTLING_ENABLED) {
    return {
      global: passThrough,
      login: passThrough,
      refresh: passThrough,
      userAction: passThrough,
    };
  }
  return {
    global: limiter(100, userKey),
    login: limiter(5, loginKey),
    refresh: limiter(30, (req) =>
      refreshKey(readCookie(req, REFRESH_COOKIE), ipKey(req)),
    ),
    userAction: limiter(20, userKey),
  };
}
