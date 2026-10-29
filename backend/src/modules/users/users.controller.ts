import type { RequestHandler } from 'express';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser } from '../../common/types/request.types';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
} from './users.schemas';
import type { UsersService } from './users.service';

export interface UsersController {
  list: RequestHandler;
  get: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  roles: RequestHandler;
}

function actorOf(user: AuthUser | undefined): AuthUser {
  if (!user) throw AppException.unauthenticated();
  return user;
}

function idOf(locals: Record<string, unknown>): string {
  return (locals.params as { id: string }).id;
}

/** Thin: reads the validated input from `res.locals`, calls the service, shapes the HTTP response. */
export function createUsersController(service: UsersService): UsersController {
  return {
    list: async (_req, res) => {
      res.json(await service.list(res.locals.query as ListUsersQuery));
    },
    get: async (_req, res) => {
      res.json(await service.getById(idOf(res.locals)));
    },
    create: async (_req, res) => {
      res
        .status(201)
        .json(await service.create(res.locals.body as CreateUserBody));
    },
    update: async (req, res) => {
      res.json(
        await service.update(
          actorOf(req.user),
          idOf(res.locals),
          res.locals.body as UpdateUserBody,
        ),
      );
    },
    remove: async (req, res) => {
      await service.remove(actorOf(req.user), idOf(res.locals));
      res.status(204).end();
    },
    roles: async (_req, res) => {
      res.json(await service.listRoles());
    },
  };
}
