import { Types } from 'mongoose';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser } from '../../common/types/request.types';
import { TaskCommentModel, type ITaskComment } from '../../models';
import type { TasksService } from '../tasks/tasks.service';
import { createCommentSchema } from './comments.schemas';

export interface CommentResponse {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
}

type AuthorFields = { _id: Types.ObjectId; name: string };
type CommentWithAuthor = Omit<ITaskComment, 'authorId'> & {
  authorId: AuthorFields | null;
};

/** Upper bound for one task's thread; real tasks stay far below it, and it keeps a response from growing without limit. */
const MAX_COMMENTS_PER_RESPONSE = 500;

function toResponse(
  row: Omit<ITaskComment, 'authorId'>,
  author: AuthorFields,
): CommentResponse {
  return {
    id: row._id.toHexString(),
    body: row.body,
    author: { id: author._id.toHexString(), name: author.name },
    createdAt: row.createdAt.toISOString(),
  };
}

export class CommentsService {
  constructor(private readonly tasks: TasksService) {}

  async list(user: AuthUser, taskId: string): Promise<CommentResponse[]> {
    const task = await this.tasks.getForViewer(user, taskId); // 404 outside the viewer's scope
    const rows = await TaskCommentModel.find({ taskId: task._id })
      .sort({ createdAt: 1, _id: 1 })
      .limit(MAX_COMMENTS_PER_RESPONSE)
      .populate<{ authorId: AuthorFields | null }>('authorId', 'name')
      .lean<CommentWithAuthor[]>();
    return rows.flatMap((row) =>
      row.authorId ? [toResponse(row, row.authorId)] : [],
    );
  }

  /** The body is trimmed and must be 1-2000 characters (also enforced here, not only at the route). */
  async create(
    user: AuthUser,
    taskId: string,
    body: string,
  ): Promise<CommentResponse> {
    const parsed = createCommentSchema.shape.body.safeParse(body);
    if (!parsed.success) {
      throw AppException.validation([
        { field: 'body', message: parsed.error.issues[0].message },
      ]);
    }
    const task = await this.tasks.getForViewer(user, taskId);
    const comment = await TaskCommentModel.create({
      taskId: task._id,
      authorId: new Types.ObjectId(user.id),
      body: parsed.data,
    });
    return this.respond(comment._id);
  }

  private async respond(id: Types.ObjectId): Promise<CommentResponse> {
    const row = await TaskCommentModel.findById(id)
      .populate<{ authorId: AuthorFields | null }>('authorId', 'name')
      .lean<CommentWithAuthor>();
    if (!row?.authorId) throw AppException.notFound('Comment');
    return toResponse(row, row.authorId);
  }
}
