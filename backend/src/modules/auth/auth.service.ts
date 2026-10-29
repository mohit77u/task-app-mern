import { notDeleted } from '../../common/db/soft-delete';
import { isRoleCode } from '../../common/enums/role-code';
import { AppException } from '../../common/errors/app.exception';
import type { Env } from '../../config/env.validation';
import { RoleModel, UserModel, type IRole, type IUser } from '../../models';
import { verifyDummyPassword, verifyPassword } from '../../security/password';
import { signAccessToken } from '../../security/token';
import { toUserResponse, type UserResponse } from '../users/user.mapper';
import { RefreshTokenService, type ClientMeta } from './refresh-token.service';
import { findActiveUserWithRole } from './session-user';

const SESSION_ENDED = 'Session expired. Please sign in again.';
const INVALID_CREDENTIALS = 'Invalid email or password';

export class AuthService {
  constructor(
    private readonly env: Env,
    private readonly refreshTokens: RefreshTokenService = new RefreshTokenService(
      env,
    ),
  ) {}

  async login(
    email: string,
    password: string,
    meta: ClientMeta,
  ): Promise<{ user: UserResponse; access: string; refresh: string }> {
    const user = await UserModel.findOne(
      notDeleted({ email: email.trim().toLowerCase() }),
    ).lean();
    // Same work and same error whether the email exists or not, so neither message nor timing enumerates accounts.
    const valid = user
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyDummyPassword(password), false);
    if (!user || !valid)
      throw AppException.unauthenticated(INVALID_CREDENTIALS);

    const role = await RoleModel.findById(user.roleId).lean();
    if (!role) throw AppException.unauthenticated(INVALID_CREDENTIALS);

    return {
      user: toUserResponse(user, role),
      access: await this.signAccessFor(user, role),
      refresh: await this.refreshTokens.issueForLogin(
        user._id.toHexString(),
        meta,
      ),
    };
  }

  /** `refresh` is absent when the presented token was inside the grace window: the first response already delivered it. */
  async refresh(
    presented: string | undefined,
    meta: ClientMeta,
  ): Promise<{ access: string; refresh?: string }> {
    if (!presented) throw AppException.unauthenticated(SESSION_ENDED);

    const result = await this.refreshTokens.rotate(presented, meta);
    if (result.kind === 'invalid' || result.kind === 'reuse')
      throw AppException.unauthenticated(SESSION_ENDED);

    const found = await findActiveUserWithRole(result.userId);
    if (!found) {
      // The user was deleted while holding a valid refresh token: end the session for good, not just this request.
      await this.refreshTokens.revokeFamilyOf(presented);
      throw AppException.unauthenticated(SESSION_ENDED);
    }

    return {
      access: await this.signAccessFor(found.user, found.role),
      refresh: result.kind === 'rotated' ? result.token : undefined,
    };
  }

  async logout(presented?: string): Promise<void> {
    if (presented) await this.refreshTokens.revokeFamilyOf(presented);
  }

  async me(userId: string): Promise<UserResponse> {
    const found = await findActiveUserWithRole(userId);
    if (!found) throw AppException.unauthenticated();
    return toUserResponse(found.user, found.role);
  }

  private signAccessFor(
    user: Pick<IUser, '_id'>,
    role: Pick<IRole, 'code'>,
  ): Promise<string> {
    if (!isRoleCode(role.code)) throw AppException.unauthenticated();
    return signAccessToken(
      { id: user._id.toHexString(), role: role.code },
      this.env,
    );
  }
}
