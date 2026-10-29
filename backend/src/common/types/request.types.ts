import type { RoleCode } from '../enums/role-code';

/** Identity carried by a verified access token. Display data (name, email) is loaded from the DB when needed. */
export interface AuthUser {
  id: string;
  role: RoleCode;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by the requestId middleware, which runs first. */
      id: string;
      user?: AuthUser;
    }
  }
}
