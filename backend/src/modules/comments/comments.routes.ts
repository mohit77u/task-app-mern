import { Router, type RequestHandler } from 'express';
import { validate } from '../../common/validation/validate';
import { idParamsSchema } from '../tasks/tasks.schemas';
import { noLimit } from '../tasks/tasks.routes';
import { createCommentsController } from './comments.controller';
import { createCommentSchema } from './comments.schemas';
import type { CommentsService } from './comments.service';

/**
 * `GET|POST /api/v1/tasks/:id/comments` for the Admin or the assignee (scoped in the service). `limiter` sits in front
 * of the POST so Task 9 can apply the 20/min limit. Mounted behind `jwtAuth` (Task 9).
 */
export function commentsRouter(
  service: CommentsService,
  limiter: RequestHandler = noLimit,
): Router {
  const c = createCommentsController(service);
  const id = validate(idParamsSchema, 'params');
  const router = Router();
  router.get('/:id/comments', id, c.list);
  router.post(
    '/:id/comments',
    limiter,
    id,
    validate(createCommentSchema, 'body'),
    c.create,
  );
  return router;
}
