import type { Types } from 'mongoose';
import { RoleCode } from '../../common/enums/role-code';
import { TaskStatus } from '../../common/enums/task-status';
import { withTransaction } from '../../common/db/with-transaction';
import type { Env } from '../../config/env.validation';
import {
  RoleModel,
  TaskModel,
  TaskStatusHistoryModel,
  UserModel,
} from '../../models';
import { hashPassword } from '../../security/password';
import {
  DEMO_USERS,
  SAMPLE_TASKS,
  SEED_ROLES,
  resolveDemoPasswords,
} from './demo-data';

export interface SeedResult {
  created: { roles: number; users: number; tasks: number };
}

const STATUS_ORDER = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
  TaskStatus.PENDING_APPROVAL,
  TaskStatus.COMPLETED,
];

/** The ordered statuses a task passes through to reach `target`, starting from PENDING. */
function pathTo(target: TaskStatus): TaskStatus[] {
  return STATUS_ORDER.slice(0, STATUS_ORDER.indexOf(target) + 1);
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Idempotent and non-destructive: roles (by code) and demo users (by lower-cased email) are inserted only when
 * missing and existing rows are never updated. Sample-task rule: a sample task is created only when no task (deleted
 * or not) with that exact title exists, so re-runs add nothing and a deleted demo task is not resurrected.
 *
 * Assumes Mongoose is already connected; the caller owns the connection.
 */
export async function seed(env: Env): Promise<SeedResult> {
  const passwords = resolveDemoPasswords(env);
  const created = { roles: 0, users: 0, tasks: 0 };

  const roleIds = new Map<string, Types.ObjectId>();
  for (const seedRole of SEED_ROLES) {
    let role = await RoleModel.findOne({ code: seedRole.code });
    if (!role) {
      role = await RoleModel.create(seedRole);
      created.roles += 1;
    }
    roleIds.set(seedRole.code, role._id);
  }

  const userIds = new Map<string, Types.ObjectId>();
  for (const demo of DEMO_USERS) {
    const existing = await UserModel.findOne({ email: demo.email });
    if (existing) {
      userIds.set(demo.email, existing._id);
      continue;
    }
    const user = await UserModel.create({
      name: demo.name,
      email: demo.email,
      phone: demo.phone,
      isDefault: true,
      roleId: roleIds.get(demo.role),
      passwordHash: await hashPassword(
        demo.role === RoleCode.ADMIN ? passwords.admin : passwords.employee,
      ),
    });
    userIds.set(demo.email, user._id);
    created.users += 1;
  }

  const adminId = userIds.get(DEMO_USERS[0].email)!;
  for (const sample of SAMPLE_TASKS) {
    if (await TaskModel.exists({ title: sample.title })) continue;
    const assigneeId = userIds.get(sample.assignee)!;
    await withTransaction(async (session) => {
      const [task] = await TaskModel.create(
        [
          {
            title: sample.title,
            description: sample.description,
            priority: sample.priority,
            status: sample.status,
            dueDate: dateOffset(sample.dueInDays),
            assigneeId,
            createdById: adminId,
          },
        ],
        { session },
      );
      // History mirrors what the real workflow would have written: the admin creates and approves, the employee
      // does the steps in between.
      const steps = pathTo(sample.status);
      await TaskStatusHistoryModel.create(
        steps.map((to, index) => ({
          taskId: task._id,
          fromStatus: index === 0 ? null : steps[index - 1],
          toStatus: to,
          actorId:
            index === 0 || to === TaskStatus.COMPLETED ? adminId : assigneeId,
          note: null,
        })),
        { session, ordered: true },
      );
    });
    created.tasks += 1;
  }

  return { created };
}
