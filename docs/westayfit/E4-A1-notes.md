# WSF E4-A1 — Local Emulator Slice

*Smallest testable phone → own receipt → independent-session shared-total slice.*

## What this ships

Three new callables (parallel to E3's `wsfCheckIn` / `wsfChallengePulse`) that
turn shared totals from a *unique members × moves* count into a *sum of
per-attempt quantities*:

- `wsfCreateGoal({title, target, unit})` — auth + email-verified. Creates a
  new `wsfGoals/{goalId}` and returns its id.
- `wsfContribute({goalId, attemptId, count})` — auth only. Idempotent by
  `(goalId, attemptId)`. Concurrency-safe via 10-way sharded counter +
  per-member totals doc. Rejects contributions to a non-active goal AFTER
  the idempotency check so a legitimate replay never surfaces as "closed".
- `wsfGoalPulse({goalId})` — public. Cache-first (2s TTL). Returns
  `{sharedTotal, target, unit, status, contributorCount}`.

Three new phone / display routes:

- `apps/westayfit/app/contribute/[goalId].tsx` — sign-in required, one
  number input, "Log it" button, own-credit + shared-total receipt. Once
  the initial load lands (`ready`/`closed`), polls `wsfGoalPulse` every
  2s so a peer's contribution surfaces without a manual refresh. The
  poll interval matches the server-side 2s cache TTL — a shorter poll
  pays a Firestore round-trip on every tick; a longer poll wastes the
  cache window.
- `apps/westayfit/app/display/[goalId].tsx` — public, polls `wsfGoalPulse`
  every 2s, big-number layout for a shared screen.
- `apps/westayfit/app/goals/new.tsx` — auth-gated form that mints a goal
  and deep-links into both routes above. This is the seam that makes the
  slice runnable end to end on a laptop without any live data.

## Firestore layout (Admin-SDK only)

All new collections are default-deny — the existing catch-all in
`firestore.rules` covers them without a rules edit (same pattern as E3
§5.9):

- `wsfGoals/{goalId}` — `{ownerUid, title, target, unit, status, createdAt}`
- `wsfContributions/{goalId}_{userId}_{attemptId}` — `{goalId, attemptId, userId, count, shardIndex, unit, communityGroupId, createdAt}` (key scoped by the authenticated uid since E4-A1-R4: same member + same attemptId replays once; different members with the same attemptId each count once)
- `wsfGoalCounters/{goalId}/shards/{0..9}` — `{count}`
- `wsfGoalMemberTotals/{goalId}_{userId}` — `{goalId, userId, total, updatedAt}`

## Baseline

- Repo: `github.com/idevinsimpson/goarrive`
- Worktree: `/home/ben/dev-goarrive-wsf-e4a1` (isolated; not pushed)
- Branch: `feat/wsf-e4a1`, no upstream, no PR
- Cut from: `feat/wsf-e35-phone-fixes` @ `2f0a9dc101f1583995591d82f4fcba3dda6b2041`
- HEAD: `2f0a9dc101f1583995591d82f4fcba3dda6b2041` (working tree only; no commits yet)

## Changed files (allowlist)

Modified (1):

- `functions-westayfit/src/index.ts` — appends only; no callable rename or
  signature change to any E3.5 callable.

Added (10):

- `functions-westayfit/tests/callable/wsf-contribute.test.ts`
- `functions-westayfit/tests/callable/wsf-goal-pulse.test.ts`
- `functions-westayfit/tests/callable/wsf-adjust-goal.test.ts`
- `apps/westayfit/app/contribute/[goalId].tsx`
- `apps/westayfit/app/display/[goalId].tsx`
- `apps/westayfit/app/goals/new.tsx`
- `apps/westayfit/src/goalPercent.ts`
- `apps/westayfit/tests/goal-percent-floor.test.ts`
- `apps/westayfit/tests-e2e/e4-a1-shared-goal.spec.ts`
- `docs/westayfit/E4-A1-notes.md` (this file)

Untouched (verified — zero diff vs `2f0a9dc`):

- `firestore.rules`
- `firestore.indexes.json`
- `firebase.westayfit.json`
- `firebase.westayfit.emulators.json`
- `scripts/westayfit/inject_meta.py`
- `functions/` (GoArrive backend)
- Any `apps/` file outside `apps/westayfit/`

### Verification path — Expo dev server, not the static Hosting export

The static Hosting export path would need `/contribute/**` → `__dynamic.html`
and `/display/**` → `__dynamic.html` rewrites in `firebase.westayfit.json` +
its emulators mirror; `inject_meta.py` enforces that lockstep and fails the
web build otherwise. Per the R1 dispatch those hosting-config edits were
pulled back to zero-diff, so E4-A1 is verified by running Playwright
against the Expo/Metro dev server (`expo start --web`) instead. Metro
serves the two dynamic routes natively — no rewrite is needed at the dev
server layer, and no `scripts/` file was touched.

## How to run locally

Prereqs — same environment used for E3.5:

- Node 20 (`~/.nvm/versions/node/v20.20.2`) — declared by
  `functions-westayfit/package.json` `engines`
- Java 21 (`~/.local/jdk/jdk-21.0.12.1+1`) for the Firestore emulator
- `firebase-tools` 15+ on PATH

```
export PATH=/home/ben/.nvm/versions/node/v20.20.2/bin:$PATH
export JAVA_HOME=/home/ben/.local/jdk/jdk-21.0.12.1+1
export PATH=$JAVA_HOME/bin:$PATH
cd /home/ben/dev-goarrive-wsf-e4a1
```

### Focused callable tests

```
firebase emulators:exec \
  --only firestore,auth \
  --config firebase.westayfit.emulators.json \
  --project goarrive-test \
  "cd functions-westayfit && npm run test:callable -- \
     --testPathPatterns='wsf-(contribute|goal-pulse)' \
     --testTimeout=30000"
```

Last observed: **22 / 22 passed, exit 0, 13.3s**.

### Type checks

```
cd functions-westayfit && npx tsc --noEmit   # exit 0
cd ../apps/westayfit && npx tsc --noEmit     # exit 2 — SEE NOTE
```

The apps/westayfit tsc reports exactly one error, in
`playwright.config.ts`: `Cannot find module '@playwright/test'`. This is a
pre-existing baseline gap in this fresh worktree (`@playwright/test` is
declared in `package.json` but not installed here) and is unrelated to
E4-A1. All new files (`contribute/[goalId].tsx`, `display/[goalId].tsx`,
`goals/new.tsx`) typecheck clean.

## Acceptance proof coverage (from Devin's list)

Each acceptance proof is pinned by at least one test in
`tests/callable/wsf-contribute.test.ts`:

- **3700 + 20 = 3720** — `primeShardTotal(goalId, 3700)` then
  `wsfContribute({count: 20})` → `sharedTotal === 3720`.
- **concurrent +30 / +20 → shared +50, own credit isolated** —
  `Promise.all` on two `wsfContribute` calls from two distinct uids;
  asserts final shared delta and per-caller own credit.
- **double-submit counts once** — same `attemptId` retried; server returns
  original body with `alreadyRecorded: true` and the shared total is
  unchanged.
- **4999 / 5000 stays 4999** — assertion on the raw shared total, not on
  any percent derivation.
- **4980 + 35 = 5015** — overshoot preserved; the callable never clamps.
  UI clamps the progress bar, not the number.
- **closed goal rejects** — `failed-precondition`.
- **idempotent replay across close** — a contribution that already
  succeeded returns its original body even after the goal transitions to
  closed. Prevents "you did the reps, we say you didn't" during a race.
- **new-goal isolation** — two goals maintain independent counters.
- **unit isolation** — a goal with `unit: 'squats'` and one with
  `unit: 'push-ups'` never share the shared total.
- **same-user accumulation** — the same uid contributing twice with
  distinct attemptIds accumulates own credit correctly.

`wsf-goal-pulse.test.ts` covers the read side: unknown-goal → not-found,
fresh-goal zeros, shard-sum correctness, contributor count, cross-goal
isolation, closed-status echoed without throwing, and the 2s cache
correctly serves the previous snapshot when a shard write lands between
two rapid polls.

## Scope corrections applied 2026-09-11

Per Devin's dispatch, three items I initially reached for were pulled back
so the E4-A1 diff stays scoped to the acceptance proofs:

- **IP-based rate-limit on `wsfGoalPulse`** — removed. The 2s
  per-instance cache already bounds Firestore read cost; abuse-hardening
  is a follow-up review, not part of the acceptance surface.
- **ASCII / lowercase whitelist on `normalizeGoalUnit`** — removed.
  A unit is free text, matching `wsfCreateCommunity`'s trim + length
  gate for `displayName`. Only ASCII control chars are rejected. Units
  like `sentadillas` and `push-ups` are valid.
- **`isSample` refusal on `wsfGoalPulse`** — removed. Introducing a
  curator-seed policy is out of the E4-A1 scope. `isSample` on
  `wsfGoals` is still an available document field for future work.

## Deferred / out of scope (STOP if any of these are proposed)

- `firestore.rules`, `firestore.indexes.json` — untouched.
- `firebase.westayfit.json`, `firebase.westayfit.emulators.json` —
  untouched (zero diff vs `2f0a9dc`). See "Verification path" above.
- `scripts/westayfit/inject_meta.py` — untouched.
- `functions/` (GoArrive) — untouched
- `apps/` outside `apps/westayfit/` — untouched
- PR #300 rebase / repoint — untouched
- Full baseline callable test suite (10 files) — not repaired.
  Baseline `npm run test:callable` on the full suite was recorded once at
  45 failed / 27 passed in ~85 min under Node 22; that is a
  harness / timeout artifact and not a demonstration of failing
  assertions. The 4 suites that passed cleanly stay passing under the
  same isolated Node 20 + `--testPathPatterns` invocation used above.

## Follow-ups outside E4-A1

- Node engines mismatch (`functions-westayfit/package.json` declares
  Node 20; local `nvm current` defaults to Node 22). Pin one for all
  contributors.
- `apps/westayfit` fresh-worktree install path — `@playwright/test` is
  declared but does not resolve without `npm install`. Consider a bootstrap
  script.
