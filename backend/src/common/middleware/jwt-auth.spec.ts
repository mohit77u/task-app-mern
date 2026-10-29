import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import request from 'supertest';
import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { RoleModel, UserModel } from '../../models';
import { ACCESS_COOKIE } from '../../security/cookies';
import { signAccessToken } from '../../security/token';
import { RoleCode } from '../enums/role-code';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { errorHandler } from '../errors/error-handler';
import { jwtAuth, resolveSessionUser } from './jwt-auth';

const ID = new Types.ObjectId().toHexString();

function errorOf(fn: () => unknown): AppException {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('resolveSessionUser', () => {
  const changedAt = new Date('2026-01-01T12:00:00.500Z');
  const changedAtSeconds = Math.floor(changedAt.getTime() / 1000);

  it('refuses a token whose user no longer exists (or was deleted)', () => {
    const error = errorOf(() =>
      resolveSessionUser({ id: ID, role: RoleCode.ADMIN, issuedAt: 1 }, null),
    );
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe(ErrorCode.UNAUTHENTICATED);
  });

  it.each([
    ['before', changedAtSeconds - 1],
    ['in the same second as', changedAtSeconds],
  ])('refuses a token issued %s the password change', (_label, issuedAt) => {
    const error = errorOf(() =>
      resolveSessionUser(
        { id: ID, role: RoleCode.ADMIN, issuedAt },
        { id: ID, passwordChangedAt: changedAt, role: { code: 'ADMIN' } },
      ),
    );
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Session expired. Please sign in again.');
  });

  it('accepts a token issued after the password change', () => {
    expect(
      resolveSessionUser(
        { id: ID, role: RoleCode.ADMIN, issuedAt: changedAtSeconds + 1 },
        { id: ID, passwordChangedAt: changedAt, role: { code: 'ADMIN' } },
      ),
    ).toEqual({ id: ID, role: RoleCode.ADMIN });
  });

  it('lets the database role win over the role in the token', () => {
    expect(
      resolveSessionUser(
        { id: ID, role: RoleCode.ADMIN, issuedAt: 1 },
        { id: ID, passwordChangedAt: null, role: { code: 'EMPLOYEE' } },
      ),
    ).toEqual({ id: ID, role: RoleCode.EMPLOYEE });
  });

  it('refuses a user whose stored role is not a known role code', () => {
    expect(
      errorOf(() =>
        resolveSessionUser(
          { id: ID, role: RoleCode.ADMIN, issuedAt: 1 },
          { id: ID, passwordChangedAt: null, role: { code: 'ROOT' } },
        ),
      ).code,
    ).toBe(ErrorCode.UNAUTHENTICATED);
  });
});

describe('jwtAuth middleware', () => {
  const env = testEnv();
  const app = express();
  app.use(cookieParser());
  app.get('/api/probe', jwtAuth(env), (req, res) => {
    res.json(req.user);
  });
  app.use(errorHandler);

  let userId: string;

  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    const role = await RoleModel.create({ code: 'EMPLOYEE', name: 'Employee' });
    const user = await UserModel.create({
      name: 'Emp',
      email: 'emp@example.com',
      passwordHash: 'x',
      roleId: role._id,
    });
    userId = user._id.toHexString();
  });

  async function probe(token?: string): Promise<request.Response> {
    const req = request(app).get('/api/probe');
    return token ? req.set('Cookie', `${ACCESS_COOKIE}=${token}`) : req;
  }

  it('sets req.user from the database row for a valid access cookie', async () => {
    // The token claims ADMIN; the DB says EMPLOYEE, and the DB wins.
    const token = await signAccessToken(
      { id: userId, role: RoleCode.ADMIN },
      env,
    );
    const res = await probe(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: userId, role: 'EMPLOYEE' });
  });

  it('answers 401 UNAUTHENTICATED without a cookie', async () => {
    const res = await probe();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 TOKEN_EXPIRED for an expired access token', async () => {
    const expired = jwt.sign(
      { sub: userId, role: 'EMPLOYEE' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    const res = await probe(expired);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('refuses a user soft-deleted after the token was issued (Review Focus 5)', async () => {
    const token = await signAccessToken(
      { id: userId, role: RoleCode.EMPLOYEE },
      env,
    );
    expect((await probe(token)).status).toBe(200);
    await UserModel.updateOne({ _id: userId }, { deletedAt: new Date() });
    const res = await probe(token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a token minted before the password was changed', async () => {
    const token = await signAccessToken(
      { id: userId, role: RoleCode.EMPLOYEE },
      env,
    );
    await UserModel.updateOne(
      { _id: userId },
      { passwordChangedAt: new Date(Date.now() + 1000) },
    );
    const res = await probe(token);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Session expired. Please sign in again.');
  });
});
