import { Types } from 'mongoose';
import { clearTestDb, startTestDb, stopTestDb } from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import { TaskPriority } from '../../common/enums/task-priority';
import type { AuthUser } from '../../common/types/request.types';
import {
  ensureIndexes,
  RoleModel,
  TaskCommentModel,
  UserModel,
} from '../../models';
import { TasksService } from '../tasks/tasks.service';
import { CommentsService } from './comments.service';

describe('CommentsService', () => {
  const tasks = new TasksService();
  const service = new CommentsService(tasks);
  let admin: AuthUser;
  let emp1: AuthUser;
  let emp2: AuthUser;
  let taskId: string;

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
    taskId = (
      await tasks.create(admin, {
        title: 't',
        description: 'd',
        priority: TaskPriority.LOW,
        dueDate: '2030-01-01',
        assigneeId: emp1.id,
      })
    ).id;
  });

  it('creates a trimmed comment and returns {id, body, author{id,name}, createdAt}', async () => {
    const c = await service.create(emp1, taskId, '  hello there  ');
    expect(c).toEqual({
      id: expect.any(String),
      body: 'hello there',
      author: { id: emp1.id, name: 'Ann' },
      createdAt: expect.any(String),
    });
    const row = await TaskCommentModel.findById(c.id).lean();
    expect(row?.body).toBe('hello there');
  });

  it('lists the thread oldest first, for the assignee and for an Admin', async () => {
    const a = await service.create(emp1, taskId, 'first');
    const b = await service.create(admin, taskId, 'second');
    for (const viewer of [emp1, admin]) {
      const list = await service.list(viewer, taskId);
      expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
      expect(list[1].author).toEqual({ id: admin.id, name: 'Boss' });
    }
  });

  it.each(['', '    ', 'x'.repeat(2001)])(
    'rejects body %p with VALIDATION_ERROR on body',
    async (body) => {
      await expect(service.create(emp1, taskId, body)).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        details: [{ field: 'body', message: expect.any(String) }],
      });
      expect(await TaskCommentModel.countDocuments()).toBe(0);
    },
  );

  it('accepts exactly 2000 characters', async () => {
    const c = await service.create(emp1, taskId, 'x'.repeat(2000));
    expect(c.body).toHaveLength(2000);
  });

  it("another employee's task is NOT_FOUND for list and create", async () => {
    await expect(service.list(emp2, taskId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    await expect(service.create(emp2, taskId, 'hi')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(await TaskCommentModel.countDocuments()).toBe(0);
  });

  it('a deleted or unknown task is NOT_FOUND', async () => {
    await tasks.remove(admin, taskId);
    await expect(service.list(admin, taskId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      service.create(admin, new Types.ObjectId().toHexString(), 'x'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
