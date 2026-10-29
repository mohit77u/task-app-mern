# Task Manager (MERN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-build the existing Task & Approval app (Next.js + NestJS + MySQL) as a separate MERN app: Express + Mongoose on MongoDB Atlas, React (Vite) frontend ported from the existing UI, deployable to Vercel + Render.

**Architecture:** `backend/` is Express 5 + TypeScript, layered route → controller → service → Mongoose model, with the wire contract (paths, JSON, status codes, error codes) identical to the old API. `frontend/` is a Vite React port of the old Next.js UI; the browser only ever talks to its own origin, which proxies `/api/*` to the backend (Vite proxy locally, Vercel `rewrites` in production) so auth cookies stay first-party.

**Tech Stack:** Node 20+, Express 5, Mongoose, zod, jsonwebtoken, bcrypt, helmet, cookie-parser, express-rate-limit, Jest + supertest + mongodb-memory-server (replica set); React 19, Vite, react-router, Tailwind v4, shadcn/ui, Redux Toolkit + RTK Query, React Hook Form + zod, sonner, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-task-manager-mern-design.md`. It defers to the old spec `/home/ghost/Desktop/Mohit/Learning/task-approval-app/docs/superpowers/specs/2026-10-10-task-approval-design.md` and, where they differ, to the old code in `/home/ghost/Desktop/Mohit/Learning/task-approval-app/` (call it **OLD**). Executors read all of these. Read-only: never modify OLD.

## Global Constraints

- New project root: `/home/ghost/Desktop/Mohit/Learning/task-manager-mern/` (`backend/`, `frontend/`, `docs/`, root `README.md`). Own git repo (`git init` in Task 1). TypeScript `strict`, no `any`, explicit return types on exported functions.
- Author/copyright name is "Mohit Singh". Commit messages are conventional-commit style with **no** `Co-Authored-By` or any AI attribution line (the owner's standing rule overrides any tool default). Stage files individually.
- Wire contract unchanged from OLD: business routes under `/api/v1`, `GET|HEAD /api/health` version-neutral, error body `{ statusCode, code, message, details:[{field,message}], requestId, timestamp, path }`, codes `UNAUTHENTICATED TOKEN_EXPIRED FORBIDDEN NOT_FOUND VALIDATION_ERROR INVALID_TRANSITION STATE_CONFLICT CONFLICT RATE_LIMITED INTERNAL_ERROR SERVICE_UNAVAILABLE`. Only change: ids are 24-char ObjectId **strings** (OLD used numbers).
- Enums: `RoleCode` ADMIN|EMPLOYEE; `TaskStatus` PENDING|IN_PROGRESS|PENDING_APPROVAL|COMPLETED; `TaskPriority` LOW|MEDIUM|HIGH. Roles are documents, not an enum.
- Auth values: access JWT `ACCESS_TOKEN_TTL` default `30m` (must match `^[1-9]\d*(s|m|h|d)$`); refresh token opaque 256-bit, `REFRESH_TOKEN_TTL_DAYS` default 365, only its SHA-256 hash stored; grace window 10 s (`REFRESH_GRACE_MS = 10_000`); revoked rows kept 7 days; cookies HttpOnly, SameSite per `COOKIE_SAMESITE` (default lax), host-only, access `Path=/api`, refresh `Path=/api/v1/auth`, both `Max-Age` 1 year; access cookie names/`ACCESS_COOKIE`/`REFRESH_COOKIE` constants as in OLD `security/utils/cookie.options.ts`.
- Throttling (disabled when `THROTTLING_ENABLED=false`): global 100/min; login 5/min keyed by normalised email; refresh 30/min keyed by hash of refresh cookie; transitions and comments 20/min keyed by user id; fallback IP; throttled responses carry `Retry-After` and code `RATE_LIMITED` (429).
- CORS: exact-match `FRONTEND_ORIGINS` allow-list, credentials true, `maxAge` 600; Origin check rejects `POST|PATCH|PUT|DELETE` with a disallowed `Origin` as 403 `FORBIDDEN`; requests without `Origin` pass.
- Env names: OLD's, with `DB_*` replaced by `MONGODB_URI` (required, secret) and `MONGODB_DB` (optional). Production boot checks from OLD `config/env.validation.ts` are kept verbatim (COOKIE_SECURE true, https-only origins, weak-secret check, `TRUST_PROXY_HOPS` ≥ 1), minus the DB_SSL rule. `MONGODB_URI` is never printed, logged, committed or asked for in chat.
- Task `dueDate` is a calendar date string `YYYY-MM-DD` stored as a string (no timezone shifts). Soft delete via `deletedAt`; every query goes through one helper that excludes deleted documents.
- Swagger is dropped (Express has no free OpenAPI; hand-writing one is out of proportion). This is a deliberate delta from OLD and is listed in the README.

## Review Focus

Failure modes the spec implies but the main tasks do not otherwise exercise, most likely first; each has a pinning test in the task named in brackets.

1. A malformed id in a path (`/tasks/not-an-id`, `/users/123`) must answer 404 `NOT_FOUND`, not a 500 from a Mongoose `CastError`. [Task 3 errors, Task 7]
2. Regex metacharacters in task search (`(`, `.*`, `[`) must be treated literally and never 500 or hang. [Task 7]
3. An email differing only by case or surrounding whitespace is a duplicate (`CONFLICT`), and login matches case-insensitively. [Task 6]
4. `page=0`, `limit=1000`, `limit=abc`, or an unknown query key must give 422 `VALIDATION_ERROR`, not a crash or an unbounded query. [Task 7]
5. A user soft-deleted while holding a valid access/refresh token must be refused (401) on the next request and cannot refresh. [Task 5]

---

## Part A — Backend

### Task 1: Backend scaffold, config and project repo

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/jest.config.ts`, `backend/eslint.config.mjs`, `backend/.prettierrc`, `backend/.env.example`, `backend/src/config/env.validation.ts`, `backend/src/config/env.validation.spec.ts`, root `.gitignore`
- Port from OLD: `backend/src/config/env.validation.ts` (+ spec), `.prettierrc`, eslint config

**Interfaces:**
- Produces: `envSchema`, `validateEnv(raw: Record<string, unknown>): Env`, `type Env`, `isWeakSecret(secret: string): boolean`, `JWT_SECRET_PLACEHOLDER`. Same shape as OLD except `MONGODB_URI: string` (must start `mongodb://` or `mongodb+srv://`) and `MONGODB_DB?: string` replace all `DB_*`.

- [ ] **Step 1:** `git init` at the project root, set repo-local `user.name` to `Mohit Singh`, add `.gitignore` (`node_modules`, `dist`, `.env*` except `.env.example`, `coverage`, Playwright output).
- [ ] **Step 2:** Create the backend package (`"type": "commonjs"`), install runtime and dev deps from Tech Stack, scripts: `dev` (ts-node-dev or tsx watch), `build` (tsc), `start` (`node dist/main`), `test`, `lint`, `seed`, `seed:prod`.
- [ ] **Step 3: Write failing test** `env.validation.spec.ts`, ported from OLD's spec with DB cases replaced: rejects missing `MONGODB_URI`; rejects `MONGODB_URI=mysql://x`; accepts `mongodb+srv://u:p@c.mongodb.net/`; in production rejects `COOKIE_SECURE=false`, `http://` origin, placeholder secret, `TRUST_PROXY_HOPS=0`; `ACCESS_TOKEN_TTL='60'` rejected, `'30m'` default.
- [ ] **Step 4:** Run `npx jest env.validation` → FAIL. Port `env.validation.ts` from OLD with the DB changes. Run → PASS.
- [ ] **Step 5:** Write `backend/.env.example` (names only, empty or placeholder values, includes `MONGODB_URI`, `MONGODB_DB`). Commit `chore(backend): scaffold express app and env validation`.

### Task 2: Test harness (replica-set Mongo)

**Files:**
- Create: `backend/test/mongo.ts`, `backend/test/setup.ts`, `backend/test/mongo.spec.ts`

**Interfaces:**
- Produces: `startTestDb(): Promise<void>` (starts `MongoMemoryReplSet` with 1 node, connects Mongoose), `stopTestDb(): Promise<void>`, `clearTestDb(): Promise<void>` (deletes all documents, keeps indexes), `testEnv(overrides?: Partial<Record<string,string>>): Env` (a valid validated Env for tests, `THROTTLING_ENABLED` false by default).

- [ ] **Step 1: Write failing test** `mongo.spec.ts`: after `startTestDb()` a transaction (`mongoose.startSession().withTransaction`) that inserts and commits succeeds; `clearTestDb()` leaves zero documents.
- [ ] **Step 2:** Run → FAIL. Implement the helpers. Run → PASS. Commit `test(backend): add in-memory replica set harness`.

### Task 3: Errors, request plumbing and validation

**Files:**
- Create under `backend/src/common/`: `errors/error-codes.ts`, `errors/app.exception.ts`, `errors/error-handler.ts`, `errors/mongo-errors.ts`, `middleware/request-id.ts`, `middleware/origin.ts`, `validation/validate.ts`, `validation/primitives.ts`, `types/request.types.ts`, `utils/escape-regex.ts`, `utils/object-id.ts`
- Tests alongside each as `*.spec.ts`
- Port ideas from OLD: `common/errors/*`, `common/middleware/origin.middleware.ts`, `common/pipes/validation.pipe.ts`, `common/utils/escape-like.ts`

**Interfaces:**
- Produces:
  - `class AppException extends Error` with statics `unauthenticated(msg?)`, `tokenExpired()`, `forbidden(msg?)`, `notFound(msg?)`, `validation(details: ApiErrorDetail[], msg?)`, `invalidTransition(msg?)`, `stateConflict(msg?)`, `conflict(msg?)`, `rateLimited(retryAfterSeconds: number)`, `serviceUnavailable(msg?)`; fields `statusCode`, `code`, `details`.
  - `errorHandler: ErrorRequestHandler` (final Express middleware) and `notFoundHandler: RequestHandler` — both emit the contract body including `requestId`. Maps: body-parser errors (malformed JSON → 400, too large → 413, wrong content type → 415) as `VALIDATION_ERROR`; Mongo duplicate key (11000) → `CONFLICT`; Mongoose `CastError` on `_id` → `NOT_FOUND`; Mongoose `ValidationError` → 422; anything else → 500 `INTERNAL_ERROR` with no internals leaked, logged with the request id.
  - `requestId: RequestHandler` sets `req.id` (uuid) and `X-Request-Id`.
  - `originCheck(allowedOrigins: string[]): RequestHandler`.
  - `validate<T>(schema: z.ZodType<T>, source: 'body'|'query'|'params'): RequestHandler` — strict (unknown keys → 422 with `field` set), puts the parsed value on `res.locals.<source>`.
  - `parseObjectId(value: string): Types.ObjectId | null`; `escapeRegex(s: string): string`.
  - `interface AuthUser { id: string; role: RoleCode }`, and `Express.Request` augmented with `user?: AuthUser`, `id: string`.

- [ ] **Step 1: Write failing tests:** `AppException` statusCode/code table for each factory; `errorHandler` returns full body shape for: `AppException.forbidden()`, a thrown `Error('boom')` (500, message not leaked), a duplicate-key error `{code:11000}`, a `CastError` (404), malformed JSON through a mounted `express.json()` (400 `VALIDATION_ERROR`); `notFoundHandler` returns 404 with `requestId`; `originCheck` allows missing Origin, allows listed, rejects unlisted on POST (403) but allows unlisted on GET; `validate` rejects an unknown key with `details[0].field` equal to that key; `escapeRegex('a.*(b)')` returns a string that `new RegExp` matches only literally; `parseObjectId('abc')` is `null`. Review Focus 1 is pinned by the `CastError` and `parseObjectId` cases.
- [ ] **Step 2:** Run `npx jest common` → FAIL. Implement each file; port message wording from OLD where it exists. Run → PASS.
- [ ] **Step 3:** Commit `feat(backend): error contract, validation and request middleware`.

### Task 4: Models, enums and serializers

**Files:**
- Create: `backend/src/common/enums/{role-code,task-status,task-priority}.ts`, `backend/src/models/{role,user,task,task-comment,task-status-history,refresh-token}.model.ts`, `backend/src/common/db/soft-delete.ts`, `backend/src/common/db/with-transaction.ts`, `backend/src/models/models.spec.ts`

**Interfaces:**
- Produces:
  - Enums as TS `enum`s plus `isRoleCode(v: string): v is RoleCode`.
  - Models (interfaces `IRole, IUser, ITask, ITaskComment, ITaskStatusHistory, IRefreshToken`, Mongoose models `RoleModel, UserModel, TaskModel, TaskCommentModel, TaskStatusHistoryModel, RefreshTokenModel`). Fields exactly as OLD tables (OLD `entities/*.ts`, camelCase), with `roleId`/`assigneeId`/`createdById`/`taskId`/`authorId`/`actorId`/`userId` as `ObjectId` refs, `dueDate: string` matching `/^\d{4}-\d{2}-\d{2}$/`, `email` stored trimmed and lower-cased, `users.passwordChangedAt: Date | null`, `users.isDefault: boolean`, `refreshtokens.{familyId, tokenHash, expiresAt, revokedAt, replacedById, userAgent, ip}`, timestamps on users/tasks/comments/history/tokens. Indexes: unique `users.email`, unique `roles.code`, unique `refreshtokens.tokenHash`, `tasks(assigneeId,status)`, `tasks(status,priority)`, `tasks(dueDate)`, comments and history `(taskId,createdAt)`, `refreshtokens(familyId)`, TTL on `refreshtokens.expiresAt` with `expireAfterSeconds: 30 * 86400` (extra slack so the TTL monitor never removes a row inside the 7-day revoked-retention rule).
  - `notDeleted<T extends object>(filter?: T): T & { deletedAt: null }`.
  - `withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T>` — wraps `session.withTransaction`, always ends the session, returns `fn`'s result.
  - Models call `syncIndexes()` through an exported `ensureIndexes(): Promise<void>` used by boot, seed and tests.

- [ ] **Step 1: Write failing tests** (`models.spec.ts`, using Task 2 harness): two users `A@x.com` and ` a@x.com ` → second insert fails with code 11000 (pins Review Focus 3 at model level); task with `dueDate: '2026-13-40'`-style bad format or `'2026-1-5'` fails validation; status not in enum fails; `withTransaction` rolls back an insert when `fn` throws.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit `feat(backend): mongoose models, indexes and transaction helper`.

### Task 5: Security and authentication

**Files:**
- Create: `backend/src/security/{password.ts,token.ts,cookies.ts,refresh-token-util.ts}`, `backend/src/modules/auth/{refresh-token.service.ts,auth.service.ts,auth.controller.ts,auth.routes.ts,auth.schemas.ts}`, `backend/src/common/middleware/jwt-auth.ts`, specs alongside
- Port from OLD: `security/*`, `modules/auth/*`, `common/middleware/jwt-auth.middleware.ts` (including `resolveSessionUser`), cookie option helpers, `refresh-token.util`

**Interfaces:**
- Consumes: Task 3 (`AppException`, `validate`), Task 4 models.
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.
  - `signAccessToken(user: AuthUser, env: Env): Promise<string>`, `verifyAccessToken(token: string, env: Env): AccessTokenClaims` (`{ id, role, issuedAt }`; expired → `tokenExpired()`, other failure → `unauthenticated()`).
  - `generateRefreshToken(): { token: string; hash: string }`, `hashRefreshToken(t: string): string`.
  - `ACCESS_COOKIE`, `REFRESH_COOKIE`, `setAuthCookies(res, env, {access, refresh}): void`, `clearAuthCookies(res, env): void`.
  - `class RefreshTokenService(env)`: `issueForLogin(userId: string, meta: ClientMeta): Promise<string>`; `rotate(presented: string, meta: ClientMeta): Promise<RotationResult>` with `RotationResult = {kind:'rotated',userId,token} | {kind:'grace',userId} | {kind:'reuse'} | {kind:'invalid'}`; `revokeFamilyOf(presented: string): Promise<void>`.
  - `class AuthService`: `login(email, password, meta): Promise<{ user: UserResponse; access: string; refresh: string }>`, `refresh(presented, meta): Promise<{ access: string; refresh?: string }>`, `logout(presented?: string): Promise<void>`, `me(userId): Promise<UserResponse>`. `UserResponse` is the Task 6 mapper's output (import the type from `modules/users/user.mapper.ts`; the mapper itself is built in Task 6, so create the type-only stub there first).
  - `jwtAuth(env): RequestHandler` — verifies the access cookie, loads the user (not deleted) by id, runs `resolveSessionUser(claims, row)`, sets `req.user`. Exported pure `resolveSessionUser(claims, user | null): AuthUser` ported unchanged.
  - Routes: `POST /api/v1/auth/login|refresh|logout`, `GET /api/v1/auth/me`, behaviour per OLD controller (identical error for unknown email and wrong password; logout works with an expired access token; refresh sets new cookies, and in `grace` only a new access cookie).

- [ ] **Step 1: Write failing unit tests** (ports of OLD specs, with Mongo): `resolveSessionUser` cases (null → 401; `issuedAt <=` `passwordChangedAt` seconds → 401; DB role wins over token role); `signAccessToken`/`verifyAccessToken` round-trip and `TokenExpiredError` → `TOKEN_EXPIRED`; `cookies` attribute table (Path, HttpOnly, Secure flag from env, Max-Age 1 year).
- [ ] **Step 2: Write failing refresh-token tests** (`refresh-token.service.spec.ts`, replica-set DB): login issues a token whose DB row stores only the hash; `rotate` returns `rotated` and marks the old row revoked with `replacedById`; second `rotate` with the same token inside 10 s returns `grace`; after 10 s (fake `Date.now`) returns `reuse` and every token in the family is revoked; expired or unknown token → `invalid`; two concurrent `rotate` calls with the same token yield exactly one `rotated` (the other `grace`) — atomicity comes from a single `findOneAndUpdate({tokenHash, revokedAt:null, expiresAt:{$gt:now}}, {revokedAt:now})` claim, then creating the successor and setting `replacedById`; `revokeFamilyOf` revokes the whole family; the grace branch is refused (treated as `reuse`) when the newest token of the chain is revoked (port OLD `isSessionAlive`); `issueForLogin` prunes rows expired or revoked more than 7 days ago for that user only.
- [ ] **Step 3: Write failing HTTP tests** (`auth.http.spec.ts`, supertest against `createApp` from Task 9 — create this file now but mark `describe.skip` until Task 9 lands; the executor un-skips it in Task 9): login ok sets both cookies with the Paths above; wrong password and unknown email return identical bodies; expired access cookie → 401 `TOKEN_EXPIRED` then `POST /auth/refresh` returns a new pair; replayed rotated refresh token (after grace) → 401 and the newest token also dies; logout revokes (refresh afterwards → 401); a user soft-deleted after login gets 401 on `/auth/me` and on `/auth/refresh` (pins Review Focus 5).
- [ ] **Step 4:** Run `npx jest security modules/auth` → FAIL. Implement. Run → PASS (HTTP spec stays skipped).
- [ ] **Step 5:** Commit `feat(backend): password, token, cookie and refresh-token auth`.

### Task 6: Users and roles

**Files:**
- Create: `backend/src/modules/users/{users.service.ts,users.controller.ts,users.routes.ts,roles.routes.ts,user.mapper.ts,users.schemas.ts,users.service.spec.ts}`
- Port from OLD: `modules/users/*` (rules in OLD spec §5.3 `/users` row and OLD `users.service.ts`)

**Interfaces:**
- Consumes: Task 3, 4, 5 (`hashPassword`, `AuthUser`).
- Produces:
  - `UserResponse = { id: string; name: string; email: string; phone: string | null; isDefault: boolean; role: { id: string; code: string; name: string } }` and `toUserResponse(user, role): UserResponse`.
  - `class UsersService`: `list(query: { roleCode?: RoleCode; page: number; limit: number }): Promise<Paginated<UserResponse>>`, `getById(id: string): Promise<UserResponse>`, `create(dto: { name; email; phone?; password; roleId }): Promise<UserResponse>`, `update(actor: AuthUser, id: string, dto: { name?; email?; phone?: string | null; password? }): Promise<UserResponse>` (password change sets `passwordChangedAt` and revokes the user's refresh-token families), `remove(actor: AuthUser, id: string): Promise<void>`, `findSessionUser(id: string)`, `listRoles(): Promise<RoleResponse[]>`.
  - Routes (Admin only, role checked in the route layer by a shared `requireRole(...roles: RoleCode[]): RequestHandler`, create it in `common/middleware/require-role.ts` in this task): `GET/POST /api/v1/users`, `GET/PATCH/DELETE /api/v1/users/:id`, `GET /api/v1/roles`.
  - `remove` refuses (409 `CONFLICT`) for yourself, for `isDefault` users, and for any user with a non-deleted task assigned in any status. Runs in `withTransaction`; both it and task creation (Task 7) must write to the assignee's user document inside their transactions (`$set: { updatedAt: new Date() }` guarded by `deletedAt: null`) so the two serialize on a write conflict.

- [ ] **Step 1: Write failing tests** (`users.service.spec.ts`, replica-set DB): create trims/lower-cases email and `Foo@X.com` after `foo@x.com` → `CONFLICT` (Review Focus 3); role cannot be changed through `update` (unknown key rejected by schema); updating password sets `passwordChangedAt` and revokes tokens; `remove` refused for self, for `isDefault`, and for a user with a live task, allowed otherwise and then excluded from `list`; `list` with `roleCode=EMPLOYEE` returns only employees; `page`/`limit` bounds enforced by schema (limit ≤ 100, ≥ 1).
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit `feat(backend): users and roles module`.

### Task 7: Tasks, state machine, comments, history, dashboard, health

**Files:**
- Create: `backend/src/modules/tasks/{task-state-machine.ts,task-state-machine.spec.ts,tasks.service.ts,tasks.controller.ts,tasks.routes.ts,tasks.schemas.ts,task.mapper.ts,tasks.service.spec.ts}`, `backend/src/modules/comments/{comments.service.ts,comments.controller.ts,comments.routes.ts,comments.schemas.ts,comments.service.spec.ts}`, `backend/src/modules/dashboard/{dashboard.service.ts,dashboard.routes.ts,dashboard.service.spec.ts}`, `backend/src/modules/health/health.routes.ts`
- Port from OLD: `modules/tasks/state-machine/task-state-machine.ts` verbatim (rules table, `evaluateTransition`, `allowedTargets`), tasks/comments/dashboard/health modules

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  - `TRANSITION_RULES`, `evaluateTransition(ctx): TransitionDecision`, `allowedTargets(viewer: Viewer, from: TaskStatus): TaskStatus[]` — same signatures as OLD, imports changed only.
  - `TaskResponse` = OLD `Task` JSON (`id, title, description, priority, status, dueDate, assignee{id,name,email}, createdBy{id,name,email}, allowedTransitions, createdAt, updatedAt`); `toTaskResponse(task, viewer: AuthUser): TaskResponse`.
  - `class TasksService`: `list(user: AuthUser, q: { status?; priority?; assigneeId?; search?; page; limit }): Promise<Paginated<TaskResponse>>` (Employee forced to own tasks, `assigneeId` ignored), `getResponse(user, id): Promise<TaskResponse>` (404 for non-visible or malformed id), `create(admin, dto)` (assignee must be a non-deleted EMPLOYEE; first history row `fromStatus: null`), `update(admin, id, dto)` (not when COMPLETED), `remove(admin, id)` (soft), `transition(user, id, dto: { to: TaskStatus; note?: string }): Promise<TaskResponse>`, `listHistory(user, id): Promise<HistoryEntryResponse[]>`.
  - `transition` runs in `withTransaction`: load with scoping, `evaluateTransition` (`INVALID_TRANSITION` 422, `FORBIDDEN` 403, `NOTE_REQUIRED` → `VALIDATION_ERROR` 422 field `note`), then `TaskModel.findOneAndUpdate({ _id, status: from, assigneeId, deletedAt: null }, { status: to }, { session })`; `null` → `STATE_CONFLICT` 409; then insert the history row in the same session.
  - `class CommentsService`: `list(user, taskId)`, `create(user, taskId, body: string)` (trimmed, 1–2000 chars; visible tasks only).
  - `DashboardService.get(user): Promise<{ counts: Record<TaskStatus, number>; total: number }>` — one `$group` aggregate with the same scoping, missing statuses filled with 0.
  - Routes exactly per OLD spec §5.3 table; create/update/delete Admin-only; transition and comments carry the 20/min limiter slot (the limiter itself is wired in Task 9, expose them as separate routers so Task 9 can place `limiter` in front); `GET|HEAD /api/health` runs `mongoose.connection.db.admin().ping()` and returns `{status:'ok',db:'up'}` or 503 `SERVICE_UNAVAILABLE`.

- [ ] **Step 1: Write failing state-machine test** (port OLD `task-state-machine.spec.ts` as table-driven): every (role, isAssignee, from, to) combination — allowed ones from the rules table are allowed, an Admin who is not the assignee cannot do employee steps, an Employee never approves or rejects, reject without a note → `NOTE_REQUIRED`, unlisted pairs → `INVALID_TRANSITION`; `allowedTargets` per viewer/state.
- [ ] **Step 2: Write failing service tests** (`tasks.service.spec.ts`, replica-set DB): Employee `list` never returns another employee's task and ignores `assigneeId`; Employee `getResponse` for another's task → `NOT_FOUND`; `getResponse('not-an-id')` → `NOT_FOUND` (Review Focus 1); `list` with `search: '(a.*'` returns 200-shaped results, matching titles containing that literal text only (Review Focus 2); `list` with `page: 0`, `limit: 1000`, `limit: 'abc'` rejected by the query schema with `VALIDATION_ERROR` (Review Focus 4); `create` by Employee → `FORBIDDEN` at the route layer; create assigns to an Admin → `VALIDATION_ERROR`; `create` writes a history row with `fromStatus: null`; `update` on COMPLETED rejected; `remove` is soft and the task disappears from `list`; `transition` approve writes history and sets COMPLETED; reject without note fails, with note returns IN_PROGRESS; two simultaneous `transition` calls on the same PENDING task → exactly one succeeds, the other `STATE_CONFLICT`; a transition after the task was reassigned between read and write → `STATE_CONFLICT`; a transaction that fails after the status write leaves the old status (history insert failure rolls it back).
- [ ] **Step 3: Write failing tests** for comments (visible-only, body trimmed, empty → `VALIDATION_ERROR`, other employee's task → `NOT_FOUND`) and dashboard (employee counts equal the length of their own `list`, zero-filled, `total` is the sum).
- [ ] **Step 4:** Run `npx jest modules` → FAIL. Implement all of it. Search uses `new RegExp(escapeRegex(q), 'i')` on `title` and `description`. Run → PASS.
- [ ] **Step 5:** Commit `feat(backend): tasks, state machine, comments, dashboard, health`.

### Task 8: Seed

**Files:**
- Create: `backend/src/database/seed/{demo-data.ts,seed.ts,run-seed.ts,demo-data.spec.ts}`
- Port from OLD: `database/seeds/{demo-data.ts,seed.ts,run-seed.ts,demo-data.spec.ts}` — copy the account names, emails, demo passwords and sample tasks verbatim so README credentials stay identical.

**Interfaces:**
- Consumes: Task 4 (`ensureIndexes`), Task 5 (`hashPassword`), Task 3 env.
- Produces: `seed(env: Env): Promise<{ created: { roles: number; users: number; tasks: number } }>` — idempotent and non-destructive (insert if missing by `roles.code` and by email; existing rows never updated); creates ADMIN and EMPLOYEE roles, 2 Admins and 3 Employees (`isDefault: true`), and sample tasks spanning every status and priority with matching history rows. `run-seed.ts` connects with `MONGODB_URI`/`MONGODB_DB` and calls `seed`. Passwords overridable by `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD`.

- [ ] **Step 1: Write failing tests:** seed on an empty DB creates 2 Admins + 3 Employees + the sample tasks; running it twice creates nothing the second time (`created` all zero); a pre-existing user with a seeded email is not modified; `SEED_ADMIN_PASSWORD` is honoured for newly created admins only.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit `feat(backend): idempotent demo seed`.

### Task 9: App assembly and integration suite

**Files:**
- Create: `backend/src/app.ts`, `backend/src/main.ts`, `backend/src/common/middleware/rate-limits.ts`, `backend/test/{auth.http.spec.ts (un-skip), authorization.http.spec.ts, workflow.http.spec.ts, throttling.http.spec.ts, health.http.spec.ts}`

**Interfaces:**
- Consumes: everything above.
- Produces: `createApp(env: Env): Express` (no listening, no DB connect), `main.ts` (validate env, connect Mongoose with `MONGODB_URI` + optional `dbName`, `ensureIndexes()`, listen on `PORT`, graceful shutdown on SIGTERM). `rateLimits(env): { global, login, refresh, userAction }` as `RequestHandler`s keyed per the Global Constraints table, returning 429 through `AppException.rateLimited` with `Retry-After`.
- Middleware order in `createApp`: `trust proxy` from `TRUST_PROXY_HOPS` → `requestId` → `helmet` → `cors` (allow-list) → `cookieParser` → `express.json({limit:'100kb'})` → `originCheck` → global limiter → `GET|HEAD /api/health` → versioned router at `/api/v1`: auth routes (login limiter on login, refresh limiter on refresh) mounted before `jwtAuth`, then `jwtAuth`, then users, roles, tasks (transition and comment routes behind `userAction`), comments, dashboard → `notFoundHandler` → `errorHandler`.

- [ ] **Step 1:** Un-skip `auth.http.spec.ts` from Task 5. Write failing HTTP suites using `createApp(testEnv())` + supertest agents, replica-set DB, seeded data:
  - `authorization.http.spec.ts`: unauthenticated `/tasks` → 401; Employee on Admin-only endpoints (`POST /tasks`, `GET /users`, `GET /roles`) → 403; Employee GET/PATCH/comment on another employee's task → 404; Employee transition by non-assignee → 404.
  - `workflow.http.spec.ts`: full reviewer flow with two agents — Admin creates and assigns, Employee moves PENDING → IN_PROGRESS → PENDING_APPROVAL, Employee approving → 403, Admin reject without note → 422, with note → IN_PROGRESS, again to PENDING_APPROVAL, Admin approves → COMPLETED; history lists all steps with actors; dashboard counts agree with `/tasks` for both roles; two concurrent transitions → one 200 and one 409; `GET /tasks/xyz` → 404 body with `requestId`; malformed JSON → 400 contract body; Origin `https://evil.example` on a POST → 403.
  - `throttling.http.spec.ts`: with `THROTTLING_ENABLED=true`, the 6th login for one email within a minute → 429 with `Retry-After`; a different email is not affected.
  - `health.http.spec.ts`: `GET` and `HEAD /api/health` → 200 `{status:'ok',db:'up'}`; with Mongoose disconnected → 503 `SERVICE_UNAVAILABLE`.
- [ ] **Step 2:** Run `npx jest test` → FAIL. Implement `app.ts`, `main.ts`, `rate-limits.ts`. Run the full backend suite `npm test` and `npm run lint && npx tsc --noEmit` → all green.
- [ ] **Step 3:** Commit `feat(backend): assemble app with rate limits and integration tests`.

---

## Part B — Frontend

### Task 10: Vite foundation and ported non-visual layers

**Files:**
- Create: `frontend/` (Vite React-TS), `vite.config.ts` (proxy `/api` → `http://localhost:4000`, `@` alias → `src`), `vitest.config.ts`, `tsconfig*.json`, `components.json`, `index.html`, `src/main.tsx`
- Copy and adjust from OLD `frontend/src`: `types/`, `lib/`, `store/`, `services/`, `hooks/`, `components/ui/`, `components/common/`, `test/setup.ts`, `app/globals.css` → `src/index.css`

**Interfaces:**
- Produces: the same module paths and exports as OLD for `lib/*`, `store/*`, `services/api/*`, `hooks/*`, `types/api.ts`, and `components/ui/*`, with these changes only: every `id: number` in `types/api.ts` (`Role`, `User`, `PersonRef`, `Task`, `HistoryEntry`, `TaskComment`, and `actor.id`/`author.id`) becomes `string`; API function arguments carrying ids become `string`; `"use client"` directives removed; `next/*` imports replaced (`next-themes` stays, it works outside Next).

- [ ] **Step 1:** Scaffold Vite, install the deps listed in OLD `frontend/package.json` (same versions where they exist, excluding `next` and `eslint-config-next`; add `react-router`, `@vitejs/plugin-react`, `@tailwindcss/vite`).
- [ ] **Step 2:** Copy the files listed above and their `*.test.ts(x)` siblings. `grep -rn "next/\|use client\|Number(\|parseInt(" src` and fix every hit that touches ids or Next APIs.
- [ ] **Step 3:** `npx tsc --noEmit` and `npx vitest run` → all ported tests PASS (they are the failing-first check: they fail until ids and imports are fixed). Add one test in `lib/ids.test.ts` only if a helper is introduced.
- [ ] **Step 4:** Commit `feat(frontend): vite foundation with ported store, api layer and ui kit`.

### Task 11: Routing, auth shell, login and dashboard

**Files:**
- Create: `frontend/src/routes.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/{LoginPage,DashboardPage,NotFoundPage}.tsx`, `frontend/src/layouts/AppLayout.tsx`
- Copy and adjust: `components/auth/AuthGate.tsx`, `components/layout/*`, `components/dashboard/*`, `lib/demoAccounts.ts` (credentials must match the Task 8 seed)

**Interfaces:**
- Consumes: Task 10.
- Produces: router with `/login`, and under `AppLayout` (wraps `AuthGate` + `AppShell`): `/dashboard`, `/tasks`, `/tasks/:id`, `/users` (Admin only; Employees redirected to `/dashboard`), `/` redirecting to `/dashboard`, `*` → `NotFoundPage`. Navigation uses `react-router` `Link`, `NavLink`, `useNavigate`, `useSearchParams`, `useParams`.

- [ ] **Step 1: Write failing tests:** `AuthGate` shows a skeleton while `/auth/me` is pending, redirects to `/login` on 401, renders children when authenticated; `Sidebar` hides "Users" for Employee; `/users` as Employee redirects to `/dashboard` (use `MemoryRouter` + a mocked store).
- [ ] **Step 2:** Run → FAIL. Port components, replacing Next navigation with router equivalents; keep ServerStatusBanner behaviour. Run → PASS.
- [ ] **Step 3:** Start the backend (`npm run dev` with a dev `MONGODB_DB`) and `npm run seed`, run the frontend, and sign in as a seeded Admin and Employee; confirm the dashboard renders counts. Commit `feat(frontend): routing, auth gate, login and dashboard`.

### Task 12: Tasks and users pages

**Files:**
- Create: `frontend/src/pages/{TasksPage,TaskDetailPage,UsersPage}.tsx`
- Copy and adjust: `components/tasks/*`, `components/users/*`, `hooks/useTaskFilters.ts` (filters live in URL via `useSearchParams`)

**Interfaces:**
- Consumes: Tasks 10, 11.
- Produces: pages matching OLD behaviour (OLD spec §6.4–6.6): debounced search, URL-synced filters, status dropdown driven by `allowedTransitions` with confirmation dialog and required reject reason, comments and history tabs, Admin users list + create form with disabled-reason delete.

- [ ] **Step 1: Write failing tests:** port OLD `TasksTable.test.tsx`, `TaskStatusControl.test.tsx`, `UsersTable.test.tsx`, `useTaskFilters.test.ts` (adapt router wrapper); add: a task detail route with an unknown id renders the not-found error state, not a crash.
- [ ] **Step 2:** Run → FAIL. Port components and pages. Run → PASS; `npx tsc --noEmit` and lint clean.
- [ ] **Step 3:** Manual pass against the local stack in two browser profiles (Admin and Employee): create → assign → progress → approve/reject → refresh persists → role restrictions. Commit `feat(frontend): tasks and users pages`.

### Task 13: End-to-end test

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/*.spec.ts` (port OLD `frontend/e2e`); the run command is documented in the README (Task 14).

- [ ] **Step 1:** Port OLD Playwright specs; `E2E_BASE_URL` defaults to `http://localhost:5173`. Cover the reviewer flow of OLD spec §2.4 with two browser contexts.
- [ ] **Step 2:** Run against local stack (backend + seeded dev DB + `vite`) → PASS. Commit `test(frontend): playwright reviewer-flow e2e`.

---

## Part C — Delivery

### Task 14: Deploy config, docs and submission files

**Files:**
- Create: `frontend/vercel.json` generator `frontend/scripts/write-vercel-config.mjs`, `frontend/.env.example`, `backend/render` notes inside README (no `render.yaml` unless the owner wants IaC), root `README.md`, `SUBMISSION.md`, `docs/AI-USAGE.md`, `docs/DEPLOY-RUNBOOK.md`
- Port prose from OLD `README.md` and `docs/INTERVIEW-GUIDE.md` where still true

**Interfaces:**
- Produces:
  - `write-vercel-config.mjs`: run as `prebuild`; reads `BACKEND_URL` (required, no trailing slash, no `/api`; fails the build if unset), writes `vercel.json` with `rewrites: [{ source: '/api/:path*', destination: '${BACKEND_URL}/api/:path*' }, { source: '/((?!api/).*)', destination: '/index.html' }]`.
  - `DEPLOY-RUNBOOK.md` steps the owner follows: Atlas (user, Network Access allowing Render, separate `MONGODB_DB` for dev and live), Render web service (root `backend`, build `npm ci && npm run build`, start `node dist/main`, health check `/api/health`, env var list from Global Constraints with production values), run `npm run seed:prod` once, Vercel project (root `frontend`, `BACKEND_URL` set **before** build), UptimeRobot on `/api/health` every 5 min, then the live checks: health via both origins, full reviewer flow, cookies HttpOnly/Secure/SameSite=Lax host-only, cross-origin POST → 403, Render cold-start behaviour through the Vercel rewrite.
  - `README.md`: overview, live URLs placeholder, demo accounts (identical to OLD), setup/seed/test commands, env var **names**, architecture, the Swagger delta, known limitations.
  - `SUBMISSION.md`: section per spec §5, with the draft three decisions, three not-built features, and one limitation clearly marked "owner to confirm", plus a talking-points outline for the video. `docs/AI-USAGE.md` updated from OLD's.

- [ ] **Step 1:** Write the generator script with a Vitest test (`write-vercel-config.test.ts`): missing `BACKEND_URL` throws; a trailing slash or `/api` suffix is rejected; valid input yields the exact `rewrites` above.
- [ ] **Step 2:** Run → FAIL, implement, run → PASS. Add `"prebuild": "node scripts/write-vercel-config.mjs"` to `frontend/package.json`.
- [ ] **Step 3:** Write the docs. Verify every command in the README by running it on a clean checkout of the repo (`git clone` to a temp dir, follow the README up to a green `npm test` in both packages).
- [ ] **Step 4:** Run the whole backend and frontend suites, lint and typecheck in both packages. Commit `docs: readme, deploy runbook and submission notes`.

---

## Self-Review

- **Spec coverage:** stack/§4.1 → Tasks 1, 10; data model/§4.2 → 4; atomicity/§4.3 → 5 (refresh claim), 6–7 (transactions); frontend port/§4.4 → 10–12; config/§4.5 → 1, 14; tests/§4.6 → 2, 9, 13; deployment/§4.7 and §8 → 14; submission/§5 → 14; constraints/§6 → Global Constraints; old-code-wins/§8 → `jwtAuth`/`resolveSessionUser` (5), assignee compare-and-set (7), delete-under-transaction (6), boot checks (1). Swagger is the one OLD feature knowingly dropped; it is stated in Global Constraints and the README.
- **Type consistency:** `AuthUser {id: string; role}` is used by Tasks 3, 5, 6, 7; `UserResponse` is defined in Task 6 with a stub created in Task 5; `withTransaction` (Task 4) is consumed in Tasks 6 and 7; `ensureIndexes` (Task 4) in Tasks 8, 9; `createApp` (Task 9) is what the skipped Task 5 HTTP spec waits on.
- **Review Focus:** items 1–5 each have a pinning test in the tasks named.
- **Proportion:** bodies are left to the implementer; OLD is cited as the port source for each module.
