import { Schema, model, type Types } from 'mongoose';
import { TaskStatus } from '../common/enums/task-status';

export interface ITaskStatusHistory {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  /** Null for the row written when the task is created. */
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  actorId: Types.ObjectId;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskStatusHistorySchema = new Schema<ITaskStatusHistory>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    fromStatus: {
      type: String,
      enum: Object.values(TaskStatus),
      default: null,
    },
    toStatus: { type: String, enum: Object.values(TaskStatus), required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: null, maxlength: 1000 },
  },
  { collection: 'taskstatushistories', timestamps: true },
);

taskStatusHistorySchema.index({ taskId: 1, createdAt: 1 });

export const TaskStatusHistoryModel = model<ITaskStatusHistory>(
  'TaskStatusHistory',
  taskStatusHistorySchema,
);
