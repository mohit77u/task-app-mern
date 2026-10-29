import type { Request, RequestHandler } from 'express';
import { AppException } from '../../common/errors/app.exception';
import type { Env } from '../../config/env.validation';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookies,
} from '../../security/cookies';
import type { LoginBody } from './auth.schemas';
import type { AuthService } from './auth.service';
import type { ClientMeta } from './refresh-token.service';

export interface AuthController {
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
}

function clientMeta(req: Request): ClientMeta {
  return { userAgent: req.get('user-agent') ?? undefined, ip: req.ip };
}

export function createAuthController(
  env: Env,
  auth: AuthService,
): AuthController {
  return {
    /** Body validated by `validate(loginSchema, 'body')`, which puts the parsed value on `res.locals.body`. */
    login: async (req, res) => {
      const { email, password } = res.locals.body as LoginBody;
      const session = await auth.login(email, password, clientMeta(req));
      setAuthCookies(res, env, {
        access: session.access,
        refresh: session.refresh,
      });
      res.status(200).json({ user: session.user });
    },

    refresh: async (req, res) => {
      const refreshCookie = readCookie(req, REFRESH_COOKIE);
      try {
        const result = await auth.refresh(refreshCookie, clientMeta(req));
        setAuthCookies(res, env, result);
        res.status(200).json({ refreshed: true });
      } catch (error) {
        // A dead session must not leave a dead cookie behind, or the client would retry it forever. Only clear when a
        // refresh cookie was actually sent: a cookie-less refresh (e.g. a first-visit bootstrap) can resolve after the
        // user logged in, and its Set-Cookie clears would wipe the fresh session.
        if (refreshCookie && error instanceof AppException)
          clearAuthCookies(res, env);
        throw error;
      }
    },

    // Mounted without JWT auth on purpose: logging out must work after the access token expired. It only needs the
    // refresh cookie.
    logout: async (req, res) => {
      await auth.logout(readCookie(req, REFRESH_COOKIE));
      clearAuthCookies(res, env);
      res.status(204).end();
    },

    me: async (req, res) => {
      if (!req.user) throw AppException.unauthenticated();
      res.json(await auth.me(req.user.id));
    },
  };
}
