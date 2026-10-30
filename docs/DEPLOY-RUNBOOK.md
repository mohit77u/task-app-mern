# Deploy runbook

Do the steps in order. Names in `<angle brackets>` are values you choose or copy. Details and the full env var table are in the [README](../README.md#deploy).

## 0. Before you start

- Code is pushed to `git@github.com:mohit77u/task-app-mern.git`, branch `main`.
- You have accounts on MongoDB Atlas, Render, Vercel (and optionally UptimeRobot).

## 1. Atlas

1. **Database Access:** a database user with read/write on the cluster. Keep the password out of chat and the repo.
2. **Network Access:** add `0.0.0.0/0` (Render's free plan has no fixed IP).
3. Use a **separate database name for production**: `MONGODB_DB=taskmanager_live` (local development uses `taskmanager_dev`).
4. Copy the connection string (`mongodb+srv://...`).

## 2. Render (backend)

1. New **Web Service** from the GitHub repo. Root directory `backend`, runtime Node, instance type Free.
2. Build command `npm ci && npm run build`, start command `npm start` (runs `node dist/main`).
3. Health check path `/api/health`.
4. Environment variables:

   ```
   NODE_ENV=production
   MONGODB_URI=<Atlas string>
   MONGODB_DB=taskmanager_live
   JWT_ACCESS_SECRET=<48 random bytes as hex: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
   ACCESS_TOKEN_TTL=30m
   REFRESH_TOKEN_TTL_DAYS=365
   COOKIE_SECURE=true
   COOKIE_SAMESITE=lax
   FRONTEND_ORIGINS=https://placeholder.vercel.app   # replaced in step 5
   TRUST_PROXY_HOPS=1
   THROTTLING_ENABLED=true
   ```

5. Deploy. `https://<service>.onrender.com/api/health` must return `{"status":"ok","db":"up"}`.

## 3. Seed the live database (once)

From your machine, with the live values in your shell (not in a committed file). The seed reuses the app's environment validation, so these four are required; if a `backend/.env` exists it is loaded too, but shell values take precedence:

```bash
cd backend
MONGODB_URI='<Atlas string>' MONGODB_DB=taskmanager_live JWT_ACCESS_SECRET='<same secret>' \
FRONTEND_ORIGINS='https://<app>.vercel.app' npm run seed
```

(Set `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD` first if you do not want the public demo passwords on the live data.) The seed is idempotent; running it twice does not duplicate users.

## 4. Vercel (frontend)

1. Import the same repo. **Root Directory** `frontend`, preset Vite, build `npm run build`, output `dist`.
2. Set `BACKEND_URL=https://<service>.onrender.com` (no trailing slash, no `/api`) **before** the first build. If it is missing or malformed the build stops with a clear message.
3. Deploy and note `https://<app>.vercel.app`.

## 5. Close the loop

1. Render → Environment → set `FRONTEND_ORIGINS=https://<app>.vercel.app` (exact, no trailing slash) → save (this redeploys).
2. Optional: UptimeRobot HTTP monitor on `https://<service>.onrender.com/api/health`, every 5 minutes.
3. Put the two live URLs in the README table and in `SUBMISSION.md` section 1, commit, push.

## 6. Live checks

- [ ] `https://<service>.onrender.com/api/health` → `{"status":"ok","db":"up"}`
- [ ] `https://<app>.vercel.app/api/health` → the same JSON (browser → Vercel → Render → Atlas)
- [ ] Admin signs in, creates a task for an Employee. In an incognito window the Employee moves it to In Progress, then Pending Approval. The Admin approves it; also try reject with a reason.
- [ ] Employee cannot see other people's tasks, cannot approve, cannot open `/users`.
- [ ] Reload: still signed in, data still there.
- [ ] DevTools → Application → Cookies: `access_token` and `refresh_token` are `HttpOnly`, `Secure`, `SameSite=Lax`, host-only (domain is the Vercel host).
- [ ] A cross-origin state-changing request is refused:
  `curl -i -X POST https://<service>.onrender.com/api/v1/auth/logout -H 'Origin: https://evil.example'` → `403`.
- [ ] Cold start: after 15+ minutes idle, the first page load through Vercel is slow but succeeds (no error screen).

## If something fails

| Symptom | Likely cause |
|---|---|
| Render service crashes at boot, log mentions environment | An insecure or missing production value (`COOKIE_SECURE`, non-`https` origin, placeholder secret, `TRUST_PROXY_HOPS` < 1) |
| `/api/health` says `db: down` | Atlas Network Access does not allow `0.0.0.0/0`, or wrong `MONGODB_URI` |
| Vercel build fails with `BACKEND_URL ...` | Variable missing, has a trailing slash, or ends in `/api` |
| Login works but you are signed out on reload | `FRONTEND_ORIGINS` does not match the Vercel URL exactly |
| API calls return 404 on Vercel | `BACKEND_URL` was set after the build; redeploy |
