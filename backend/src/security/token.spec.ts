import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { testEnv } from '../../test/mongo';
import { RoleCode } from '../common/enums/role-code';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { signAccessToken, verifyAccessToken } from './token';

const env = testEnv();
const SECRET = env.JWT_ACCESS_SECRET;
const USER_ID = new Types.ObjectId().toHexString();

function codeOf(fn: () => unknown): ErrorCode {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('access token', () => {
  it('round-trips the user identity with the id as the subject', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(
      { id: USER_ID, role: RoleCode.ADMIN },
      env,
    );
    const claims = verifyAccessToken(token, env);
    expect(claims).toEqual({
      id: USER_ID,
      role: RoleCode.ADMIN,
      issuedAt: expect.any(Number),
    });
    expect(claims.issuedAt).toBeGreaterThanOrEqual(before - 1);
    expect(jwt.decode(token)).toMatchObject({ sub: USER_ID, role: 'ADMIN' });
  });

  it('expires after ACCESS_TOKEN_TTL', async () => {
    const token = await signAccessToken(
      { id: USER_ID, role: RoleCode.EMPLOYEE },
      testEnv({ ACCESS_TOKEN_TTL: '30m' }),
    );
    const payload = jwt.decode(token) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(30 * 60);
  });

  it('reports an expired token as TOKEN_EXPIRED so clients know to refresh', () => {
    const expired = jwt.sign({ sub: USER_ID, role: 'ADMIN' }, SECRET, {
      expiresIn: -10,
    });
    expect(codeOf(() => verifyAccessToken(expired, env))).toBe(
      ErrorCode.TOKEN_EXPIRED,
    );
  });

  it('reports a tampered or foreign token as UNAUTHENTICATED', async () => {
    const token = await signAccessToken(
      { id: USER_ID, role: RoleCode.ADMIN },
      env,
    );
    expect(codeOf(() => verifyAccessToken(`${token}x`, env))).toBe(
      ErrorCode.UNAUTHENTICATED,
    );
    expect(codeOf(() => verifyAccessToken('not-a-jwt', env))).toBe(
      ErrorCode.UNAUTHENTICATED,
    );
    expect(codeOf(() => verifyAccessToken(token, testEnv()))).toBe(
      ErrorCode.UNAUTHENTICATED,
    );
  });

  it('rejects a validly signed token with an unexpected payload shape', () => {
    for (const payload of [
      { sub: 'abc', role: 'ADMIN' },
      { sub: 7, role: 'ADMIN' },
      { sub: USER_ID, role: 'ROOT' },
    ]) {
      const odd = jwt.sign(payload, SECRET, { expiresIn: 60 });
      expect(codeOf(() => verifyAccessToken(odd, env))).toBe(
        ErrorCode.UNAUTHENTICATED,
      );
    }
  });

  it('rejects a token without an issued-at claim, since revocation checks depend on it', () => {
    const noIat = jwt.sign({ sub: USER_ID, role: 'ADMIN' }, SECRET, {
      expiresIn: 60,
      noTimestamp: true,
    });
    expect(codeOf(() => verifyAccessToken(noIat, env))).toBe(
      ErrorCode.UNAUTHENTICATED,
    );
  });
});
