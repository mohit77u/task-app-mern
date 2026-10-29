import type { RequestHandler } from 'express';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser } from '../../common/types/request.types';
import type {
  CreateTaskBody,
  ListTasksQuery,
  TransitionTaskBody,
  UpdateTaskBody,
} from './tasks.schemas';
import type { TasksService } from './tasks.service';

export interface TasksController {
  list: RequestHandler;
  get: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  transition: RequestHandler;
  history: RequestHandler;
}

export function actorOf(user: AuthUser | undefined): AuthUser {
  if (!user) throw AppException.unauthenticated();
  return user;
}

export function idOf(locals: Record<string, unknown>): string {
  return (locals.params as { id: string }).id;
}

/** Thin: reads the validated input from `res.locals`, calls the service, shapes the HTTP response. */
export function createTasksController(service: TasksService): TasksController {
  return {
    list: async (req, res) => {
      res.json(
        await service.list(
          actorOf(req.user),
          res.locals.query as ListTasksQuery,
        ),
      );
    },
    get: async (req, res) => {
      res.json(await service.getResponse(actorOf(req.user), idOf(res.locals)));
    },
    create: async (req, res) => {
      res
        .status(201)
        .json(
          await service.create(
            actorOf(req.user),
            res.locals.body as CreateTaskBody,
          ),
        );
    },
    update: async (req, res) => {
      res.json(
        await service.update(
          actorOf(req.user),
          idOf(res.locals),
          res.locals.body as UpdateTaskBody,
        ),
      );
    },
    remove: async (req, res) => {
      await service.remove(actorOf(req.user), idOf(res.locals));
      res.status(204).end();
    },
    transition: async (req, res) => {
      res.json(
        await service.transition(
          actorOf(req.user),
          idOf(res.locals),
          res.locals.body as TransitionTaskBody,
        ),
      );
    },
    history: async (req, res) => {
      res.json(await service.listHistory(actorOf(req.user), idOf(res.locals)));
    },
  };
}
