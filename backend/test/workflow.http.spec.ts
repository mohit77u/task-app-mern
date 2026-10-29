import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { TaskModel } from '../src/models';
import {
  DEMO,
  EVIL_ORIGIN,
  expectErrorBody,
  ORIGIN,
  seedDemo,
  signIn,
  type Agent,
  type SignedIn,
} from './http';
import { startTestDb, stopTestDb, testEnv } from './mongo';

const STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'PENDING_APPROVAL',
  'COMPLETED',
] as const;

interface TaskBody {
  id: string;
  status: string;
  allowedTransitions: string[];
}

interface HistoryRow {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actor: { id: string; name: string };
}

describe('reviewer workflow over HTTP', () => {
  const env = testEnv();
  let app: Express;
  // Two agents = two browsers, each with its own cookie jar.
  let admin: SignedIn;
  let priya: SignedIn;

  beforeAll(async () => {
    await startTestDb();
    await seedDemo(env);
    app = createApp(env);
    [admin, priya] = await Promise.all([
      signIn(app, DEMO.admin),
      signIn(app, DEMO.priya),
    ]);
  });
  afterAll(stopTestDb);
  afterEach(() => jest.restoreAllMocks());

  function createTask(title: string): request.Test {
    return admin.agent.post('/api/v1/tasks').set('Origin', ORIGIN).send({
      title,
      description: 'Integration test task',
      priority: 'HIGH',
      dueDate: '2030-06-30',
      assigneeId: priya.id,
    });
  }

  function transition(
    agent: Agent,
    id: string,
    to: string,
    note?: string,
  ): request.Test {
    return agent
      .post(`/api/v1/tasks/${id}/transition`)
      .set('Origin', ORIGIN)
      .send(note === undefined ? { to } : { to, note });
  }

  it('Admin creates and assigns, Employee works, Admin rejects with a note and finally approves; history records every step', async () => {
    const created = await createTask('Quarterly report').expect(201);
    const task = created.body as TaskBody;
    expect(task.status).toBe('PENDING');

    // The Employee sees it, with the move they may make.
    const seen = await priya.agent.get(`/api/v1/tasks/${task.id}`).expect(200);
    expect((seen.body as TaskBody).allowedTransitions).toEqual(['IN_PROGRESS']);

    await transition(priya.agent, task.id, 'IN_PROGRESS').expect(200);
    const submitted = await transition(
      priya.agent,
      task.id,
      'PENDING_APPROVAL',
    ).expect(200);
    expect((submitted.body as TaskBody).status).toBe('PENDING_APPROVAL');

    // An Employee cannot approve their own work.
    const selfApprove = await transition(
      priya.agent,
      task.id,
      'COMPLETED',
    ).expect(403);
    expectErrorBody(selfApprove.body, 403, 'FORBIDDEN');

    // Rejecting needs a reason.
    const noNote = await transition(admin.agent, task.id, 'IN_PROGRESS').expect(
      422,
    );
    expectErrorBody(noNote.body, 422, 'VALIDATION_ERROR');
    expect(noNote.body.details).toEqual([
      { field: 'note', message: expect.any(String) },
    ]);

    const rejected = await transition(
      admin.agent,
      task.id,
      'IN_PROGRESS',
      'Please add the Q3 numbers',
    ).expect(200);
    expect((rejected.body as TaskBody).status).toBe('IN_PROGRESS');

    await transition(priya.agent, task.id, 'PENDING_APPROVAL').expect(200);
    const approved = await transition(admin.agent, task.id, 'COMPLETED').expect(
      200,
    );
    expect((approved.body as TaskBody).status).toBe('COMPLETED');
    expect((approved.body as TaskBody).allowedTransitions).toEqual([]);

    const history = await priya.agent
      .get(`/api/v1/tasks/${task.id}/history`)
      .expect(200);
    const rows = (history.body as HistoryRow[]).map((r) => ({
      from: r.fromStatus,
      to: r.toStatus,
      actor: r.actor.id,
      note: r.note,
    }));
    expect(rows).toEqual([
      { from: null, to: 'PENDING', actor: admin.id, note: null },
      { from: 'PENDING', to: 'IN_PROGRESS', actor: priya.id, note: null },
      {
        from: 'IN_PROGRESS',
        to: 'PENDING_APPROVAL',
        actor: priya.id,
        note: null,
      },
      {
        from: 'PENDING_APPROVAL',
        to: 'IN_PROGRESS',
        actor: admin.id,
        note: 'Please add the Q3 numbers',
      },
      {
        from: 'IN_PROGRESS',
        to: 'PENDING_APPROVAL',
        actor: priya.id,
        note: null,
      },
      {
        from: 'PENDING_APPROVAL',
        to: 'COMPLETED',
        actor: admin.id,
        note: null,
      },
    ]);
    expect(
      (history.body as HistoryRow[]).every((r) => r.actor.name.length > 0),
    ).toBe(true);
  });

  it.each([
    ['Admin', () => admin],
    ['Employee', () => priya],
  ])(
    'the %s dashboard counts agree with the task list',
    async (_label, who) => {
      const { agent } = who();
      const dash = await agent.get('/api/v1/dashboard').expect(200);
      const { counts, total } = dash.body as {
        counts: Record<string, number>;
        total: number;
      };
      const all = await agent.get('/api/v1/tasks?limit=1').expect(200);
      expect(total).toBe((all.body as { meta: { total: number } }).meta.total);
      expect(total).toBeGreaterThan(0);
      for (const status of STATUSES) {
        const list = await agent
          .get(`/api/v1/tasks?status=${status}&limit=1`)
          .expect(200);
        expect(counts[status]).toBe(
          (list.body as { meta: { total: number } }).meta.total,
        );
      }
    },
  );

  it('two concurrent transitions of one task: one 200, the other 409 STATE_CONFLICT', async () => {
    const task = (await createTask('Race me').expect(201)).body as TaskBody;

    // Barrier: hold each status write until both requests have read the task, so they genuinely overlap.
    const original = TaskModel.findOneAndUpdate.bind(TaskModel);
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    // If a regression stops the second request from reaching the write, open the barrier after 3 s and fail clearly
    // below instead of hanging until the test timeout.
    let barrierTimedOut = false;
    const barrierTimer = setTimeout(() => {
      barrierTimedOut = true;
      release();
    }, 3_000);
    jest.spyOn(TaskModel, 'findOneAndUpdate').mockImplementation(((
      ...args: Parameters<typeof TaskModel.findOneAndUpdate>
    ) => {
      arrived += 1;
      if (arrived === 2) release();
      return {
        lean: async () => {
          await bothRead;
          return original(...args).lean();
        },
      };
    }) as never);

    const responses = await Promise.all([
      transition(priya.agent, task.id, 'IN_PROGRESS'),
      transition(priya.agent, task.id, 'IN_PROGRESS'),
    ]);
    clearTimeout(barrierTimer);
    if (barrierTimedOut) {
      throw new Error(
        `Concurrency barrier timed out: only ${arrived} of 2 transitions reached the status write within 3 s`,
      );
    }
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = responses.find((r) => r.status === 409)!;
    expectErrorBody(loser.body, 409, 'STATE_CONFLICT');

    jest.restoreAllMocks();
    const history = await admin.agent
      .get(`/api/v1/tasks/${task.id}/history`)
      .expect(200);
    expect(history.body).toHaveLength(2);
  });

  it('an unknown or malformed task id is 404 with the request id in the body', async () => {
    const res = await admin.agent
      .get('/api/v1/tasks/xyz')
      .set('X-Request-Id', 'trace-123')
      .expect(404);
    expectErrorBody(res.body, 404, 'NOT_FOUND');
    expect(res.body.requestId).toBe('trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
    expect(res.body.path).toBe('/api/v1/tasks/xyz');
  });

  it('malformed JSON is 400 with the contract body', async () => {
    const res = await admin.agent
      .post('/api/v1/tasks')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{"title": ')
      .expect(400);
    expectErrorBody(res.body, 400, 'VALIDATION_ERROR');
    expect(res.body.message).toBe('Request body is not valid JSON');
  });

  it('a write from a foreign Origin is 403 even with a valid session', async () => {
    const res = await admin.agent
      .post('/api/v1/tasks')
      .set('Origin', EVIL_ORIGIN)
      .send({})
      .expect(403);
    expectErrorBody(res.body, 403, 'FORBIDDEN');
  });
});
