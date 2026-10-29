import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import {
  RoleModel,
  TaskModel,
  TaskStatusHistoryModel,
  UserModel,
  ensureIndexes,
} from '../../models';
import { verifyPassword } from '../../security/password';
import { DEFAULT_DEMO_PASSWORDS, SAMPLE_TASKS } from './demo-data';
import { seed } from './seed';

const ORDER = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.PENDING_APPROVAL,
  TaskStatus.COMPLETED,
];

describe('seed', () => {
  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);

  async function roleCode(roleId: unknown): Promise<string | undefined> {
    return (await RoleModel.findById(roleId))?.code;
  }

  describe('on an empty database', () => {
    let result: Awaited<ReturnType<typeof seed>>;
    beforeAll(async () => {
      await clearTestDb();
      result = await seed(testEnv());
    }, 60_000);

    it('creates 2 roles, 2 admins, 3 employees and the sample tasks', async () => {
      expect(result.created).toEqual({
        roles: 2,
        users: 5,
        tasks: SAMPLE_TASKS.length,
      });
      const users = await UserModel.find();
      const codes = await Promise.all(users.map((u) => roleCode(u.roleId)));
      expect(codes.filter((c) => c === RoleCode.ADMIN)).toHaveLength(2);
      expect(codes.filter((c) => c === RoleCode.EMPLOYEE)).toHaveLength(3);
      expect(users.every((u) => u.isDefault)).toBe(true);
    });

    it('covers every status and priority, assigned to employees by an admin', async () => {
      const tasks = await TaskModel.find();
      expect(new Set(tasks.map((t) => t.status))).toEqual(
        new Set(Object.values(TaskStatus)),
      );
      expect(new Set(tasks.map((t) => t.priority))).toEqual(
        new Set(Object.values(TaskPriority)),
      );
      for (const t of tasks) {
        expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const assignee = await UserModel.findById(t.assigneeId);
        const creator = await UserModel.findById(t.createdById);
        expect(await roleCode(assignee?.roleId)).toBe(RoleCode.EMPLOYEE);
        expect(await roleCode(creator?.roleId)).toBe(RoleCode.ADMIN);
      }
    });

    it('writes a history chain consistent with each task status', async () => {
      for (const t of await TaskModel.find()) {
        const rows = await TaskStatusHistoryModel.find({ taskId: t._id }).sort({
          _id: 1,
        });
        const expected = ORDER.slice(0, ORDER.indexOf(t.status) + 1);
        expect(rows.map((r) => r.toStatus)).toEqual(expected);
        expect(rows.map((r) => r.fromStatus)).toEqual([
          null,
          ...expected.slice(0, -1),
        ]);
        expect(rows[0].actorId.equals(t.createdById)).toBe(true);
        rows.forEach((r, i) => {
          if (i > 0 && r.toStatus !== TaskStatus.COMPLETED) {
            expect(r.actorId.equals(t.assigneeId)).toBe(true);
          }
          if (r.toStatus === TaskStatus.COMPLETED) {
            expect(r.actorId.equals(t.createdById)).toBe(true);
          }
        });
      }
    });

    it('hashes the documented demo passwords', async () => {
      const admin = await UserModel.findOne({ email: 'admin@taskapp.dev' });
      expect(
        await verifyPassword(DEFAULT_DEMO_PASSWORDS.admin, admin!.passwordHash),
      ).toBe(true);
    });

    it('creates nothing on a second run', async () => {
      expect(await seed(testEnv())).toEqual({
        created: { roles: 0, users: 0, tasks: 0 },
      });
      expect(await UserModel.countDocuments()).toBe(5);
      expect(await TaskModel.countDocuments()).toBe(SAMPLE_TASKS.length);
    }, 30_000);
  });

  describe('with pre-existing data', () => {
    beforeEach(clearTestDb);

    it('does not modify a pre-existing user with a seeded email', async () => {
      const role = await RoleModel.create({ code: 'EMPLOYEE', name: 'Staff' });
      await UserModel.create({
        name: 'Edited Name',
        email: 'Priya@taskapp.dev',
        passwordHash: 'custom-hash',
        roleId: role._id,
      });
      const result = await seed(testEnv());
      expect(result.created.users).toBe(4);
      const priya = await UserModel.findOne({ email: 'priya@taskapp.dev' });
      expect(priya).toMatchObject({
        name: 'Edited Name',
        passwordHash: 'custom-hash',
        isDefault: false,
      });
      expect((await RoleModel.findById(role._id))?.name).toBe('Staff');
      expect(await UserModel.countDocuments({ email: /priya/ })).toBe(1);
    }, 60_000);

    it('applies SEED_*_PASSWORD to newly created accounts only', async () => {
      const env = testEnv({
        SEED_ADMIN_PASSWORD: 'Private@Admin1',
        SEED_EMPLOYEE_PASSWORD: 'Private@Emp1',
      });
      const role = await RoleModel.create({
        code: 'ADMIN',
        name: 'Administrator',
      });
      await UserModel.create({
        name: 'Old',
        email: 'admin2@taskapp.dev',
        passwordHash: 'old-hash',
        roleId: role._id,
      });
      await seed(env);
      const admin = await UserModel.findOne({ email: 'admin@taskapp.dev' });
      const employee = await UserModel.findOne({ email: 'rahul@taskapp.dev' });
      const existing = await UserModel.findOne({ email: 'admin2@taskapp.dev' });
      expect(await verifyPassword('Private@Admin1', admin!.passwordHash)).toBe(
        true,
      );
      expect(await verifyPassword('Private@Emp1', employee!.passwordHash)).toBe(
        true,
      );
      expect(existing!.passwordHash).toBe('old-hash');
    }, 60_000);
  });
});
