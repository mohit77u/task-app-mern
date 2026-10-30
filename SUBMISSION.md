# Submission

Author: Mohit Singh · mohiit77u@gmail.com

## 1. Working application and source code
- Live app: https://frontend-rho-nine-39.vercel.app · API health: https://backend-mohit77us-projects.vercel.app/api/health
- Source: this repository (`frontend/`, `backend/`). Demo accounts: see README.
- Stack: MongoDB Atlas + Mongoose, Express, React (Vite), Node.js.

## 2. Video explanation (recorded by me, on camera, about 4 to 5 minutes)
The video covers three parts: the three key decisions, the three features I did not build, and one limitation. Below are the talking points only (not a script); I speak in my own words.

**Opening (10 seconds):** "Hi, I'm Mohit. I built a task manager on MongoDB Atlas, Express, React and Node. Admins create and assign tasks, employees move them through a status flow, and the admin approves or rejects. I'll explain three decisions, three things I left out, and one limitation."

**Part A: three most important decisions (about 2.5 minutes, roughly 50 seconds each)**
1. *Permissions live in the backend, as one state machine.*
   - What: the allowed status changes sit in a single table (Pending to In Progress to Pending Approval to Completed; the admin can reject back to In Progress with a required reason). The API returns `allowedTransitions` on every task for the logged-in user.
   - Why: the UI cannot be trusted for security, and one source of truth stops the frontend and backend from drifting. An employee cannot approve even by calling the API directly; others' tasks return 404, so their existence is not leaked.
   - Trade-off: the UI has to wait for the API to know what is allowed, which is a small price for safety.
   - Show on screen: the status dropdown with disabled options, and the state machine file.
2. *The browser talks to one origin only (a proxy for `/api`).*
   - What: frontend and backend are on different hosts, so I proxy `/api` through the frontend host. Auth cookies are `HttpOnly` and first-party.
   - Why: cross-site cookies are blocked by Safari and by incognito, which is exactly how a reviewer would test two roles. Same-origin also removes most CORS and CSRF trouble; I still keep a strict origin allow-list as a second layer.
   - Show on screen: the network tab (requests go to the same domain) and the cookie flags.
3. *Short-lived access token plus a rotating refresh token with reuse detection.*
   - What: a 30-minute access token, and a refresh token that is replaced on every use, stored only as a hash, and revocable.
   - Why: a stolen access token is useful for at most 30 minutes; if an old refresh token is replayed, the whole token family is revoked. A 10-second grace window stops two browser tabs from logging the user out by accident. Changing a password or deleting a user signs them out immediately.
   - Trade-off: more moving parts than a single long-lived token, but it keeps "stay signed in" without the usual risk.
   - Show on screen: login, then the token expiring and a silent refresh (or the auth service file).

**Part B: three things I deliberately did not build (about 1 minute)**
- Email notifications: need a provider, a queue and retries; everything is already visible in the app through history, comments and the dashboard.
- File attachments: need storage, type and size limits and malware scanning; free hosting has no persistent disk.
- Dynamic roles and permissions: roles are data but what they can do is in code; two roles meet the requirements and a permissions engine adds risk without a requirement.
- One closing line: "I chose depth on correctness and security over breadth of features."

**Part C: one limitation, and what else I would do with one more day (about 1 minute)**
- Limitation: rate limiting is held in memory, so it resets on a restart or sleep and would double with two instances. Fix: a shared store (Redis or MongoDB) plus a test that the counter survives a restart.
- With one more day, in order: real-time updates; an absolute session cap with inactivity logout; password reset and user deactivation; a CI pipeline running lint and the automated tests.

**Closing (10 seconds):** "The live link, the demo accounts and the source code are in the submission. Thank you."

**Recording tips:** keep the browser on the live app in two windows (one normal, one incognito: admin and employee) for a quick demo before Part A, look at the camera when giving the reasons, and keep each part within its time.

## 3. What I chose not to implement (and why)
1. **Email notifications** (on assign, approve, reject). They need an email provider, a queue and retries, and deliverability is a separate problem. The brief is about creating and managing tasks. Status history, comments and the dashboard "needs attention" list already make every change visible inside the app.
2. **File attachments on tasks.** They need file storage, size and type limits and malware scanning, and they widen the security surface. Free-tier hosting also has no persistent disk. Text in the description and comments (including links) covers the need for now.
3. **A dynamic roles and permissions system** (creating roles and assigning permissions from an admin screen). Roles are stored as data, but what each role may do lives in code (guards and the state machine). Two roles, Admin and Employee, fully cover the requirements, and a permissions engine would add a lot of complexity and risk for no requirement.

## 4. One limitation I would fix with one more day
**Rate limiting is stored in memory.** Limits such as 5 login attempts per minute live inside the server process, so they reset when the server restarts or a serverless instance is recycled, and with several instances (which serverless creates under load) each keeps its own counter, so the real limit is higher than 5. With one more day I would move the limiter to a shared store (Redis or MongoDB) and add a test proving the counter survives a restart.

## 5. What else I would build with one more day (in priority order)
1. Shared rate-limit store (the limitation above).
2. **Real-time updates** (WebSocket or server-sent events) so a status change by one user appears for the other without a refresh.
3. **Absolute session cap:** refresh tokens rotate but a session never expires; I would add a 30-day absolute limit and logout after 7 days of inactivity, tracked per token family.
4. **Password reset and user deactivation** (an `isActive` flag instead of only soft delete). The reset flow needs email, so it comes together with item 1 of section 3.
5. **CI pipeline** (GitHub Actions) running lint and the automated tests on every push.
