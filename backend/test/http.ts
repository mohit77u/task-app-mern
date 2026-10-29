/**
 * Shared helpers for the HTTP integration suites: the seeded demo accounts and a sign-in that returns a supertest agent
 * (one agent = one browser with its own cookie jar).
 */
import type { Express } from 'express';
import request from 'supertest';
import type { Env } from '../src/config/env.validation';
import { DEFAULT_DEMO_PASSWORDS } from '../src/database/seed/demo-data';
import { seed } from '../src/database/seed/seed';
import { ensureIndexes } from '../src/models';

export const ORIGIN = 'http://localhost:5173';
export const EVIL_ORIGIN = 'https://evil.example';

export type Agent = ReturnType<typeof request.agent>;

export interface DemoAccount {
  email: string;
  password: string;
}

export const DEMO = {
  admin: { email: 'admin@taskapp.dev', password: DEFAULT_DEMO_PASSWORDS.admin },
  priya: {
    email: 'priya@taskapp.dev',
    password: DEFAULT_DEMO_PASSWORDS.employee,
  },
  rahul: {
    email: 'rahul@taskapp.dev',
    password: DEFAULT_DEMO_PASSWORDS.employee,
  },
} as const satisfies Record<string, DemoAccount>;

/** Indexes plus the idempotent demo seed. Seed once per file: bcrypt cost 12 makes it the slow part. */
export async function seedDemo(env: Env): Promise<void> {
  await ensureIndexes();
  await seed(env);
}

export interface SignedIn {
  agent: Agent;
  id: string;
}

export async function signIn(
  app: Express,
  account: DemoAccount,
): Promise<SignedIn> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: account.email, password: account.password })
    .expect(200);
  return { agent, id: (res.body as { user: { id: string } }).user.id };
}

/** The error contract every failure follows. */
export function expectErrorBody(
  body: unknown,
  statusCode: number,
  code: string,
): void {
  expect(body).toEqual({
    statusCode,
    code,
    message: expect.any(String),
    details: expect.any(Array),
    requestId: expect.any(String),
    timestamp: expect.any(String),
    path: expect.any(String),
  });
}
