# EXPO-ATTENDEE-JOURNEY-PROOF-1: the attendee's journey at an expo

Packet: EXPO-ATTENDEE-JOURNEY-PROOF-1 (queued #365 5962994387, released 5963015704, W9 ACK 5963036221).
This packet only adds tests and evidence. It changes no product code.

| | |
|---|---|
| Tested product source | `ab77fbfce97e60c1c22492397b2ab6b491f9e0db`, unmodified. #561 (`e603a39c`) is **not** included. |
| Served build observed | Local emulator Hosting (`127.0.0.1:5010`) served a web export of that source. `/health` reported `wsf-health-commit = ab77fbfc`. |
| Environment | Firebase emulators only (`demo-wsf-local`: Auth, Firestore, Functions, Hosting); Playwright 1.62.1; Chromium 141 (headless); Node 22. |
| Accounts and data | Synthetic only, from `tests-e2e/helpers/expo-attendee-fixtures.ts`. Every name starts with "Fixture", every address is under `example.com`, and every starting total is a seeded number. |
| Not done | No deploy. No staging activation. Nothing touched a provider, IAM, secrets or production. No media, vision or raffle scope. Frozen references are unchanged. |

## Verdict

- **Emulator proof:** 5 of the 6 new browser journeys pass. Four full runs gave the same pass/fail results.
  - J2b **fails**: the station prints `internal` when a request is lost (GAP-1).
  - J4b shows that a goal which is already closed is not refused until the Record step (GAP-2).
- **Existing tests:**
  - All 28 related browser tests pass on this build.
  - All 70 related callable tests pass.
- **Hosted changed-journey smoke: NOT RUN.**
  - The candidate manifest is valid under schema v1.
  - The staging checker refuses to activate it, because no hosted driver exists for any of its 8 journeys. It was not activated.
- **Owner card:** rendered by the real renderer as **INCOMPLETE**: 8 NOT RUN, cleanup not needed, device review NOT RUN.
- **Separate gates, none claimed:**
  - mailbox
  - printed QR
  - kiosk hardware
  - Safari or native
  - owner feel and device review

## How each proof works

`apps/westayfit/tests-e2e/expo-attendee-journey.spec.ts` uses one browser context per device. Three phones and two hall screens share nothing but the server.

Every screen claim is also checked against the store that holds the truth:
- `wsfTurnEntries` for the place in line and the turn attempt;
- `wsfContributions` for the ledger;
- the ten `wsfGoalCounters/{goal}/shards` for the Living WE total;
- `wsfGoals.reachedAt` and `reachedSharedTotal` for the crossing.

Station screens are enrolled the real way:
1. The screen asks for a pairing code itself.
2. The Champion's approval of that code is the only callable the fixture invokes directly.
3. The screen claims its own credential.

The attendee's whole path goes through the real screens and their real callables:
- the device question;
- the activity;
- "Use my phone" or "Join the kiosk queue";
- the chosen screen name;
- "I'm ready".

The station's path does too: Call next, Start, Record and Let them go.

## Coverage matrix

Status comes from what each test run actually showed. The callable tests are `functions-westayfit/tests/callable/wsf-turn.test.ts`, which ran as 70 tests together with the `wsf-station-enrollment` and `wsf-contribute` suites.

| # | Journey row | Runtime source (ab77fbfc) | Executable test | Status |
|---|---|---|---|---|
| 1 | Device question answered "my own phone" | `app/event/[goalId].tsx` (DeviceChoice), `src/deviceMode.ts` | `ui-device-choice` "My own phone"; J1 | **PASS** |
| 2 | Single-activity event: the activity stands selected and is said back | `src/eventActivity.ts` `initialSelection` | `ui-event-activity-choice` ×2; J1 (`wsf-event-choice-activity` = squats) | **PASS** |
| 3 | "Use my phone" opens the ordinary contribution flow and creates no queue place | `app/event/[goalId].tsx` `wsf-event-add`, `app/contribute/[goalId].tsx` | `ui-event-activity-choice` "Use my phone"; J1 (no `wsfTurnEntries` row for the phone attendee, before or after) | **PASS** |
| 4 | Deliberate queue entry only: scanning, opening the page or opening the name control is not joining | `app/event/[goalId].tsx` `onJoinQueue` → `wsfJoinTurnLine` | `ui-event-activity-choice` scanned journey; J1 (name control open, no row, hall reads "Nobody is waiting." across three polls) | **PASS** |
| 5 | A waiting person is a number on the hall screen, never a name | `functions-westayfit/src/index.ts` `readTurnState`/`hallAssignment`; `app/station/[goalId].tsx` | `queue-call-by-name` T1; J1 (both halls, chosen name + display name + uid absent from text and HTML) | **PASS** |
| 6 | Two equivalent stations each call the next person, in order, with distinct codes | `wsfCallNext` (line `callSeq` contention) | J1; callable "two stations calling at the same instant cannot assign the same person", "the short code is duplicate-safe" | **PASS** |
| 7 | Correct-person confirmation: each phone shows its own station's code and "Go to Station N." | `wsfMyTurn`; `app/queue/[goalId].tsx` | `queue-call-by-name` T1 (one station); J1 (two stations, each phone checked against its own hall code) | **PASS** |
| 8 | A call is an offer: Start is disabled until that station's own person taps "I'm ready", and another person's ready does not open it | `wsfTurnReady`, `wsfStartTurn` | J1 (Station 2 opens on its person's ready; Station 1 stays disabled for 4 s and opens only on its own) | **PASS** |
| 9 | Authoritative binding: the entry carries person, goal, movement, station, and one minted `turn_` attempt; the contribution is that attempt | `wsfStartTurn`, `completeTurnEntry` → `performContribution` | J1 (entry fields; `wsfContributions.attemptId == entry.attemptId` for both station turns; the phone attempt is not `turn_`); callable "start claims only a READY entry, mints ONE attempt, and binds it", "one station cannot start or complete the other's turn" | **PASS** |
| 10 | Concurrent phone and two station contributions converge on exact Living WE progress | `performContribution` (sharded counter), `goalPulseCacheInvalidate` | J1: phone 15, Station 1 20 and Station 2 30 fired together. Shards are 40 seeded + 65 = **105**. Each person has exactly one contribution. Both halls read "105 of 100 squats", and so does the phone, read fresh. | **PASS** |
| 11 | Target crossing and overshoot | `recordTargetCrossing`; `src/ui/progressFormat.ts` | J1: `reachedAt` is set, `reachedSharedTotal` = 105 and `reachedAttemptId` = null. No contribution has `crossedTarget` set. Both halls show "100% complete" and "5 beyond our goal · still open". `ui-contribute-crossing` ×2 covers the phone side. | **PASS** |
| 12 | Station retry after a lost answer counts once | `wsfCompleteTurn` (pointer kept; `alreadyRecorded`) | J2: the first Record reaches the server and its answer is dropped. Hall polls also fail, and the same turn and count stay on screen. The retry returns `alreadyRecorded: true`, amount 25. The ledger holds one row with the station's attempt; shards 100 → 125, once. Callable "a lost response retried at the station records exactly once" covers this too. | **PASS** |
| 13 | What the hall screen says when an answer is lost | `app/station/[goalId].tsx` `runTurnAction` catch | J2b: one "Call next" whose network drops | **FAIL — GAP-1** |
| 14 | Reconnect/pending truth for a turn on the attendee's phone | `wsfMyTurn` + `wsfTurnReceipts` | J2: while offline the phone shows no receipt. Once back online it shows "25 squats recorded." and the ledger still holds one row. | **PASS** |
| 15 | Reconnect/pending truth for a phone contribution (unknown outcome, confirm, receipt) | `app/contribute/[goalId].tsx` pending/reconcile | `sprint-w9-recovery-port-rendering` ×6 | **PASS** |
| 16 | Giving up a place by switching to the phone | `wsfLeaveTurnLine {switchingToPhone}`; `app/queue/[goalId].tsx` | `queue-call-by-name` T3; J3: the entry ends `left`/`memberToPhone`, the hall goes back to nobody, and the 10 recorded on the phone is the only number. | **PASS** |
| 17 | Leaving the line from one's own phone | `wsfLeaveTurnLine` | `queue-call-by-name` T2; callable "leaving mid-turn frees the event place and records nothing" | **PASS** |
| 18 | No-show when the 45-second lease runs out | `recoverLapsedTurn`, `readTurnState` | J3: lease run out in the store. The phone reads "Your turn timed out" with the product sentence and the hall serving slot empties. The next call records `noShow`/`lease`, and nothing is recorded. Callable "an expired lease is a no-show" covers this too. | **PASS** |
| 19 | The station lets a called, ready person go ("Let them go") | `wsfCancelTurn` | J3: the entry ends `left`/`station`, the phone says "You're not in the line" with no receipt, and nothing is recorded | **PASS** |
| 20 | Closed-goal refusal at Record | `performContribution` gate 2 ("This goal is closed.") | J4: the goal closes mid-turn. The hall prints "This goal is closed.", the ledger stays empty, the shards are unchanged, and the phone shows no receipt. | **PASS** |
| 21 | Closed-goal refusal before Record (join, call, ready, start) | `wsfJoinTurnLine`, `wsfCallNext`, `wsfTurnReady`, `wsfStartTurn` (none check `goal.status`); `app/event/[goalId].tsx` | J4b (observation): every step is accepted on a closed goal, and the event page still offers "Join the kiosk queue" | **FAIL — GAP-2** (product decision; see below) |
| 22 | Finish/reset on a shared screen leaves no previous identity | `app/kiosk/[goalId].tsx`, kiosk Finish in `app/contribute/[goalId].tsx` | `ui-kiosk` walk-up, two people in a row: after Finish the screen is signed out, and none of the first person's email, name, credit or pending record remains; also `ui-kiosk` countdown; `ui-device-choice` "A shared screen here"; `sprint-w1b-kiosk-idle-finish` ×9 | **PASS** |
| 23 | Reset on the hall screen: no name or code survives a finished turn | `completeTurnEntry` (name blanked, 10-second result) | `queue-call-by-name` T1; J1 (both halls once the result clears: no chosen name, code or uid) | **PASS** |
| 24 | A station whose polls fail keeps what it last confirmed | `app/station/[goalId].tsx` state poll | J2 (polls aborted for the retry window; the turn stays on screen) | **PASS** |
| 25 | A station revoked while it is serving someone: does the place come back? | `wsfRevokeStation` | No test exercises it. The callable "a revoked or wrong credential gets one answer" proves only refusal. | **NOT RUN** |

## Gaps found

Neither gap is fixed here: both are outside this packet's reserved paths. Each comes with its smallest reproduction.

### GAP-1: a lost answer prints `internal` on the hall screen

- **Reproduction:** J2b (`expo-attendee-journey.spec.ts`, "a station action whose answer is lost says so in the product's words, never a vendor code").
  1. Enrol one station.
  2. Make its `wsfCallNext` request fail at the network.
  3. Press "Call next".
- **Expected:** a product sentence. That is either the station's own fallback, "That didn't go through. Try again.", or the app-wide connectivity sentence `src/callableErrors.ts` gives every other screen, "We couldn't reach the server. Check your connection and try again." The test accepts both, so it does not choose the fix.
- **Observed:** `internal`. Identical on both runs.
- **Cause:**
  - `@firebase/functions` turns any request that never gets an answer (status 0) into `FunctionsError('internal', 'internal')`.
  - `runTurnAction`'s catch shows any message that is not an all-caps code (`/^[A-Z_]+$/`), so the lower-case `internal` reaches the screen.
  - The station's own contract says "No code, no identifier and no vendor string on a screen in a room".
- **Reach:** the catch is shared by every station action: Call next, Start, Record and Let them go.
- **Runtime files:**
  - `apps/westayfit/app/station/[goalId].tsx`, `runTurnAction` catch, lines 544–553 at ab77fbfc.
  - `src/callableErrors.ts` already names this exact failure ("the SDK's network failure surfaces as the bare word 'internal'") and maps it to a sentence. `describeCallableError` is what the queue and event pages use; the station does not.
- **What still holds:** the wording is the only problem. Counting is still correct (row 12).

### GAP-2: a closed goal still runs the line up to Record

- **Reproduction:** J4b (observation; its output is in the spec's annotations and stdout).
  1. Close the goal.
  2. `wsfJoinTurnLine` is accepted.
  3. The station's "Call next" calls the person by name.
  4. `wsfTurnReady` is accepted.
  5. "Start their turn" opens the count box.
  6. Only Record refuses (row 20).
  7. A second member opening `/event/{goalId}` is still offered both "Join the kiosk queue" and "Use my phone". "Use my phone" lands on the contribution screen's own closed state, already covered elsewhere.
- **Consequence:** at an expo, someone can be called across the hall and do a turn, and only then hear "This goal is closed." Nothing is recorded, so the totals are safe.
- **Runtime files** in `functions-westayfit/src/index.ts` at ab77fbfc:
  - `resolveTurnEvent` (:7646), which reads the goal but does not check its status;
  - `wsfJoinTurnLine` (:8045);
  - `wsfTurnReady` (:8327);
  - `wsfCallNext` (:8540);
  - `wsfStartTurn` (:8712);
  - client side, `apps/westayfit/app/event/[goalId].tsx` (the choice is offered whatever the goal's status).
- **Decision needed:** no current requirement says the line must refuse earlier, so this is recorded as a gap for the owner and Director to decide. It is not a code change this packet could make.

## Runs

These are the run lines as the reporter printed them, against `ab77fbfc` served by emulator Hosting.

New spec, final committed text (run 4). Four full runs gave the same 5 passed / 1 failed, with `internal` printed every time. In runs 1 and 2, J2b required only the station's own sentence; run 3 was before formatting.

```
✓ 1 expo-attendee-journey.spec.ts:73  one attendee chooses their phone, two take equivalent station turns, and all three land once each on the exact Living WE total (41.1s)
✓ 2 expo-attendee-journey.spec.ts:328 a station whose Record answer is lost retries and counts once, and an offline phone comes back to the truth (13.8s)
✘ 3 expo-attendee-journey.spec.ts:443 a station action whose answer is lost says so in the product’s words, never a vendor code (4.1s)
       [J2b] the hall printed: "internal"
       Expected value: "internal"
       Received array: ["That didn’t go through. Try again.", "We couldn’t reach the server. Check your connection and try again."]
✓ 4 expo-attendee-journey.spec.ts:473 switching to the phone gives the place up, a lapsed call is a no-show, and a station can let somebody go — none of them records anything (24.1s)
✓ 5 expo-attendee-journey.spec.ts:574 a goal closed mid-turn refuses the station’s Record and records nothing (10.5s)
✓ 6 expo-attendee-journey.spec.ts:631 observation: joining, calling and starting a turn on a goal that is already closed (9.1s)
  1 failed, 5 passed (1.7m)

[J4b] join on a closed goal: {"ok":true,"result":{"entryId":"…","code":"ZDM","calledName":"Fixture Q","status":"waiting","goalId":"expo-goal-j4b-…","alreadyInLine":false}}
[J4b] call next on a closed goal: called "Fixture Q"
[J4b] ready on a closed goal: {"ok":true,"result":{"entryId":"…","status":"ready","stationLabel":"Station 1"}}
[J4b] start on a closed goal: started: the count box is up
[J4b] event page settled on wsf-event-member; "Join the kiosk queue" offered: true; "Use my phone" offered: true
```

Existing browser specs, same build: 28 passed, 0 failed.

```
queue-call-by-name ×3 · ui-device-choice ×3 · ui-event-activity-choice ×2          8 passed (1.5m)
sprint-w1b-kiosk-idle-finish ×9 · sprint-w9-recovery-port-rendering ×6 ·
ui-contribute-crossing ×2 · ui-kiosk ×3                                           20 passed (2.6m)
```

Callable tests, same source, against the emulators:

```
GCLOUD_PROJECT=demo-wsf-local FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  npm run test:callable -- tests/callable/wsf-turn.test.ts tests/callable/wsf-station-enrollment.test.ts tests/callable/wsf-contribute.test.ts
Test Suites: 3 passed, 3 total
Tests:       70 passed, 70 total
```

To reproduce the browser runs:

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web     # apps/westayfit, at ab77fbfc
npx firebase-tools emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 npx playwright test tests-e2e/expo-attendee-journey.spec.ts --workers=1
```

## Candidate changed-journey manifest and owner test card

**`expo-attendee-journey-1.changed-journeys.json`** is milestone manifest schema v1:
- `productSha` is `ab77fbfc…`, the tested and staged-served SHA;
- `previousKnownGoodSha` is `a3127651…`, the rollback;
- it has 8 journeys, each with an entry, setup, actions, expected results and exclusions;
- GAP-1 and GAP-2 sit in the exclusions of the journeys they affect, so neither is listed as expected behaviour.

Two checks were run on the manifest:
- `validateManifest` from `origin/main:.github/wsf-staging/milestone-manifest.mjs` reports no errors.
- `check-milestone-manifest.mjs`, run locally with the staged SHA, **refuses** it: "no registered driver for journeys event-use-my-phone, … shared-screen-finish (journeys/index.mjs)". That refusal is correct. No hosted driver exists for these journeys yet, so this manifest cannot be activated, and it was not activated.

**`expo-attendee-journey-1.owner-test-card.json`** is the hosted results document (results schema v1) the card is rendered from:
- `servedSha` is `null` and `results` is empty, because nothing hosted was run;
- emulator passes are deliberately **not** written into it, because that document only carries hosted results.

Rendered with `origin/main:.github/wsf-staging/owner-test-card.mjs`, it produces:

```
# Owner test card: EXPO-ATTENDEE-JOURNEY-PROOF-1
- Staging link: https://westayfit-staging--staging-4a616y5m.web.app
- Served SHA: not observed
- Milestone product SHA: ab77fbfce97e60c1c22492397b2ab6b491f9e0db
- Previous known-good / rollback SHA: a31276516e786ac8f848269de4c839b3b9e13123
- Milestone: EXPO-ATTENDEE-JOURNEY-PROOF-1
- Hosted changed-journey status: INCOMPLETE (0 passed, 0 failed, 0 blocked, 0 not verified, 8 not run)
- Changed-journey cleanup: not needed — no fixtures were created
- Device review: NOT RUN — Devin's verdict
…every journey: Hosted smoke: **NOT RUN** — no hosted result for this journey
```

**Rollback:** the manifest names `a31276516e786ac8f848269de4c839b3b9e13123`. This packet changes no product code, so nothing in it needs rolling back.

## Separate gates, not claimed

| Gate | Status | Why |
|---|---|---|
| Hosted staging run of these journeys | NOT RUN | No hosted driver exists, and the manifest is refused for activation |
| Mailbox (verification and reset email) | NOT RUN | Accounts are seeded already verified |
| Printed QR | NOT RUN | Event and station addresses are opened directly |
| Kiosk or station hardware | NOT RUN | Station screens are 1280×720 browser windows |
| Safari, iOS or Android native | NOT RUN | Chromium only |
| Owner feel and device review | NOT RUN | Devin's verdict |
