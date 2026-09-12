# WSF E4-A1-R1 — Checkpoint 3 (Evidence Report)

*Local emulator verification of the R1 correction package. No push, no PR,
no deploy, no live data.*

## Result

R1 acceptance surface is green on the local emulator, verified through the
Expo dev server (Metro) — the static Hosting export path was not used, so
`firebase.westayfit.json` and `firebase.westayfit.emulators.json` sit at
zero diff vs baseline.

- Two-browser-context E2E — **1 passed in 31.8s**, 0 retries needed, exit 0
  (`apps/westayfit/tests-e2e/e4-a1-shared-goal.spec.ts`).
- App type-check + vitest — exit 0, 30 / 30 tests pass (from the prior R1
  pass; no `apps/westayfit/src/` file has changed since).
- Functions callable jest — 107 / 111 pass; the 4 failures are pre-existing
  in `wsfSendPasswordResetEmail` (E3.5 baseline, not R1). Per Devin's
  dispatch the full-suite result is classified **FAILED** for R1 review.
  All R1-scope callables (`wsfContribute`, `wsfGoalPulse`, `wsfAdjustGoal`,
  `wsfCreateGoal`) pass.

## Baseline and worktree

| Item | Value |
|---|---|
| Repo | `github.com/idevinsimpson/goarrive` |
| Worktree | `/home/ben/dev-goarrive-wsf-e4a1` (isolated, not pushed) |
| Branch | `feat/wsf-e4a1` — no upstream, no PR |
| Cut from | `feat/wsf-e35-phone-fixes` @ `2f0a9dc101f1583995591d82f4fcba3dda6b2041` |
| Branch HEAD | `2f0a9dc101f1583995591d82f4fcba3dda6b2041` (uncommitted working tree — no commits yet) |
| GoArrive `main` (informational) | `4ccd1978248b445b0f010b5250f97325942bc79d` (untouched) |

## Environment (verified)

| Component | Version | Notes |
|---|---|---|
| Node (test runtime) | v22.22.2 | `/home/ben/.nvm/versions/node/v22.22.2/bin/node` |
| Node (deploy runtime, per engines) | 20 | `functions-westayfit/package.json` |
| Java (Firestore emulator) | Temurin 21.0.12.1 LTS | `/home/ben/.local/jdk/jdk-21.0.12.1+1` |
| `firebase-tools` | 15.13.0 | On `PATH` via Node 22.22.2 |
| Emulator config | `firebase.westayfit.emulators.json` (unchanged) | ui disabled, singleProjectMode |
| Emulator project | `goarrive` (E2E) / `goarrive-test` (callable jest) | see "Emulator project" note below |
| Emulator surface | `firestore + auth + functions` (no hosting) | R1 E2E does not exercise hosting rewrites |
| Web served by | Expo dev server (Metro) on 127.0.0.1:8081 | `npx expo start --web --port 8081 --host localhost` |

Emulator port table (from `firebase.westayfit.emulators.json`, unmodified):

| Service | Host | Port |
|---|---|---|
| Auth | 127.0.0.1 | 9099 |
| Firestore | 127.0.0.1 | 8080 |
| Functions | 127.0.0.1 | 5001 |
| Hosting | 127.0.0.1 | 5010 (not started by this run) |

### Emulator project — why `goarrive`, not `goarrive-test`

The dispatch asked for `--project goarrive-test`. I verified via a probe
that the Functions emulator only serves callables at URLs prefixed with
its own `--project` label (probe: `--project goarrive-test` + client call
to `/goarrive/us-central1/wsfGoalPulse` → HTTP 404; call to
`/goarrive-test/us-central1/wsfGoalPulse` → 200). The WSF web client is
baked with `projectId: 'goarrive'` in `apps/westayfit/src/firebase.ts:17`
— a pre-existing baseline file that the dispatch prohibits editing
("do not modify … any other shared config/script"). The only two combos
that let the client reach a callable are:

1. Emulator `--project goarrive` (this run).
2. Editing `apps/westayfit/src/firebase.ts` — explicitly out of scope.

Firestore/Auth emulators accept both projectIds in the URL under
`singleProjectMode: true` (namespaced separately). The Functions emulator
is the strict one. Flagged for review.

## Verification path — Expo dev server, not the static Hosting export

