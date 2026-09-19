# Task 1/8 — Baseline freeze + Gate 1 investigation

Overnight run of 2026-09-18 on PR #327 (`claude/wsf-ui-member-experience`). Draft PR; nothing merged or deployed.

## 1. Baseline at handoff

| Item | Value |
|---|---|
| Branch | `claude/wsf-ui-member-experience` |
| Head at handoff | `5af29f48df73745e500f99cfbf26a64e8d0cd085` |
| Base | `claude/wsf-package-e-display-auth` @ `3560936b37900591d41240adf98ea82b1b8f0c72` |
| Working tree | clean (untracked: `node_modules`, regenerated `tests-e2e/artifacts/ui-*` PNG folders, never committed) |
| PR #327 | open, **draft**, base unchanged, mergeable state clean, no review comments at handoff |

### Changed paths vs base (47 files, +6,459 / −1,100)

- **Product UI / routes:** `apps/westayfit/app/community/[groupId]/index.tsx`, `app/contribute/[goalId].tsx`, `app/display/[goalId].tsx`
- **Shared UI / helpers:** `src/contributionFlow.ts`, `src/ui/{ButtonLink,LivingWeProgress,WsfWordmark}.tsx`, `src/ui/{brandAssets,dates,livingWeCalibration,progressFormat,useReducedMotion}.ts`; `src/goalPercent.ts` deleted
- **Brand assets:** `apps/westayfit/assets/brand/**` (originals with SHA256SUMS, derived PNGs, calibration JSON, README)
- **Brand tooling:** `scripts/westayfit/brand/derive-brand-assets.py`
- **App tests:** new e2e `ui-community-home`, `ui-contribute`, `ui-display`, `ui-journey`, `ui-qa`; updated `d-admission-controls`, `e35-home`, `e4-a1-shared-goal`, `e5-community-goal-seam`, `e5-display-authorization`, `mu2-flow`; new Vitest `brand-assets-provenance`, `contribution-flow`, `dates-timezone`, `living-we-calibration`, `progress-format`; `goal-percent-floor` deleted
- **Backend contract change:** `functions-westayfit/src/index.ts` (`wsfGoalPulse` nine-field owner-approved contract) and `functions-westayfit/tests/callable/wsf-goal-pulse.test.ts`
- **Not touched:** `apps/goarrive`, `functions/` (non-WSF), Firestore rules/indexes, `.github`, staging workflow, IAM/WIF, `approved-candidate.json`, production config

### Approved visual / product status at handoff

Checkpoints A2 (Community Home), B2 (Contribution), C2 (Public display, zone-aware dates) accepted by Devin. Checkpoint D (cross-surface coherence + candidate hardening) delivered and awaiting the whole-product verdict.

### Test receipts at handoff (head `5af29f4`)

| Suite | Result |
|---|---|
| App TypeScript | clean |
| App Vitest | 205 passed / 14 files |
| Complete emulator browser suite (17 specs) | 61 passed |
| Functions build | clean |
| Callable suite | 204 passed / 17 files |
| Firestore rules suite | 22 passed |
| Deploy-config suite | 8 passed |
| `scripts/westayfit/gate1.sh` | **not green** — its 7-spec browser step failed `e2-join-flow.spec.ts` in 3 of 3 runs on the branch and 1 of 1 on the base commit |

### Intentional gaps (kept, not built)

Authoritative one-time target-crossing event · repeat policy · guided activity instructions · calibrated Living WE motion · recent privacy-safe public additions on the display · complete durable community history.

## 2. Gate 1 failure investigation

### Symptom

`e2-join-flow.spec.ts` › "a signed-out visitor with only a join URL reaches /community/<id>": after the test verifies the new account through the Auth emulator REST API and taps **I have verified**, `wsf-profile` never appears (15 s). The failure snapshot shows the **Verify your email** screen with no status or error text. On the base commit the same test failed one step later (the click on the profile terms checkbox never completed within the 30 s test timeout).

### Reproduction

