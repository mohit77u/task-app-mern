import type { NextFunction, Request, Response } from 'express';
import { RoleCode } from '../enums/role-code';
import { AppException } from '../errors/app.exception';
import { requireRole } from './require-role';

function run(user: Request['user'], ...roles: RoleCode[]): unknown {
  const next = jest.fn<void, [unknown?]>();
  requireRole(...roles)(
    { user } as Request,
    {} as Response,
    next as NextFunction,
  );
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
}

describe('requireRole', () => {
  it('answers 401 UNAUTHENTICATED without req.user', () => {
    const err = run(undefined, RoleCode.ADMIN);
    expect(err).toBeInstanceOf(AppException);
    expect(err).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
  });

  it('answers 403 FORBIDDEN for a role that is not allowed', () => {
    const err = run({ id: 'x', role: RoleCode.EMPLOYEE }, RoleCode.ADMIN);
    expect(err).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('passes an allowed role through with no error', () => {
    expect(run({ id: 'x', role: RoleCode.ADMIN }, RoleCode.ADMIN)).toBe(
      undefined,
    );
    expect(
      run(
        { id: 'x', role: RoleCode.EMPLOYEE },
        RoleCode.ADMIN,
        RoleCode.EMPLOYEE,
      ),
    ).toBe(undefined);
  });
});
