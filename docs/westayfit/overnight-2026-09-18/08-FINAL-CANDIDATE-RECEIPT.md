# Task 8/8 — Final candidate receipt (overnight 2026-09-18)

## 1. Identity

| Item | Value |
|---|---|
| PR | [idevinsimpson/goarrive#327](https://github.com/idevinsimpson/goarrive/pull/327) — **open, DRAFT**, not marked ready, not merged |
| Branch | `claude/wsf-ui-member-experience` |
| **Final head** | `96d0380539bfd16667ad0d17a253774458533dc5` (code); the docs-only commits carrying this receipt are the branch tip after it |
| Base | `claude/wsf-package-e-display-auth` @ `3560936b37900591d41240adf98ea82b1b8f0c72` (unchanged) |
| Head at overnight handoff | `5af29f48df73745e500f99cfbf26a64e8d0cd085` |
| Overnight commits | 19 (this receipt's commit included) on top of the handoff head |
| Nothing merged, deployed, or changed on `main`, `approved-candidate.json`, IAM/WIF, Firestore rules/indexes, `.github`, the staging workflow, or production | **confirmed** (see §3) |

## 2. Changed paths vs base (grouped)

79 files changed vs base (+14604 / −1136):

| Category | Files |
|---|---|
| Product UI / routes (3) | `index.tsx`, `[goalId].tsx`, `[goalId].tsx` |
| Shared UI / helpers (12) | `contributionFlow.ts`, `displayPulse.ts`, `goalPercent.ts`, `ButtonLink.tsx`, `LivingWeProgress.tsx`, `WsfWordmark.tsx`, `brandAssets.ts`, `dates.ts`, `displayTypeScale.ts`, `livingWeCalibration.ts`, `progressFormat.ts`, `useReducedMotion.ts` |
| Brand assets (14) | `README.md`, `MANIFEST.json`, `living-we-calibration.json`, `monogram-fill-green.png`, `monogram-silhouette.png`, `monogram-unfilled-navy.png`, `monogram-unfilled-white.png`, `wordmark-navy-green.png`, `wordmark-white-green.png`, `SHA256SUMS.json`, `monogram-navy-green.original.png`, `monogram-white-green.original.png`, `wordmark-navy-green.original.png`, `wordmark-white-green.original.png` |
| Brand tooling (1) | `derive-brand-assets.py` |
| App unit tests (8) | `brand-assets-provenance.test.ts`, `contribution-flow.test.ts`, `dates-timezone.test.ts`, `display-pulse.test.ts`, `display-type-scale.test.ts`, `goal-percent-floor.test.ts`, `living-we-calibration.test.ts`, `progress-format.test.ts` |
| App browser specs (23) | 23 files |
| Backend contract / hardening (1) | `index.ts` |
| Backend tests (3) | `wsf-contribute.test.ts`, `wsf-goal-pulse.test.ts`, `wsf-overnight-privacy-audit.test.ts` |
| Backend test config (1) | `jest.callable.config.cjs` |
| Overnight docs + boards (12) | `00-OVERNIGHT-INDEX.md`, `01-BASELINE-AND-GATE1.md`, `02-SECURITY-PRIVACY-AUDIT.md`, `03-CONTRIBUTION-RESILIENCE.md`, `04-DISPLAY-AUTH-RESILIENCE.md`, `05-ACCESSIBILITY-RESPONSIVE-QA.md`, `06-PERFORMANCE-OPERATIONS.md`, `07-CROSS-SURFACE-QUALITY.md`, `08-FINAL-CANDIDATE-RECEIPT.md`, `OVERNIGHT-VISUAL-BOARD-WIDE.png`, `OVERNIGHT-VISUAL-BOARD.png`, `hosted-harness-compat-delta.md` |
| Other (1) | `.gitignore` |

Verified absent from the diff: `apps/goarrive/**`, `functions/**` (non-WSF), `firestore.rules`, `firestore.indexes.json`, `.github/**`, the staging workflow, IAM/WIF, `approved-candidate.json`, `firebase.json`/`.firebaserc`, production configuration. The only file outside `apps/westayfit`, `functions-westayfit`, `scripts/westayfit/brand` and the overnight docs folder is `.gitignore` (one line: the app's `node_modules` symlink path). `git ls-files` carries no `node_modules` entry and no regenerated screenshot folder.

## 3. Complete battery on the final head (from a clean state)

| Suite | Result |
|---|---|
| App TypeScript (`tsc --noEmit`) | clean |
| App Vitest | 233 passed / 16 files |
| Complete emulator browser suite (33 specs) | 122 passed / 0 failed (5.1 min) |
| Functions build (`tsc`) | clean |
| Callable suite (Firestore + Auth emulators) | 238 passed / 18 files |
| Firestore rules suite | 22 passed |
| Deploy-config suite | 8 passed |
| `scripts/westayfit/gate1.sh` (unit + types + builds + callable + 7-spec browser step) | **GATE 1 CLEAR** — Vitest 233, callable 238, browser step 31/31 |

First pass of the battery on `bafef52` found one real defect (below, D-31) through the e4-a1 console-error assertion; it was fixed in `96d0380` and the browser suite and gate1 were re-run on the final head. The first pass also saw one 30 s timeout in the community goal seam spec under the 33-spec parallel load; it passed in the re-run of the complete suite and in every per-spec run overnight, and is recorded here rather than hidden.

## 4. Defects discovered overnight (31), by outcome

**Fixed on the branch (with tests):** D-2 empty community reference answered `internal`; D-3 malformed display URL polled for ever; D-4 malformed contribution link showed the server message; D-6 contribute poll kept a total after membership loss; D-8 contribute poll ordering; D-11 double tap rendered a first success as "already recorded"; D-12 unresolved attempt unreachable after membership loss; D-13 replay used a frozen before-total; D-14 context check compared the goal with itself; D-7/D-7b Champion notices hidden by a failed reload; D-15 landed revoke on a closed goal reported as unknown; D-16 sample-community card over-claimed; D-17 "Open · Ends <past date>"; D-18 Check again gave no feedback; D-19 no headings; D-20 status messages not announced; D-21 unnamed dialog; D-22 six targets under 44 px; D-23 placeholder contrast; D-24 display clipping at maximum names; D-25 enterKeyHint; D-26 duplicate accessible names; D-27 h1 overflow at 195 px + display generic h1; D-28 raw SDK error text to members; D-29 six cross-surface inconsistencies (reached signal, near-goal emphasis, closed percent, freshness line, post-target subline, phone chrome flip); D-30 periods without the year; **D-31** display hydration mismatch (React #418) on wide clients — the static export carries the phone loading tree; the wide layout is now chosen only after hydration.

**Not fixed — owner boundary:** **D-5** `firestore.rules` `wsfIsGroupMember` is existence-only: a removed or departed member (row kept, status changed) can read `wsfCommunityGroups/{groupId}` directly via the SDK, including the live and every rotated `joinCode`. Pre-existing; rules are outside overnight authority. Proposed one-helper fix and a rules test are in `02-SECURITY-PRIVACY-AUDIT.md`.

**Not fixed — pre-existing product, out of PR scope:** **D-1** `signup.tsx` navigates to `/verify-email` twice; the late replace after a slow verification-email round trip can pull a member back from profile-setup. Harness made deterministic; one-file plan in `01-BASELINE-AND-GATE1.md`.

**Not fixed — copy / product decisions, recorded:** D-9 quarantined legacy pending row never surfaced (needs a non-attributing sentence); closure while on Review drops the typed number without a sentence; the reminder's durability sentence is untrue when storage is unavailable; contribution routes stay offered on an ended window (the server refuses truthfully); the "Past goals" heading could read as complete; per-route page titles (expo-router disables document titles on web; needs a dependency).

**Accepted, recorded:** D-10 one extra read on refusal for an existing goal (no enumerable id space); the Living WE fill on navy at 1.90:1 (approved colourway, text carries the meaning); the server-side `wsfSetGoalDisplayAuthorization` ignoring `isSample` (client qualifier states the truth; functions untouched beyond the cache edits); TTL/poll alignment; phone-oversized brand PNGs; post-hydration image load; token/typography drift.

**Audit items reverted after measurement (Task 6):** a display poll in-flight guard (overlapping polls let a refusal overtake a held response) and a single `wsfListGoals` per read-back (would make the D-7 covenant test unreachable).

## 5. Privacy / publication contract (unchanged overnight)

`wsfGoalPulse` returns, for an active member of the goal's community or for anyone when the goal carries `aggregateDisplayAuthorized === true` and the community exists and is not a sample, exactly: `sharedTotal, target, unit, status, communityDisplayName, goalTitle, startsAt, endsAt, timezone`. Everyone else receives one generic `not-found`, byte-identical for unknown, unauthorized, revoked, removed and sample. Access is decided before the 2 s per-goal cache. Not published: member names, photos, member/contributor counts, individual contributions, own credit, contact details, locations, group type, join policy, join code, Champion/creator identity, organization data, invitation capabilities. Pinned by the exact-key callable tests and the display's no-leak browser assertions; hardened overnight by the 33-case adversarial suite.

## 6. Remaining intentional product gaps (kept, not built, confirmed un-claimed by any copy)

Authoritative one-time target-crossing event · repeat policy · guided activity instructions · calibrated Living WE motion · recent privacy-safe public additions on the display · complete durable community history.

## 7. Hosted-harness compatibility delta

`hosted-harness-compat-delta.md` in this folder (sections A–I). Plan only, not applied to `main`. Ops PR scope: `.github/wsf-staging/hosted-package-e-smoke.mjs` compatibility (Manage sheet before the authorization controls, contribution copy, exact-key public pulse assertion, display context after authorization and absence after refusal, period pinned in the fixture's zone), the `approved-candidate.json` SHA/metadata, workflow contract pins. No product source. Section I re-checks all 23 selectors the `main` harness uses against the overnight head: all preserved.

## 8. Exact next recommended ops steps (none taken overnight)

1. Devin reviews `OVERNIGHT-VISUAL-BOARD.png` / `-WIDE.png` and the eight task docs; whole-product verdict on the draft.
2. Owner decision on D-5 (Firestore rule `wsfIsGroupMember` → status-aware) — a separate, reviewed rules change with the rules test from `02-SECURITY-PRIVACY-AUDIT.md`.
3. Owner decisions on the recorded copy items (§4) and on D-1's one-file signup correction.
4. If accepted: mark PR #327 ready, merge into the Package E branch per the repository's convention; then the ops PR on `main` per §7 (harness compat + `approved-candidate.json` pointing at the merged SHA + workflow pins), then the staging deploy through the existing workflow. None of these were started.

## 9. Confirmation

Nothing was merged or deployed. `main`, `approved-candidate.json`, IAM/WIF, Firestore rules and indexes, `.github`, the staging workflow and production configuration are untouched. No secrets were written to chat or Git. No periodic check-ins were created. PR #327 remains a draft.
