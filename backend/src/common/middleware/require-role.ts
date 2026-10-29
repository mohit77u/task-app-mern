import type { RequestHandler } from 'express';
import type { RoleCode } from '../enums/role-code';
import { AppException } from '../errors/app.exception';

/** Route-level role gate. Must run after `jwtAuth`, which sets `req.user`. */
export function requireRole(...roles: RoleCode[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(AppException.unauthenticated());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(AppException.forbidden());
      return;
    }
    next();
  };
}
