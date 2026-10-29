import type { RequestHandler } from 'express';
import { actorOf, idOf } from '../tasks/tasks.controller';
import type { CreateCommentBody } from './comments.schemas';
import type { CommentsService } from './comments.service';

export interface CommentsController {
  list: RequestHandler;
  create: RequestHandler;
}

/** Thin: reads the validated input from `res.locals`, calls the service, shapes the HTTP response. */
export function createCommentsController(
  service: CommentsService,
): CommentsController {
  return {
    list: async (req, res) => {
      res.json(await service.list(actorOf(req.user), idOf(res.locals)));
    },
    create: async (req, res) => {
      const { body } = res.locals.body as CreateCommentBody;
      res
        .status(201)
        .json(await service.create(actorOf(req.user), idOf(res.locals), body));
    },
  };
}
