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

## 2026-08-26 — No SPA catch-all rewrite in `firebase.westayfit.json`

Chose: omit the `"rewrites": [{ "source": "**", "destination": "/index.html" }]` block that a typical SPA hosting config includes. Unknown routes are served by the Expo static export's own `+not-found.html` page (which returns a real HTTP 404 with correct semantics).

Alternative considered:
- Add the standard SPA catch-all so any URL renders the app shell and lets client-side routing decide (rejected: `/definitely-not-a-real-wsf-route` would then return HTTP 200 with the brand shell, not 404 — worse SEO and worse user signaling for a `noindex` site whose whole point is not to accumulate garbage indexed URLs).

Reason: WSF has two real routes (`/`, `/health`) plus the auto-generated `+not-found` and `_sitemap` — the static export covers them by construction, so the SPA rewrite is unnecessary and actively harmful for 404 semantics. Verified by the live-channel Playwright spec `unknown-route.spec.ts`: `GET /definitely-not-a-real-wsf-route` returns 404 with no GoArrive leakage.

Called out on PM review of PR #299 as an accepted deviation from the dispatch spec (which implied a rewrite would be present).

## 2026-08-26 — M-U1.1 correction: `/health` shows real commit; home tagline is chartered sentence; specs enforce spec, not implementation

Chose (after PM visual smoke of the first M-U1 deploy):

1. `/health` reads a build-time-injected commit SHA (`EXPO_PUBLIC_BUILD_COMMIT`, set inline in the `build:web` script via `git rev-parse --short HEAD`). The `dev` string is kept as a fallback for local dev only (when the app is served via `expo start` without the build wrapper). Playwright spec `health.spec.ts` now asserts the deployed value is not `dev` and matches the short-SHA regex `^[0-9a-f]{7,40}$`.
2. `/health` no longer shows the Firebase project row. `wsfFirebaseProjectId` is not verification data — publishable, but non-diagnostic — so the stamp is now App, Version, Commit, Built at (as per the PM's stated intent).
3. Home tagline is the chartered sentence: *"Wherever your people gather, We Stay Fit."* (from `UNIVERSAL_COMMUNITIES_CHARTER.md`). Playwright spec `home.spec.ts` now asserts that literal string, not the implementation copy.

Alternatives considered:
- Injecting the commit at runtime via a Firebase Function or a `/health.json` endpoint (rejected: adds infra weight for a static-truth artifact; env at build time is the smaller mechanism and stays inside the WSF app boundary).
- Keeping the `Firebase project` row for informational purposes (rejected on PM's read: the project ID is fixed to `goarrive` for the life of the app; it teaches nothing at diagnosis time).
- Asserting only that the commit stamp is non-empty (rejected: that was the original spec and it silently passed against the `dev` fallback string — the whole point of `/health` is defeated).

Reason: `/health` is the deploy-truth artifact. If it can lie, it is worse than not existing. The spec now enforces the invariant.

Process lesson (recorded here so future WSF work does not repeat it):
- Specs must assert the *specified* copy, not the *rendered* copy. When the two diverge, the spec should fail — that is the whole reason the spec exists.
- Visual smoke by a human is authoritative for defects that only show up on-screen (wrong copy, placeholder values, contrast, layout). Automated tests catch what they were written to catch; they cannot catch what they were not.

## 2026-08-26 — Record `ls-remote` check permanently in truth gate

Recorded in Maia's session memory: before any `git worktree add -b <branch>`, run both `git branch --list <branch>` AND `git ls-remote origin refs/heads/<branch>`. Stop on any output.

Reason: catches stale remote branches from prior workers/attempts that the local checkout has never heard of; `branch --list` alone misses that entirely.
