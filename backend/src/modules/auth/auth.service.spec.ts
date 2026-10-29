import { Types } from 'mongoose';
import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import { AppException } from '../../common/errors/app.exception';
import { RefreshTokenModel, RoleModel, UserModel } from '../../models';
import { hashPassword } from '../../security/password';
import { hashRefreshToken } from '../../security/refresh-token-util';
import { verifyAccessToken } from '../../security/token';
import { AuthService } from './auth.service';
import { REFRESH_GRACE_MS, RefreshTokenService } from './refresh-token.service';

const meta = { userAgent: 'jest', ip: '127.0.0.1' };
const PASSWORD = 'Employee#123';

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('AuthService', () => {
  const env = testEnv();
  let clock: number;
  let auth: AuthService;
  let userId: string;
  let roleId: string;
  let passwordHash: string;

  beforeAll(async () => {
    await startTestDb();
    passwordHash = await hashPassword(PASSWORD);
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    clock = Date.now();
    auth = new AuthService(env, new RefreshTokenService(env, () => clock));
    const role = await RoleModel.create({ code: 'EMPLOYEE', name: 'Employee' });
    roleId = role._id.toHexString();
    const user = await UserModel.create({
      name: 'Emp One',
      email: 'emp@example.com',
      phone: '555',
      passwordHash,
      roleId: role._id,
    });
    userId = user._id.toHexString();
  });

  const softDelete = async (): Promise<void> => {
    await UserModel.updateOne({ _id: userId }, { deletedAt: new Date() });
  };

  describe('login', () => {
    it('returns the user summary, an access token for the user and a refresh token', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      expect(session.user).toEqual({
        id: userId,
        name: 'Emp One',
        email: 'emp@example.com',
        phone: '555',
        isDefault: false,
        role: { id: roleId, code: 'EMPLOYEE', name: 'Employee' },
      });
      expect(JSON.stringify(session.user)).not.toContain('passwordHash');
      expect(verifyAccessToken(session.access, env)).toMatchObject({
        id: userId,
        role: RoleCode.EMPLOYEE,
      });
      expect(
        await RefreshTokenModel.countDocuments({
          tokenHash: hashRefreshToken(session.refresh),
        }),
      ).toBe(1);
    });

    it('matches the email case-insensitively and ignoring surrounding spaces', async () => {
      const session = await auth.login(' EMP@Example.com ', PASSWORD, meta);
      expect(session.user.id).toBe(userId);
    });

    it('answers a wrong password and an unknown email with the identical error', async () => {
      const wrong = await rejection(
        auth.login('emp@example.com', 'nope', meta),
      );
      const unknown = await rejection(
        auth.login('nobody@example.com', PASSWORD, meta),
      );
      for (const error of [wrong, unknown]) {
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('UNAUTHENTICATED');
        expect(error.message).toBe('Invalid email or password');
      }
    });

    it('refuses a soft-deleted user', async () => {
      await softDelete();
      expect(
        (await rejection(auth.login('emp@example.com', PASSWORD, meta)))
          .message,
      ).toBe('Invalid email or password');
    });
  });

  describe('refresh', () => {
    it('rotates: a new access token and a new refresh token', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      const result = await auth.refresh(session.refresh, meta);
      expect(verifyAccessToken(result.access, env).id).toBe(userId);
      expect(result.refresh).toEqual(expect.any(String));
      expect(result.refresh).not.toBe(session.refresh);
    });

    it('inside the grace window returns only an access token', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      await auth.refresh(session.refresh, meta);
      clock += REFRESH_GRACE_MS - 1;
      const again = await auth.refresh(session.refresh, meta);
      expect(again.access).toEqual(expect.any(String));
      expect(again.refresh).toBeUndefined();
    });

    it.each([
      ['missing', undefined],
      ['unknown', 'not-a-real-token'],
    ])('refuses a %s refresh token with 401', async (_label, token) => {
      const error = await rejection(auth.refresh(token, meta));
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Session expired. Please sign in again.');
    });

    it('refuses a replayed token after the grace window', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      const rotated = await auth.refresh(session.refresh, meta);
      clock += REFRESH_GRACE_MS + 1;
      expect((await rejection(auth.refresh(session.refresh, meta))).code).toBe(
        'UNAUTHENTICATED',
      );
      // Reuse killed the family: the newest token is dead too.
      expect((await rejection(auth.refresh(rotated.refresh, meta))).code).toBe(
        'UNAUTHENTICATED',
      );
    });

    it('refuses a user soft-deleted after login and kills the session (Review Focus 5)', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      await softDelete();
      const error = await rejection(auth.refresh(session.refresh, meta));
      expect(error.statusCode).toBe(401);
      expect(
        await RefreshTokenModel.countDocuments({
          userId: new Types.ObjectId(userId),
          revokedAt: null,
        }),
      ).toBe(0);
    });
  });

  describe('logout', () => {
    it('revokes the family so the refresh token stops working', async () => {
      const session = await auth.login('emp@example.com', PASSWORD, meta);
      await auth.logout(session.refresh);
      expect((await rejection(auth.refresh(session.refresh, meta))).code).toBe(
        'UNAUTHENTICATED',
      );
    });

    it('is a no-op without a refresh token', async () => {
      await expect(auth.logout(undefined)).resolves.toBeUndefined();
    });
  });

  describe('me', () => {
    it('returns the user summary', async () => {
      expect((await auth.me(userId)).email).toBe('emp@example.com');
    });

    it('answers 401 for a soft-deleted or unknown user', async () => {
      await softDelete();
      expect((await rejection(auth.me(userId))).statusCode).toBe(401);
      expect(
        (await rejection(auth.me(new Types.ObjectId().toHexString())))
          .statusCode,
      ).toBe(401);
    });
  });
});
