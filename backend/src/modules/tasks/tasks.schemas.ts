import { z } from 'zod';
import { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import {
  dateOnlyString,
  objectIdParam,
  objectIdString,
  trimmedString,
} from '../../common/validation/primitives';

export const idParamsSchema = z.object({ id: objectIdParam });

export const listTasksQuerySchema = z.object({
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  /** Honoured for Admins only; Employees are always limited to their own tasks. */
  assigneeId: objectIdString.optional(),
  search: z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(100, 'Must be at most 100 characters')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

const taskFields = {
  title: trimmedString.max(200, 'Must be at most 200 characters'),
  description: trimmedString.max(5000, 'Must be at most 5000 characters'),
  priority: z.enum(TaskPriority),
  dueDate: dateOnlyString,
  assigneeId: objectIdString,
};

export const createTaskSchema = z.object(taskFields);
export type CreateTaskBody = z.infer<typeof createTaskSchema>;

/** Every field optional. Status is intentionally absent: it only changes through the transition endpoint. */
export const updateTaskSchema = createTaskSchema.partial();
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>;

export const transitionTaskSchema = z.object({
  to: z.enum(TaskStatus),
  note: z
    .string()
    .trim()
    .max(1000, 'Must be at most 1000 characters')
    .optional(),
});
export type TransitionTaskBody = z.infer<typeof transitionTaskSchema>;
