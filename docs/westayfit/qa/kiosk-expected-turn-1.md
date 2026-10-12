# KIOSK-EXPECTED-TURN-1 — a station command names the turn it is for

Status: **successor delivered for review** (handback: W4 finding 6044506214 and the owner receipt delta in #365 6044494616). This is not accepted, not integrated and not staged. Source only. It started stacked on #586 (`a17ee3e2`), and #586 has since merged into `claude/wsf-app-shell`.
Emulator only (`demo-wsf-local`). No deploy, rules, index, IAM, secret, provider or UI change was made.

## The defect

On `a17ee3e2`, `wsfStartTurn`, `wsfCancelTurn` and `wsfCompleteTurn` acted on **whoever the screen was serving when the request landed**. A delayed command for visitor A, arriving after visitor B had been called at the same screen, therefore acted on B.

A scratch probe proves this on the base (it was never committed). Setup: A finished on the phone, then B was called and readied. A's late commands then arrive:

| Late command for A | Base `a17ee3e2` | After |
|---|---|---|
| `wsfCancelTurn` | **ok; B ended (`left`)** | refused (stale); B stays `ready` |
| `wsfStartTurn` | **ok; B started (`active`, attempt minted)** | refused (stale); B stays `ready`, no attempt |
| `wsfCompleteTurn` | refused "Nobody is up at this screen." (A's lost answer cannot be reconciled) | ok: A's receipt `{amount:20, alreadyRecorded:true}`; B untouched |

## The contract (exact)

### The binding

- **`turnRef`**: an opaque string matching `^tr_[A-Za-z0-9_-]{16,64}$`, made of 18 random bytes encoded as base64url.
- **When it is minted:** `wsfCallNext` mints one each time it assigns a person.
- **Where it is stored:**
  - `wsfTurnEntries/{id}.stationTurnRef`
  - `wsfKioskStations/{id}.serving.turnRef`
- **What it carries:** no uid, no entry id, no station id, no goal id and no secret.
- **Who sees it:**
  - It is shown **only** to the serving station, as `wsfTurnState` / `wsfCallNext` / `wsfStartTurn` / `wsfCompleteTurn` / `wsfCancelTurn` → `assigned.turnRef`.
  - It is absent from `wsfMyTurn` (the phone), `wsfGoalPulse`, any other station's state, the public QR and every public payload. This is asserted in tests.
- **What it is not:** a bearer credential. Every station command still requires `stationId` + `secret`.

### Requests

| Callable | Request | Change |
|---|---|---|
| `wsfStartTurn` | `{ stationId, secret, expectedTurn }` | `expectedTurn` is **required** |
| `wsfCompleteTurn` | `{ stationId, secret, count, expectedTurn }` | `expectedTurn` is **required** |
| `wsfCancelTurn` | `{ stationId, secret, expectedTurn }` | `expectedTurn` is **required** |
| `wsfCallNext`, `wsfTurnState` | unchanged | the response's `assigned` gains `turnRef: string \| null` |
| `wsfCompleteMyTurn` (phone) | unchanged `{ entryId, count }` | now runs in the same transaction as the record |

### Responses

- The shape is unchanged except for `assigned.turnRef`. `wsfTurnState` still has its five top-level keys and no array at any depth.
- `assigned` now has these keys: `activityTitle, activityUnit, calledName, code, readySecondsLeft, state, turnRef`.

#### `wsfCompleteTurn`: the completion's own receipt (additive)

The response is the hall state plus `recorded` and `anyoneWaiting`, exactly as before, and **adds** these fields:

```ts
entryId: string;            // the entry THIS Record completed
receipt: {
  entryId: string;          // same as above
  goalId: string;           // the ACTIVITY goal recorded (a combined event's child, never the parent)
  addedCount: number;       // the attempt's recorded amount (on a replay: the ORIGINAL amount)
  unit: string;             // goalId's own unit
  alreadyRecorded: boolean;
  sharedTotal: number | null;  // canonical post-commit observation of goalId's own total, in `unit`
  target: number | null;
  status: 'active' | 'closed' | ... | null;
  crossedTarget: boolean | null; // canonical per-attempt value, forwarded as is (never true today)
};
```

Example fixture, from an isolated goal with no other contribution and +7 recorded:

```json
{ "entryId": "<entry>", "receipt": { "entryId": "<entry>", "goalId": "<goal>", "addedCount": 7, "unit": "squats",
  "alreadyRecorded": false, "sharedTotal": 7, "target": 5000, "status": "active", "crossedTarget": false } }
```

**Attribution.** `entryId` is the entry the server found by the `expectedTurn` the Record carried. It is never whoever the hall now serves, and never anything the caller names. A delayed or retried Record for A returns **A's** `entryId` and A's original `addedCount` with `alreadyRecorded: true`, while the hall fields in the same answer show B.

**What is in the receipt:**
- It is a whitelist. There is no uid, no `ownCredit`, no profile and no email. The member's contribution response is not forwarded whole to the shared screen.
- It appears **only** in this credential-authorized answer. It is never in `wsfTurnState`, the pulse, the public QR, logs or rendered hall attributes, and nothing personal is stored on the station.

**Honest absence:**
- `sharedTotal`, `target`, `status` and `crossedTarget` are given only when the goal's aggregate may be shown on a public display. That is decided by `evaluateGoalAggregateAccess(goal, null)`, the same display route the pulse uses, and also requires that the canonical contribution returned them.
- Otherwise they are `null`, **never 0**.
- No before/after pair is derived: `before = sharedTotal − addedCount` is not computed and must not be computed by a caller.
- On a replay, `sharedTotal` is today's observation and `addedCount`/`crossedTarget` are the attempt's stored values.
- `crossedTarget` is not a goal-achievement claim. No new crossing algorithm is added (MEMBER-TRUTH-BACKEND-1 / TOGETHER-CROSSING-DESIGN-DECISION hold).

#### `wsfMyTurn`: the phone's own receipt

`receipt` gains `entryId: string | null` (`{ amount, unit, goalId, entryId }`), read from the receipt already stored under the caller's own uid.
- A phone that lost an answer matches it to **that** entry, not to any entry on the goal.
- A receipt stored before the field existed reports `entryId: null`.
- The legacy `amount`/`unit`/`goalId` handling is unchanged.
- The receipt is only ever the caller's own.

### Errors (new)

| Code | Message | When |
|---|---|---|
| `invalid-argument` | `This screen needs an update before it can run a turn.` | `expectedTurn` is missing or malformed. This is the old-client case, and there is **no fallback**. |
| `failed-precondition` | `That turn has moved on. This screen now shows the current one.` | The binding is not this screen's current turn: it is foreign, expired, or belongs to another station. Nothing is written. |
| `failed-precondition` | `That turn is not running.` | A result arrives for a turn that was cancelled or lapsed and has no recorded attempt. Nothing is recorded. |
| `permission-denied` | `This screen is not enrolled.` | The station was revoked, including between the credential check and the recording transaction. |

Existing errors are unchanged: closed (`This goal is closed.`), not ready, nobody, lapsed, and the repeat-policy sentences.

### Server enforcement (no check-then-act gap)

- **Start and cancel:** the station's `serving.turnRef` and the entry's `stationTurnRef` must equal `expectedTurn`. Both are read **inside** the transaction that writes. A mismatch writes nothing.
- **Complete:**
  - The entry is found by `stationTurnRef == expectedTurn`, never by `serving`.
  - The binding is then re-checked inside `performContribution`'s own transaction through a `TurnCompletionHook`. The checks are: entry attempt, station of the attempt, `stationTurnRef`, station `active`, and a running status unless the attempt is already recorded.
  - Contribution, entry `done`, receipt, place release, `lastResult` and the hall name-blanking commit **atomically**.
  - The hall name is blanked only if the station is still on this entry.
  - A replay of an already-recorded attempt writes nothing to the line, the station or the hall.
- **Phone completion:** bound to its own entry (`entry.uid == caller`, re-checked inside the transaction). When the phone and the station race, the result is one contribution.
- **Lookup index:** the query is a single-field equality, which uses Firestore's automatic index. No `firestore.indexes.json` change.

## Required client update (not done here; outside the reservation)

The server rejects old clients. Until this update ships, an old station screen gets `This screen needs an update before it can run a turn.` on Start, Record and Cancel.

- `apps/westayfit/app/station/[goalId].tsx` → `runTurnAction`: **bind each operation, not the screen** (W4 finding 6044506214).
  - When Start, Record or Cancel is pressed, capture the **current** `assigned.turnRef`, and for Record the count, into an **immutable pending operation**. Send it as `expectedTurn` (plus `count`).
  - A retry of that operation, such as a lost answer or a timeout, resends **exactly the captured `expectedTurn` and count**. It never substitutes a newer `turnRef` that a later poll or Call next brought in.
  - Keep the visible current turn (from `wsfTurnState`/responses) and any pending operation **separate**. The visible turn may advance to B while A's Record is still pending, and A's retry still sends A's ref.
  - Discard a pending operation only once its own answer arrives: success, `alreadyRecorded`, or a definite refusal such as stale or not-running. Read `entryId`/`receipt` from **that** answer to show the result of the operation it belongs to.
  - **The hazard this avoids:** a "newest-ref" client that retries A's lost Record with B's ref sends B's binding with A's count. The server cannot tell whose count it is, so it records A's count **to B**, and the goal counts it twice. Never retry with a ref the operation did not capture.
- `apps/westayfit/app/queue/[goalId].tsx` and `src/followAlongSession.ts` reference the turn callables in comments only. They need a verification read but no request change. The phone uses `wsfCompleteMyTurn`, which is unchanged.
- `tests-e2e/expo-attendee-journey.spec.ts` (station record and lost answer) drives the station UI. It will fail against this server until the station client sends `expectedTurn`, and it should be re-run with that client.
- **Lovable:** any Lovable station surface that calls these three callables must use the same per-operation binding. It must read a Record's result from that answer's `entryId`/`receipt`, never from the hall's `result`/`code`. No Lovable call site was found in this repository.

**Deploy order** (when separately authorized — not part of this packet):

1. Ship the station client first. It is harmless against the old server, which ignores the extra field.
2. Then ship the functions.

## Inventory delta

- **Exports:** none added or removed. The callable set is unchanged.
- **Fields:**
  - `wsfTurnEntries.stationTurnRef` (new, server-written)
  - `wsfKioskStations.serving.turnRef` (new, server-written)
  - `assigned.turnRef` in station responses
  - `wsfCompleteTurn` → `entryId`, `receipt` (additive; see the contract above)
  - `wsfMyTurn` → `receipt.entryId` (additive)
- **Unchanged:** no rules, index, provider, IAM or secret change. No new ledger, no automatic credit, no raffle, and no frontend authority.

## Proof

These are the files touched, exactly the six reserved:

- `functions-westayfit/src/index.ts`
- `functions-westayfit/tests/callable/wsf-turn.test.ts`
  - Every station command now sends the binding the screen holds.
  - The `assigned` key set gains `turnRef`.
  - The binding is read before a race spy is armed, or before a lease lapses, as a real screen already holds it.
- `functions-westayfit/tests/callable/wsf-kiosk-expected-turn.test.ts` (new, 17 tests)
- `docs/westayfit/qa/kiosk-expected-turn-1.md` (this file)
- `wsf-station-enrollment.test.ts` and `wsf-combined-correction-and-recovery.test.ts` were reserved but needed no change. Both pass unchanged.

| Run | Result |
|---|---|
| New suite on base `a17ee3e2` (fail-before) | **16 failed, 1 passed / 17.** The pass is the unchanged `wsfCreateGoal` verification-gate regression. |
| Scratch behavioural probe on base (not committed) | 3/3 show the defect (table above) |
| Same probe after | 3/3 fixed |
| New suite after (pass-after) | **17 passed / 17** |
| `wsf-turn.test.ts` after | **48 passed / 48** |
| Full callable suite after | **32 suites, 574 passed / 574** |
| Deploy-config | **2 suites, 17 passed / 17** |
| `tsc --noEmit` | clean |

The new suite covers:

- **The binding:** it is station-only and opaque, and absent from the phone, the pulse and the other station.
- **A's late result after B:** it replays A's one contribution, and B and the screen are byte-equal.
- **A's late result after A was cancelled:** nothing is recorded.
- **A's late cancel after B:** stale; B is kept.
- **A's late start after B:** stale; B gets no attempt, and B's own binding still starts B.
- **An already-confirmed A replayed during B's active turn:** one contribution; the station and line docs are byte-equal.
- **Missing or malformed bindings:** six shapes × start/cancel/complete, all refused, with no change.
- **A foreign binding:** stale.
- **An expired binding** (a lapsed no-show): stale.
- **The phone and the station finishing at once:** one contribution, with one `alreadyRecorded` true and one false.
- **A cancel racing a result:** either done with one record, or left with none.
- **Two stations contending:** cross-station start, cancel and complete are refused, and parallel completions record one each.
- **A lost answer:** the retry gets the same receipt twice, the count changes nothing, and there is one contribution and one receipt.
- **A station revoked inside the transaction** (spy on `runTransaction`): `permission-denied`, nothing recorded. Revoked before the transaction: refused. The phone can still finish.
- **The wrong member:** `not-found`, nothing recorded.
- **A closed goal:** the right binding gets the closed sentence and nothing is recorded; a stale binding is still stale.
- **W4's `wsfCreateGoal` gate:** an unverified caller gets `failed-precondition` "Verify your email before starting a goal." and no goal is written.

### Successor proof (receipt delta + W4 finding)

Added rows:
- `wsf-kiosk-expected-turn.test.ts`:
  - A's late result after B is called returns A's `entryId`/receipt alongside B's hall.
  - An isolated goal returns exactly +7, with `sharedTotal` 7, target, status and `crossedTarget:false`, and exactly the whitelisted keys. No uid, `ownCredit` or email appear.
  - A goal that is not display-authorized gives shared fields `null`, not 0.
  - The receipt is absent from the hall, from the other station and from the pulse.
  - **W4's row:** a lost Record retried with its own captured `(refA, 20)` while B is mid-turn gives A's receipt with `alreadyRecorded`, and B's total stays 0.
  - The phone's receipt carries `entryId`, another member sees nothing, and a legacy stored receipt gives `entryId: null`.
  - When the phone and the station race, the station's receipt names A and reports A's one amount.
- `wsf-turn.test.ts`:
  - A combined event's receipt is scoped to the activity goal and unit (push-ups 9), never the parent's.
  - The phone receipt assertion now includes `entryId`.

| Run | Result |
|---|---|
| The two turn suites on the previous head `a3f38e22` (fail-before) | **8 failed / 64 passed** (the 8 are the new receipt rows; the privacy-only row passes before and after, as a regression guard) |
| The two turn suites after | **72 / 72** |
| Full callable suite after | **32 suites, 581 / 581** |
| Deploy-config | **17 / 17** |
| `tsc --noEmit` | clean |

## Next

1. One independent journey QA, with the station client updated as described above.
2. The Director's acceptance.
