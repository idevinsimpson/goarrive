# KIOSK-GUEST-MOVE-1: a walk-up guest's squats count toward the station's goal

**Authority:** queue #365 `6111692291`, release `6111692815` (W9, wake `ef7c8468`), ACK #497 `6111870196`.

**Owner decision (17:11Z, relayed in the queue):** anonymous guest kiosk squats count toward the community goal, and guests never earn raffle tickets. Counsel sign-off (`GUEST-ENTRIES-OK`) is still open, so production enablement stays the owner's call.

**Base:** `claude/wsf-app-shell` at `8a067b29420563408e16cff5d91cc77b2ad0fbd8`, the merge of KIOSK-TURN-LIFECYCLE-1 (#606).

Source-only. Nothing deployed. No rules, index, client or existing response-shape change.

## The callable

`wsfStationGuestContribute({ stationId, secret, count, attemptId })` answers:

```ts
{ recorded, alreadyRecorded, amount, unit, before, after, target, status }
```

This is the web's `GUEST_MOVE_PORT` reply.
- `recorded` and `alreadyRecorded` are exact opposites. Either this call wrote the move, or an earlier call with the same `attemptId` at this station did.
- `amount` and `unit` are what was recorded. On a replay that is the stored count, not the request's.
- `after` is the goal's shared total read just after the commit, so it can include other movement that landed at the same moment.
- `before` is `after - amount`. It is given only for a move this call recorded, and is `null` on a replay. It is never a separate reading.
- `after`, `target` and `status` are `null` only when the goal's total may no longer be shown publicly. A new guest move is refused on such a goal, so this happens only on a replay after the goal stopped being public. See residual 2.

New files and edits:
- `functions-westayfit/src/guest-contribute.ts`: the names, limits, rate window and receipt.
- `functions-westayfit/src/index.ts`:
  - the callable, appended at the end of the file;
  - one import;
  - two comment notes on existing sections: the `GoalDoc` crossing rule names the guest move, and the station section names it as a second station-authorized writer.

## Authorization

- **The station's credential, and nothing else.** The callable uses `authorizeStationForTurn`, exactly as every station callable does:
  - the station must exist and be `active`;
  - the secret's hash is compared in constant time;
  - the goal is the one the station is bound to.

  A `goalId` in the request is ignored. A bad credential is refused with `permission-denied` "This screen is not enrolled." before the payload is read, and it is charged to the existing per-IP station limiter.
- **Re-checked inside the transaction.** A Champion who revokes the screen between the credential check and the transaction gets the same refusal, and nothing is written.
- **A revoked station cannot even replay** a move it recorded. The station check comes before the replay.
- **`request.auth` is never read.** A guest move names nobody, whoever is signed in on the kiosk's browser. `tests/deploy-config/station-guest-contribute.test.ts` pins this in the source.
- **Declared `invoker: 'public'`,** like `wsfTurnState`, `wsfCallNext` and `wsfCompleteTurn`. A paired kiosk is a signed-out browser.

## The order of checks

| # | Check | Refusal |
|---|---|---|
| 1 | Station credential | `permission-denied` "This screen is not enrolled." |
| 2 | `attemptId`: 8 to 128 characters of `A-Z a-z 0-9 _ -`, the contribution's own rule | `invalid-argument` "attemptId must be 8..128 chars of A-Z, a-z, 0-9, _ or -." |
| 3 | `count`: an integer from 1 to 100000, the cap `wsfCompleteTurn` and `wsfContribute` use | `invalid-argument` "count must be a positive integer up to 100000." |
| 4 | The station's goal still exists (preflight) | `not-found` "This link is not valid." |
| In the transaction: | | |
| 5 | Station still active and on this goal | `permission-denied` "This screen is not enrolled." |
| 6 | **Replay.** A stored move for this station and `attemptId` answers with what it recorded, whatever has changed since. A stored row that does not match the request is refused. | `internal` "Guest record mismatch." |
| 7 | Goal still exists | `not-found` "Goal not found." |
| 8 | Goal `active` | `failed-precondition` "This goal is closed." |
| 9 | Inside the goal's window, on the server's clock | "Goal has not started yet." / "Goal window has ended." |
| 10 | The public may see the goal: `aggregateDisplayAuthorized === true`, the community exists, and it is not a sample. This is the display route of `evaluateGoalAggregateAccess` with no caller. | `failed-precondition` "This goal is not shown publicly, so guests cannot add to it." |
| 11 | Not a once-per-member goal (`goalRepeatPolicy`; an unknown value is `'once'`) | `failed-precondition` "This goal takes one contribution from each member, so guests cannot add to it." |
| 12 | **Not busy.** Nobody waits on the station's line for an activity that is still open (exactly who `wsfCallNext` would call), and no live turn sits at this screen. | `failed-precondition` "Someone is in line for this station. Guests can move once the line is clear." |
| 13 | Room in the station's guest window | `resource-exhausted` "This station is recording guests too quickly. Try again in a minute." |

Where the transaction draws its line:
- **A recorded attempt is never refused afterwards.** The replay comes before every goal, line and window gate, so a kiosk that lost the answer always learns the truth.
- **A refusal writes nothing** and is never charged to the window.
- **Busy is per screen.** A turn assigned to the event's other screen does not make this one busy: that screen is serving the person. An assigned turn whose 45-second lease has run out is not live (`effectiveTurnStatus`); a ready or active turn is, since neither lapses. At a combined event, somebody waiting on a closed activity is nobody the line will call.
- **The line document is read inside the transaction.** So a join or call that commits first makes the guest move retry and see it.

## What it writes, in one transaction, only for a new attempt

| Document | Content |
|---|---|
| `wsfKioskGuestMoves/{stationId}_{attemptId}` (**new**, server-only) | `{ source: 'kioskGuest', stationId, attemptId, goalId, communityGroupId, unit, count, shardIndex, createdAt }`. No uid, name, photo, video or device detail. `tx.create`, so a race on one id can record only once. |
| `wsfGoalCounters/{goalId}/shards/{i}` | `count` incremented by exactly `count`, the same sharded counter a member's contribution moves |
| `wsfGoals/{goalId}/recentAdditions/kioskGuest~{stationId}~{attemptId}` | `{ amount, at }` with `at` truncated to the minute, exactly a member line's shape. `~` is outside what member ids admit, so no member's line can share the name. |
| `wsfCombinedCounters/{setupId}/shards/{goalId}_{i}` and `wsfCombinedCredits/kioskGuest~{stationId}~{attemptId}` | Only when the goal is a child of an active combined goal, decided by the same `combinedCreditDecision` a member's contribution uses. The credit row is `{ setupId, setupVersion, contributionRuleVersion, goalId, attemptId, source: 'kioskGuest', stationId, amount, shardIndex, communityGroupId, createdAt }`, with no `userId`. `wsfRepairCombinedGoal` counts it and reports the parent healthy. |
| `wsfStationGuestLimits/{stationId}` (**new**, server-only) | `{ windowStartMs, count }` |

After the commit, as `wsfContribute` does:
- the goal's pulse cache entry is dropped, so the public pulse is fresh at once;
- the target-crossing event is claimed (`recordTargetCrossing`) when this move carries the total over the target. The event records `reachedAttemptId: null`, the shape it already has.

**It never writes:**
- `wsfContributions`;
- `wsfGoalMemberTotals`;
- a turn entry, a line document, a station's `serving` pointer or a `lastResult`;
- anything under the raffle's collections.

The two new collections fall to the WSF catch-all deny in `firestore.rules`, so no client can read or write them. They need no index: the callable reads them by id only.

## Why guest moves have their own collection: the raffle

Expo-prize (`functions-westayfit/src/expo-prize/`) is not wired to any trigger today. It is built to take its movement from `wsfContributions` only:
- `contributionDocIdFromPath` accepts only `wsfContributions/{id}`;
- `readContributionRow` requires a `userId`;
- reconcile scans `wsfContributions` by goal;
- the freeze pass counts a pre-cutoff row it cannot read as a row error, and so would never freeze.

A guest row in `wsfContributions` would therefore have:
- blocked the raffle's freeze for good;
- appeared in the activity feed's scan;
- sat in a collection that is otherwise a member's history.

In its own collection, the raffle structurally never sees a guest. `tests/expo-prize/guest-never-a-ticket.test.ts` drives the raffle's real functions against real guest moves:
- ingest and the trigger body refuse a guest move as `notAContributionPath` and write nothing;
- reconcile over a goal moved only by guests processes nothing;
- freeze over members and guests issues exactly the members' tickets, with no row error, and nothing in the pool names a station or attempt;
- freeze over a goal moved only by guests refuses `poolEmpty`.

## The per-station rate limit

At most `GUEST_RATE_MAX` (6) new guest moves per station in a fixed `GUEST_RATE_WINDOW_MS` (60 s) window. The window is read and written inside the move's transaction, so racing moves serialize on it. A real guest set takes far longer than ten seconds, so the limit never slows an honest kiosk. It bounds what a leaked station secret can add (residual 4). Replays and refusals are never charged.

**A defect the race test found, fixed before delivery.** The first version treated a window that "starts in the future" as unreadable and reset it. Racing moves read the clock before they queue on the window document, so a move with an earlier clock reading found the window a later-clocked move had just opened, and reset it. Eight racing moves all recorded, past the cap of six.

The rule now:
- a start up to one whole window after `now` is the current window;
- only a start further ahead than that is replaced;
- so a bad value can hold a station for at most two windows.

`G03` in the mutant table restores the old rule, and the race test kills it.

## Privacy

- **The answer** carries `{ recorded, alreadyRecorded, amount, unit, before, after, target, status }` and nothing else. The suite checks the exact key set, and that no station id, attempt id, secret, label or uid appears in any string.
- **No request field is ever stored or echoed,** including `calledName`, `name`, `deviceId`, `photoUrl` or a `userId`. The suite sends all of them, from a kiosk signed in as a member, and checks that none reaches any written document.
- **The activity feed says nothing about a guest.** It scans `wsfContributions`, which a guest never touches. The packet allows at most "A guest moved"; this delivery shows nothing.
- **The recent-additions read** shows a guest's line as `{ amount, unit, at }`, the same anonymous shape as every member line.

## Residuals (named so nobody assumes otherwise)

1. **A guest's combined parent credit cannot be corrected per contribution.** `wsfAdjustGoal` addresses a credit by `(goalId, targetUid, attemptId)`, and a guest has no uid. An unaddressed goal-level correction moves the child total and never the parent, as it always has. `wsfRepairCombinedGoal` rebuilds parent counters from credit rows, so a guest credit stays counted. A mistaken guest move on a combined child can be removed from the child total only. Each guest credit names its station and attempt, so an operator can find it.
2. **The web reply type is narrower than the server's.** `src/wsf/served-ports.ts` (`GuestMoveReply`) declares `after: number` and `status: string`. The server returns `null` for `after`, `target` and `status` on one path only: a replay after the goal stopped being public. The web side should widen those two to `number | null` and `string | null` (outside this packet's paths).
3. **Production.** A new export changes the production preflight's reviewed export manifest. `functions-westayfit/src/index.ts` has 59 exports, 17 of them public, at `8a067b29`, and 60 and 18 with this callable. KIOSK-LIVE-POSE-2 (#622) changes the count again if it merges first. Production needs a new reviewed record before this function can ship there. Not in scope here. Counsel `GUEST-ENTRIES-OK` stays open.
4. **What a leaked station secret can do.** The count cap is the packet's (that of `wsfCompleteTurn`). So until a Champion revokes the screen, a leaked secret can add up to 6 × 100000 to that one goal per minute. It cannot:
   - name anybody;
   - touch another goal;
   - earn a ticket;
   - write anywhere but the rows above.

   Every guest move is a row naming its station, so a station's moves can be summed and reversed with a goal-level correction.
