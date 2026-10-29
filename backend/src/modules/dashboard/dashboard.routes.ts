import { Router } from 'express';
import { actorOf } from '../tasks/tasks.controller';
import type { DashboardService } from './dashboard.service';

/** `GET /api/v1/dashboard`: task counts per status with the same scoping as the task list. Behind `jwtAuth` (Task 9). */
export function dashboardRouter(service: DashboardService): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    res.json(await service.get(actorOf(req.user)));
  });
  return router;
}
