import { RefreshTokenModel } from './refresh-token.model';
import { RoleModel } from './role.model';
import { TaskCommentModel } from './task-comment.model';
import { TaskStatusHistoryModel } from './task-status-history.model';
import { TaskModel } from './task.model';
import { UserModel } from './user.model';

export * from './refresh-token.model';
export * from './role.model';
export * from './task-comment.model';
export * from './task-status-history.model';
export * from './task.model';
export * from './user.model';

export const models = [
  RoleModel,
  UserModel,
  TaskModel,
  TaskCommentModel,
  TaskStatusHistoryModel,
  RefreshTokenModel,
] as const;

/** Creates missing indexes and drops stale ones for every model. Used by boot, seed and tests. */
export async function ensureIndexes(): Promise<void> {
  for (const m of models) await m.syncIndexes();
}
