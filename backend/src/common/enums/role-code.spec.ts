import { isRoleCode, RoleCode } from './role-code';

describe('isRoleCode', () => {
  it('accepts known roles only', () => {
    expect(isRoleCode('ADMIN')).toBe(true);
    expect(isRoleCode(RoleCode.EMPLOYEE)).toBe(true);
    expect(isRoleCode('admin')).toBe(false);
  });
});
