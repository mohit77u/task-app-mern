import { Types, type ClientSession } from 'mongoose';
import { notDeleted } from '../../common/db/soft-delete';
import { withTransaction } from '../../common/db/with-transaction';
import { AppException } from '../../common/errors/app.exception';
import { fromMongoError } from '../../common/errors/mongo-errors';
import type { AuthUser } from '../../common/types/request.types';
import { toPaginated, type Paginated } from '../../common/types/pagination';
import { parseObjectId } from '../../common/utils/object-id';
import {
  RoleModel,
  TaskModel,
  UserModel,
  type IRole,
  type IUser,
} from '../../models';
import { hashPassword } from '../../security/password';
import { findActiveUserWithRole, type ActiveUser } from '../auth/session-user';
import type { RefreshTokenService } from '../auth/refresh-token.service';
import { toUserResponse, type UserResponse } from './user.mapper';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
} from './users.schemas';

export interface RoleResponse {
  id: string;
  code: string;
  name: string;
}

const EMAIL_TAKEN = 'A user with this email already exists';

/** The unique index is the real guard against duplicate emails; a pre-check alone would race. */
function rethrowDuplicate(error: unknown): never {
  const mapped = fromMongoError(error);
  if (mapped?.statusCode === 409) throw AppException.conflict(EMAIL_TAKEN);
  throw error;
}

export class UsersService {
  constructor(private readonly refreshTokens: RefreshTokenService) {}

  /** The live user behind an access token with their role, or null. */
  findSessionUser(id: string): Promise<ActiveUser | null> {
    return findActiveUserWithRole(id);
  }

  async listRoles(): Promise<RoleResponse[]> {
    const roles = await RoleModel.find().sort({ _id: 1 }).lean();
    return roles.map((r) => ({
      id: r._id.toHexString(),
      code: r.code,
      name: r.name,
    }));
  }

  async list(
    query: Pick<ListUsersQuery, 'page' | 'limit'> & {
      roleCode?: ListUsersQuery['roleCode'];
    },
  ): Promise<Paginated<UserResponse>> {
    const filter: { deletedAt: null; roleId?: Types.ObjectId } = notDeleted();
    if (query.roleCode) {
      const role = await RoleModel.findOne({ code: query.roleCode }).lean();
      if (!role) return toPaginated([], 0, query.page, query.limit);
      filter.roleId = role._id;
    }
    const [rows, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ name: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate<{ roleId: IRole | null }>('roleId')
        .lean(),
      UserModel.countDocuments(filter),
    ]);
    const items = rows.flatMap((row) =>
      row.roleId ? [toUserResponse(row, row.roleId)] : [],
    );
    return toPaginated(items, total, query.page, query.limit);
  }

  async getById(id: string): Promise<UserResponse> {
    return this.respond(await this.findActiveOrFail(id));
  }

  async create(dto: CreateUserBody): Promise<UserResponse> {
    const role = await RoleModel.findById(dto.roleId).lean();
    if (!role) {
      throw AppException.validation([
        { field: 'roleId', message: 'Unknown role' },
      ]);
    }
    try {
      const user = await UserModel.create({
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        roleId: role._id,
        passwordHash: await hashPassword(dto.password),
      });
      return toUserResponse(user, role);
    } catch (error) {
      return rethrowDuplicate(error);
    }
  }

  /**
   * Changes only the fields that were sent. A new password also signs the user out everywhere: refresh tokens are
   * revoked, and `passwordChangedAt` makes the auth middleware refuse access tokens issued before it.
   */
  async update(
    _actor: AuthUser,
    id: string,
    dto: UpdateUserBody,
  ): Promise<UserResponse> {
    const _id = this.parse(id);
    if (dto.email !== undefined || dto.password !== undefined) {
      // The default accounts' credentials are public (README, login page), so a visitor could otherwise lock everyone out.
      const target = await UserModel.findOne(notDeleted({ _id }))
        .select('isDefault')
        .lean();
      if (target?.isDefault) {
        throw AppException.conflict(
          'The email and password of a default account cannot be changed',
        );
      }
    }
    const set: Partial<
      Pick<
        IUser,
        'name' | 'email' | 'phone' | 'passwordHash' | 'passwordChangedAt'
      >
    > = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.email !== undefined) set.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) set.phone = dto.phone;
    if (dto.password !== undefined) {
      set.passwordHash = await hashPassword(dto.password);
      set.passwordChangedAt = new Date();
    }
    let updated: IUser | null;
    try {
      updated = await UserModel.findOneAndUpdate(
        notDeleted({ _id }),
        { $set: set },
        { returnDocument: 'after' },
      ).lean();
    } catch (error) {
      return rethrowDuplicate(error);
    }
    if (!updated) throw AppException.notFound('User');
    if (dto.password !== undefined) {
      await this.refreshTokens.revokeAllForUser(id);
    }
    return this.respond(updated);
  }

  /**
   * Soft delete, for non-default users other than yourself with no live tasks (any status). The first write inside the
   * transaction touches the user document: task creation does the same to its assignee, so the two conflict on that
   * document and one retries after the other commits, seeing its effect (a task, or a deleted user).
   */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const _id = this.parse(id);
    await withTransaction(async (session: ClientSession) => {
      const touched = await UserModel.updateOne(
        notDeleted({ _id }),
        { $set: { updatedAt: new Date() } },
        { session },
      );
      if (touched.matchedCount === 0) throw AppException.notFound('User');
      const user = await UserModel.findOne(notDeleted({ _id }), null, {
        session,
      }).lean();
      if (!user) throw AppException.notFound('User');

      if (actor.id === id) {
        throw AppException.conflict('You cannot delete your own account');
      }
      if (user.isDefault) {
        throw AppException.conflict('Default accounts cannot be deleted');
      }
      const assigned = await TaskModel.countDocuments(
        notDeleted({ assigneeId: _id }),
        { session },
      );
      if (assigned > 0) {
        throw AppException.conflict(
          `This user has ${assigned} assigned task(s). Delete or reassign them before deleting the user.`,
        );
      }
      await UserModel.updateOne(
        { _id },
        { $set: { deletedAt: new Date() } },
        { session },
      );
    });
    // Outside the transaction: a deleted user is refused by the session check anyway, this just ends their tokens.
    await this.refreshTokens.revokeAllForUser(id);
  }

  private parse(id: string): Types.ObjectId {
    const _id = parseObjectId(id);
    if (!_id) throw AppException.notFound('User');
    return _id;
  }

  private async findActiveOrFail(id: string): Promise<IUser> {
    const user = await UserModel.findOne(
      notDeleted({ _id: this.parse(id) }),
    ).lean();
    if (!user) throw AppException.notFound('User');
    return user;
  }

  private async respond(user: IUser): Promise<UserResponse> {
    const role = await RoleModel.findById(user.roleId).lean();
    if (!role) throw AppException.notFound('User');
    return toUserResponse(user, role);
  }
}
