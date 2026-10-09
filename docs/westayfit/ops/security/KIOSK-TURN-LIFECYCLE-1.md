# KIOSK-TURN-LIFECYCLE-1: a revoked screen gives its turn back; a recorded member is not put in line

**Authority:** queue #365 `6079353576`, release `6082013157` (W9, wake `c0b43c67`).

**Base:** `claude/wsf-app-shell` at `e65bfee9eecb2370f602d09880da604709fba58a`. That is the merge of ANON-GATE-1 (#601). The callables in scope exist only on this line. `main`'s `functions-westayfit` has one export.

Source-only. Nothing deployed.

## Why

### 1. A revoked station left its turn stranded

A Champion can revoke a kiosk screen at any time, including while the screen is running somebody's turn. Before this change, `wsfRevokeStation` deleted the screen's secret and closed its pairing, but it did not touch the turn line. So the person's entry stayed `assigned`, `ready` or `active` on a screen that no longer existed:

- **`ready` and `active` never lapse,** by design: somebody walking across a hall must not lose their place to a timer. So `wsfMyTurn` kept telling the person to walk to "Station 1" for the rest of the event.
- **Their one place at the event** (`wsfTurnMembers/{lineId}__{uid}`) was held by a turn nobody could run. A second tap on "Join" returned the stranded turn.
- **The revoked screen's own `wsfTurnState` was already refused,** because the credential check requires an active station. But no other screen at the event could see or call the person.

### 2. The line admitted members it could never record

Under a goal that takes one contribution from each member (`repeatPolicy: 'once'`), a member whose contribution was already recorded could still:
- take a place;
- be called on the big screen by name;
- tap "I'm ready";
- be started.

Only at the very end did the completion refuse, with "This goal takes one contribution from each member, and yours is already recorded." The member had done the movement, and the station had spent a turn on them.

## What changed (`functions-westayfit/src/index.ts`)

### `wsfRevokeStation`: the turn goes back to the line

In the revoke's own transaction, after its existing reads, it reads the turn the screen holds through the screen's `serving` pointer. It confirms on the entry that the turn is assigned to this station. Then:

| The turn the screen held | What the revoke does |
|---|---|
| `assigned`, inside its 45-second lease | **Returns it to the line** (`returnTurnToLine`) |
| `ready` | **Returns it to the line** |
| `active` (started; attempt minted, nothing recorded) | **Returns it to the line**, and drops the unrecorded attempt |
| `assigned`, lease already run out | **Closes it as a no-show** (`recoverLapsedTurn`), the same way every other transaction closes a lapsed lease; the place is freed |
| `done`, `left`, `noShow`, or none | Nothing |
| Assigned to another station | Nothing |

The screen's `serving` pointer is cleared in the same write, so no name stays on a revoked station's document.

**`returnTurnToLine`** sets the entry back to `waiting` at **the position it already had**.
- Positions are handed out once and never reused, so the person is older than anyone who joined after them, and the next "Call next" at the event reaches them first.
- They keep their one place, their name and their code.
- Everything that tied the turn to the screen is cleared: the assignment, label, lease, ready time, expected-turn reference (`stationTurnRef`), attempt id, attempt station and start time.
- `requeuedAt` and `requeueReason: 'stationRevoked'` record what happened. It is not an ending, so `endedBy` is not written.

**Why requeue rather than end:** the person did nothing. Ending the turn (as `wsfCancelTurn` does) would send them to the back of the line for a Champion's decision about a screen.

**The dropped attempt cannot double-count,** because the drop happens inside the revoke's transaction:
- A phone completion (`wsfCompleteMyTurn`) that commits first finds the turn `active`, records it and marks it `done`; the revoke then leaves a `done` turn alone.
- One that commits after finds the turn `waiting`, and is refused with "That turn is not running." Nothing is recorded.
- The next screen to start the turn mints its own attempt.

**What reports it:**
- **`wsfMyTurn`:** `waiting`, with `ahead` counted, and no station label, lease or open attempt.
- **Every remaining screen's `wsfTurnState`:** counts the person in `waitingCount`, and shows them when it calls them.
- **The revoked screen:** its own calls are refused, as before.
- **Its old expected-turn reference** matches nothing:
  - the revoked screen gets "This screen is not enrolled.";
  - another screen gets "That turn has moved on…".

### `wsfJoinTurnLine`: one contribution means one

After the membership check and the closed-goal check, and before the existing-place return, the join reads the chosen goal's repeat policy through `goalRepeatPolicy`. That function resolves an absent field to `'multiple'` and an unknown value to `'once'`, exactly as the contribution does.

Under `'once'`, a member with a contribution already recorded is refused:
- **Code:** `failed-precondition`.
- **Message:** `ONE_CONTRIBUTION_MESSAGE`, "This goal takes one contribution from each member, and yours is already recorded."
- **Writes:** none, so no place, entry or line is created.

The evidence and the sentence are now shared with the contribution itself, not copied:
- **`priorContributionCount`** is extracted from `performContribution`. It reads the member's totals row, `wsfGoalMemberTotals/{goalId}_{uid}`. For a row written before `contributionCount` existed, it asks the ledger, as the contribution always has.
- **`performContribution`** now calls it, and keeps the same value for its later `contributionCount + 1` write. Its behaviour is unchanged.
- **`ONE_CONTRIBUTION_MESSAGE`** is the one constant both use.

Properties of the join gate:
- **Said only to a member.** A non-member or removed member still gets the generic not-found. A closed goal still answers "This goal is closed." first.
- **Per activity.** At a combined event, the check is on the activity the member chose. An activity they have not recorded still admits them.
- **Before the existing-place return.** A member who records on their own phone while waiting in line is told on their next tap. The refusal writes nothing, so the place they hold stays theirs until they leave it (`wsfLeaveTurnLine`).

## Residual behaviour (unchanged here, named so nobody assumes otherwise)

- **A member who records on their own phone while waiting** is still called when their turn comes. That turn's completion refuses with the same sentence. Changing "Call next" was not in scope.
- **A revoked screen holds at most one live turn.** Every path that gives a station a live turn sets its `serving` pointer, and "Call next" refuses while the pointed-at turn is live. The revoke finds the turn through that pointer and confirms it on the entry. It does not query for other entries.
- **No client, rules, index or response-shape change.** `wsfRevokeStation` still returns `{ stationId, status: 'revoked' }`. The new entry fields are written by the Admin SDK only. The collections stay covered by the WSF catch-all deny.

## Tests

**Suite:** `functions-westayfit/tests/callable/wsf-station-turn-lifecycle.test.ts`. All fixtures are synthetic, on `demo-wsf-local`.

1. **Revoke:**
   - assigned, ready and active turns each go back to `waiting` at their own position, with every station field cleared, and the next screen calls them first under a fresh reference;
   - the active turn's dropped attempt is refused from the phone, and the next screen records exactly one contribution under a new attempt;
   - a lapsed lease becomes a no-show and frees the place;
   - a finished turn is byte-for-byte unchanged;
   - another screen's turn and the waiting line are unchanged;
   - a hand-edited pointer to another station's turn moves nothing;
   - the old reference is refused on both screens;
   - a non-Champion's revoke moves nothing, and a second revoke is harmless.
2. **Join:**
   - a member who recorded on the contribute page is refused, with the same message the contribution gives, and nothing is written;
   - a member whose turn was recorded through the line is refused a second place;
   - a repeat-contribution goal re-admits at the back;
   - the policy table holds: absent and `'multiple'` admit, `'once'` and an unknown value refuse;
   - older totals rows are settled by the ledger;
   - at a combined event the refusal is per activity;
   - membership and closed-goal refusals come first;
   - a member who records on their phone while in line is refused on the next tap, and keeps the place until they leave.

**Run**, from the repository root:
```sh
npx -y firebase-tools@15.30.1 emulators:exec --only firestore,auth --project demo-wsf-local \
  --config firebase.westayfit.emulators.json "cd functions-westayfit && npm run test:callable"
```

**Results:**

| Run | Result |
|---|---|
| The new suite (17 tests) | **17/17** |
| Fail-first: the same suite against the unmodified `index.ts` at `e65bfee9` | **15 failed**. The 2 that pass are the regression guards: the repeat-goal rejoin, and the refusal order. |
| Full callable suite | **718/718** in 36 suites: 701 before, plus these 17 |
| `test:rules` | **28/28** |
| `test:deploy-config` | **17/17** |
| `tsc --noEmit` | clean |
| Mutants (21) | **all killed** (see below) |

The 21 mutants:
- **Revoke (12):**
  - it never requeues;
  - it acts on another station's turn;
  - it requeues a lapsed lease;
  - it requeues a finished turn;
  - it leaves an active turn;
  - it keeps the pointer;
  - it keeps the attempt;
  - it keeps the reference;
  - it keeps the label;
  - it leaves a stale status key;
  - it ends the turn instead of requeueing it;
  - it drops the requeue reason.
- **Join (7):**
  - the gate is off;
  - the policy is ignored;
  - the raw policy field is read instead of `goalRepeatPolicy`;
  - the ledger fallback is off;
  - it reads the wrong totals row;
  - it gives another sentence;
  - at a combined event, it checks the event's goal instead of the chosen one.
- **The shared contribution evidence (2):**
  - the threshold is off by one;
  - the count field is ignored.
