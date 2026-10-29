import { Types } from 'mongoose';
import { clearTestDb, startTestDb, stopTestDb } from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import type { AuthUser } from '../../common/types/request.types';
import { ensureIndexes, RoleModel, TaskModel, UserModel } from '../../models';
import { TasksService } from '../tasks/tasks.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const tasks = new TasksService();
  const service = new DashboardService(tasks);
  let admin: AuthUser;
  let emp1: AuthUser;
  let emp2: AuthUser;

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    const adminRole = await RoleModel.create({ code: 'ADMIN', name: 'Admin' });
    const empRole = await RoleModel.create({
      code: 'EMPLOYEE',
      name: 'Employee',
    });
    const mk = async (
      name: string,
      roleId: Types.ObjectId,
      role: RoleCode,
    ): Promise<AuthUser> => {
      const u = await UserModel.create({
        name,
        email: `${name.toLowerCase()}@x.com`,
        passwordHash: 'h',
        roleId,
      });
      return { id: u.id, role };
    };
    admin = await mk('Boss', adminRole._id, RoleCode.ADMIN);
    emp1 = await mk('Ann', empRole._id, RoleCode.EMPLOYEE);
    emp2 = await mk('Ben', empRole._id, RoleCode.EMPLOYEE);
  });

  async function add(
    assignee: AuthUser,
    status: TaskStatus,
    deleted = false,
  ): Promise<void> {
    const t = await tasks.create(admin, {
      title: 't',
      description: 'd',
      priority: TaskPriority.LOW,
      dueDate: '2030-01-01',
      assigneeId: assignee.id,
    });
    await TaskModel.updateOne(
      { _id: t.id },
      { $set: { status, deletedAt: deleted ? new Date() : null } },
    );
  }

  it('zero-fills every status when there are no tasks', async () => {
    expect(await service.get(emp1)).toEqual({
      counts: {
        PENDING: 0,
        IN_PROGRESS: 0,
        PENDING_APPROVAL: 0,
        COMPLETED: 0,
      },
      total: 0,
    });
  });

  it('uses the same scoping as list: employee counts match their own list; deleted tasks excluded', async () => {
    await add(emp1, TaskStatus.PENDING);
    await add(emp1, TaskStatus.PENDING);
    await add(emp1, TaskStatus.COMPLETED);
    await add(emp1, TaskStatus.IN_PROGRESS, true);
    await add(emp2, TaskStatus.IN_PROGRESS);

    const mine = await service.get(emp1);
    expect(mine).toEqual({
      counts: {
        PENDING: 2,
        IN_PROGRESS: 0,
        PENDING_APPROVAL: 0,
        COMPLETED: 1,
      },
      total: 3,
    });
    const list = await tasks.list(emp1, { page: 1, limit: 100 });
    expect(mine.total).toBe(list.items.length);
    for (const status of Object.values(TaskStatus)) {
      expect(mine.counts[status]).toBe(
        list.items.filter((i) => i.status === status).length,
      );
    }

    const all = await service.get(admin);
    expect(all.counts).toEqual({
      PENDING: 2,
      IN_PROGRESS: 1,
      PENDING_APPROVAL: 0,
      COMPLETED: 1,
    });
    expect(all.total).toBe(
      Object.values(all.counts).reduce((s, n) => s + n, 0),
    );
    expect(all.total).toBe(
      (await tasks.list(admin, { page: 1, limit: 100 })).meta.total,
    );
  });
});
