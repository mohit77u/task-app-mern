import { Router } from 'express';
import { RoleCode } from '../../common/enums/role-code';
import { requireRole } from '../../common/middleware/require-role';
import { validate } from '../../common/validation/validate';
import { createUsersController } from './users.controller';
import {
  createUserSchema,
  idParamsSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from './users.schemas';
import type { UsersService } from './users.service';

/** Routes under `/api/v1/users`, Admin only. Mounted behind `jwtAuth` (Task 9). */
export function usersRouter(service: UsersService): Router {
  const c = createUsersController(service);
  const router = Router();
  router.use(requireRole(RoleCode.ADMIN));
  router.get('/', validate(listUsersQuerySchema, 'query'), c.list);
  router.post('/', validate(createUserSchema, 'body'), c.create);
  router.get('/:id', validate(idParamsSchema, 'params'), c.get);
  router.patch(
    '/:id',
    validate(idParamsSchema, 'params'),
    validate(updateUserSchema, 'body'),
    c.update,
  );
  router.delete('/:id', validate(idParamsSchema, 'params'), c.remove);
  return router;
}
