import type { IRole, IUser } from '../../models';

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Seeded demo account: the UI hides Delete for these and the API refuses it. */
  isDefault: boolean;
  role: { id: string; code: string; name: string };
}

export type UserFields = Pick<
  IUser,
  '_id' | 'name' | 'email' | 'phone' | 'isDefault'
>;
export type RoleFields = Pick<IRole, '_id' | 'code' | 'name'>;

/** The only shape in which users leave the API. It deliberately omits the password hash. */
export function toUserResponse(
  user: UserFields,
  role: RoleFields,
): UserResponse {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    isDefault: user.isDefault,
    role: { id: role._id.toHexString(), code: role.code, name: role.name },
  };
}