5. **Rate window clock.** The window uses the function instance's clock, like `enforceStationRateLimit`. Clock skew between instances is absorbed by the one-window tolerance above.
6. **Abandoned window documents.** `wsfStationGuestLimits/{stationId}` is not deleted when a station is revoked. It is a two-number document per station that ever recorded a guest. It carries no identity.

## Tests

All fixtures are synthetic and labelled, on `demo-wsf-local`.

- **`functions-westayfit/tests/callable/wsf-station-guest-contribute.test.ts`** (65 tests):
  - the move and its receipt;
  - the stored row's exact keys;
  - identity and extra fields ignored;
  - no member-scoped row;
  - no turn written;
  - member and guest sharing an `attemptId`;
  - retries, sequential and concurrent;
  - a recorded attempt answered after the line, window or goal changed;
  - the non-public replay;
  - attempt ids per station;
  - mismatch refusal, field by field;
  - revoked (before the call, and between the check and the transaction);
  - revoked replay;
  - wrong or missing secret, unknown station;
  - goal id ignored;
  - busy, for waiting, assigned, ready, active, an assigned turn whose lease ran out, and both combined-line cases;
  - count and `attemptId` tables;
  - every goal gate;
  - the rate window (cap, race, expiry, future start, the pure table);
  - recent-addition shape and public read;
  - pulse freshness;
  - the target crossing claimed and not claimed;
  - the activity feed;
  - the combined credit and repair;
  - no credit off a combined goal.
