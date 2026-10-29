import jwt, { type SignOptions } from 'jsonwebtoken';
import { isRoleCode, type RoleCode } from '../common/enums/role-code';
import { AppException } from '../common/errors/app.exception';
import type { AuthUser } from '../common/types/request.types';
import { parseObjectId } from '../common/utils/object-id';
import type { Env } from '../config/env.validation';

/** What a valid signature proves. The role is only a hint: the auth middleware re-reads the authoritative one. */
export interface AccessTokenClaims extends AuthUser {
  /** `iat`, in whole seconds since the epoch (jsonwebtoken adds it on every sign). */
  issuedAt: number;
}

export function signAccessToken(user: AuthUser, env: Env): Promise<string> {
  return new Promise((resolve, reject) => {
    jwt.sign(
      { sub: user.id, role: user.role satisfies RoleCode },
      env.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        // The env value is validated as a duration string; the library's type is a narrower template literal.
        expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
      },
      (error, token) => {
        if (error || !token) reject(error ?? new Error('JWT signing failed'));
        else resolve(token);
      },
    );
  });
}

export function verifyAccessToken(token: string, env: Env): AccessTokenClaims {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    });
  } catch (error) {
    // Distinguishing "expired" lets the client refresh silently instead of sending the user to the login page.
    throw error instanceof jwt.TokenExpiredError
      ? AppException.tokenExpired()
      : AppException.unauthenticated();
  }
  if (typeof payload === 'string') throw AppException.unauthenticated();
  const { sub, iat } = payload;
  const role: unknown = payload.role;
  if (
    typeof sub !== 'string' ||
    parseObjectId(sub) === null ||
    typeof role !== 'string' ||
    !isRoleCode(role) ||
    typeof iat !== 'number'
  ) {
    throw AppException.unauthenticated();
  }
  return { id: sub, role, issuedAt: iat };
}
