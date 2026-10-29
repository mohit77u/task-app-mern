# Task Manager (MERN) — Design

Date: 2026-10-29
Status: Draft for owner approval
Author: Mohit Singh

## 1. Intent and why

A fresh submission for a "Build a Task Manager" assessment. A working application is required, plus the
source code, a short on-camera video explaining the three most important decisions, a list of three things
deliberately not built (with reasons), and one limitation to fix given one more day.

The owner already built and deployed a Task & Approval app (Next.js + NestJS + TypeORM + MySQL). This
project is the **same product re-built on the MERN stack**: MongoDB Atlas + Mongoose, Express, React,
Node. It is a separate project; the old one must not be modified. The new one needs its own fresh deployment.

The owner's words: same app, all the same features, Mongoose and an Atlas connection string, reuse the UI.

## 2. Source of truth for behaviour

`/home/ghost/Desktop/Mohit/Learning/task-approval-app/docs/superpowers/specs/2026-10-10-task-approval-design.md`
(the "old spec") and the running code in `/home/ghost/Desktop/Mohit/Learning/task-approval-app/`
describe the behaviour to preserve. **Everything in the old spec holds unless section 4 below changes it.**
That covers: roles and the seed (2 Admins, 3 Employees), task CRUD, the state machine and its permissions,
comments, status history, dashboard counts, filters, the error contract and codes, endpoints and paths
(`/api/v1/...`, `/api/health`), access + rotating refresh token auth with reuse detection, cookie
attributes, CORS and Origin check, throttling, boot-time production checks, the API-driven
`allowedTransitions`, the toast and status-dropdown UX, and the page list. The port is a rewrite of the
data layer and the framework glue, not a redesign. The wire contract (request/response JSON, status codes,
error codes) stays identical so the UI port is mechanical.

## 3. Goals, non-goals, anti-goals

**Goals**
- Feature parity with the old app on the reviewer flow: Admin creates and assigns a task, Employee (separate
  session) moves it Pending → In Progress → Pending Approval, Admin approves or rejects, data persists,
  role restrictions hold.
- Backend enforces every permission. Mongoose is the only data access path.
- Deployed live with its own URLs and its own Atlas database.
- Code reads as consistently senior-level, like the old one.

**Non-goals**
- Not a redesign of the product, the UI look, or the API contract.
- No data migration from MySQL. The new database starts empty and is seeded.
- No features beyond the old app.

**Anti-goals (failure even if it technically works)**
- Touching or breaking the old `task-approval-app` repo or its deployment.
- A Mongo schema that is a naive copy of the SQL tables and loses the benefits or breaks invariants
  (for example, unique email must be a real unique index; task state changes must stay atomic).
- Any secret (Atlas URI, JWT secret) committed, printed, or logged.

## 4. Changes from the old spec

### 4.1 Stack

| Layer | Old | New |
|---|---|---|
| Database | MySQL 8, TypeORM | MongoDB Atlas, **Mongoose** |
| Backend | NestJS | **Express + TypeScript (strict)** |
| Frontend | Next.js App Router | **React + Vite + TypeScript**, `react-router` |
| Unchanged | Tailwind, shadcn/ui, Redux Toolkit + RTK Query, React Hook Form + zod, sonner, lucide, JWT + refresh cookies, helmet, bcrypt, rate limiting, Jest + supertest | same |

Backend validation uses `zod` (whitelist: unknown fields rejected), replacing class-validator. Layered as
route → controller (thin) → service (business rules) → model. Controllers never touch models.

### 4.2 Data model (Mongoose)

