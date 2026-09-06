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

## 2026-09-05 — E3 staging preview for Devin's phone test (commit `324cad6`)

**Scope:** WSF functions codebase + WSF Hosting preview channel `staging`. Live channel untouched.
GoArrive functions untouched (`firebase functions:list` before/after: only `wsf*` lines differ).
Approved by Devin 20:10Z ("Ready for you to deploy to staging for testing"). Executed by Maia
20:30–20:40Z, thread #dev-westayfit 1788640186.853239.

| Item | Value |
|---|---|
| Channel URL | `https://westayfit-app--staging-x4m0iwln.web.app` (expires 2026-09-12 20:35:52Z) |
| Join URL | `https://westayfit-app--staging-x4m0iwln.web.app/join/P9RACO2GyZJWUOMHbXZW-w` |
| Build | `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 npm --prefix apps/westayfit run build:web` at `324cad6`; three dynamic-route aliases routed; SHA in `/health` |
| Functions created | `wsfChallengePulse`, `wsfCheckIn` (minInstances 1 — billing prompt answered with `--force`, cost accepted by Devin), `wsfJoinCommunity`, `wsfListChallenge`, `wsfPreviewCommunity` |
| Functions updated | `wsfHealth`, `wsfCreateCommunity`, `wsfSendVerificationEmail` |
| Secret | `WSF_EMAIL_API_KEY` did not exist; placeholder set (version 1). **Verification emails will not send until Manus installs the real Resend key** (`docs/westayfit/MANUS_HANDOFF_EMAIL.md`). |
| Seed | `scripts/westayfit/seed/staging-test.json` (`b815415`): community `wsf-staging-test` (custom, public, `isSample: false`), challenge `wsf-staging-test-challenge` "Staging moves" (active, `goalTarget: null`), moves: Walk the main hall · Stretch at the wall for one minute · Scan the code at the desk (`requiresCode`, code `1234`) |
| Smoke | `/health` 200 · `/join/<code>` 200 · `/community/wsf-staging-test/challenge` 200 |
| Housekeeping | `firebase-admin@12` installed `--no-save` at the worktree root for the seed script (untracked `node_modules/`, no manifest change) |

**Not LIVE VERIFIED yet:** the member flow on this channel is Devin's phone test. EMULATOR
VERIFIED at `324cad6` (gate green 20:05Z, 7 browser specs + callable suite).

## 2026-09-06 — E3.5 staging redeploy for Devin's retest (commit `642f335`)

**Scope:** WSF functions codebase + WSF Hosting preview channel `staging`. Live channel untouched.
GoArrive functions untouched (`firebase functions:list` before/after: only two new `wsf*` lines).
Gate green at `642f335` 02:20:27Z (18 browser specs incl. the new `e35-home` spec, callable suite
incl. `wsf-my-communities` and `wsf-save-profile`). Executed by Maia 02:21–02:30Z, thread
#dev-westayfit 1788661278.137109.

| Item | Value |
|---|---|
| Channel URL | `https://westayfit-app--staging-x4m0iwln.web.app` (expires 2026-09-13 02:25:12) |
| Build | `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 npm --prefix apps/westayfit run build:web` at `642f335`; SHA in `/health`; dynamic routes present |
| Functions created | `wsfMyCommunities`, `wsfSaveProfile` (both callable, us-central1, nodejs20) |
| Functions updated | the whole `westayfit` codebase redeployed: `wsfCreateCommunity` and `wsfJoinCommunity` no longer require `adultConfirmation` |
| Rules / indexes | untouched (the deployed rules still carry the dead `adultConfirmation` clauses on `wsfMemberProfiles`; harmless because the client now writes profiles through `wsfSaveProfile`) |
| Smoke | `/health` 200 · `/` 200 · `/signin` 200 · `/join/P9RACO2GyZJWUOMHbXZW-w` 200 · `/community/wsf-staging-test/challenge` 200 |

**What changed for the tester:** signed-in home with your communities, Start and Join-with-a-code;
sign-in lands on the home when a profile exists; the 18+ checkbox is gone from signup and profile
(replaced by the "13 or older" sentence, pending Devin's floor); Terms and Privacy expand inline
(placeholder text until approved); community page shows human labels, a members count, and a
copyable invite link for public communities; a third join policy *Public*; an in-app-browser
hint. **Not LIVE VERIFIED yet:** Devin's retest in Safari, and the E3 check-in flow.

## 2026-09-06 — E3.5 turn C staging redeploy: sign-in and password polish (commit `2f0a9dc`)

**Scope:** WSF functions codebase + WSF Hosting preview channel `staging`. Live channel untouched.
GoArrive functions untouched (`firebase functions:list` before/after: one new `wsf*` line). Gate green
at `2f0a9dc` 17:47:23Z (25 browser specs incl. `e35-auth-polish`, callable suite incl.
`wsf-send-password-reset-email`). Executed by Maia 18:00–18:05Z, thread #dev-westayfit 1788717599.623009.

| Item | Value |
|---|---|
| Channel URL | `https://westayfit-app--staging-x4m0iwln.web.app` (expires 2026-09-13 18:03:58) |
| Build | `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 npm --prefix apps/westayfit run build:web` at `2f0a9dc`; SHA in `/health`; `reset-password` route present |
| Functions created | `wsfSendPasswordResetEmail` (callable, unauthenticated, enumeration-safe, same email config as verification) |
| Functions updated | the whole `westayfit` codebase redeployed in place (10 existing) |
| Rules / indexes | untouched |
| Smoke | `/health` · `/` · `/signin` · `/signup` · `/reset-password` · `/join/P9RACO2GyZJWUOMHbXZW-w` · `/community/wsf-staging-test/challenge` — all 200 |

**What changed for the tester:** Show/Hide on password fields; "Forgot your password?" → `/reset-password`;
the mismatch error offers reset or create; email/password autofill and keyboard attributes; Enter submits;
email trimmed and lower-cased; `/signin` and `/signup` send a signed-in member home; signup shows the
8-character rule up front; the verify screen says plainly that email is not set up on this build.
**Email itself still does not send** until decision A (sender domain) and the Manus steps in task #30:
the reset and verification screens show the honest "not set up yet" message. **Not LIVE VERIFIED yet.**
