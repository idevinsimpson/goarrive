# We Stay Fit — Releases

Append-only release log. Each entry: date, milestone, staging channel URL, functions deployed, GoArrive-unchanged proof, PR link.

## Format

```
## YYYY-MM-DD — M-XX <title>

- Branch: <branch-name>
- Anchor SHA: <origin/main SHA at dispatch>
- Head SHA: <branch HEAD SHA at deploy>
- Hosting: <channel URL>
- Functions deployed: <list>
- GoArrive-unchanged proof:
  - `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` → EMPTY
  - `firebase functions:list` before/after → all pre-existing GoArrive functions present
- PR: <URL>
- Notes: <anything worth flagging for the next milestone>
```

## Entries

## 2026-08-26 — M-U1 App Shell & Infrastructure

- Branch: `feat/westayfit-foundation`
- Anchor SHA: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf` (origin/main at dispatch)
- Head SHA: (see PR at merge time)
- Hosting: <https://westayfit-app--staging-x4m0iwln.web.app> (channel `staging`, expires 2026-09-03)
- Functions deployed: `westayfit:wsfHealth` (v2 callable, us-central1, Node 20, auth-required)
- GoArrive-unchanged proof:
  - `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` → EMPTY
  - `firebase functions:list --project goarrive` before: 125 functions; after: 126 functions; delta = `+wsfHealth`, no removals
  - `npm --prefix apps/goarrive run ts:check` → exit 0
- WSF checks:
  - `npm --prefix apps/westayfit run ts:check` → exit 0
  - `npm --prefix apps/westayfit run test:vitest` → 5/5 tests pass (4 smoke + 1 zero-custom-claims guard)
  - `npm --prefix apps/westayfit run build:web` → 4 static routes (`/`, `/health`, `/_sitemap`, `/+not-found`), WSF meta injected into all HTML files
  - `npm --prefix apps/westayfit run test:e2e` (vs channel URL) → 4/4 tests pass (home render, health render, unknown-route 404 with no GoArrive leak, axe no serious/critical)
- PR: (opened, do NOT merge)
- Notes:
  - Initial axe run failed on eyebrow color `#e8b547` gold on `#f7f5f0` cream (contrast 1.73:1 vs WCAG 4.5:1 required). Fix: swapped eyebrow to `theme.colors.primary` (`#0B1F3A`), rebuilt, redeployed, axe green.
  - Zero-custom-claims guard implemented via `git grep` at test time against `functions-westayfit/` and `apps/westayfit/` (excluding the guard itself and `docs/westayfit/**`).
  - `inject_meta.py` walks `dist/*.html` so all static routes get the meta (not just `index.html`).
  - Root `firebase.json` change limited to appending one `functions` array entry (`{ source: "functions-westayfit", codebase: "westayfit" }`). Hosting block untouched.

## 2026-08-26 — M-U1.1 Correction Pass

- Branch: `feat/westayfit-foundation` (same PR #299, normal follow-up commits, no force-push)
- Hosting: same channel `https://westayfit-app--staging-x4m0iwln.web.app` (Firebase reuses deterministic channel URL; no new URL to record)
- Functions: unchanged from M-U1 (no functions redeploy in this pass)
- Trigger: PM visual smoke of the M-U1 channel found two defects the diff review could not see.

**Fixes**

1. Home tagline replaced with the chartered sentence *"Wherever your people gather, We Stay Fit."* (was: "Universal communities that move together."). Playwright `home.spec.ts` updated to assert the chartered sentence — the spec now enforces the spec instead of echoing the implementation.
2. `/health` build stamp now shows the real commit SHA instead of the `dev` fallback: `apps/westayfit/package.json` `build:web` sets `EXPO_PUBLIC_BUILD_COMMIT="$(git rev-parse --short HEAD)"` inline; `apps/westayfit/src/buildStamp.ts` reads it with `dev` fallback kept for local `expo start`; `apps/westayfit/tests-e2e/health.spec.ts` asserts the deployed commit is not `dev` and matches `^[0-9a-f]{7,40}$`.
3. `/health` no longer shows the *Firebase project* row (the project ID is fixed and non-diagnostic; the stamp is App, Version, Commit, Built at).

**Post-fix proofs**

- `apps/westayfit ts:check` → exit 0
- `apps/westayfit vitest` → 5/5 pass (unchanged suite)
- `apps/westayfit test:e2e` vs redeployed channel → 4/4 pass (home now asserts chartered sentence; health now asserts real short-SHA commit; unknown-route + axe still green)
- GoArrive-unchanged: `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` → EMPTY
- Files touched (allowlist per PM directive): `apps/westayfit/app/index.tsx`, `apps/westayfit/app/health.tsx`, `apps/westayfit/src/buildStamp.ts`, `apps/westayfit/package.json`, `apps/westayfit/tests-e2e/home.spec.ts`, `apps/westayfit/tests-e2e/health.spec.ts`, `docs/westayfit/RELEASES.md`, `docs/westayfit/DECISIONS.md`. Nothing outside the allowlist.

**Post-commit redeploy**

After committing and pushing the fixes above, one more rebuild + channel redeploy is performed so `/health` displays the SHA of the actual PR HEAD (not the SHA that was HEAD at the time of the first post-fix rebuild).
