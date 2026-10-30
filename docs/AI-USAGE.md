# AI usage

## Tools

- **Claude Code** (Anthropic's CLI, Claude Sonnet 5.5 and Opus models), using brainstorming, planning and subagent-driven development: each implementation task was done by a subagent and followed by a review loop (spec compliance, then code quality) before the next task. The task ledger recorded rulings and deferred minor findings.
- Any editor assistants the owner used interactively are not logged, so this note cannot say which individual lines came from them.

## What AI did

- Turned the assessment requirements and the earlier NestJS/MySQL version of this app into a design spec with a requirement-to-design traceability table, and wrote the implementation plan (`docs/superpowers/specs/`, `docs/superpowers/plans/`).
- Generated the backend (Express + Mongoose), the React frontend port, the unit and HTTP integration tests, and the documentation from that plan. Review findings were fixed in follow-up commits (for example per-user rate limiting behind authentication, hardened shutdown, a React 19 console error, a search filter that did not apply after Reset).

## What the human decided and directed

- The stack change to MongoDB Atlas, Express, React and Node, and keeping the earlier app's behaviour and demo accounts.
- The deployment shape: Vercel proxying `/api` to Render so cookies stay first-party.
- Scope: three features deliberately not built, one named limitation (in-memory rate limiting), and which test suites are part of the deliverable (backend and frontend unit/integration tests only).
- The Atlas cluster, credentials and the final deployment are handled by the owner; credentials were never given to the AI or committed.

## Verification

- Automated: backend (Jest, including HTTP integration suites on an in-memory replica set) and frontend (Vitest) tests, type checks, lint and builds.
- Browser-driven local verification of the reviewer flow (Admin and Employee in separate sessions) against a local stack, which found and fixed two integration defects.
- Not claimed: no live-deployment test yet at the time of writing, no 14-day uptime check, and no independent security audit. Items a reviewer should re-check by hand: role restrictions (an Employee cannot see others' tasks, approve, or open `/users`), cookie flags in a browser, and the refresh-token rotation code.

## Known gaps

See "Known limitations" in the [README](../README.md).
