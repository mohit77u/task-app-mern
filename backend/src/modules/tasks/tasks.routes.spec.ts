import express, { type Express, type RequestHandler } from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { clearTestDb, startTestDb, stopTestDb } from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import {
  errorHandler,
  notFoundHandler,
} from '../../common/errors/error-handler';
import { requestId } from '../../common/middleware/request-id';
import type { AuthUser } from '../../common/types/request.types';
import { ensureIndexes, RoleModel, UserModel } from '../../models';
import { commentsRouter } from '../comments/comments.routes';
import { CommentsService } from '../comments/comments.service';
import { dashboardRouter } from '../dashboard/dashboard.routes';
import { DashboardService } from '../dashboard/dashboard.service';
import { healthRouter } from '../health/health.routes';
import { taskTransitionRouter, tasksRouter } from './tasks.routes';
import { TasksService } from './tasks.service';

const limited: string[] = [];
const limiter: RequestHandler = (req, _res, next) => {
  limited.push(`${req.method} ${req.originalUrl}`);
  next();
};

function buildApp(user: AuthUser): Express {
  const tasks = new TasksService();
  const fakeAuth: RequestHandler = (req, _res, next) => {
    req.user = user;
    next();
  };
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/api', healthRouter());
  app.use(
    '/api/v1/tasks',
    fakeAuth,
    tasksRouter(tasks),
    taskTransitionRouter(tasks, limiter),
    commentsRouter(new CommentsService(tasks), limiter),
  );
  app.use(
    '/api/v1/dashboard',
    fakeAuth,
    dashboardRouter(new DashboardService(tasks)),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('tasks, comments, dashboard and health routes', () => {
  let adminApp: Express;
  let emp1App: Express;
  let emp2App: Express;
  let emp1Id: string;

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    limited.length = 0;
    const adminRole = await RoleModel.create({ code: 'ADMIN', name: 'Admin' });
    const empRole = await RoleModel.create({
      code: 'EMPLOYEE',
      name: 'Employee',
    });
    const mk = async (name: string, roleId: Types.ObjectId): Promise<string> =>
      (
        await UserModel.create({
          name,
          email: `${name.toLowerCase()}@x.com`,
          passwordHash: 'h',
          roleId,
        })
      ).id;
    const adminId = await mk('Boss', adminRole._id);
    emp1Id = await mk('Ann', empRole._id);
    const emp2Id = await mk('Ben', empRole._id);
    adminApp = buildApp({ id: adminId, role: RoleCode.ADMIN });
    emp1App = buildApp({ id: emp1Id, role: RoleCode.EMPLOYEE });
    emp2App = buildApp({ id: emp2Id, role: RoleCode.EMPLOYEE });
  });
  afterEach(() => jest.restoreAllMocks());

  const body = (
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    title: 'Write report',
    description: 'Quarterly numbers',
    priority: 'HIGH',
    dueDate: '2030-01-31',
    assigneeId: emp1Id,
    ...over,
  });

  async function createTask(
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(adminApp).post('/api/v1/tasks').send(body(over));
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('Admin: create 201, list, get, patch, history, delete 204', async () => {
    const created = await request(adminApp)
      .post('/api/v1/tasks')
      .send(body({ title: '  Trimmed  ' }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Trimmed',
      status: 'PENDING',
      assignee: { id: emp1Id, name: 'Ann', email: 'ann@x.com' },
    });
    const id = created.body.id as string;

    const list = await request(adminApp).get('/api/v1/tasks?page=1&limit=5');
    expect(list.status).toBe(200);
    expect(list.body.meta).toEqual({
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });

    expect((await request(adminApp).get(`/api/v1/tasks/${id}`)).body.id).toBe(
      id,
    );
    const patched = await request(adminApp)
      .patch(`/api/v1/tasks/${id}`)
      .send({ priority: 'LOW' });
    expect(patched.status).toBe(200);
    expect(patched.body.priority).toBe('LOW');

    const history = await request(adminApp).get(`/api/v1/tasks/${id}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);

    expect((await request(adminApp).delete(`/api/v1/tasks/${id}`)).status).toBe(
      204,
    );
    expect((await request(adminApp).get(`/api/v1/tasks/${id}`)).status).toBe(
      404,
    );
  });

  it('Employee gets 403 FORBIDDEN on create, update and delete', async () => {
    const id = await createTask();
    for (const res of [
      await request(emp1App).post('/api/v1/tasks').send(body()),
      await request(emp1App).patch(`/api/v1/tasks/${id}`).send({ title: 'x' }),
      await request(emp1App).delete(`/api/v1/tasks/${id}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });

  it("Employee gets 404 for another employee's task on every task route", async () => {
    const id = await createTask();
    for (const res of [
      await request(emp2App).get(`/api/v1/tasks/${id}`),
      await request(emp2App).get(`/api/v1/tasks/${id}/history`),
      await request(emp2App).get(`/api/v1/tasks/${id}/comments`),
      await request(emp2App)
        .post(`/api/v1/tasks/${id}/comments`)
        .send({ body: 'hi' }),
      await request(emp2App)
        .post(`/api/v1/tasks/${id}/transition`)
        .send({ to: 'IN_PROGRESS' }),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  it.each(['not-an-id', '123456789012', '123'])(
    'malformed path id %p is 404 NOT_FOUND with a requestId on every route',
    async (bad) => {
      const base = `/api/v1/tasks/${bad}`;
      for (const res of [
        await request(adminApp).get(base),
        await request(adminApp).patch(base).send({ title: 'x' }),
        await request(adminApp).delete(base),
        await request(adminApp).get(`${base}/history`),
        await request(adminApp).get(`${base}/comments`),
        await request(adminApp).post(`${base}/comments`).send({ body: 'x' }),
        await request(adminApp)
          .post(`${base}/transition`)
          .send({ to: 'COMPLETED' }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          code: 'NOT_FOUND',
          requestId: expect.any(String),
        });
      }
    },
  );

  it.each(['(a.*', '[', '\\'])(
    'search %p is 200 and matches only the literal text',
    async (q) => {
      const hit = await createTask({ title: `has ${q} in it` });
      await createTask({ title: 'a plain task' });
      const res = await request(adminApp)
        .get('/api/v1/tasks')
        .query({ search: q });
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([hit]);
    },
  );

  it.each([
    'page=0',
    'limit=1000',
    'limit=abc',
    'limit=0',
    'foo=1',
    'status=DONE',
    'priority=URGENT',
    'assigneeId=123',
    'search=',
    `search=${'x'.repeat(101)}`,
  ])('list query %s is 422 VALIDATION_ERROR', async (qs) => {
    const res = await request(adminApp).get(`/api/v1/tasks?${qs}`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('Employee list ignores assigneeId and shows only own tasks', async () => {
    const mine = await createTask();
    const res = await request(emp1App).get('/api/v1/tasks');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([mine]);
    const other = await request(emp2App)
      .get('/api/v1/tasks')
      .query({ assigneeId: emp1Id });
    expect(other.body.items).toEqual([]);
  });

  it.each([
    [{ dueDate: '2026-02-30' }, 'dueDate'],
    [{ dueDate: '2026-2-3' }, 'dueDate'],
    [{ assigneeId: 'zzz' }, 'assigneeId'],
    [{ assigneeId: new Types.ObjectId().toHexString() }, 'assigneeId'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ priority: 'URGENT' }, 'priority'],
    [{ status: 'COMPLETED' }, 'status'],
  ])('create with %p is 422 on field %s', async (over, field) => {
    const res = await request(adminApp).post('/api/v1/tasks').send(body(over));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe(field);
  });

  it('transition: 200 with the new task, 422 for a bad body, and the limiter slot runs', async () => {
    const id = await createTask();
    const bad = await request(emp1App)
      .post(`/api/v1/tasks/${id}/transition`)
      .send({ to: 'DONE' });
    expect(bad.status).toBe(422);
    const ok = await request(emp1App)
      .post(`/api/v1/tasks/${id}/transition`)
      .send({ to: 'IN_PROGRESS' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      id,
      status: 'IN_PROGRESS',
      allowedTransitions: ['PENDING_APPROVAL'],
    });
    const invalid = await request(emp1App)
      .post(`/api/v1/tasks/${id}/transition`)
      .send({ to: 'COMPLETED' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe('INVALID_TRANSITION');
    expect(limited).toEqual([
      `POST /api/v1/tasks/${id}/transition`,
      `POST /api/v1/tasks/${id}/transition`,
      `POST /api/v1/tasks/${id}/transition`,
    ]);
  });

  it('comments: POST 201 trimmed, GET lists, empty body 422; only POST is limited', async () => {
    const id = await createTask();
    const created = await request(emp1App)
      .post(`/api/v1/tasks/${id}/comments`)
      .send({ body: '  hi  ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      body: 'hi',
      author: { id: emp1Id, name: 'Ann' },
    });
    const empty = await request(emp1App)
      .post(`/api/v1/tasks/${id}/comments`)
      .send({ body: '   ' });
    expect(empty.status).toBe(422);
    expect(empty.body.details[0].field).toBe('body');
    const list = await request(adminApp).get(`/api/v1/tasks/${id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.map((c: { body: string }) => c.body)).toEqual(['hi']);
    expect(limited).toHaveLength(2);
    expect(limited.every((l) => l.startsWith('POST '))).toBe(true);
  });

  it('dashboard: scoped, zero-filled counts', async () => {
    await createTask();
    const res = await request(emp2App).get('/api/v1/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      counts: { PENDING: 0, IN_PROGRESS: 0, PENDING_APPROVAL: 0, COMPLETED: 0 },
      total: 0,
    });
    const admin = await request(adminApp).get('/api/v1/dashboard');
    expect(admin.body.counts.PENDING).toBe(1);
    expect(admin.body.total).toBe(1);
  });

  describe('health', () => {
    it('GET is 200 {status:ok, db:up}; HEAD is 200 without a body', async () => {
      const get = await request(adminApp).get('/api/health');
      expect(get.status).toBe(200);
      expect(get.body).toEqual({ status: 'ok', db: 'up' });
      const head = await request(adminApp).head('/api/health');
      expect(head.status).toBe(200);
      expect(head.text).toBeUndefined();
    });

    it('a failing ping is 503 SERVICE_UNAVAILABLE for GET and HEAD', async () => {
      const db = mongoose.connection.db!;
      jest.spyOn(db, 'admin').mockReturnValue({
        ping: () => Promise.reject(new Error('db down')),
      } as never);
      const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
      const get = await request(adminApp).get('/api/health');
      expect(get.status).toBe(503);
      expect(get.body.code).toBe('SERVICE_UNAVAILABLE');
      const head = await request(adminApp).head('/api/health');
      expect(head.status).toBe(503);
      expect(head.text).toBeUndefined();
      expect(logged).toHaveBeenCalled();
    });
  });
});
