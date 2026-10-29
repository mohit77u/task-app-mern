import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from './common/errors/error-handler';
import { jwtAuth } from './common/middleware/jwt-auth';
import { originCheck } from './common/middleware/origin';
import { rateLimits, type RateLimits } from './common/middleware/rate-limits';
import { requestId } from './common/middleware/request-id';
import { buildServices, type Services } from './composition';
import type { Env } from './config/env.validation';
import { authRouter } from './modules/auth/auth.routes';
import { commentsRouter } from './modules/comments/comments.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { healthRouter } from './modules/health/health.routes';
import {
  taskTransitionRouter,
  tasksRouter,
} from './modules/tasks/tasks.routes';
import { rolesRouter } from './modules/users/roles.routes';
import { usersRouter } from './modules/users/users.routes';

/**
 * `/api/v1`. Auth routes come first because login, refresh and logout must work without an access token (`/auth/me`
 * carries its own `jwtAuth`); they sit behind the per-IP limiter. Everything mounted after `jwtAuth` is protected by
 * default, including unknown paths (an anonymous caller gets 401, a signed-in one 404), and is limited per user: behind
 * a proxy many users share an IP, so an IP-keyed limit must never sit in front of authenticated traffic.
 */
function v1Router(env: Env, services: Services, limits: RateLimits): Router {
  const router = Router();
  router.use(
    '/auth',
    limits.anonymous,
    authRouter(env, {
      service: services.auth,
      loginLimiter: limits.login,
      refreshLimiter: limits.refresh,
    }),
  );
  router.use(jwtAuth(env));
  router.use(limits.authenticated);
  router.use('/users', usersRouter(services.users));
  router.use('/roles', rolesRouter(services.users));
  router.use(
    '/tasks',
    tasksRouter(services.tasks),
    taskTransitionRouter(services.tasks, limits.userAction),
    commentsRouter(services.comments, limits.userAction),
  );
  router.use('/dashboard', dashboardRouter(services.dashboard));
  // Answered here so a /api/v1 request never reaches the app-level anonymous limiter as well.
  router.use(notFoundHandler);
  return router;
}

/** Builds the HTTP app. Does not listen and does not connect to the database; `main.ts` does both. */
export function createApp(env: Env): Express {
  const services = buildServices(env);
  const limits = rateLimits(env);
  const app = express();

  // Requests arrive through proxies; the hop count makes `req.ip` (and so the IP-keyed limits) the real client.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // First, so every response, including parser failures and 404s, carries a request id.
  app.use(requestId);
  app.use(helmet());
  const corsOptions: CorsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  };
  app.use(
    // Exact-match allow-list. Any other origin gets no CORS headers at all (the browser then blocks the read) and no
    // error here; writes from it are refused by `originCheck` below.
    cors((req, callback) => {
      const origin = req.headers.origin;
      const allowed =
        origin !== undefined && env.FRONTEND_ORIGINS.includes(origin);
      callback(null, allowed ? corsOptions : { origin: false });
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(originCheck(env.FRONTEND_ORIGINS));
  // Public and outside every limiter: health checks and uptime pings must never be throttled.
  app.use('/api', healthRouter());
  // After the body parser and cookie parser, so the route limiters inside can key on the email and refresh cookie.
  app.use('/api/v1', v1Router(env, services, limits));
  // Anything else is an unknown path from an anonymous client: limited per IP, then 404.
  app.use(limits.anonymous);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
