import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { RoleCode } from '../../common/enums/role-code';
import {
  errorHandler,
  notFoundHandler,
} from '../../common/errors/error-handler';
import { requestId } from '../../common/middleware/request-id';
import type { AuthUser } from '../../common/types/request.types';
import { ensureIndexes, RoleModel, UserModel } from '../../models';
import { hashPassword } from '../../security/password';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { rolesRouter } from './roles.routes';
import { usersRouter } from './users.routes';
import { UsersService } from './users.service';

function buildApp(user: AuthUser): Express {
  const service = new UsersService(new RefreshTokenService(testEnv()));
  const fakeAuth: RequestHandler = (req, _res, next) => {
    req.user = user;
    next();
  };
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/api/v1/users', fakeAuth, usersRouter(service));
  app.use('/api/v1/roles', fakeAuth, rolesRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('users and roles routes', () => {
  let adminApp: Express;
  let employeeApp: Express;
  let adminId: string;
  let employeeRoleId: string;

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    const admin = await RoleModel.create({ code: 'ADMIN', name: 'Admin' });
    const emp = await RoleModel.create({ code: 'EMPLOYEE', name: 'Employee' });
    employeeRoleId = emp.id;
    const a = await UserModel.create({
      name: 'Boss',
      email: 'boss@x.com',
      passwordHash: await hashPassword('Password1'),
      roleId: admin._id,
    });
    adminId = a.id;
    adminApp = buildApp({ id: adminId, role: RoleCode.ADMIN });
    employeeApp = buildApp({ id: adminId, role: RoleCode.EMPLOYEE });
  });

  const body = (
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name: 'Ann',
    email: 'ann@x.com',
    password: 'Password1',
    roleId: employeeRoleId,
    ...over,
  });

  it('answers 403 FORBIDDEN to an Employee on every route', async () => {
    const id = '0123456789abcdef01234567';
    const calls = [
      request(employeeApp).get('/api/v1/users'),
      request(employeeApp).post('/api/v1/users').send(body()),
      request(employeeApp).get(`/api/v1/users/${id}`),
      request(employeeApp).patch(`/api/v1/users/${id}`).send({ name: 'x' }),
      request(employeeApp).delete(`/api/v1/users/${id}`),
      request(employeeApp).get('/api/v1/roles'),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });

  it('Admin: create, list, get, patch, delete', async () => {
    const created = await request(adminApp).post('/api/v1/users').send(body());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Ann',
      email: 'ann@x.com',
      isDefault: false,
      role: { code: 'EMPLOYEE' },
    });
    expect(created.body).not.toHaveProperty('passwordHash');
    const id = created.body.id as string;

    const list = await request(adminApp).get(
      '/api/v1/users?roleCode=EMPLOYEE&page=1&limit=5',
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([id]);
    expect(list.body.meta).toEqual({
      page: 1,
      limit: 5,
      total: 1,
      totalPages: 1,
    });

    const got = await request(adminApp).get(`/api/v1/users/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(id);

    const patched = await request(adminApp)
      .patch(`/api/v1/users/${id}`)
      .send({ name: 'Anna', phone: null });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Anna', phone: null });

    const del = await request(adminApp).delete(`/api/v1/users/${id}`);
    expect(del.status).toBe(204);
    expect((await request(adminApp).get(`/api/v1/users/${id}`)).status).toBe(
      404,
    );
  });

  it('GET /roles returns RoleResponse[]', async () => {
    const res = await request(adminApp).get('/api/v1/roles');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      code: expect.any(String),
      name: expect.any(String),
    });
  });

  it('a malformed path id is 404 NOT_FOUND on get, patch and delete', async () => {
    for (const res of [
      await request(adminApp).get('/api/v1/users/123'),
      await request(adminApp)
        .patch('/api/v1/users/not-an-id')
        .send({ name: 'x' }),
      await request(adminApp).delete('/api/v1/users/123'),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  it('a duplicate email is 409 CONFLICT, ignoring case and whitespace', async () => {
    await request(adminApp).post('/api/v1/users').send(body());
    const res = await request(adminApp)
      .post('/api/v1/users')
      .send(body({ email: '  ANN@x.com ' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('PATCH with roleId (or any unknown key) is 422: the role cannot change', async () => {
    const created = await request(adminApp).post('/api/v1/users').send(body());
    const res = await request(adminApp)
      .patch(`/api/v1/users/${created.body.id}`)
      .send({ roleId: employeeRoleId });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual([
      { field: 'roleId', message: 'Unknown field' },
    ]);
  });

  it('create with a malformed or unknown roleId is 422 on field roleId', async () => {
    const bad = await request(adminApp)
      .post('/api/v1/users')
      .send(body({ roleId: 'zzz' }));
    expect(bad.status).toBe(422);
    expect(bad.body.details[0].field).toBe('roleId');
    const unknown = await request(adminApp)
      .post('/api/v1/users')
      .send(body({ roleId: '0123456789abcdef01234567' }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.details[0].field).toBe('roleId');
  });

  it('create validates name, email and password', async () => {
    for (const over of [
      { name: '  ' },
      { email: 'nope' },
      { password: 'short1' },
      { password: 'allletters' },
      { password: 'a1'.repeat(40) },
      { phone: 'abc' },
    ]) {
      const res = await request(adminApp)
        .post('/api/v1/users')
        .send(body(over));
      expect(res.status).toBe(422);
    }
  });

  it.each([
    'page=0',
    'limit=0',
    'limit=101',
    'limit=abc',
    'foo=1',
    'roleCode=BOSS',
  ])('list query %s is 422', async (qs) => {
    const res = await request(adminApp).get(`/api/v1/users?${qs}`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('list accepts limit=100 and defaults page/limit', async () => {
    const res = await request(adminApp).get('/api/v1/users?limit=100');
    expect(res.status).toBe(200);
    const def = await request(adminApp).get('/api/v1/users');
    expect(def.body.meta).toMatchObject({ page: 1, limit: 20 });
  });

  it('delete of self is 409 CONFLICT', async () => {
    const res = await request(adminApp).delete(`/api/v1/users/${adminId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });
});