Collections: `roles`, `users`, `tasks`, `taskcomments`, `taskstatushistories`, `refreshtokens` (names are the
builder's call). Same fields as the old spec section 4, with these Mongo-specific decisions:

- `_id` is `ObjectId`; API returns it as the string `id` (old API returned numeric ids; the UI only treats ids
  as opaque, so this is a transparent change but must be checked on port).
- Enums (`status`, `priority`) are string fields with Mongoose `enum` validators.
- Soft delete via `deletedAt`; queries exclude deleted by default through one shared helper, not scattered filters.
- `users.email`: unique index on the normalised (lower-cased) email. Duplicate → `CONFLICT` (map Mongo error 11000).
- `refreshtokens`: unique index on `tokenHash`; a TTL index on `expiresAt` replaces the old "delete on next
  login" cleanup for expired rows. Rows revoked within the last 7 days must still be kept for reuse detection.
- Indexes equivalent to the old ones: `(assigneeId, status)`, `(status, priority)`, `dueDate`,
  comments by `(taskId, createdAt)`, history by `(taskId, createdAt)`.
- Roles remain a collection (rows, not an enum), as before.

### 4.3 Atomicity without SQL

The old transition used `UPDATE ... WHERE id AND status=from AND assignee_id` and required one affected row.
New: a single `findOneAndUpdate({ _id, status: from, assigneeId, deletedAt: null }, { status: to })` that
must return a document, otherwise `STATE_CONFLICT` (409). The history insert follows. Whether to wrap both
in a Mongo transaction (Atlas M0 supports them) or accept a compensating write is left to the builder, but a
transition must never leave a changed status without its history row. The "delete user refused if live tasks
assigned" rule must stay race-safe with an equivalent technique chosen by the builder.

### 4.4 Frontend port

The Vite app is a port of the existing components, not a rewrite:
- Replace `next/link`, `next/navigation`, `next/font`, `"use client"`, route groups and `layout.tsx` with
  `react-router` routes and layout components. Keep the same URL structure (`/login`, `/dashboard`, `/tasks`,
  `/tasks/:id`, `/users`) and the filters-in-the-URL behaviour.
- Keep `AuthGate`, the RTK Query `baseApi` with the single-flight refresh, `normalizeError`, the toast
  middleware, `apiMessages`, and all `components/ui` as they are.
- The browser must still talk to **one origin**. Production: Vercel `rewrites` in `vercel.json` proxy
  `/api/:path*` to the Render URL, plus an SPA fallback to `index.html`. Local: Vite dev-server proxy to the backend.
  This keeps auth cookies first-party (the reasoning in old spec section 5.8 applies unchanged).
- `BACKEND_URL` is configured where Vercel rewrites can read it; document how, since `vercel.json` cannot
  read env vars directly (builder to choose the mechanism, for example generating the file at build time).

### 4.5 Config and environments

Env names change only where the DB is concerned: `MONGODB_URI` (Atlas `mongodb+srv://...`) and `MONGODB_DB`
(optional) replace `DB_HOST/PORT/USER/PASSWORD/NAME/SSL/SSL_CA`. Everything else keeps its name and its
production boot checks. `MONGODB_URI` is secret: only in `.env` (git-ignored), provider env vars, and
`.env.example` as an empty/placeholder name. The owner will put the real value in `backend/.env`; the
builder must never ask for it in chat and never print it.

### 4.6 Tests

Jest + supertest. Use `mongodb-memory-server` for the automated suite so tests need no Docker and never
touch Atlas (builder may justify an alternative). Cover the same scenario groups as old spec section 8:
state machine table, authorization (404/403/401), approval + history, concurrent transition (one 200, one
409), login throttling, token expiry/rotation/reuse/logout. Frontend tests as before, if time allows.

### 4.7 Deployment

| Piece | Host |
|---|---|
| Frontend | Vercel (new project, new URL) |
| Backend | Render free web service (new service, new URL) |
| Database | MongoDB Atlas free tier (owner supplies the URI; Atlas Network Access must allow Render's outbound IPs) |

Render free sleeps after 15 min idle; keep the wake-up banner and `/api/health` behaviour. Seed runs once
manually against Atlas. The seed stays idempotent and non-destructive.

## 5. Submission deliverables (what this project must also produce)

Beyond the code, the repo carries a `SUBMISSION.md` (linked from the README) with:
1. Live URLs and demo accounts.
2. **Three most important decisions** — talking points the owner can speak to on camera (the owner records
   the video themselves; the builder does not produce it). Draft candidates, to be confirmed with the owner:
   (a) backend-enforced permissions with an API-driven state machine, (b) same-origin proxy so cookies are
   first-party, (c) access + rotating refresh tokens with reuse detection.
3. **Three features deliberately not built**, each with a reason. Draft candidates: email notifications,
   file attachments, a dynamic permissions system (role/permission tables).
4. **One limitation** to fix with one more day. Draft candidate: the 1-year refresh token / no absolute
   session cap, or the shared-cookie limitation across tabs. Owner picks.
5. `docs/AI-USAGE.md` (AI tools used and what was personally verified), carried over and updated.

These drafts are the builder's suggestion, not the owner's choices.

## 6. Constraints

- New directory: `/home/ghost/Desktop/Mohit/Learning/task-manager-mern/` with `frontend/`, `backend/`, root
  README, `docs/`. Own git repository.
- Author and copyright name is "Mohit Singh". Commits carry no AI co-author or attribution lines.
- No code, scaffolding or installs until the owner approves this document.

## 7. Left to the builder

Folder names inside `src`, Express middleware ordering, the exact zod schemas, the transaction-vs-compensation
choice in 4.3, how `BACKEND_URL` reaches `vercel.json`, collection names, TTL index details, and the Vite and
Tailwind versions (match the old frontend's where possible).

## 8. Settled after the builder check

- **Old spec vs old code:** the old **code wins** where they differ, because it is what is live. Known
  drift to carry over: access tokens are re-checked against the user row on every request (deleted user,
  `passwordChangedAt`, role change invalidate the session), transitions compare-and-set the assignee, user
  deletion checks for live tasks under a lock, production boot checks, opt-in Swagger, URI versioning, no
  e2e suite in the old repo. The builder audits the old code once at the start of the plan for any other divergence.
- **Who deploys:** the builder delivers a deployable repo (`vercel.json`, Render start/build commands, env
  var names, a step-by-step runbook) and the owner creates the Vercel/Render projects with their own
  accounts, because only they hold those logins. Done means the runbook's live check passes on the owner's
  URLs (health via the proxy, then the full reviewer flow), including cookie pass-through through Vercel
  rewrites and a Render cold start. The keep-alive ping on `/api/health` (for example UptimeRobot) is kept.
  The old 14-day-uptime rule belonged to the old assessment and is not required here.
- **Databases:** one Atlas cluster, **separate databases by name** via `MONGODB_DB`: one for local dev and
  one for the live app, so seeding or experiments never touch the reviewer-facing data. Automated tests use
  `mongodb-memory-server` and never touch Atlas. README setup needs no local mongod, only the Atlas URI.

## 9. Calls made by the author of this document (not yet agreed by the owner)

- Express instead of NestJS, and Vite React instead of Next.js (the word "MERN", and Express+React are the literal M-E-R-N).
- ObjectId string ids instead of numeric ids.
- `mongodb-memory-server` for tests instead of a real test database.
- Project name and location `task-manager-mern`.
- The draft decision / non-feature / limitation lists in section 5.
- Old code wins over the old spec on conflicts; the owner deploys from a runbook; dev and live use different
  database names on the same Atlas cluster (section 8).
