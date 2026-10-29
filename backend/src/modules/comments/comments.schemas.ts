import { z } from 'zod';
import { trimmedString } from '../../common/validation/primitives';

export const COMMENT_MAX_LENGTH = 2000;

export const createCommentSchema = z.object({
  body: trimmedString.max(
    COMMENT_MAX_LENGTH,
    `Must be at most ${COMMENT_MAX_LENGTH} characters`,
  ),
});
export type CreateCommentBody = z.infer<typeof createCommentSchema>;