| Run | Head | Command | Result |
|---|---|---|---|
| A | branch `5af29f4` | gate1.sh (3 runs, earlier session) | 2 of 3 e2e steps failed on this test (the third run failed earlier in the callable step on an unrelated 5 s Jest timeout under load) |
| B | base `3560936` built in place | Gate 1's exact 7-spec command | failed, same test |
| C | branch `5af29f4` | Gate 1's exact 7-spec command with `--trace on` | failed, same test — trace captured |
| D | complete 17-spec suite on the branch | `npm run test:e2e` | passed twice (61/61) |

One traced run was invalid and is not counted: the container had just restarted (uptime 4 min) and the Functions emulator's own loader timed out at 10 s; every spec that needed a callable failed. That is emulator cold start, unrelated to the join flow.

### Trace timeline (run C)

| t | What |
|---|---|
| 4.28 s | test clicks `wsf-signup-submit`; browser sends `accounts:signUp` (47 ms), `accounts:update` (displayName) |
| 4.40 s | **`wsf-verify` already visible** — the auth listener fired on account creation, and signup's "already signed in" effect did `router.replace('/verify-email')` |
| 4.41 s | signup's `onSubmit` is still awaiting `wsfSendVerificationEmail` (best effort; the emulator has no mail key so it answers 400) |
| 4.46 s | test marks the email verified via the emulator REST API |
| 4.50 s | test clicks `wsf-verify-check`; browser sends `accounts:lookup` (reload), `securetoken` (forced token refresh), Firestore `Listen` (profile lookup) — all answered by 5.5 s, so the handler ran to completion and called `router.replace('/profile-setup')` |
| 5.79 s | `wsfSendVerificationEmail` finally answers (1,388 ms round trip under two parallel workers); `onSubmit` resumes and executes its trailing **`router.replace('/verify-email')`**, navigating the member away from profile-setup |
| 19.54 s | `wsf-profile` assertion times out on the Verify screen |

### Root cause

`apps/westayfit/app/signup.tsx` navigates to `/verify-email` **twice**: once from its signed-in short-circuit effect as soon as `onAuthStateChanged` reports the new (unverified) user, and once at the end of `onSubmit` after the best-effort verification-email callable returns. When that callable is slow (cold function, parallel workers) the second navigation lands after the member has already left `/verify-email`, and pulls them back. Whether the test sees "stuck on verify" or "profile click never completes" depends only on where the member was when the late replace fired.

Classification: **a pre-existing product race in the signup screen** (present on the base commit, in files this PR does not touch), surfaced by the test harness because a test can "verify" an address within a second of signing up while a person cannot. It is not an emulator bug and not a failure of anything this PR changed.

### What was changed overnight (harness only)

In the four specs that drive signup → verify (`e2-join-flow`, `e35-auth-polish`, `e35-home` ×4 sites, `mu2-flow`), the test now registers `page.waitForResponse` for `wsfSendVerificationEmail` **before** tapping Sign up and awaits it after the Verify screen is visible, before marking the email verified. This models the real ordering (nobody verifies an address before the send attempt has even finished). No assertion was weakened, nothing skipped, no product file touched.

Regression evidence after the change (branch, same sandbox, same command as gate1.sh's browser step): three consecutive runs, 31/31 passed each (58.4 s, 54.9 s, 57.5 s). Full `gate1.sh` result is recorded in `00-OVERNIGHT-INDEX.md` under Task 1.

### Product defect NOT fixed overnight (out of authority) and narrow future plan

Fixing the race properly means changing `signup.tsx`, an authentication screen outside this PR's product scope. Not done overnight. Narrow correction for a separately reviewed change:

1. In `onSubmit`, drop the trailing `router.replace('/verify-email')` entirely — the signed-in effect already performs that navigation the moment the account exists, and `/verify-email` itself has the Resend button for the failed-send case; **or**
2. keep the trailing replace but guard it with a `navigated` ref set by the effect, so the second replace becomes a no-op.

Either option is one file, no contract change, and the existing mu2/e2/e35 specs (with the harness wait removed again) would prove it. Practical user impact today is small: a member would have to leave `/verify-email` within roughly the send round-trip (about a second) to be pulled back once.
