export enum RoleCode {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
}

export function isRoleCode(value: string): value is RoleCode {
  return (Object.values(RoleCode) as string[]).includes(value);
}