E4-A1 introduces two new dynamic routes: `/contribute/[goalId]` and
`/display/[goalId]`. Serving these via `firebase serve` from the built
`apps/westayfit/dist/` would need two additional entries in
`firebase.westayfit.{json,emulators.json}`
(`/contribute/**` → `/contribute/__dynamic.html`, `/display/**` →
`/display/__dynamic.html`) — `scripts/westayfit/inject_meta.py` enforces
that lockstep and fails the export otherwise. Per Devin's R1 dispatch
those hosting-config edits were pulled back so both files sit at
**zero diff vs `2f0a9dc`**, and E4-A1 is verified against the Expo dev
server (Metro), which serves the two dynamic routes natively. No
`scripts/` or shared-config file was touched.

## Commands run (chronological, with exit codes and timestamps)

All commands ran inside `/home/ben/dev-goarrive-wsf-e4a1`. The long-running
step ran under `systemd-run --user --unit=wsf-e4a1-devserver-e2e --collect`
so a turn timeout could not orphan it.

### 1. Restore `firebase.westayfit.{json,emulators.json}` to baseline

Two narrow `Edit`s — no `git checkout`, no `git reset`, no `sed`. Removed
the `/contribute/**` and `/display/**` rewrites and the trailing comma on
the `/join/**` line.

```
$ git diff --stat 2f0a9dc -- firebase.westayfit.json firebase.westayfit.emulators.json
    (empty — zero diff)
```

### 2. Detached emulator + Expo dev server + Playwright — `wsf-e4a1-devserver-e2e.service`

Command:

```
systemd-run --user --unit=wsf-e4a1-devserver-e2e --collect \
  --working-directory=/home/ben/dev-goarrive-wsf-e4a1 \
  --setenv=PATH=…/jdk-21.0.12.1+1/bin:…/node/v22.22.2/bin:… \
  --setenv=JAVA_HOME=/home/ben/.local/jdk/jdk-21.0.12.1+1 \
  --setenv=NODE_OPTIONS=--max-old-space-size=4096 \
  -- bash -c "firebase emulators:exec \
    --only firestore,auth,functions \
    --config firebase.westayfit.emulators.json \
    --project goarrive \
    'bash /tmp/wsf-e4a1-devserver-run.sh'"
```

Inner runner `/tmp/wsf-e4a1-devserver-run.sh`:

- launches `npx --yes expo start --web --port 8081 --host localhost` in
  background with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1
  EXPO_PUBLIC_WSF_USE_EMULATORS=1`
- polls `curl -sf http://127.0.0.1:8081/` until it answers
- runs `WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 npx playwright test
  --config=playwright.config.ts tests-e2e/e4-a1-shared-goal.spec.ts`
- traps EXIT/INT/TERM to kill the Expo dev server

Timing (UTC):

| Phase | Start | End | Exit |
|---|---|---|---|
| systemd unit begin | 2026-09-12T08:52:31Z | | |
| emulators up (firestore + auth + functions loaded) | | 2026-09-12T08:52:54Z | |
| Expo dev server ready on 127.0.0.1:8081 | 2026-09-12T08:52:54Z | 2026-09-12T08:52:59Z | 5 s |
| dev server dynamic-route probes (`/contribute/e4a1-probe`, `/display/e4a1-probe`, `/signin` — all 200, HTML) | | 2026-09-12T08:53:29Z | 0 |
| Playwright test run | 2026-09-12T08:53:30Z | 2026-09-12T08:54:03Z | 0 |
| systemd unit end | | 2026-09-12T08:54:06Z | 0 |

Playwright output (from `/tmp/wsf-e4a1-devserver-e2e.log`):

```
Running 1 test using 1 worker

  ✓  1 [chromium] › tests-e2e/e4-a1-shared-goal.spec.ts:200:5
    › member A + member B contribute in independent browser contexts;
    unauthed display sums both (30.5s)

  1 passed (31.8s)
playwright exit 0
```

Exit-file (`/tmp/wsf-e4a1-devserver-e2e.exit`): `0`.

## Two-browser-context screenshots (dev-server run)

All six were re-captured by this dev-server Playwright run:

```
apps/westayfit/tests-e2e/artifacts/e4-a1-shared-goal/
  01-A-contribute-empty.png              25,025 B  2026-09-12T08:53Z
  02-A-after-20.png                      33,353 B  2026-09-12T08:53Z
  03-B-sees-shared-20-own-0.png          25,770 B  2026-09-12T08:54Z
  04-B-after-15.png                      34,130 B  2026-09-12T08:54Z
  05-A-reload-shared-35.png              25,744 B  2026-09-12T08:54Z
  06-C-display-shows-35.png              23,086 B  2026-09-12T08:54Z
```

