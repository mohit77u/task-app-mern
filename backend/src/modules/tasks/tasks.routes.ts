import { Router, type RequestHandler } from 'express';
import { RoleCode } from '../../common/enums/role-code';
import { requireRole } from '../../common/middleware/require-role';
import { validate } from '../../common/validation/validate';
import { createTasksController } from './tasks.controller';
import {
  createTaskSchema,
  idParamsSchema,
  listTasksQuerySchema,
  transitionTaskSchema,
  updateTaskSchema,
} from './tasks.schemas';
import type { TasksService } from './tasks.service';

/** Placeholder for the rate-limit slot; Task 9 passes the real 20/min limiter. */
export const noLimit: RequestHandler = (_req, _res, next) => next();

/**
 * Routes under `/api/v1/tasks`: list, detail and history for any signed-in user (scoped in the service), create,
 * update and delete for Admins. Mounted behind `jwtAuth` (Task 9).
 */
export function tasksRouter(service: TasksService): Router {
  const c = createTasksController(service);
  const admin = requireRole(RoleCode.ADMIN);
  const id = validate(idParamsSchema, 'params');
  const router = Router();
  router.get('/', validate(listTasksQuerySchema, 'query'), c.list);
  router.post('/', admin, validate(createTaskSchema, 'body'), c.create);
  router.get('/:id', id, c.get);
  router.patch('/:id', admin, id, validate(updateTaskSchema, 'body'), c.update);
  router.delete('/:id', admin, id, c.remove);
  router.get('/:id/history', id, c.history);
  return router;
}

/** `POST /api/v1/tasks/:id/transition`, with `limiter` in front so Task 9 can apply the 20/min limit. */
export function taskTransitionRouter(
  service: TasksService,
  limiter: RequestHandler = noLimit,
): Router {
  const c = createTasksController(service);
  const router = Router();
  router.post(
    '/:id/transition',
    limiter,
    validate(idParamsSchema, 'params'),
    validate(transitionTaskSchema, 'body'),
    c.transition,
  );
  return router;
}
