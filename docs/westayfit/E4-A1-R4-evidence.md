# E4-A1-R4 — evidence note (PM implementation, branch `feat/wsf-e4a1-pm`)

*Written by the PM (Claude Code) on 2026-09-12 after Devin paused Maia and said
"Do what you recommend". Local emulator verification only. No PR, no merge, no
deploy, no live data, no physical-device claim.*

## Lineage

| Commit | Content |
|---|---|
| `2f0a9dc` | E3.5 baseline (`feat/wsf-e35-phone-fixes`, GATE 1 GREEN, on staging since 2026-09-06) |
| `c4d8354` | Maia's E4-A1-R1 patch applied verbatim (uploaded to Slack 06:56 EDT; SHA-256 `6259369a9d3de5e7b4df9a32c437d5b685e7c01a921f37b769499f5cdb9b2438` re-verified before apply; clean apply; allowlist pass) |
| `ab28bf9` | R4 corrections on the eight approved files (see the commit message) |
| `4795091` | Lockstep project id for GATE 1: `scripts/westayfit/gate1.sh` two `--project` flags and `PROJECT_ID` in the five baseline browser specs (option (a) of the PM channel note; separable) |

Files outside `apps/westayfit`, `functions-westayfit`, `docs/westayfit` and
`scripts/westayfit/gate1.sh` are byte-identical to `2f0a9dc`. No
`firestore.rules`, `firestore.indexes.json`, `firebase*.json`, package or
lockfile change. No new dependency.

## Environment (this run)

- Claude Code remote container, Node 20.20.x (`/opt/node20`), Temurin JDK present,
  firebase-tools 15.13.0 installed in a scratch directory (not in the repo),
  Firestore emulator jar v1.20.4, pre-installed Chromium 1194 via
  `WSF_PLAYWRIGHT_CHROMIUM` (the repo's Playwright 1.59 wants headless-shell
  1234, which is not downloadable here).
- Emulator project id for every run: `goarrive-test`. Expo dev server run with
  `EXPO_OFFLINE=1 EXPO_NO_DEPENDENCY_VALIDATION=1` because the sandbox proxy
  returns a non-JSON 403 for `api.expo.dev` (a CLI doctor lookup, not app code).
- `JAVA_TOOL_OPTIONS` cleared for the emulator processes.

## Observed gates (commands, exits, counts as printed by the runners)