Test flow (assertions in `tests-e2e/e4-a1-shared-goal.spec.ts`):

1. `pageA` signs in as member A, opens `/contribute/{goalId}` — empty state.
2. `pageA` submits `20` — receipt confirms own credit `20`, shared `20`.
3. `pageB` signs in as member B in an independent browser context, opens
   the same `/contribute/{goalId}` — sees shared `20`, own credit `0`.
4. `pageB` submits `15` — receipt confirms own credit `15`, shared `35`.
5. `pageA` reloads — shared re-renders to `35`.
6. `pageC`, unauthenticated, opens `/display/{goalId}` — shared reads `35`,
   percent shows `0%` (target 5000, `barPercent` floor invariant).

Steps 3 and 5 depend on the R1 correction: a second `useEffect` in
`app/contribute/[goalId].tsx` gated on `state.kind ∈ {'ready', 'closed'}`
polls `wsfGoalPulse` every `POLL_INTERVAL_MS = 2_000` and merges `pulse`
while preserving `state.ownCredit`. The poll interval matches
`GOAL_PULSE_CACHE_TTL_MS` in `functions-westayfit/src/index.ts`.

## Files changed vs baseline `2f0a9dc`

Modified (1):

```
functions-westayfit/src/index.ts  | 809 ++++++++++++++++++++++++++++-
1 file changed, 809 insertions(+), 1 deletion(-)
```

Untracked (deliverable) files:

```
apps/westayfit/app/contribute/[goalId].tsx
apps/westayfit/app/display/[goalId].tsx
apps/westayfit/app/goals/new.tsx
apps/westayfit/src/goalPercent.ts
apps/westayfit/tests/goal-percent-floor.test.ts
apps/westayfit/tests-e2e/e4-a1-shared-goal.spec.ts
functions-westayfit/tests/callable/wsf-adjust-goal.test.ts
functions-westayfit/tests/callable/wsf-contribute.test.ts
functions-westayfit/tests/callable/wsf-goal-pulse.test.ts
docs/westayfit/E4-A1-notes.md
docs/westayfit/E4-A1-checkpoint-3.md   (this file)
```

Screenshot artifacts (`apps/westayfit/tests-e2e/artifacts/e4-a1-shared-goal/*.png`)
are captured on disk but are excluded from the deliverable patch (attached
separately). No commits have been made on `feat/wsf-e4a1`.

Verified **unchanged** from baseline (zero diff vs `2f0a9dc`):

- `firebase.westayfit.json`
- `firebase.westayfit.emulators.json`
- `scripts/westayfit/inject_meta.py`
- `firestore.rules`
- `firestore.indexes.json`
- `apps/westayfit/expo-env.d.ts` (Expo dev server rewrote this on start;
  restored via `git checkout` before packaging)
- `apps/westayfit/.gitignore` (Expo dev server generated a fresh file;
  deleted before packaging — was not tracked in baseline)

## Result classification (per Devin's dispatch)

| Surface | Classification | Detail |
|---|---|---|
| E4-A1 two-browser-context E2E via Expo dev server | **PASS** | 1/1 passed in 31.8s, exit 0 |
| App type-check (`apps/westayfit` tsc) | **PASS** | 30/30 vitest tests, no tsc errors on R1 files (last recorded run in this worktree) |
| Functions callable jest — R1 scope only (`wsf-contribute`, `wsf-goal-pulse`, `wsf-adjust-goal`, `wsf-create-goal`) | **PASS** | 100% of R1 callable tests |
| Functions callable jest — **full suite** (13 files) | **FAILED** | 107/111; 4 failures in `wsf-send-password-reset-email` (pre-existing E3.5 baseline; not R1) |
| `firestore.rules` test suite | **BLOCKED** | rules-test harness known-broken on this baseline (duplicate firebase instance + Node 20-vs-22 suspects); R1 introduces no rules changes; follow-up in next cycle |
| Full Playwright suite (E3.5 surface) | **NOT RUN** | Only `tests-e2e/e4-a1-shared-goal.spec.ts` invoked, per R1 scope |
| GoArrive-side regressions | **NOT RUN** | No GoArrive code was touched — `firestore.rules`, `functions/`, and `apps/` outside `apps/westayfit/` are byte-identical to baseline |
| Deploys | **NOT RUN** | No deploy command was invoked — nothing left the worktree |

## Halt

Per Devin's dispatch: "Execute now and stop after the artifacts are posted
for review." Stopping here. No commit, push, deploy, tunnel, new
dependencies, new branches, or shared-config/script edits.
