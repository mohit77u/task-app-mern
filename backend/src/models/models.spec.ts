import { Types } from 'mongoose';
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo';
import { TaskPriority } from '../common/enums/task-priority';
import { TaskStatus } from '../common/enums/task-status';
import { notDeleted } from '../common/db/soft-delete';
import { withTransaction } from '../common/db/with-transaction';
import {
  RefreshTokenModel,
  RoleModel,
  TaskCommentModel,
  TaskModel,
  TaskStatusHistoryModel,
  UserModel,
  ensureIndexes,
} from './index';

const roleId = new Types.ObjectId();

function userDoc(email: string): Record<string, unknown> {
  return { name: 'A', email, passwordHash: 'h', roleId };
}

function taskDoc(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: 't',
    description: 'd',
    dueDate: '2026-01-31',
    assigneeId: new Types.ObjectId(),
    createdById: new Types.ObjectId(),
    ...overrides,
  };
}

describe('models', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(clearTestDb);

  it('rejects a duplicate email after trim and lower-casing', async () => {
    await UserModel.create(userDoc('A@x.com'));
    await expect(UserModel.create(userDoc(' a@x.com '))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('stores email trimmed and lower-cased with defaults', async () => {
    const u = await UserModel.create(userDoc(' Bob@X.com '));
    expect(u.email).toBe('bob@x.com');
    expect(u.isDefault).toBe(false);
    expect(u.passwordChangedAt).toBeNull();
    expect(u.deletedAt).toBeNull();
  });

  it('rejects a duplicate role code', async () => {
    await RoleModel.create({ code: 'ADMIN', name: 'Admin' });
    await expect(
      RoleModel.create({ code: 'ADMIN', name: 'Admin 2' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it.each(['2026-1-5', '2026-13-40', '2026-02-30', '31-01-2026'])(
    'rejects bad dueDate %s',
    async (dueDate) => {
      await expect(TaskModel.create(taskDoc({ dueDate }))).rejects.toThrow(
        /dueDate/,
      );
    },
  );

  it('accepts a valid dueDate and applies defaults', async () => {
    const t = await TaskModel.create(taskDoc());
    expect(t.dueDate).toBe('2026-01-31');
    expect(t.status).toBe(TaskStatus.PENDING);
    expect(t.priority).toBe(TaskPriority.MEDIUM);
    expect(t.deletedAt).toBeNull();
  });

  it('rejects a status outside the enum', async () => {
    await expect(TaskModel.create(taskDoc({ status: 'DONE' }))).rejects.toThrow(
      /status/,
    );
  });

  it('notDeleted adds deletedAt: null', () => {
    expect(notDeleted({ status: 'X' })).toEqual({
      status: 'X',
      deletedAt: null,
    });
    expect(notDeleted()).toEqual({ deletedAt: null });
  });

  describe('withTransaction', () => {
    it('commits and returns the result', async () => {
      const r = await withTransaction(async (session) => {
        await RoleModel.create([{ code: 'EMPLOYEE', name: 'Employee' }], {
          session,
        });
        return 42;
      });
      expect(r).toBe(42);
      expect(await RoleModel.countDocuments()).toBe(1);
    });

    it('rolls back an insert and rethrows when fn throws', async () => {
      await expect(
        withTransaction(async (session) => {
          await RoleModel.create([{ code: 'ADMIN', name: 'Admin' }], {
            session,
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await RoleModel.countDocuments()).toBe(0);
    });
  });

  it('creates the required indexes', async () => {
    const names = async (m: {
      listIndexes(): Promise<{ key: Record<string, number> }[]>;
    }): Promise<string[]> =>
      (await m.listIndexes()).map((i) => Object.keys(i.key).join(','));
    const rt = await RefreshTokenModel.listIndexes();
    expect(rt.find((i) => i.key.expiresAt)?.expireAfterSeconds).toBe(
      30 * 86400,
    );
    expect(await names(RefreshTokenModel)).toEqual(
      expect.arrayContaining(['tokenHash', 'familyId']),
    );
    expect(await names(TaskModel)).toEqual(
      expect.arrayContaining([
        'assigneeId,status',
        'status,priority',
        'dueDate',
      ]),
    );
    expect(await names(TaskCommentModel)).toContain('taskId,createdAt');
    expect(await names(TaskStatusHistoryModel)).toContain('taskId,createdAt');
  });
});
