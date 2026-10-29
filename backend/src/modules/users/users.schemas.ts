import { z } from 'zod';
import { RoleCode } from '../../common/enums/role-code';
import {
  emailString,
  objectIdParam,
  objectIdString,
  trimmedString,
} from '../../common/validation/primitives';

const name = trimmedString.max(120, 'Must be at most 120 characters');
const email = emailString.refine(
  (v) => v.length <= 255,
  'Must be at most 255 characters',
);
const phone = z
  .string()
  .trim()
  .regex(
    /^\+?[0-9 ()-]{7,20}$/,
    'Must be 7-20 characters: digits, spaces, +, -, ( )',
  );
// 72 is bcrypt's input limit; longer passwords would be silently truncated.
const password = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .max(72, 'Must be at most 72 characters')
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/, 'Must contain a letter and a number');

export const idParamsSchema = z.object({ id: objectIdParam });

export const listUsersQuerySchema = z.object({
  roleCode: z.enum(RoleCode).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  name,
  email,
  phone: phone.optional(),
  password,
  roleId: objectIdString,
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

/** Deliberately has no `roleId`: a user's role cannot change, and `validate` rejects unknown keys. */
export const updateUserSchema = z.object({
  name: name.optional(),
  email: email.optional(),
  phone: phone.nullable().optional(),
  password: password.optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
