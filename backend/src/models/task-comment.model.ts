import { Schema, model, type Types } from 'mongoose';

export interface ITaskComment {
  _id: Types.ObjectId;
  taskId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const taskCommentSchema = new Schema<ITaskComment>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
  },
  { collection: 'taskcomments', timestamps: true },
);

taskCommentSchema.index({ taskId: 1, createdAt: 1 });

export const TaskCommentModel = model<ITaskComment>(
  'TaskComment',
  taskCommentSchema,
);
