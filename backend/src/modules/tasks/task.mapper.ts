import type { Types } from 'mongoose';
import type { TaskPriority } from '../../common/enums/task-priority';
import type { TaskStatus } from '../../common/enums/task-status';
import type { AuthUser } from '../../common/types/request.types';
import type { ITask } from '../../models';
import { allowedTargets } from './task-state-machine';

export interface PersonRef {
  id: string;
  name: string;
  email: string;
}

export interface TaskResponse {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  assignee: PersonRef;
  createdBy: PersonRef;
  /** What the current viewer may move this task to. The UI renders from this and never re-implements the rules. */
  allowedTransitions: TaskStatus[];
  createdAt: string;
  updatedAt: string;
}

/** The populated subset of a user that a task response shows. */
export interface PersonFields {
  _id: Types.ObjectId;
  name: string;
  email: string;
}

/** A task with `assigneeId` and `createdById` populated. */
export type TaskWithPeople = Omit<ITask, 'assigneeId' | 'createdById'> & {
  assigneeId: PersonFields;
  createdById: PersonFields;
};

const toPersonRef = ({ _id, name, email }: PersonFields): PersonRef => ({
  id: _id.toHexString(),
  name,
  email,
});

export function toTaskResponse(
  task: TaskWithPeople,
  viewer: AuthUser,
): TaskResponse {
  return {
    id: task._id.toHexString(),
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate,
    assignee: toPersonRef(task.assigneeId),
    createdBy: toPersonRef(task.createdById),
    allowedTransitions: allowedTargets(
      {
        role: viewer.role,
        isAssignee: task.assigneeId._id.toHexString() === viewer.id,
      },
      task.status,
    ),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