- **Why that suite enrols each screen from its own address** in the IPv6 documentation range. Requesting and claiming a pairing both charge the per-IP station limiter (300 a minute). From 127.0.0.1, this suite's hundred-odd enrolments would spend the budget the other station suites share in a parallel run, and a second run within the same minute was refused. Three back-to-back runs on one emulator now pass 65/65 each.
- **`functions-westayfit/tests/expo-prize/guest-never-a-ticket.test.ts`** (5 tests): the raffle proof above.
- **`functions-westayfit/tests/deploy-config/station-guest-contribute.test.ts`** (4 tests): exported callable in `us-central1`, `invoker: 'public'` (with station and member controls), `request.auth` never read, and no `wsfContributions` or member-total write in the handler.

**Run**, from the repository root:

```sh
npx -y firebase-tools@15.30.1 emulators:exec --only firestore,auth --project demo-wsf-local \
  --config firebase.westayfit.emulators.json \
  "cd functions-westayfit && npm run test:callable && npx jest --config jest.expo-prize.config.cjs && npm run test:deploy-config"
```

**Results:**

| Run | Result |
|---|---|
| The new callable suite | **65/65**, and 65/65 three times back to back on one emulator |
| The raffle proof (`guest-never-a-ticket.test.ts`) | **5/5** |
| The deployment shape (`station-guest-contribute.test.ts`) | **4/4** |
| Fail-first: the three new suites against `8a067b29` with only the pure module added | callable **64 of 65 fail** (the passer is the pure window table, which needs no callable); raffle **5/5 fail**; deployment shape **4/4 fail**. Without the module, the callable and raffle suites fail to load. |
| Full callable suite, Node 22.22.2 and Node 20.20.2 | **783/783** in 37 suites each: 718 before, plus these 65 |
| `test:rules`, both Node versions | **28/28** |
| `test:deploy-config`, both Node versions | **21/21** (17 before, plus these 4) |
| Expo-prize suite, both Node versions | **134/135**. The one failure is pre-existing and identical on `8a067b29`: `award.test.ts` row 3, whose shared fixture `startedTurn` calls `wsfStartTurn` without the `expectedTurn` that KIOSK-EXPECTED-TURN-1 made required. Not touched here. |
| `tsc --noEmit`, both Node versions | clean |
| Mutants (39) | **38 killed, 1 equivalent** (below) |

