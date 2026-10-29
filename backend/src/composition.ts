import type { Env } from './config/env.validation';
import { AuthService } from './modules/auth/auth.service';
import { RefreshTokenService } from './modules/auth/refresh-token.service';
import { CommentsService } from './modules/comments/comments.service';
import { DashboardService } from './modules/dashboard/dashboard.service';
import { TasksService } from './modules/tasks/tasks.service';
import { UsersService } from './modules/users/users.service';

export interface Services {
  auth: AuthService;
  users: UsersService;
  tasks: TasksService;
  comments: CommentsService;
  dashboard: DashboardService;
}

/**
 * The one place services are constructed. Auth and users share a RefreshTokenService so deleting a user revokes the
 * same token store that login and refresh use; comments and dashboard reuse the tasks service's visibility rules.
 */
export function buildServices(env: Env): Services {
  const refreshTokens = new RefreshTokenService(env);
  const tasks = new TasksService();
  return {
    auth: new AuthService(env, refreshTokens),
    users: new UsersService(refreshTokens),
    tasks,
    comments: new CommentsService(tasks),
    dashboard: new DashboardService(tasks),
  };
}
