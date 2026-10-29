import { Types } from 'mongoose';
import { clearTestDb, startTestDb, stopTestDb } from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import type { AuthUser } from '../../common/types/request.types';
import {
  ensureIndexes,
  RoleModel,
  TaskModel,
  TaskStatusHistoryModel,
  UserModel,
} from '../../models';
import * as stateMachine from './task-state-machine';
import { listTasksQuerySchema, type CreateTaskBody } from './tasks.schemas';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  const service = new TasksService();
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
  afterEach(() => jest.restoreAllMocks());

  const dto = (over: Partial<CreateTaskBody> = {}): CreateTaskBody => ({
    title: 'Write report',
    description: 'Quarterly numbers',
    priority: TaskPriority.HIGH,
    dueDate: '2030-01-31',
    assigneeId: emp1.id,
    ...over,
  });

  const page = { page: 1, limit: 20 };

  async function setStatus(id: string, status: TaskStatus): Promise<void> {
    await TaskModel.updateOne({ _id: id }, { $set: { status } });
  }

  /** Holds every status compare-and-set (`findOneAndUpdate(...).lean()`) until `wait` resolves. */
  function delayStatusWrites(wait: () => Promise<void>): void {
    const original = TaskModel.findOneAndUpdate.bind(TaskModel);
    jest.spyOn(TaskModel, 'findOneAndUpdate').mockImplementation(
      (...args: Parameters<typeof TaskModel.findOneAndUpdate>) =>
        ({
          lean: async () => {
            await wait();
            return original(...args).lean();
          },
        }) as never,
    );
  }

  describe('create', () => {
    it('creates a PENDING task with populated people and a first history row (fromStatus null)', async () => {
      const t = await service.create(admin, dto());
      expect(t).toEqual({
        id: expect.any(String),
        title: 'Write report',
        description: 'Quarterly numbers',
        priority: 'HIGH',
        status: 'PENDING',
        dueDate: '2030-01-31',
        assignee: { id: emp1.id, name: 'Ann', email: 'ann@x.com' },
        createdBy: { id: admin.id, name: 'Boss', email: 'boss@x.com' },
        allowedTransitions: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(new Date(t.createdAt).toISOString()).toBe(t.createdAt);
      const history = await TaskStatusHistoryModel.find({
        taskId: new Types.ObjectId(t.id),
      }).lean();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING',
        note: null,
      });
      expect(history[0].actorId.toHexString()).toBe(admin.id);
    });

    it('rejects an Admin assignee with VALIDATION_ERROR on assigneeId and writes nothing', async () => {
      await expect(
        service.create(admin, dto({ assigneeId: admin.id })),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        details: [{ field: 'assigneeId', message: expect.any(String) }],
      });
      expect(await TaskModel.countDocuments()).toBe(0);
      expect(await TaskStatusHistoryModel.countDocuments()).toBe(0);
    });

    it('rejects an unknown or soft-deleted assignee with VALIDATION_ERROR on assigneeId', async () => {
      await UserModel.updateOne({ _id: emp2.id }, { deletedAt: new Date() });
      for (const assigneeId of [new Types.ObjectId().toHexString(), emp2.id]) {
        await expect(
          service.create(admin, dto({ assigneeId })),
        ).rejects.toMatchObject({
          statusCode: 422,
          details: [{ field: 'assigneeId', message: expect.any(String) }],
        });
      }
    });
  });

  describe('list and get (visibility)', () => {
    it('Employee list never returns another employee task and ignores assigneeId', async () => {
      const mine = await service.create(admin, dto());
      await service.create(admin, dto({ assigneeId: emp2.id }));
      const r = await service.list(emp1, { ...page, assigneeId: emp2.id });
      expect(r.items.map((i) => i.id)).toEqual([mine.id]);
      expect(r.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(r.items[0].allowedTransitions).toEqual(['IN_PROGRESS']);
    });

    it('Admin sees all and can filter by assignee, status and priority', async () => {
      const a = await service.create(admin, dto());
      const b = await service.create(
        admin,
        dto({ assigneeId: emp2.id, priority: TaskPriority.LOW }),
      );
      await setStatus(b.id, TaskStatus.IN_PROGRESS);
      expect((await service.list(admin, page)).meta.total).toBe(2);
      expect(
        (await service.list(admin, { ...page, assigneeId: emp1.id })).items.map(
          (i) => i.id,
        ),
      ).toEqual([a.id]);
      expect(
        (
          await service.list(admin, { ...page, status: TaskStatus.IN_PROGRESS })
        ).items.map((i) => i.id),
      ).toEqual([b.id]);
      expect(
        (
          await service.list(admin, { ...page, priority: TaskPriority.HIGH })
        ).items.map((i) => i.id),
      ).toEqual([a.id]);
    });

    it('sorts newest first and paginates', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++)
        ids.push((await service.create(admin, dto({ title: `t${i}` }))).id);
      const p1 = await service.list(admin, { page: 1, limit: 2 });
      const p2 = await service.list(admin, { page: 2, limit: 2 });
      expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(
        [...ids].reverse(),
      );
      expect(p1.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    });

    it('Employee getResponse for another employee task is NOT_FOUND', async () => {
      const other = await service.create(admin, dto({ assigneeId: emp2.id }));
      await expect(service.getResponse(emp1, other.id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      expect((await service.getResponse(emp2, other.id)).id).toBe(other.id);
    });

    it.each(['not-an-id', '123', '123456789012'])(
      'getResponse(%p) is NOT_FOUND, not a cast error',
      async (bad) => {
        await expect(service.getResponse(admin, bad)).rejects.toMatchObject({
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      },
    );
  });

  describe('search', () => {
    it('treats regex metacharacters literally', async () => {
      const literal = await service.create(
        admin,
        dto({ title: 'Fix (a.* parser' }),
      );
      await service.create(admin, dto({ title: 'a parser' })); // would match /(a.*/-like patterns
      await service.create(admin, dto({ title: 'aaa' }));
      const r = await service.list(admin, { ...page, search: '(a.*' });
      expect(r.items.map((i) => i.id)).toEqual([literal.id]);
    });

    it.each(['[', '\\', '.*', '(', ')', '+?', '$^|{}'])(
      'search %p never throws and only returns literal matches',
      async (q) => {
        const hit = await service.create(
          admin,
          dto({ title: 'plain', description: `has ${q} inside` }),
        );
        await service.create(admin, dto({ title: 'other', description: 'x' }));
        const r = await service.list(admin, { ...page, search: q });
        expect(r.items.map((i) => i.id)).toEqual([hit.id]);
      },
    );

    it('matches title or description case-insensitively', async () => {
      const a = await service.create(admin, dto({ title: 'Alpha' }));
      const b = await service.create(
        admin,
        dto({ title: 'Beta', description: 'about ALPHA' }),
      );
      await service.create(admin, dto({ title: 'Gamma', description: 'g' }));
      const r = await service.list(admin, { ...page, search: 'alpha' });
      expect(r.items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    });
  });

  describe('list query schema (Review Focus 4)', () => {
    it.each([
      { page: '0' },
      { limit: '1000' },
      { limit: 'abc' },
      { limit: '0' },
      { foo: '1' },
      { status: 'DONE' },
      { assigneeId: '123' },
      { search: 'x'.repeat(101) },
    ])('rejects %p', (q) => {
      const r = listTasksQuerySchema.strict().safeParse(q);
      expect(r.success).toBe(false);
    });

    it('applies defaults and trims search', () => {
      expect(listTasksQuerySchema.parse({ search: '  hi ' })).toEqual({
        page: 1,
        limit: 20,
        search: 'hi',
      });
    });
  });

  describe('update and remove', () => {
    it('changes only sent fields', async () => {
      const t = await service.create(admin, dto());
      const u = await service.update(admin, t.id, {
        title: 'New',
        assigneeId: emp2.id,
      });
      expect(u).toMatchObject({
        title: 'New',
        description: 'Quarterly numbers',
        assignee: { id: emp2.id },
      });
    });

    it('rejects reassignment to a non-employee', async () => {
      const t = await service.create(admin, dto());
      await expect(
        service.update(admin, t.id, { assigneeId: admin.id }),
      ).rejects.toMatchObject({
        statusCode: 422,
        details: [{ field: 'assigneeId', message: expect.any(String) }],
      });
      expect((await service.getResponse(admin, t.id)).assignee.id).toBe(
        emp1.id,
      );
    });

    it('rejects editing a COMPLETED task with STATE_CONFLICT', async () => {
      const t = await service.create(admin, dto());
      await setStatus(t.id, TaskStatus.COMPLETED);
      await expect(
        service.update(admin, t.id, { title: 'x' }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'STATE_CONFLICT' });
      expect((await service.getResponse(admin, t.id)).title).toBe(
        'Write report',
      );
    });

    it('update of a missing task is NOT_FOUND', async () => {
      await expect(
        service.update(admin, new Types.ObjectId().toHexString(), {
          title: 'x',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('remove is soft and the task disappears from list and get', async () => {
      const t = await service.create(admin, dto());
      await service.remove(admin, t.id);
      expect((await service.list(admin, page)).items).toHaveLength(0);
      await expect(service.getResponse(admin, t.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      const row = await TaskModel.findById(t.id).lean();
      expect(row?.deletedAt).toBeInstanceOf(Date);
      await expect(service.remove(admin, t.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('transition', () => {
    it('runs the full workflow and records history in order', async () => {
      const t = await service.create(admin, dto());
      expect(
        (await service.transition(emp1, t.id, { to: TaskStatus.IN_PROGRESS }))
          .status,
      ).toBe('IN_PROGRESS');
      await service.transition(emp1, t.id, {
        to: TaskStatus.PENDING_APPROVAL,
        note: '  done  ',
      });
      const approved = await service.transition(admin, t.id, {
        to: TaskStatus.COMPLETED,
      });
      expect(approved.status).toBe('COMPLETED');
      expect(approved.allowedTransitions).toEqual([]);
      const history = await service.listHistory(emp1, t.id);
      expect(history.map((h) => [h.fromStatus, h.toStatus, h.note])).toEqual([
        [null, 'PENDING', null],
        ['PENDING', 'IN_PROGRESS', null],
        ['IN_PROGRESS', 'PENDING_APPROVAL', 'done'],
        ['PENDING_APPROVAL', 'COMPLETED', null],
      ]);
      expect(history[3]).toEqual({
        id: expect.any(String),
        fromStatus: 'PENDING_APPROVAL',
        toStatus: 'COMPLETED',
        note: null,
        actor: { id: admin.id, name: 'Boss' },
        createdAt: expect.any(String),
      });
    });

    it('reject without a note is VALIDATION_ERROR on note; with a note returns IN_PROGRESS', async () => {
      const t = await service.create(admin, dto());
      await setStatus(t.id, TaskStatus.PENDING_APPROVAL);
      await expect(
        service.transition(admin, t.id, { to: TaskStatus.IN_PROGRESS }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        details: [{ field: 'note', message: expect.any(String) }],
      });
      const r = await service.transition(admin, t.id, {
        to: TaskStatus.IN_PROGRESS,
        note: 'More detail please',
      });
      expect(r.status).toBe('IN_PROGRESS');
      expect(r.allowedTransitions).toEqual([]);
    });

    it('maps an unlisted pair to INVALID_TRANSITION and a wrong actor to FORBIDDEN', async () => {
      const t = await service.create(admin, dto());
      await expect(
        service.transition(emp1, t.id, { to: TaskStatus.COMPLETED }),
      ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_TRANSITION' });
      await expect(
        service.transition(admin, t.id, { to: TaskStatus.IN_PROGRESS }),
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    });

    it('another employee transitioning or reading history gets NOT_FOUND', async () => {
      const t = await service.create(admin, dto());
      await expect(
        service.transition(emp2, t.id, { to: TaskStatus.IN_PROGRESS }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.listHistory(emp2, t.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('two simultaneous transitions of the same PENDING task: exactly one wins, the other STATE_CONFLICT', async () => {
      const t = await service.create(admin, dto());
      // Barrier: both transactions read the task before either writes.
      let arrived = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((r) => (release = r));
      const real = stateMachine.evaluateTransition;
      jest
        .spyOn(stateMachine, 'evaluateTransition')
        .mockImplementation((ctx) => {
          arrived += 1;
          if (arrived === 2) release();
          return real(ctx);
        });
      delayStatusWrites(() => bothRead);

      const results = await Promise.allSettled([
        service.transition(emp1, t.id, { to: TaskStatus.IN_PROGRESS }),
        service.transition(emp1, t.id, { to: TaskStatus.IN_PROGRESS }),
      ]);
      expect(arrived).toBeGreaterThanOrEqual(2);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toMatchObject({
        statusCode: 409,
        code: 'STATE_CONFLICT',
      });
      expect(
        await TaskStatusHistoryModel.countDocuments({
          taskId: new Types.ObjectId(t.id),
        }),
      ).toBe(2);
      expect((await TaskModel.findById(t.id).lean())?.status).toBe(
        'IN_PROGRESS',
      );
    });

    it('a reassignment between the read and the write is STATE_CONFLICT', async () => {
      const t = await service.create(admin, dto());
      const real = stateMachine.evaluateTransition;
      let reassigned = false;
      jest
        .spyOn(stateMachine, 'evaluateTransition')
        .mockImplementation((ctx) => {
          if (!reassigned) {
            reassigned = true;
            // Committed outside the transition's transaction, after its read.
            void TaskModel.updateOne(
              { _id: t.id },
              { $set: { assigneeId: new Types.ObjectId(emp2.id) } },
            ).exec();
          }
          return real(ctx);
        });
      // Let the reassignment land before the transition writes.
      delayStatusWrites(async () => {
        while (
          !(await TaskModel.exists({
            _id: t.id,
            assigneeId: new Types.ObjectId(emp2.id),
          }))
        ) {
          await new Promise((r) => setTimeout(r, 10));
        }
      });
      await expect(
        service.transition(emp1, t.id, { to: TaskStatus.IN_PROGRESS }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'STATE_CONFLICT' });
      const row = await TaskModel.findById(t.id).lean();
      expect(row?.status).toBe('PENDING');
      expect(
        await TaskStatusHistoryModel.countDocuments({
          taskId: new Types.ObjectId(t.id),
        }),
      ).toBe(1);
    });

    it('a failing history insert rolls the status change back', async () => {
      const t = await service.create(admin, dto());
      jest
        .spyOn(TaskStatusHistoryModel, 'create')
        .mockImplementation(() =>
          Promise.reject(new Error('history write failed')),
        );
      await expect(
        service.transition(emp1, t.id, { to: TaskStatus.IN_PROGRESS }),
      ).rejects.toThrow('history write failed');
      jest.restoreAllMocks();
      expect((await TaskModel.findById(t.id).lean())?.status).toBe('PENDING');
      expect(
        await TaskStatusHistoryModel.countDocuments({
          taskId: new Types.ObjectId(t.id),
        }),
      ).toBe(1);
    });
  });
});
