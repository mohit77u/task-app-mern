import type { RequestHandler } from 'express';
import type { Env } from '../../config/env.validation';
import { findActiveUserWithRole } from '../../modules/auth/session-user';
import { ACCESS_COOKIE, readCookie } from '../../security/cookies';
import {
  type AccessTokenClaims,
  verifyAccessToken,
} from '../../security/token';
import { isRoleCode } from '../enums/role-code';
import { AppException } from '../errors/app.exception';
import type { AuthUser } from '../types/request.types';

/** The fields of the user document the session check needs. */
export interface SessionUserRow {
  id: string;
  passwordChangedAt: Date | null;
  role: { code: string };
}

/**
 * Decides whether a correctly signed access token still stands for a live session. A signature alone cannot tell, because
 * the token is valid for its full TTL: the user may have been deleted, had their password changed (which must sign them
 * out) or been given another role since it was issued.
 *
 * `iat` has whole-second resolution, so a token issued in the same second as the password change cannot be ordered
 * against it. It is refused: the cost is at most one extra sign-in within a second of the change, whereas accepting it
 * could keep a pre-change session alive.
 */
export function resolveSessionUser(
  claims: AccessTokenClaims,
  user: SessionUserRow | null,
): AuthUser {
  if (!user) throw AppException.unauthenticated();
  if (
    user.passwordChangedAt &&
    claims.issuedAt <= Math.floor(user.passwordChangedAt.getTime() / 1000)
  ) {
    throw AppException.unauthenticated(
      'Session expired. Please sign in again.',
    );
  }
  // The database role wins over the role in the token, so a role change takes effect on the next request.
  if (!isRoleCode(user.role.code)) throw AppException.unauthenticated();
  return { id: user.id, role: user.role.code };
}

/**
 * Authenticates every request it is applied to and attaches `req.user`. Routes that must work without a valid access
 * token (login, refresh, logout, health) are mounted before it, so a new route is protected by default.
 *
 * Costs one lookup per request. There is deliberately no cache: any cache would reopen a window in which a deleted or
 * signed-out user is still let in.
 */
export function jwtAuth(env: Env): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, ACCESS_COOKIE);
    if (!token) throw AppException.unauthenticated();

    const claims = verifyAccessToken(token, env);
    const found = await findActiveUserWithRole(claims.id);
    req.user = resolveSessionUser(
      claims,
      found && {
        id: found.user._id.toHexString(),
        passwordChangedAt: found.user.passwordChangedAt,
        role: { code: found.role.code },
      },
    );
    next();
  };
}
