# Deploy runbook

Frontend and backend are two Vercel projects from the same GitHub repo; the database is on Atlas. Do the steps in order. Values in `<angle brackets>` are yours. Full detail is in the [README](../README.md#deploy).

## 0. Before you start
- Code is pushed to `git@github.com:mohit77u/task-app-mern.git`, branch `main`.
- Accounts: MongoDB Atlas, Vercel.

## 1. Atlas
1. **Database Access:** a user with read/write. Keep the password out of chat and the repo.
2. **Network Access:** add `0.0.0.0/0` (Vercel functions have no fixed IP).
3. Use a separate production database name: `MONGODB_DB=taskmanager_live` (local uses `taskmanager_dev`).
4. Copy the connection string (`mongodb+srv://...`).

## 2. Backend project (Vercel)
1. Add New → Project → this repo. Framework **Other**, Root Directory `backend`.
2. Install Command (override): `npm install --include=dev`. Build Command `npm run build`. Output Directory empty.
3. Environment variables:

   ```
   NODE_ENV=production
   MONGODB_URI=<Atlas string>
   MONGODB_DB=taskmanager_live
   JWT_ACCESS_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
   ACCESS_TOKEN_TTL=30m
   REFRESH_TOKEN_TTL_DAYS=365
   COOKIE_SECURE=true
   COOKIE_SAMESITE=lax
   FRONTEND_ORIGINS=https://placeholder.vercel.app   # replaced in step 5
   TRUST_PROXY_HOPS=1
   THROTTLING_ENABLED=true
   ```
4. Settings → Deployment Protection → **Vercel Authentication: Disabled**.
5. Deploy. `https://<backend>.vercel.app/api/health` must return `{"status":"ok","db":"up"}`.

## 3. Seed the live database (once)
From your machine, values in the shell (not in a committed file). The seed reuses the app's environment validation, so these four are required:

```bash
cd backend
MONGODB_URI='<Atlas string>' MONGODB_DB=taskmanager_live JWT_ACCESS_SECRET='<same secret>' \
FRONTEND_ORIGINS='https://<frontend>.vercel.app' npm run seed
```

The login page lists the public demo passwords, so leave `SEED_ADMIN_PASSWORD` / `SEED_EMPLOYEE_PASSWORD` unset for the submission. The seed is idempotent. The default accounts' email and password cannot be changed from the app.

## 4. Frontend project (Vercel)
1. Edit `frontend/vercel.json`: first rewrite `destination` = `https://<backend>.vercel.app/api/:path*`. Commit and push. (Vercel reads this file before the build; it cannot come from an env var.)
2. Add New → Project → same repo, Root Directory `frontend`, preset Vite, build `npm run build`, output `dist`. No environment variables are needed.
3. Deployment Protection → Vercel Authentication: **Disabled**.
4. Deploy and note `https://<frontend>.vercel.app`.

## 5. Close the loop
1. Backend project → Settings → Environment Variables → `FRONTEND_ORIGINS=https://<frontend>.vercel.app` (exact, no trailing slash) → **Redeploy** the backend.
2. Put both live URLs in the README table and in `SUBMISSION.md` section 1, commit, push.

## 6. Live checks
- [ ] `https://<backend>.vercel.app/api/health` → `{"status":"ok","db":"up"}`
- [ ] `https://<frontend>.vercel.app/api/health` → the same JSON (frontend → backend → Atlas)
- [ ] `https://<frontend>.vercel.app/dashboard` opens the app (or login) directly, also after a refresh
- [ ] Admin signs in, creates a task for an Employee. In an incognito window the Employee moves it to In Progress, then Pending Approval. The Admin approves it; also try reject with a reason.
- [ ] Employee cannot see other people's tasks, cannot approve, cannot open `/users`.
- [ ] Reload: still signed in, data still there.
- [ ] Cookies: `access_token` and `refresh_token` are `HttpOnly`, `Secure`, `SameSite=Lax`, host-only (the frontend host).
- [ ] A cross-origin write is refused:
  `curl -i -X POST https://<backend>.vercel.app/api/v1/auth/logout -H 'Origin: https://evil.example'` → `403`.
- [ ] Test on the production URL only: preview deployments have a different origin, so their writes return 403.

## If something fails
| Symptom | Likely cause |
|---|---|
| Build: `tsc: command not found` | Install Command is not `npm install --include=dev` |
| Everything redirects to a Vercel login | Deployment Protection is still on |
| Backend `/api/health` returns 503 | Wrong `MONGODB_URI` or Atlas Network Access; or an insecure/missing production value (`COOKIE_SECURE`, non-`https` origin, placeholder secret, `TRUST_PROXY_HOPS` < 1). See the function logs |
| `/dashboard` or `/api/*` 404 on the frontend | `frontend/vercel.json` not committed, or it points to the wrong backend URL |
| Login works but you are signed out on reload | `FRONTEND_ORIGINS` does not match the frontend URL exactly |
