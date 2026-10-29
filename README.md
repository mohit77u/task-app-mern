# Task Manager (MERN)

A task management app where an **Admin** creates and assigns tasks, **Employees** work them through a status flow, and the Admin **approves or rejects** the result.

Built with **MongoDB Atlas + Mongoose, Express, React (Vite) and Node.js**, all in TypeScript.

Author: Mohit Singh

| | |
|---|---|
| Live app (frontend, Vercel) | _add your Vercel URL after deploying_ |
| Live API (backend, Render) | _add your Render URL after deploying_ (health check: `/api/health`) |
| Database | MongoDB Atlas (free tier) |

> The free Render plan sleeps after about 15 minutes without traffic. The first request after that can take up to a minute. That is normal for free hosting, not a bug.

## Features

- **Roles:** Admin and Employee. Permissions are enforced in the backend, never only in the UI.
- **Admin:** create, edit, delete and assign tasks (title, description, priority, due date); see every task; approve or reject; create and manage users.
- **Employee:** sees only the tasks assigned to them, comments on them, and moves them `Pending → In Progress → Pending Approval`.
- **Approval flow:** `Pending Approval → Completed` (approve) or back to `In Progress` (reject, a reason is required). Every change is saved in a history timeline.
- **Dashboard** with counts per status, filters (status, priority, employee), search and pagination.
- **Auth:** short-lived access token (30 min) plus a rotating refresh token with reuse detection, both in `HttpOnly` cookies. Passwords are hashed with bcrypt.
- Clear, consistent error messages and a toast for every action.

## Demo accounts

Created by the seed script (public demo values, not real credentials).

| Role | Email | Password |
|---|---|---|
| Admin | `admin@taskapp.dev` | `Admin@12345` |
| Admin | `admin2@taskapp.dev` | `Admin@12345` |
| Employee | `priya@taskapp.dev` | `Employee@12345` |
| Employee | `rahul@taskapp.dev` | `Employee@12345` |
| Employee | `ananya@taskapp.dev` | `Employee@12345` |

To test two roles at the same time, use a normal window for one and a **private/incognito window** (or a second browser) for the other. Cookies are shared by tabs of the same browser profile, so a second login in another tab replaces the first.

## Project structure

```
task-manager-mern/
  backend/    Express 5 + Mongoose API (src/, test/, scripts/)
  frontend/   React + Vite app (src/)
  docs/       Design spec and implementation plan
```

Backend layers: `routes → controllers → services → Mongoose models`. Controllers stay thin, business rules live in services and in one state-machine file (`backend/src/modules/tasks/task-state-machine.ts`). The API sends each task's `allowedTransitions`, so the UI never duplicates the rules.

## Run it locally

### Prerequisites

- Node.js 22 or newer, and npm
- A MongoDB Atlas account (free tier is enough)

### 1. Set up MongoDB Atlas

1. In Atlas create a free cluster.
2. **Database Access → Add New Database User** → password authentication → give it **Read and write to any database**. Use a password with only letters and numbers (special characters must be URL-encoded in the connection string).
3. **Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`). Render's free plan has no fixed IP.
4. **Connect → Drivers** and copy the `mongodb+srv://...` string. Replace `<db_username>` and `<db_password>` with the user you created.

### 2. Configure the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

- `MONGODB_URI` = your Atlas connection string (**secret, never commit it**; `.env` is git-ignored)
- `MONGODB_DB` = `taskmanager_dev` (the database is created on first write)
- `JWT_ACCESS_SECRET` = a random string of at least 32 characters. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- Everything else can keep the example values for local development.

### 3. Seed the demo data

```bash
npm run seed
```

The seed is idempotent and non-destructive: running it again creates nothing new and never changes existing rows. It prints counts only.

### 4. Start the backend and the frontend

```bash
# terminal 1
cd backend && npm run dev        # http://localhost:4000  (health: /api/health)

# terminal 2
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Open http://localhost:5173 and sign in with a demo account. The Vite dev server proxies `/api` to the backend, so the browser only talks to one origin.

### Try it without Atlas

```bash
cd backend && npm run dev:memory
```

This starts the real app on port 4000 on top of an in-memory MongoDB, already seeded. Nothing is stored and Atlas is never touched. Start the frontend as above.

## Tests and checks

```bash
# backend (uses an in-memory MongoDB replica set, never Atlas)
cd backend && npm test && npm run lint && npx tsc --noEmit

