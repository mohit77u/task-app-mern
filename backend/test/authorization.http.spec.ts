import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  DEMO,
  expectErrorBody,
  ORIGIN,
  seedDemo,
  signIn,
  type SignedIn,
} from './http';
import { startTestDb, stopTestDb, testEnv } from './mongo';

describe('authorization over HTTP', () => {
  const env = testEnv();
  let app: Express;
  let admin: SignedIn;
  let priya: SignedIn;
  let rahul: SignedIn;
  let priyaTaskId: string;

  beforeAll(async () => {
    await startTestDb();
    await seedDemo(env);
    app = createApp(env);
    [admin, priya, rahul] = await Promise.all([
      signIn(app, DEMO.admin),
      signIn(app, DEMO.priya),
      signIn(app, DEMO.rahul),
    ]);
    const created = await admin.agent
      .post('/api/v1/tasks')
      .set('Origin', ORIGIN)
      .send({
        title: 'Priya only',
        description: 'Visible to Priya and Admins',
        priority: 'LOW',
        dueDate: '2030-01-01',
        assigneeId: priya.id,
      })
      .expect(201);
    priyaTaskId = (created.body as { id: string }).id;
  });
  afterAll(stopTestDb);

  it('unauthenticated requests to business routes are 401', async () => {
    const res = await request(app).get('/api/v1/tasks').expect(401);
    expectErrorBody(res.body, 401, 'UNAUTHENTICATED');
    await request(app).get('/api/v1/dashboard').expect(401);
    await request(app).get('/api/v1/auth/me').expect(401);
  });

  it.each([
    ['POST', '/api/v1/tasks'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/roles'],
  ])(
    'an Employee on Admin-only %s %s is 403 FORBIDDEN',
    async (method, path) => {
      const req =
        method === 'POST'
          ? rahul.agent.post(path).set('Origin', ORIGIN).send({})
          : rahul.agent.get(path);
      const res = await req.expect(403);
      expectErrorBody(res.body, 403, 'FORBIDDEN');
    },
  );

  it("an Employee cannot see another employee's task: detail, history and comments are 404", async () => {
    const base = `/api/v1/tasks/${priyaTaskId}`;
    for (const path of [base, `${base}/history`, `${base}/comments`]) {
      const res = await rahul.agent.get(path).expect(404);
      expectErrorBody(res.body, 404, 'NOT_FOUND');
    }
    const comment = await rahul.agent
      .post(`${base}/comments`)
      .set('Origin', ORIGIN)
      .send({ body: 'sneaky' })
      .expect(404);
    expectErrorBody(comment.body, 404, 'NOT_FOUND');
    // The owner and the Admin can.
    await priya.agent.get(base).expect(200);
    await admin.agent.get(base).expect(200);
  });

  it("an Employee PATCH on any task is 403 (editing is Admin-only), so it reveals nothing about another's task", async () => {
    const res = await rahul.agent
      .patch(`/api/v1/tasks/${priyaTaskId}`)
      .set('Origin', ORIGIN)
      .send({ title: 'mine now' })
      .expect(403);
    expectErrorBody(res.body, 403, 'FORBIDDEN');
    // Same answer for an id that does not exist.
    await rahul.agent
      .patch('/api/v1/tasks/000000000000000000000000')
      .set('Origin', ORIGIN)
      .send({ title: 'x' })
      .expect(403);
  });

  it('a transition by an Employee who is not the assignee is 404', async () => {
    const res = await rahul.agent
      .post(`/api/v1/tasks/${priyaTaskId}/transition`)
      .set('Origin', ORIGIN)
      .send({ to: 'IN_PROGRESS' })
      .expect(404);
    expectErrorBody(res.body, 404, 'NOT_FOUND');
  });

  it('a user deleted by an Admin while signed in is refused on the next request and cannot refresh (Review Focus 5)', async () => {
    // Demo accounts cannot be deleted, so the Admin creates a throwaway employee first.
    const roles = await admin.agent.get('/api/v1/roles').expect(200);
    const employeeRole = (roles.body as { id: string; code: string }[]).find(
      (r) => r.code === 'EMPLOYEE',
    )!;
    const account = { email: 'temp@example.com', password: 'Temp#12345' };
    await admin.agent
      .post('/api/v1/users')
      .set('Origin', ORIGIN)
      .send({ name: 'Temp', ...account, roleId: employeeRole.id })
      .expect(201);
    const temp = await signIn(app, account);
    await temp.agent.get('/api/v1/tasks').expect(200);
    await admin.agent
      .delete(`/api/v1/users/${temp.id}`)
      .set('Origin', ORIGIN)
      .expect(204);

    const res = await temp.agent.get('/api/v1/tasks').expect(401);
    expectErrorBody(res.body, 401, 'UNAUTHENTICATED');
    await temp.agent
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .expect(401);
  });

  it('an Employee list contains only their own tasks', async () => {
    const res = await rahul.agent.get('/api/v1/tasks?limit=100').expect(200);
    const items = (res.body as { items: { assignee: { id: string } }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.assignee.id === rahul.id)).toBe(true);
  });
});
