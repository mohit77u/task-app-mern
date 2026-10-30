import { Types } from 'mongoose';
import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { notDeleted } from '../../common/db/soft-delete';
import { withTransaction } from '../../common/db/with-transaction';
import { RoleCode } from '../../common/enums/role-code';
import { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import { AppException } from '../../common/errors/app.exception';
import {
  ensureIndexes,
  RefreshTokenModel,
  RoleModel,
  TaskModel,
  UserModel,
} from '../../models';
import { hashPassword, verifyPassword } from '../../security/password';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const env = testEnv();
  let refreshTokens: RefreshTokenService;
  let service: UsersService;
  let adminRoleId: string;
  let employeeRoleId: string;
  let adminId: string;

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    refreshTokens = new RefreshTokenService(env);
    service = new UsersService(refreshTokens);
    const admin = await RoleModel.create({ code: 'ADMIN', name: 'Admin' });
    const emp = await RoleModel.create({ code: 'EMPLOYEE', name: 'Employee' });
    adminRoleId = admin.id;
    employeeRoleId = emp.id;
    const a = await UserModel.create({
      name: 'Boss',
      email: 'boss@x.com',
      passwordHash: await hashPassword('Password1'),
      roleId: admin._id,
    });
    adminId = a.id;
  });

  const actor = (): { id: string; role: RoleCode } => ({
    id: adminId,
    role: RoleCode.ADMIN,
  });

  function newEmployee(email = 'e@x.com'): ReturnType<UsersService['create']> {
    return service.create({
      name: 'Emp',
      email,
      password: 'Password1',
      roleId: employeeRoleId,
    });
  }

  async function addTask(
    assigneeId: string,
    status: TaskStatus = TaskStatus.PENDING,
    deletedAt: Date | null = null,
  ): Promise<void> {
    await TaskModel.create({
      title: 't',
      description: 'd',
      priority: TaskPriority.LOW,
      status,
      dueDate: '2030-01-01',
      assigneeId: new Types.ObjectId(assigneeId),
      createdById: new Types.ObjectId(adminId),
      deletedAt,
    });
  }

  async function expectConflict(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  }

  describe('create', () => {
    it('trims and lower-cases the email and hashes the password', async () => {
      const u = await service.create({
        name: 'Ann',
        email: '  Foo@X.com ',
        phone: '12345678',
        password: 'Password1',
        roleId: employeeRoleId,
      });
      expect(u.email).toBe('foo@x.com');
      expect(u.role).toEqual({
        id: employeeRoleId,
        code: 'EMPLOYEE',
        name: 'Employee',
      });
      expect(u).not.toHaveProperty('passwordHash');
      const row = await UserModel.findById(u.id).lean();
      expect(row?.passwordHash).not.toBe('Password1');
      expect(await verifyPassword('Password1', row!.passwordHash)).toBe(true);
    });

    it('rejects a duplicate email that differs by case or whitespace with CONFLICT', async () => {
      await newEmployee('foo@x.com');
      await expectConflict(newEmployee('Foo@X.com'));
      await expectConflict(newEmployee('  foo@x.com  '));
    });

    it('rejects an unknown roleId with a 422 on field roleId', async () => {
      const err: unknown = await service
        .create({
          name: 'A',
          email: 'a@x.com',
          password: 'Password1',
          roleId: new Types.ObjectId().toHexString(),
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppException);
      expect(err).toMatchObject({
        statusCode: 422,
        details: [{ field: 'roleId', message: expect.any(String) }],
      });
    });
  });

  describe('update', () => {
    it('changes only the sent fields and can clear the phone', async () => {
      const u = await service.create({
        name: 'Ann',
        email: 'ann@x.com',
        phone: '12345678',
        password: 'Password1',
        roleId: employeeRoleId,
      });
      const r = await service.update(actor(), u.id, {
        name: 'Anna',
        phone: null,
      });
      expect(r).toMatchObject({
        name: 'Anna',
        email: 'ann@x.com',
        phone: null,
      });
      expect(r.role.code).toBe('EMPLOYEE');
    });

    it('answers CONFLICT when the new email belongs to another user', async () => {
      await newEmployee('taken@x.com');
      const u = await newEmployee('mine@x.com');
      await expectConflict(
        service.update(actor(), u.id, { email: ' Taken@X.com' }),
      );
    });

    it('allows keeping the same email', async () => {
      const u = await newEmployee('same@x.com');
      const r = await service.update(actor(), u.id, { email: 'Same@x.com' });
      expect(r.email).toBe('same@x.com');
    });

    it('a password change sets passwordChangedAt, rehashes and revokes refresh tokens', async () => {
      const u = await newEmployee();
      const token = await refreshTokens.issueForLogin(u.id, {});
      await service.update(actor(), u.id, { password: 'NewPassword2' });
      const row = await UserModel.findById(u.id).lean();
      expect(row?.passwordChangedAt).toBeInstanceOf(Date);
      expect(await verifyPassword('NewPassword2', row!.passwordHash)).toBe(
        true,
      );
      const tokens = await RefreshTokenModel.find({
        userId: new Types.ObjectId(u.id),
      }).lean();
      expect(tokens).toHaveLength(1);
      expect(tokens[0].revokedAt).not.toBeNull();
      expect((await refreshTokens.rotate(token, {})).kind).toBe('reuse');
    });

    it('does not touch passwordChangedAt or tokens when no password is sent', async () => {
      const u = await newEmployee();
      await refreshTokens.issueForLogin(u.id, {});
      await service.update(actor(), u.id, { name: 'New' });
      const row = await UserModel.findById(u.id).lean();
      expect(row?.passwordChangedAt).toBeNull();
      expect(await RefreshTokenModel.countDocuments({ revokedAt: null })).toBe(
        1,
      );
    });

    it('refuses to change the email or password of a default (public demo) user, but allows other fields', async () => {
      const u = await newEmployee();
      await UserModel.updateOne({ _id: u.id }, { isDefault: true });
      await expectConflict(
        service.update(actor(), u.id, { password: 'Another@12345' }),
      );
      await expectConflict(
        service.update(actor(), u.id, { email: 'changed@taskapp.dev' }),
      );
      const renamed = await service.update(actor(), u.id, { name: 'Renamed' });
      expect(renamed.name).toBe('Renamed');
    });

    it('answers 404 for a missing or deleted user', async () => {
      await expect(
        service.update(actor(), new Types.ObjectId().toHexString(), {
          name: 'x',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('remove', () => {
    it('refuses to delete yourself', async () => {
      await expectConflict(service.remove(actor(), adminId));
    });

    it('refuses to delete a default user', async () => {
      const u = await newEmployee();
      await UserModel.updateOne({ _id: u.id }, { isDefault: true });
      await expectConflict(service.remove(actor(), u.id));
    });

    it.each([
      TaskStatus.PENDING,
      TaskStatus.IN_PROGRESS,
      TaskStatus.PENDING_APPROVAL,
      TaskStatus.COMPLETED,
    ])('refuses a user with a live %s task', async (status) => {
      const u = await newEmployee();
      await addTask(u.id, status);
      await expectConflict(service.remove(actor(), u.id));
      expect(await UserModel.countDocuments(notDeleted({ _id: u.id }))).toBe(1);
    });

    it('allows deleting a user whose only task is soft-deleted, then hides them', async () => {
      const u = await newEmployee();
      await addTask(u.id, TaskStatus.PENDING, new Date());
      await service.remove(actor(), u.id);
      const list = await service.list({ page: 1, limit: 20 });
      expect(list.items.map((i) => i.id)).not.toContain(u.id);
      await expect(service.getById(u.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(await service.findSessionUser(u.id)).toBeNull();
    });

    it('answers 404 for an unknown user', async () => {
      await expect(
        service.remove(actor(), new Types.ObjectId().toHexString()),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('serialises with a concurrent task creation: never a deleted user with a live task', async () => {
      const u = await newEmployee();
      const userId = new Types.ObjectId(u.id);
      let touched!: () => void;
      const touchedPromise = new Promise<void>((r) => (touched = r));

      // Simulated Task 7 creation: touch the assignee, then insert the task, holding the transaction open so the
      // remove transaction starts while it is in flight.
      const creation = withTransaction(async (session) => {
        const res = await UserModel.updateOne(
          notDeleted({ _id: userId }),
          { $set: { updatedAt: new Date() } },
          { session },
        );
        if (res.matchedCount === 0) return 'user-gone';
        touched();
        await new Promise((r) => setTimeout(r, 400));
        await TaskModel.create(
          [
            {
              title: 't',
              description: 'd',
              dueDate: '2030-01-01',
              assigneeId: userId,
              createdById: new Types.ObjectId(adminId),
            },
          ],
          { session },
        );
        return 'created';
      });
      await touchedPromise;
      const removal = service
        .remove(actor(), u.id)
        .then(() => 'removed' as const)
        .catch((e: unknown) => e);

      const [created, removed] = await Promise.all([creation, removal]);
      expect(created).toBe('created');
      // The removal lost the write conflict, retried after the commit, and saw the task.
      expect(removed).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
      const user = await UserModel.findById(u.id).lean();
      expect(user?.deletedAt).toBeNull();
      expect(await TaskModel.countDocuments({ assigneeId: userId })).toBe(1);
    });

    it('after a removal, a task creation sees the user as gone (reverse ordering)', async () => {
      const u = await newEmployee();
      await service.remove(actor(), u.id);
      const res = await withTransaction((session) =>
        UserModel.updateOne(
          notDeleted({ _id: new Types.ObjectId(u.id) }),
          { $set: { updatedAt: new Date() } },
          { session },
        ),
      );
      expect(res.matchedCount).toBe(0);
    });
  });

  describe('list / getById / roles / findSessionUser', () => {
    it('filters by roleCode and paginates', async () => {
      await newEmployee('e1@x.com');
      await newEmployee('e2@x.com');
      await newEmployee('e3@x.com');
      const emps = await service.list({
        roleCode: RoleCode.EMPLOYEE,
        page: 1,
        limit: 2,
      });
      expect(emps.items).toHaveLength(2);
      expect(emps.items.every((i) => i.role.code === 'EMPLOYEE')).toBe(true);
      expect(emps.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
      const all = await service.list({ page: 1, limit: 20 });
      expect(all.meta.total).toBe(4);
      const admins = await service.list({
        roleCode: RoleCode.ADMIN,
        page: 1,
        limit: 20,
      });
      expect(admins.items.map((i) => i.id)).toEqual([adminId]);
      expect(adminRoleId).toBeTruthy();
    });

    it('listRoles returns {id, code, name}', async () => {
      const roles = await service.listRoles();
      expect(roles).toHaveLength(2);
      expect(roles[0]).toEqual({
        id: expect.any(String),
        code: expect.any(String),
        name: expect.any(String),
      });
    });

    it('findSessionUser returns a live user with role, null for unknown ids', async () => {
      const found = await service.findSessionUser(adminId);
      expect(found?.role.code).toBe('ADMIN');
      expect(await service.findSessionUser('nope')).toBeNull();
    });
  });
});
