import { TaskStatus } from '../../common/enums/task-status';
import type { AuthUser } from '../../common/types/request.types';
import { TaskModel } from '../../models';
import type { TasksService } from '../tasks/tasks.service';

export interface DashboardResponse {
  counts: Record<TaskStatus, number>;
  total: number;
}

export class DashboardService {
  constructor(private readonly tasks: TasksService) {}

  async get(user: AuthUser): Promise<DashboardResponse> {
    // Built on the same visibility filter as the task list, so the numbers can never disagree with what the user can open.
    const rows = await TaskModel.aggregate<{ _id: TaskStatus; count: number }>([
      { $match: this.tasks.visibleFilter(user) },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(
      Object.values(TaskStatus).map((status) => [status, 0]),
    ) as Record<TaskStatus, number>;
    for (const row of rows) {
      if (row._id in counts) counts[row._id] = row.count;
    }
    return {
      counts,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    };
  }
}
