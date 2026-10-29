import { Schema, model, type Types } from 'mongoose';
import { TaskPriority } from '../common/enums/task-priority';
import { TaskStatus } from '../common/enums/task-status';

export interface ITask {
  _id: Types.ObjectId;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** Calendar date `YYYY-MM-DD`, kept as a string so it never shifts across time zones. */
  dueDate: string;
  assigneeId: Types.ObjectId;
  createdById: Types.ObjectId;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const taskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, required: true },
    priority: {
      type: String,
      enum: Object.values(TaskPriority),
      default: TaskPriority.MEDIUM,
    },
    status: {
      type: String,
      enum: Object.values(TaskStatus),
      default: TaskStatus.PENDING,
    },
    dueDate: {
      type: String,
      required: true,
      validate: {
        validator: isCalendarDate,
        message: 'dueDate must be a valid YYYY-MM-DD date',
      },
    },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: null },
  },
  { collection: 'tasks', timestamps: true },
);

taskSchema.index({ assigneeId: 1, status: 1 });
taskSchema.index({ status: 1, priority: 1 });
taskSchema.index({ dueDate: 1 });

export const TaskModel = model<ITask>('Task', taskSchema);
