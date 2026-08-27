# We Stay Fit — Decisions Log

Append-only. Each entry: date, decision, alternatives considered, reason chosen.

## 2026-08-26 — Single Firebase project for both apps

Chose: keep WSF inside the existing `goarrive` Firebase project as a second Hosting site + second functions codebase.

Alternatives considered:
- Separate `westayfit` Firebase project (rejected: doubles the infra footprint, splits auth users, creates cross-project boundary for a shared user base intent).
- WSF as a route inside `apps/goarrive/` (rejected: forces shared theming, shared bundle, shared function claims — kills the "second first-party app" property).

Reason: single project keeps auth users unified and infra minimal; separation is at Hosting site + functions codebase level, which is Firebase's supported isolation boundary for multi-app-per-project.

## 2026-08-26 — Playwright config self-contained inside `apps/westayfit/`

Chose: `apps/westayfit/playwright.config.ts` with its own `testDir` and `WSF_PLAYWRIGHT_BASE_URL`, invoked via `npm --prefix apps/westayfit run test:e2e`.

Alternative considered:
- Add a new project entry to the existing root `playwright.config.ts` (rejected: a bare `npm run test:e2e` at the repo root would then silently pull WSF specs into a GoArrive regression run — exactly the regression surface M-U1 exists to prevent).

Reason: matches the pattern of separate `firebase.westayfit.json` config for Hosting and separate `functions-westayfit` codebase for functions — one boundary per surface.

## 2026-08-26 — Zero custom claims for WSF users, static-guard enforced

Chose: WSF functions must never call `setCustomUserClaims`; a Vitest static guard fails if any WSF-path file contains the string.

Reason: 8 GoArrive claims call sites, 7 replace the whole claims object (index.ts:1892/2945/3099/3221/3318/11060, leads.ts:214). Any WSF claim on a shared user would be silently clobbered by them. The lone merge-style site (`setAdminRole` at index.ts:6460) is the exception that proves the codebase has no consistent merge convention. Enforcing zero-claims at the WSF boundary is cheaper than trying to normalize the GoArrive writers.

## 2026-08-26 — Own copy of `inject_meta` for WSF (no shared script)

Chose: `scripts/westayfit/inject_meta` is a minimal Python script (title, description, `<meta name="robots" content="noindex,nofollow">`) — not a shared script with mode flags.

Alternative considered:
- Extend `scripts/inject_pwa_meta.py` with a `--app` flag (rejected: shared script becomes the merge hazard; GoArrive's inject script has PWA manifest, service worker, fonts, Safari CSS, error handlers that WSF actively does not want).

Reason: WSF's meta needs are a strict subset of GoArrive's; a smaller own-script is more auditable and cannot regress GoArrive.

## 2026-08-26 — Record `ls-remote` check permanently in truth gate

Recorded in Maia's session memory: before any `git worktree add -b <branch>`, run both `git branch --list <branch>` AND `git ls-remote origin refs/heads/<branch>`. Stop on any output.

Reason: catches stale remote branches from prior workers/attempts that the local checkout has never heard of; `branch --list` alone misses that entirely.