# frontend
cd frontend && npm test && npm run lint && npm run typecheck
```

## Environment variables

Backend (`backend/.env`, names only; see `.env.example`):

| Name | Purpose |
|---|---|
| `NODE_ENV`, `PORT` | Runtime mode and port |
| `MONGODB_URI` | Atlas connection string (**secret**) |
| `MONGODB_DB` | Database name (`taskmanager_dev` locally, `taskmanager_live` in production) |
| `JWT_ACCESS_SECRET` | Signs access tokens (at least 32 random characters) |
| `ACCESS_TOKEN_TTL` | Access token lifetime, for example `30m` |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime in days (default 365) |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | Cookie flags (`true` and `lax` in production) |
| `FRONTEND_ORIGINS` | Exact allowed browser origin(s), comma separated |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API (at least 1 in production) |
| `THROTTLING_ENABLED` | Turns rate limiting on or off (default on) |
| `SEED_ADMIN_PASSWORD`, `SEED_EMPLOYEE_PASSWORD` | Optional, seed only: private passwords instead of the demo ones |

In production the backend refuses to start if `COOKIE_SECURE` is not `true`, an origin is not `https://`, the JWT secret looks like a placeholder, or `TRUST_PROXY_HOPS` is below 1.

## Deploy

The frontend goes to **Vercel**, the backend to **Render**, the database to **Atlas**. The Vercel app proxies `/api/*` to Render, so the browser only talks to one origin and the auth cookies stay first-party. That is what makes them work in Safari and in incognito windows.

### 1. Atlas (live database)

Use the same cluster but a separate database name, for example `taskmanager_live`, so demo data and experiments never mix with the live data. Network Access must allow all IPs (`0.0.0.0/0`).

### 2. Backend on Render

Create a **Web Service** from this GitHub repository:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance type | Free |

Environment variables:

```
NODE_ENV=production
MONGODB_URI=<your Atlas string>
MONGODB_DB=taskmanager_live
JWT_ACCESS_SECRET=<new random 48-byte hex string>
ACCESS_TOKEN_TTL=30m
REFRESH_TOKEN_TTL_DAYS=365
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
FRONTEND_ORIGINS=https://<your-app>.vercel.app      # exact URL, no trailing slash
TRUST_PROXY_HOPS=1
THROTTLING_ENABLED=true
```

After the first deploy, seed the live database **once**, from your machine (set the same `MONGODB_URI` and `MONGODB_DB=taskmanager_live` in your shell or in a copy of `.env`):

```bash
cd backend && npm run seed
```

Open `https://<your-service>.onrender.com/api/health`. It should return `{"status":"ok","db":"up"}`.

### 3. Frontend on Vercel

1. Edit `frontend/vercel.json` and replace `YOUR-RENDER-SERVICE` with your Render service name, then commit and push. (`vercel.json` cannot read environment variables, so the backend URL is written in the file.)
2. In Vercel import the same GitHub repository. Set **Root Directory** to `frontend`. Framework preset: Vite. Build command `npm run build`, output directory `dist`.
3. Deploy, then copy the Vercel URL into `FRONTEND_ORIGINS` on Render and redeploy the backend.

### 4. Keep the free backend awake (optional)

Create a free monitor at UptimeRobot for `https://<your-service>.onrender.com/api/health` every 5 minutes.

### 5. Verify the live app

1. `https://<your-service>.onrender.com/api/health` returns `{"status":"ok","db":"up"}`.
2. `https://<your-app>.vercel.app/api/health` returns the same JSON (this goes browser → Vercel → Render → Atlas).
3. Sign in as an Admin, create a task and assign it to an Employee. In a private window sign in as that Employee, move the task to In Progress and then Pending Approval. As the Admin approve it, or reject it with a reason.
4. Reload and sign in again: the data is still there.
5. Cookies in the browser dev tools: `access_token` and `refresh_token` are `HttpOnly`, `Secure`, `SameSite=Lax`.

## Security notes

- Passwords hashed with bcrypt; secrets only in environment variables; no credentials in the repository.
- Access token re-checked against the user record on every request, so deleting a user or changing a password signs them out immediately.
- Refresh tokens are stored only as a hash, rotated on every use, and revoked together if an old one is replayed.
- Strict CORS allow-list plus an `Origin` check on state-changing requests, `helmet`, request validation that rejects unknown fields, and rate limiting (login 5/min per email, 100/min per signed-in user).
- Unknown routes under `/api/v1` answer `401` to signed-out callers (authentication runs first) and `404` to signed-in ones.

## Known limitations

- Rate limits are kept in memory, so they reset when the server restarts or the free instance sleeps, and they are not shared between instances.
- The sign-in related routes (`/auth/*`) share one per-IP limit. Behind a shared proxy IP all users count against the same bucket.
- Refresh tokens last one year and there is no absolute session cap; they are rotated on every use and can be revoked.
- Cookies are shared by tabs of one browser profile, so two roles need two browsers (or a private window).
- Swagger/OpenAPI docs are not provided.
- On the free tiers, the first request after a quiet period can be slow.

## Git

This repository is `git@github.com:mohit77u/task-app-mern.git`.

```bash
git remote add origin git@github.com:mohit77u/task-app-mern.git   # once
git branch -M main
git push -u origin main
```

Never commit `backend/.env`. It is git-ignored, only `backend/.env.example` (placeholders) is tracked.