| Gate | Command | Result |
|---|---|---|
| functions typecheck | `cd functions-westayfit && npx tsc --noEmit` | exit 0 |
| app typecheck | `cd apps/westayfit && npx tsc --noEmit` | exit 0 |
| app Vitest (full) | `cd apps/westayfit && npx vitest run` | 7 files passed, 39 tests passed, runner exit 0 (`PIPESTATUS[0]`) |
| full callable Jest, BOTH emulators | `firebase emulators:exec --only firestore,auth --config firebase.westayfit.emulators.json --project goarrive-test "cd functions-westayfit && npm run test:callable -- --testTimeout=60000"` | Test Suites: 14 passed, 14 total; Tests: 121 passed, 121 total; `JEST_EXIT=0`; `emulators:exec` exit 0 |
| E4-A1 browser spec, dev-server path | `firebase emulators:exec --only firestore,auth,functions --config firebase.westayfit.emulators.json --project goarrive-test <runner>` where the runner starts `npx expo start --web --port 8081 --host localhost` with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`, pre-warms the bundle, then `npx playwright test tests-e2e/e4-a1-shared-goal.spec.ts` | PLAYWRIGHT START 2026-09-12T21:19:54Z → PLAYWRIGHT END 2026-09-12T21:20:20Z exit=0; `1 passed (24.9s)`; `PW_EXIT=0`; `emulators:exec` exit 0 |
| GATE 1 (`scripts/westayfit/gate1.sh` under the lockstep commit) | see the section below | see the section below |

Callable count reconciliation: 111 (R1 suite as uploaded) + 7 (`wsf-my-contribution`)
+ 3 (R4 cases in `wsf-contribute`) = 121. The `wsf-send-password-reset-email`
suite passes with the Auth emulator listening; the earlier "pre-existing
baseline noise" label for its four failures is disproven by this run.

## Browser evidence (`apps/westayfit/tests-e2e/artifacts/e4-a1-shared-goal/`)

| File | Asserted in the spec | PM eyeballed |
|---|---|---|
| 01-A-contribute-empty.png | A signed in, contribute screen visible | — |
| 02-A-after-20.png | own credit 20, shared ≥ 20 | — |
| 03-B-sees-shared-20-own-0.png | independent context B: own 0, shared 20 | — |
| 04-B-after-15.png | B own 15, shared 35 | — |
| 05-A-reload-shared-35.png | A after reload: shared 35 AND own credit 20 (R4) | yes: "Your confirmed credit: 20 squats" |
| 06-C-display-shows-35.png | unauthenticated display: 35, 0 %, no individual credit anywhere on the page | — |
| 07-A-closed-own-20.png | after a seeded `status: closed`: "This goal is closed" and own credit still 20 | yes |
| 08-A-corrected-own-15.png | after a seeded member-total correction to 15: own credit 15 | yes |

Also asserted, no screenshot: an anonymous POST to
`/goarrive-test/us-central1/wsfMyContribution` returns HTTP 401 with
`error.status = UNAUTHENTICATED`.

## Classification

- E4-A1 two-context E2E on `goarrive-test` — **PASS**
- App Vitest (full) — **PASS**
- Full callable Jest (both emulators, `goarrive-test`) — **PASS** (121/121)
- Typecheck ×2 — **PASS**
- GATE 1 under the lockstep commit — see below
- `firestore.rules` test suite — **NOT RUN** (harness known-broken on this baseline; R4 changes no rules; the new collections stay Admin-SDK-only under default deny)
- GoArrive-side regressions — **NOT RUN** (no GoArrive code touched)
- Deploys — **NOT RUN**; physical-device behaviour — **NOT VERIFIED**
- Live collection state — **NOT VERIFIED** (no production read authorized or needed; the callables have never been deployed; migration is a no-op by lineage)

## Follow-on proposals (not in this branch; each is a separate approval)

1. **Typed-routes latent defect in E3.5 code (found by this run).** `app/signin.tsx:111`
   passes the `string` returned by `nextRouteAfterAuth('/')` to `router.replace`, which
   fails `tsc --noEmit` once Expo has generated `.expo/types/router.d.ts` (any
   `expo start` or `expo export` does that; the directory is gitignored, so a fresh
   checkout passes and a used worktree fails). The file is untouched by R1/R4 and was
   last changed in `21ad7e1` (E3.5 C5). One-line fix candidates: type
   `nextRouteAfterAuth`'s return as `Href`, or cast at the call site. GATE 1 in this
   branch was therefore run from a fresh generated-types state (see below), which is
   the same condition the baseline gate has always relied on.
2. **Harness scripts belong in the repo.** The dev-server browser runner used here
   lives in the PM scratchpad (Maia's equivalent lived in `/tmp`). A
   `scripts/westayfit/e2e-devserver.sh` would make the goal-route browser evidence
   reproducible by anyone; until the Hosting rewrites for `/contribute/**` and
   `/display/**` are approved, the dev server is the only local path that serves the
   new dynamic routes.
3. **Goal closure has no setter.** No callable writes `status: 'closed'` or `closedAt`;
   closure is reachable only by the window (`endsAt`, server time) for contributions
   and by a seeded write in tests. A `wsfCloseGoal` (foundingChampion, immutable
   audit row) is needed before LIVE.
4. **Hosting rewrites for the two new routes** (`/contribute/** -> /contribute/__dynamic.html`,
   `/display/** -> /display/__dynamic.html`) in `firebase.westayfit.json` and its
   emulator mirror are required before a deploy candidate; `inject_meta.py` enforces
   this at build time. Same pattern as `/join/**` and `/community/**`.
5. **LIVE hardening notes carried from the PM review:** the public pulse has no rate
   limit or App Check (same profile as `wsfChallengePulse`); `wsfAdjustGoal` does not
   check that `targetUid` is a member and can create a totals row for a non-contributor;
   the contribute page and the display each poll every 2 s, so per-goal callable load is
   (phones + displays) × 0.5 req/s — consider visibility-gated polling and a longer
   phone interval before the expo.

## GATE 1 under the lockstep commit
