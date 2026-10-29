import { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { notDeleted } from '../../common/db/soft-delete';
import { withTransaction } from '../../common/db/with-transaction';
import { RoleCode } from '../../common/enums/role-code';
import type { TaskPriority } from '../../common/enums/task-priority';
import { TaskStatus } from '../../common/enums/task-status';
import { AppException } from '../../common/errors/app.exception';
import { toPaginated, type Paginated } from '../../common/types/pagination';
import type { AuthUser } from '../../common/types/request.types';
import { escapeRegex } from '../../common/utils/escape-regex';
import { parseObjectId } from '../../common/utils/object-id';
import {
  TaskModel,
  TaskStatusHistoryModel,
  UserModel,
  type IRole,
  type ITask,
} from '../../models';
import {
  toTaskResponse,
  type PersonFields,
  type TaskResponse,
  type TaskWithPeople,
} from './task.mapper';
import {
  evaluateTransition,
  type TransitionDecision,
} from './task-state-machine';
import type { CreateTaskBody, UpdateTaskBody } from './tasks.schemas';

export interface HistoryEntryResponse {
  id: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  note: string | null;
  actor: { id: string; name: string };
  createdAt: string;
}

export interface ListTasksParams {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface TransitionInput {
  to: TaskStatus;
  note?: string;
}

const PEOPLE = [
  { path: 'assigneeId', select: 'name email' },
  { path: 'createdById', select: 'name email' },
];

type PopulatedPeople = {
  assigneeId: PersonFields | null;
  createdById: PersonFields | null;
};

type PopulatedTask = Omit<ITask, 'assigneeId' | 'createdById'> &
  PopulatedPeople;

/** Narrows a populated row; null if a referenced user document is missing (never expected: users are soft-deleted). */
function withPeople(row: PopulatedTask): TaskWithPeople | null {
  const { assigneeId, createdById } = row;
  if (!assigneeId || !createdById) return null;
  return { ...row, assigneeId, createdById };
}

export class TasksService {
  /**
   * The single definition of "which tasks may this viewer see": non-deleted, and for an Employee only the tasks
   * assigned to them. List, detail, transitions, comments, history and the dashboard all start from it so the rules
   * cannot drift. The scope is applied last, so a caller-supplied `assigneeId` can never widen it.
   */
  visibleFilter(
    user: AuthUser,
    extra: QueryFilter<ITask> = {},
  ): QueryFilter<ITask> {
    const scope =
      user.role === RoleCode.EMPLOYEE
        ? { assigneeId: new Types.ObjectId(user.id) }
        : {};
    return notDeleted({ ...extra, ...scope });
  }

  async list(
    user: AuthUser,
    q: ListTasksParams,
  ): Promise<Paginated<TaskResponse>> {
    const extra: QueryFilter<ITask> = {};
    if (q.status) extra.status = q.status;
    if (q.priority) extra.priority = q.priority;
    if (q.assigneeId && user.role === RoleCode.ADMIN) {
      const assigneeId = parseObjectId(q.assigneeId);
      if (!assigneeId) return toPaginated([], 0, q.page, q.limit);
      extra.assigneeId = assigneeId;
    }
    if (q.search) {
      // Escaped, so the user's text is matched literally and can never build a pathological pattern.
      const pattern = new RegExp(escapeRegex(q.search), 'i');
      extra.$or = [{ title: pattern }, { description: pattern }];
    }
    const filter = this.visibleFilter(user, extra);
    const [rows, total] = await Promise.all([
      TaskModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate<PopulatedPeople>(PEOPLE)
        .lean(),
      TaskModel.countDocuments(filter),
    ]);
    const items = rows.flatMap((row) => {
      const task = withPeople(row);
      return task ? [toTaskResponse(task, user)] : [];
    });
    return toPaginated(items, total, q.page, q.limit);
  }

  /** Loads a task the viewer may see, or throws 404 (never 403) so other people's task ids are not revealed. */
  async getForViewer(
    user: AuthUser,
    id: string,
    session?: ClientSession,
  ): Promise<ITask> {
    const task = await TaskModel.findOne(
      this.visibleFilter(user, { _id: this.parse(id) }),
      null,
      { session },
    ).lean();
    if (!task) throw AppException.notFound('Task');
    return task;
  }

  async getResponse(user: AuthUser, id: string): Promise<TaskResponse> {
    const row = await TaskModel.findOne(
      this.visibleFilter(user, { _id: this.parse(id) }),
    )
      .populate<PopulatedPeople>(PEOPLE)
      .lean();
    const task = row && withPeople(row);
    if (!task) throw AppException.notFound('Task');
    return toTaskResponse(task, user);
  }

  async create(admin: AuthUser, dto: CreateTaskBody): Promise<TaskResponse> {
    const assigneeId = this.parseAssignee(dto.assigneeId);
    const actorId = new Types.ObjectId(admin.id);
    const id = await withTransaction(async (session) => {
      await this.ensureAssignableEmployee(assigneeId, session);
      const task = await new TaskModel({
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        dueDate: dto.dueDate,
        status: TaskStatus.PENDING,
        assigneeId,
        createdById: actorId,
      }).save({ session });
      await TaskStatusHistoryModel.create(
        [
          {
            taskId: task._id,
            fromStatus: null,
            toStatus: TaskStatus.PENDING,
            actorId,
            note: null,
          },
        ],
        { session },
      );
      return task._id;
    });
    return this.getResponse(admin, id.toHexString());
  }

  async update(
    admin: AuthUser,
    id: string,
    dto: UpdateTaskBody,
  ): Promise<TaskResponse> {
    const _id = this.parse(id);
    const set: Partial<
      Pick<
        ITask,
        'title' | 'description' | 'priority' | 'dueDate' | 'assigneeId'
      >
    > = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.priority !== undefined) set.priority = dto.priority;
    if (dto.dueDate !== undefined) set.dueDate = dto.dueDate;
    if (dto.assigneeId !== undefined)
      set.assigneeId = this.parseAssignee(dto.assigneeId);

    await withTransaction(async (session) => {
      const task = await this.getForViewer(admin, id, session);
      if (Object.keys(set).length === 0) return;
      if (task.status === TaskStatus.COMPLETED) throw this.completedConflict();
      if (set.assigneeId && !set.assigneeId.equals(task.assigneeId)) {
        await this.ensureAssignableEmployee(set.assigneeId, session);
      }
      // The status guard lives in the write itself, so an edit cannot slip in after a concurrent approval.
      const result = await TaskModel.updateOne(
        notDeleted({ _id, status: { $ne: TaskStatus.COMPLETED } }),
        { $set: set },
        { session },
      );
      if (result.matchedCount !== 1) throw this.completedConflict();
    });
    return this.getResponse(admin, id);
  }

  async remove(_admin: AuthUser, id: string): Promise<void> {
    const result = await TaskModel.updateOne(
      notDeleted({ _id: this.parse(id) }),
      { $set: { deletedAt: new Date() } },
    );
    if (result.matchedCount === 0) throw AppException.notFound('Task');
  }

  /**
   * Applies a workflow step inside one transaction: scoped read, state-machine check, a compare-and-set on every fact
   * the decision used (status and assignee), then the history row. A concurrent writer makes the server abort this
   * transaction with a transient write conflict and `withTransaction` re-runs it; the re-run compares what it reads
   * with what the first attempt decided on, so the loser of a race (or a step overtaken by a reassignment) answers
   * STATE_CONFLICT rather than INVALID_TRANSITION or NOT_FOUND.
   */
  async transition(
    user: AuthUser,
    id: string,
    dto: TransitionInput,
  ): Promise<TaskResponse> {
    const _id = this.parse(id);
    let decidedOn: { status: TaskStatus; assigneeId: Types.ObjectId } | null =
      null;

    await withTransaction(async (session) => {
      const task = await TaskModel.findOne(
        this.visibleFilter(user, { _id }),
        null,
        { session },
      ).lean();
      if (decidedOn) {
        if (
          !task ||
          task.status !== decidedOn.status ||
          !task.assigneeId.equals(decidedOn.assigneeId)
        ) {
          throw this.raceConflict();
        }
      }
      if (!task) throw AppException.notFound('Task');
      decidedOn = { status: task.status, assigneeId: task.assigneeId };

      const decision = evaluateTransition({
        role: user.role,
        isAssignee: task.assigneeId.toHexString() === user.id,
        from: task.status,
        to: dto.to,
        note: dto.note,
      });
      if (!decision.allowed)
        throw this.toTransitionException(decision, task.status, dto.to);

      const updated = await TaskModel.findOneAndUpdate(
        {
          _id,
          status: task.status,
          assigneeId: task.assigneeId,
          deletedAt: null,
        },
        { $set: { status: dto.to } },
        { session, returnDocument: 'after' },
      ).lean();
      if (!updated) throw this.raceConflict();

      await TaskStatusHistoryModel.create(
        [
          {
            taskId: _id,
            fromStatus: task.status,
            toStatus: dto.to,
            actorId: new Types.ObjectId(user.id),
            note: dto.note?.trim() || null,
          },
        ],
        { session },
      );
    });

    return this.getResponse(user, id);
  }

  async listHistory(
    user: AuthUser,
    id: string,
  ): Promise<HistoryEntryResponse[]> {
    const task = await this.getForViewer(user, id);
    const rows = await TaskStatusHistoryModel.find({ taskId: task._id })
      .sort({ createdAt: 1, _id: 1 })
      .populate<{ actorId: PersonFields | null }>('actorId', 'name')
      .lean();
    return rows.flatMap((row) =>
      row.actorId
        ? [
            {
              id: row._id.toHexString(),
              fromStatus: row.fromStatus,
              toStatus: row.toStatus,
              note: row.note,
              actor: {
                id: row.actorId._id.toHexString(),
                name: row.actorId.name,
              },
              createdAt: row.createdAt.toISOString(),
            },
          ]
        : [],
    );
  }

  /**
   * Inside the caller's transaction, the first write touches the assignee's user document. User deletion does the
   * same, so the two conflict on that document and one retries after the other commits, seeing its effect: a task can
   * never end up assigned to a deleted user.
   */
  private async ensureAssignableEmployee(
    _id: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const touched = await UserModel.updateOne(
      notDeleted({ _id }),
      { $set: { updatedAt: new Date() } },
      { session },
    );
    if (touched.matchedCount === 0) {
      throw AppException.validation([
        { field: 'assigneeId', message: 'Assignee not found' },
      ]);
    }
    const user = await UserModel.findOne(notDeleted({ _id }), null, {
      session,
    })
      .populate<{ roleId: IRole | null }>('roleId')
      .lean();
    if (user?.roleId?.code !== RoleCode.EMPLOYEE) {
      throw AppException.validation([
        {
          field: 'assigneeId',
          message: 'Tasks can only be assigned to an Employee',
        },
      ]);
    }
  }

  private parse(id: string): Types.ObjectId {
    const _id = parseObjectId(id);
    if (!_id) throw AppException.notFound('Task');
    return _id;
  }

  private parseAssignee(id: string): Types.ObjectId {
    const _id = parseObjectId(id);
    if (!_id) {
      throw AppException.validation([
        { field: 'assigneeId', message: 'Invalid id' },
      ]);
    }
    return _id;
  }

  private completedConflict(): AppException {
    return AppException.stateConflict('Completed tasks cannot be edited');
  }

  private raceConflict(): AppException {
    return AppException.stateConflict(
      'This task was just updated by someone else. Please refresh and try again.',
    );
  }

  private toTransitionException(
    decision: Extract<TransitionDecision, { allowed: false }>,
    from: TaskStatus,
    to: TaskStatus,
  ): AppException {
    switch (decision.reason) {
      case 'INVALID_TRANSITION':
        return AppException.invalidTransition(
          `A task cannot move from ${from} to ${to}`,
        );
      case 'NOTE_REQUIRED':
        return AppException.validation([
          {
            field: 'note',
            message: 'A reason is required when rejecting a task',
          },
        ]);
      case 'FORBIDDEN':
        return AppException.forbidden(
          'You are not allowed to make this status change',
        );
    }
  }
}
