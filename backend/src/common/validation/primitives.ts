import { z } from 'zod';
import { parseObjectId } from '../utils/object-id';

/** 24-hex ObjectId string; malformed ids are a client error, not a server one. */
export const objectIdString = z
  .string()
  .refine((v) => parseObjectId(v) !== null, 'Invalid id');

/** Marker `validate` looks for in issue params: a malformed id in a PATH means "no such record" (404), not a 422. */
export const NOT_FOUND_PARAM = 'notFound';

/** Path-param id: malformed values make `validate(..., 'params')` answer 404 NOT_FOUND. Use `objectIdString` in bodies/queries. */
export const objectIdParam = z
  .string()
  .refine((v) => parseObjectId(v) !== null, {
    message: 'Invalid id',
    params: { [NOT_FOUND_PARAM]: true },
  });

/** Calendar date `YYYY-MM-DD`, kept as a string so no timezone shift can occur. */
export const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Must be a valid calendar date');

/** Trims, then requires non-empty. */
export const trimmedString = z.string().trim().min(1, 'Must not be empty');

export const emailString = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Must be a valid email'));
