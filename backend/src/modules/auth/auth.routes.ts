import { Router, type RequestHandler } from 'express';
import { jwtAuth } from '../../common/middleware/jwt-auth';
import { validate } from '../../common/validation/validate';
import type { Env } from '../../config/env.validation';
import { createAuthController } from './auth.controller';
import { loginSchema } from './auth.schemas';
import { AuthService } from './auth.service';

export interface AuthRouterOptions {
  service?: AuthService;
  /** Rate limiters supplied by the app (Task 9); omitted means no route-specific limit. */
  loginLimiter?: RequestHandler;
  refreshLimiter?: RequestHandler;
}

const passThrough: RequestHandler = (_req, _res, next) => next();

/**
 * Routes under `/api/v1/auth`. Mounted before the global `jwtAuth`: login, refresh and logout must work without a valid
 * access token. `/me` is the one route here that needs one, so it carries `jwtAuth` itself.
 */
export function authRouter(env: Env, options: AuthRouterOptions = {}): Router {
  const controller = createAuthController(
    env,
    options.service ?? new AuthService(env),
  );
  const router = Router();
  router.post(
    '/login',
    options.loginLimiter ?? passThrough,
    validate(loginSchema, 'body'),
    controller.login,
  );
  router.post(
    '/refresh',
    options.refreshLimiter ?? passThrough,
    controller.refresh,
  );
  router.post('/logout', controller.logout);
  router.get('/me', jwtAuth(env), controller.me);
  return router;
}
