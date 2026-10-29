import { Router } from 'express';
import { RoleCode } from '../../common/enums/role-code';
import { requireRole } from '../../common/middleware/require-role';
import { createUsersController } from './users.controller';
import type { UsersService } from './users.service';

/** `GET /api/v1/roles`, Admin only. Mounted behind `jwtAuth` (Task 9). */
export function rolesRouter(service: UsersService): Router {
  const router = Router();
  router.get(
    '/',
    requireRole(RoleCode.ADMIN),
    createUsersController(service).roles,
  );
  return router;
}
