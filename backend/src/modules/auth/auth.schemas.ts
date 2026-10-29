import { z } from 'zod';
import { emailString } from '../../common/validation/primitives';

export const loginSchema = z.object({
  email: emailString.refine(
    (v) => v.length <= 255,
    'Must be at most 255 characters',
  ),
  // Upper bound only: complexity rules apply when a password is created, not when it is checked.
  password: z
    .string()
    .min(1, 'Must not be empty')
    .max(128, 'Must be at most 128 characters'),
});

export type LoginBody = z.infer<typeof loginSchema>;