## Staging-proof plan

This plan waits on the pin-anchor hold (#396 `6110993581`) and is run by the staging operator, not W9. Nothing here is a request to deploy.

1. **Pin.** The integrated merge reaches staging only through a reviewed pin in `.github/wsf-staging/approved-candidate.json`:
   - `functions-westayfit` changed, so this is a full-path deploy, never the ledger fast path;
   - the pin adds `wsfStationGuestContribute` to `candidateAddedFunctions`.
2. **Transport.** After the deploy, the receipt reads the new service's transport state, as for every newly added callable. If `wsfstationguestcontribute` is transport-SHUT, that is a post-deploy operator action reported separately from the deployment ("deploy succeeded; feature not yet usable"). It is not a failed deploy.
3. **Hosted proof** on staging, with a synthetic, labelled community and goal (public display authorized, `repeatPolicy: 'multiple'`), a synthetic Champion, and one screen paired through the real pairing flow. Each check uses only callables:
   1. **Retry counts once.** Read `wsfGoalPulse` (total T). Guest move `count: c` with `attemptId` A answers `recorded: true, before: T, after: T + c`. The same call again answers `alreadyRecorded: true, amount: c`. `wsfGoalPulse` reads T + c, not T + 2c.
   2. **Total rises by exactly the count.** Covered by step 1's two pulse readings, with no other movement on the synthetic goal.
   3. **Busy is refused.** A synthetic member joins the line, and a guest move answers `failed-precondition` with the busy sentence. The member leaves, and a guest move records.
   4. **No raffle entry.**
      - The deployed export inventory contains no expo-prize trigger (none exists on this line).
      - The Champion's `wsfCommunityActivity` for the synthetic goal is unchanged by a guest move (its entries and `contributorsToday`). That feed is the `wsfContributions` scan, so this proves no contribution row was written, from callables alone.
   5. **Revoked is refused.** The Champion revokes the screen, and the next guest move answers `permission-denied` "This screen is not enrolled.".
4. **Cleanup.** The synthetic goal is closed. The revoked screen stays revoked. Fixtures are labelled synthetic in their display names.
5. **Receipts.** The operator reports four things separately:
   - deployment;
   - the served marker;
   - transport;
   - the hosted checks.

## Mutants

39 mutants of the callable and its module. Each one ran the three suites in turn (deploy-config, callable, expo-prize), stopping at the first that failed. **38 were killed; 1 is equivalent.**

**Killed**, each by the first suite that failed (the first two failing tests are named):

| Mutant | Change | Killed by |
|---|---|---|
| M01 | station not re-checked in tx | callable: a station revoked after its credential was checked, before the transaction, records nothing |
| M02 | no replay branch | callable: the answer names nothing: no station, attempt, secret or person; a recorded attempt is never refused afterwards: its retry answers after the goal closes, the… (+8 more) |
| M03 | replay answers request count | callable: one after another: the retry answers alreadyRecorded with the stored amount and moves nothing |
| M04 | replay mismatch trusted | callable: a stored row whose source does not match the request is refused, never trusted |
| M05 | closed goal accepted | callable: a goal that is closed refuses a guest and writes nothing |
| M06 | not-started accepted | callable: a goal that is not started refuses a guest and writes nothing |
| M07 | ended accepted | callable: a goal that is ended refuses a guest and writes nothing |
| M08 | non-public accepted | callable: a goal that is authorized only by a truthy non-boolean refuses a guest and writes nothing; a goal that is not authorized for public display refuses a guest and writes nothing |
| M09 | sample accepted | callable: a goal that is in a sample community refuses a guest and writes nothing |
| M10 | missing group accepted | callable: a goal that is in a deleted community refuses a guest and writes nothing |
| M11 | once goal accepted | callable: a goal that is of an unknown repeat policy refuses a guest and writes nothing; a goal that is once per member refuses a guest and writes nothing |
| M12 | waiting ignored | callable: a combined event: somebody waiting on the OTHER activity holds the shared line, so both scre…; somebody waiting for the line: refused at every screen on the goal, and nothing is written |
| M13 | live turn ignored | callable: a live turn at THIS screen refuses it; the other screen, free, takes a guest; the finished t…; an assigned turn whose lease ran out is not live: the screen takes a guest |
| M14 | closed-activity waiter counts | callable: a combined event: somebody still waiting on a CLOSED activity is nobody the line will call,… |
| M15 | lapsed lease counts as live | callable: writes no turn: the line, its entries and both screens are untouched; a live turn at THIS screen refuses it; the other screen, free, takes a guest; the finished t… (+1 more) |
| M16 | rate limit never refuses | callable: 6 moves fill the window; the next is refused and writes nothing; the other screen is unaffected; the window is decided inside the transaction: racing moves record at most the cap |
| M17 | window not stored | callable: 6 moves fill the window; the next is refused and writes nothing; the other screen is unaffected; an expired window starts again; a window more than a whole window in the future is not trusted (+2 more) |
| M18 | shard moves by count+1 | callable: a member contribution with the same attemptId is a different record: both count, neither ove…; is one stored row with no uid, no name and no device detail, and nothing member-scoped (+17 more) |
| M19 | no recent-addition line | callable: a member contribution with the same attemptId is a different record: both count, neither ove…; all at once: exactly one of the racing calls records, and the total rises once (+3 more) |
| M20 | recent line named by bare attemptId | callable: a member contribution with the same attemptId is a different record: both count, neither ove…; attempt ids are the station's own: the same id at the other screen is that screen's own guest (+1 more) |
| M21 | no combined credit | callable: a combined child: the parent is credited once, by a row with no uid, and the repair finds it… |
| M22 | combined shard moves double | callable: a combined child: the parent is credited once, by a row with no uid, and the repair finds it… |
| M23 | pulse cache kept | callable: the public pulse is fresh at once, not a cached pre-move total |
| M24 | crossing never claimed | callable: a guest move that carries the goal over its target claims the crossing, naming no attempt |
| M25 | receipt ignores display gate | callable: a retry after the goal stops being public answers without the shared total |
| M26 | attemptId unchecked | callable: attemptId "has space1" is refused and writes nothing; attemptId "has~tilde1" is refused and writes nothing (+6 more) |
| M27 | count uncapped | callable: count 1.5 is refused and writes nothing; count 100001 is refused and writes nothing (+1 more) |
| M28 | goal from the request | callable: is one stored row with no uid, no name and no device detail, and nothing member-scoped; the station names the goal: a goalId in the request is ignored |
| M29 | uid stored on the move | deploy-config: its handler never reads request.auth, and authorizes by the station credential |
| M30 | public invoker dropped | deploy-config: it is reachable by a signed-out kiosk, as every station callable is |
| G01 | guest rows in wsfContributions | callable: a member contribution with the same attemptId is a different record: both count, neither ove…; is one stored row with no uid, no name and no device detail, and nothing member-scoped |
| G02 | link id not per station | callable: attempt ids are the station's own: the same id at the other screen is that screen's own guest |
| G03 | future window resets (pre-fix rule) | callable: nextGuestRateWindow, the whole table; the window is decided inside the transaction: racing moves record at most the cap |
| G04 | cap off by one | callable: 6 moves fill the window; the next is refused and writes nothing; the other screen is unaffected; nextGuestRateWindow, the whole table (+1 more) |
| G05 | window never expires | callable: an expired window starts again; a window more than a whole window in the future is not trusted; nextGuestRateWindow, the whole table |
| G06 | before given on a replay | callable: a recorded attempt is never refused afterwards: its retry answers after the goal closes, the…; one after another: the retry answers alreadyRecorded with the stored amount and moves nothing |
| G07 | recorded always true | callable: a recorded attempt is never refused afterwards: its retry answers after the goal closes, the…; a retry after the goal stops being public answers without the shared total (+2 more) |
| G08 | move id not per station | callable: attempt ids are the station's own: the same id at the other screen is that screen's own guest |

**Equivalent:** M31 drops the "no crossing yet" pre-check before the post-commit shard read. `recordTargetCrossing` re-reads `reachedAt` inside its own transaction and claims nothing when it is set, so the pre-check only saves one shard read on a goal already past its target. No behaviour changes.

**Not mutated:**
- **The read of the line document inside the transaction.** It orders a guest move against a join that commits concurrently, and no sequential test can observe it.
- **The `assignedStationId` term of the live-turn test.** The station's own `serving` pointer already selects the entry, so on any reachable state the term is redundant.
