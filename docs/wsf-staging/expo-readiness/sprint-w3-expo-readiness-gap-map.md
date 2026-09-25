# Expo readiness gap map — the six owner requirements against the source

**INTENDED DESTINATION:** `docs/westayfit/qa/sprint-w3-expo-readiness-gap-map.md`.
Parked here because this worker may push only to its own branch, which carries neither
`apps/westayfit/` nor `docs/westayfit/`. It moves unchanged.

**Read at** `ba774eff7656af27109414c8ccaf4833025ed0bb` — `claude/wsf-app-shell` as fetched
2026-09-23 03:2xZ. The packet (`5787406362`) named `a193b430`; the pickup check
(`5788268244`) named `c8f38e37`; the head had moved again by the time I read it. What
moved between `c8f38e37` and `ba774eff` is nine commits, all the responsive public
display (`2953750f`…`ba774eff`) — no route added, no callable changed.

**What this is.** One pass, source-verified, against the existing FLOW board, route index
and atlas. It is not a tracker, not a strategy restart, not an implementation assignment.
Every status below was re-derived from the route file, the callable or the run receipt
named beside it; nothing is carried from another document's claim.

**What this is not.** No live service, IAM or mail call was made. No browser was driven.
The vitest and jest suites could not be executed here (no `node_modules` in this
container), so a test is cited as *present and naming the case*, never as *passing today*.

**Correction, 05:3xZ, after first delivery.** The first version of this map called `d0477cc`
"the staging candidate" and "the served build" throughout. **That was wrong.** Staging was
promoted to **`c8f38e3`** by run 46 (`35810257325`, dispatched 02:24:57Z from `main`
`340e1417`, the #437 pin) — an hour before this map was written, and I had already seen
that pin on `main`. I took the packet's 01:30Z context line on trust instead of checking.
Every statement below now names the served `c8f38e3`, and the correction *strengthens* the
central finding rather than weakening it: `functions-westayfit/src` is byte-identical at
`d0477cc`, `c8f38e3` **and** the head, so the 46 callables are the same ones at whichever
of the three you measure from. No other conclusion changes. (Run 46's hosted rows are
`24 / 0` like run 45's, and `c8f38e3` is itself pre-responsive-display, so the one gap that
turned on this — the responsive display having no hosted receipt — is unaffected.)

---

## The one-line answer

Every one of the six requirements has routes **and** deployed callables at this head, and
five of the six have end-to-end evidence against a **served** staging build — run 45 at
`d0477cc`, re-run as run 46 at the now-served `c8f38e3`.
The readiness gap is not missing capability — it is that **two of the three documents a
reader would consult understate what exists**, and that the one thing genuinely unproven
is a physical room, not a contract.

---

## The requirements

Legend, kept from `PhysicalFlowBoard.tsx` rather than invented:
**BUILT** a route or callable does this today · **HOSTED** additionally exercised
end-to-end against a served staging build (run 45 at `d0477cc`, run 46 at the served
`c8f38e3`; the rows quoted here are run 45's, which I read verbatim) · **PROOF NEEDED** contract holds,
never driven on real hardware with real people · **SEAM** named capability the product
does not have.

| # | Owner requirement | Routes | Callables | State |
| --- | --- | --- | --- | --- |
| 1 | Two equivalent interactive stations | `/station/[goalId]` (1458 lines) | `wsfStationRequestPairing` `wsfStationPairingStatus` `wsfStationClaimPairing` `wsfApproveStation` `wsfRevokeStation` `wsfListStations` `wsfStationState` `wsfCallNext` `wsfStartTurn` `wsfCompleteTurn` `wsfCancelTurn` `wsfTurnState` | **BUILT · HOSTED** — simultaneous contention unit-tested only |
| 2 | QR / mobile entry | `/station/[goalId]` renders both QRs · `/join/[joinCode]` · `/event/[goalId]` | `wsfPreviewCommunity` `wsfJoinCommunity` `wsfEventContext` | **BUILT · HOSTED** |
| 3 | Phone or queue | `/event/[goalId]` · `/queue/[goalId]` | `wsfJoinTurnLine` `wsfMyTurn` `wsfTurnReady` `wsfCompleteMyTurn` `wsfLeaveTurnLine` | **BUILT · HOSTED** |
| 4 | Movement choice | `/event/[goalId]` (the event's frozen list) · `/move` · `/move/[goalId]` | `wsfEventContext` `wsfListGoals` `wsfGoalPulse` | **BUILT · HOSTED** (the choice; the follow-along player itself is not in any hosted row) |
| 5 | Multiple movements toward one shared goal | creation on `/community/[groupId]` · watch on `/combined/[setupId]` | `wsfCreateCombinedGoal` `wsfCombinedGoalPulse` `wsfCloseCombinedGoal` `wsfRepairCombinedGoal` `wsfAdjustGoal` | **BUILT · HOSTED** |
| 6 | A separate collective display | `/display/[goalId]` (946 lines) | `wsfGoalPulse` `wsfGoalRecentAdditions` `wsfSetGoalDisplayAuthorization` | **BUILT · HOSTED** at the served build; the responsive tiers are newer than it · **SEAM**: no QR-to-join |

### 1 — Two equivalent stations

`STATION_SLOTS = [1, 2]`, and the label is derived server-side from the slot
(`stationLabelForSlot`), never taken from the request — so "Station 1" on a screen means
the slot the Champion approved. A station's identity is a minted secret stored only as a
sha256 hash and compared in constant time, not an account, because
`app/kiosk/[goalId].tsx` signs a shared device out on focus and an account would be signed
out from under a screen standing in a hall.

Equivalence is real in the sense the requirement means it: either station may call from
the same line, and `functions-westayfit/tests/callable/wsf-turn.test.ts:609` names *"two
stations calling at the same instant cannot assign the same person."*

**Hosted evidence** (run 45, `hosted-verify` job `106988007923`), quoted exactly:

> `PASS hosted turn-service contract — two stations enrolled and approved; an independent
> participant read the event without joining, joined explicitly, gave the place back by
> switching to their own phone, was called and let the 45-second lease expire and recovered
> their place, rejoined, was called, refused an outsider at the ready gate with the generic
> not-found, readied, started at the screen and recorded 12 from their phone once — a phone
> retry and a screen retry both added nothing; the chosen activity and the combined parent
> each hold 12, the unchosen activity 0; the screen cleared and the ten-second result
> expired`

That single row carries requirements 1, 3, 4 and 5 against a served build.

**Still PROOF NEEDED:** two *simultaneous* callers. The hosted row enrols two stations; it
does not have both call at the same instant. That contention is covered by the callable
test above and by nothing hosted.

**Smallest next slice:** none, at code level. The remaining step is an on-site rehearsal
with two physical screens — an operator task, not an implementation one.

### 2 — QR / mobile entry

`/station/[goalId]` imports `encodeQr` / `qrSvgDataUriRaw` (line 49) and builds **two**
addresses — `buildEventJoinUrlFromScreenedCode` and `buildEventUrl` — one that admits a
newcomer to the community, one that takes an existing member to this event. No secret,
pairing id or authority rides in either; the station credential travels in a callable body
and nowhere else.

Before any account exists, the device is asked whose screen it is (`src/deviceMode.ts`,
one of two literal words in this browser's `localStorage`, never sent anywhere). `shared`
hands off to `/kiosk/<goalId>`.

**Hosted evidence:** `PASS guided rules, share + momentum, join QR (W4/W7/W8) — … Champion
QR inside Manage encodes the fixture join link`, and `PASS public dynamic route reload —
/combined/** and /station/** each answered a direct cold GET with their own exported
document`.

### 3 — Phone or queue

`/event/[goalId]` offers two ways on and puts nobody in a line until one is picked; the
queue name is chosen by the person it is about before anything is sent. The hosted row
above walks the switch in both directions, including a 45-second lease expiring and the
place being recovered.

**SEAM, already recorded and still open:** the queue's shipped copy says the name *"goes
when your place does."* Nothing deletes a `wsfTurnEntries` document and there is no TTL.
This is the atlas's own finding (`review/batch-d-event-and-line/README.md`); I re-checked
it at this head and it still holds. It is a copy-or-TTL decision, not a design gap.

### 4 — Movement choice

There is no global movement catalog and none is drawn. A goal is a title, a whole number
and a `unit` the Champion typed (1..40 chars). `src/activityGuides.ts` turns that free text
into a counting guide through one table — counting rules only, with `GUIDE_BANNED_WORDS`
enforced over every string by `tests/activity-guides.test.ts` so no guide can become
instruction or a health claim.

The choice at the event is between the activities that event is configured to count.
A scan does **not** make the choice: `src/eventActivity.ts` carries the scanned activity in
sessionStorage and `initialSelection` deliberately refuses to pre-select it — *"a scan says
how somebody GOT here; it does not say what they have decided to do."*

**Not hosted:** the follow-along player on `/move/[goalId]` appears in no run-45 row. It
counts nothing and watches nobody, so the risk is presentational, not arithmetic.

### 5 — Multiple movements toward one shared goal

This exists and is the most carefully built thing in the tree. Creation is a real
Champion-facing flow on `/community/[groupId]` (`wsfCreateCombinedGoal` with
`childGoalIds`); `/combined/[setupId]` is a read-only live view by design, not a setup
flow. The parent has its **own** sharded counter that starts empty, one active claim per
child enforced by the claim document's own id, and a durable credit row per credit — the
explicit fix for an earlier implementation that back-filled a parent from children's
lifetime shards.

The hosted row proves the property that matters: `the chosen activity and the combined
parent each hold 12, the unchosen activity 0`.

**Owner decision it waits on:** none technically. The atlas rule *"units are never summed
across goals — the one place the product adds across activities is a combined goal, via
`countsAs: 'repetition'`, and the line that bridges them names no unit at all"* is the
product answer to "one shared goal across different movements". If the owner expects a
shared total expressed in a *unit* rather than in repetitions, that is a product decision
and it has not been asked.

### 6 — The collective display

`/display/[goalId]` shows the shared total and recent movement, takes no input, runs no
turn and holds no session. It is gated on the Champion's explicit, revocable per-goal
`aggregateDisplayAuthorized` — default off.

**SEAM, verified at this head:** the display renders **no QR and no join control**. It
imports no encoder and no join URL builder (I checked its import list); the station does.
The route says so itself at `app/display/[goalId].tsx:735`. Batch F draws the seam; the
route does not have it.

**The one place where staging and the tree differ meaningfully.** `functions-westayfit/src`
is **byte-identical** at `d0477cc`, at the served `c8f38e3` and at this head — so all 46
callables behind every requirement above are the ones already deployed and exercised,
measured from any of the three.

Against the **served** `c8f38e3` the app differs by exactly three source files / 879
insertions, and all three are this route: `app/display/[goalId].tsx` +210, the new
`src/ui/displayLayout.ts`, and its capture spec. (Against `d0477cc`, the run-45 baseline,
it is 11 files / 1,853 — that figure describes the older comparison, not the current one.)

Both run 45's display evidence (`15-phone-public-display.png`,
`16-wide-authorized-display.png`) and run 46's are of a **pre-responsive** build: the
responsive work integrated at `ba774eff`, after the `c8f38e3` that run 46 pinned and
served. Nothing has regressed — the responsive display simply has no hosted receipt yet.

**Smallest next approved slice:** a staging deploy at a pin naming a head that carries the
responsive display, so the display rows re-run against it. That is the existing
pin-and-deploy path — #437 pinned `c8f38e3` and run 46 served it, and `c8f38e3` predates
the responsive work; no new mechanism, one more turn of the same crank.

---

## Findings — three documents that a reader would be misled by

These are the actual readiness gaps. None is a missing feature.

### F1 · `ROUTE-TARGET-INDEX.md` reports eleven working routes as "NOT implemented"

The generated table says **12** routes implemented. That number comes from `IMPLEMENTED`,
a hand-kept array at `scripts/westayfit/route-target-coverage.mjs:275`. At this head it
omits `/station/[goalId]`, `/queue/[goalId]`, `/event/[goalId]`, `/display/[goalId]`,
`/kiosk/[goalId]`, `/move/[goalId]`, `/goals/new`, `/start-community`,
`/combined/[setupId]`, `/community/[groupId]/challenge` and `/`.

Each of those is a substantial implementation — `/station` 1458 lines calling nine
callables, `/goals/new` 1036, `/display` 946, `/event` 855, `/queue` 832, `/` 753,
`/challenge` 455, `/kiosk` 408 — and six of them are named in run 45's rows: `/station`
and `/combined` (route reload), `/display` (two capture rows), `/kiosk` (W9), and `/event`
with `/queue` inside the turn-service row.

The register tracks the narrower claim *"implemented against an approved target"*, which
is a fair thing to track. But the per-route Notes render it as a flat **"NOT
implemented"**, which as a statement about the product is false, and the index is the
first document anybody consults about readiness. The document already warns that keeping
this register honest is a person's job; the register is now the stalest thing in the
package.

**Smallest fix:** distinguish the two in the script — *not built to the accepted target*
versus *does not exist* — and refresh the register. One file, generated tables, no product
change. It is `--check`-enforced, so the drift will not recur once the distinction exists.

### F2 · The station privacy comment is now false, and it is the load-bearing one

`functions-westayfit/src/index.ts:5166` states, as the definition of a station:

> `WHAT A STATION IS DELIBERATELY NOT ABLE TO DO. It cannot record a contribution …`
> and `nothing here writes wsfContributions, wsfGoalCounters or wsfGoalMemberTotals.`

`wsfCompleteTurn` (line 8910), authorized by the **station secret**, does exactly that —
its own header says so: *"IT RECORDS THE CANONICAL ATTEMPT, through performContribution,
under every gate the contribute page is under."*

Both statements are in the same file, 3,700 lines apart. The second is the current
behaviour; the first was written when station enrolment landed and was not revisited when
the turn service was added.

This matters more than a stale comment usually does, because the no-account station design
is *justified* by that paragraph. The accurate version is narrower and still strong: a
station records only the attempt **it started, for the entry it is serving, on its own
line**; it never names a uid, and it is told back a number and a unit, never a member
total or a name. Nothing about the security posture changes — only the sentence.

**Smallest fix:** correct the comment at 5166–5177 to say what the station can and cannot
do today, and point it at `wsfCompleteTurn`. Comment-only, no behaviour.

### F3 · `PhysicalFlowBoard.tsx` cites a callable that does not exist, and understates its own evidence

Line 38: *"`wsfCallNextTurn` takes a `stationId` and a secret."* No such export exists
anywhere in the tree. The callable is **`wsfCallNext`** (line 8511), and the substance of
the claim is correct — it authorizes on station id plus secret, and the contention test the
board cites is real, at `tests/callable/wsf-turn.test.ts:609`. A reader who follows the
citation finds nothing; a board whose whole purpose is inspectable status should survive
being checked.

Second, the board's foot block reads *"The server contract holds and is **unit-tested**;
the room is not."* Since run 45 that is an understatement: the contract has been driven
end-to-end against the **served** build, over the network, in one hosted row. The board's
literal claim — that two paired screens, a real line and people walking between them has
never happened — remains true, and should stay. What should change is "unit-tested", which
now undersells the evidence by a whole tier.

**Smallest fix:** rename the callable in the docstring; change "unit-tested" to name the
hosted row. Comment-and-copy only, inside a gated preview route that no deployed artifact
can serve.

---

## Where the real gap is

Nothing in the six requirements is waiting on code that does not exist. Three things are
genuinely open, and only the first is engineering:

1. **The responsive display has no hosted receipt.** Runs 45 and 46 both captured the
   pre-responsive build (`c8f38e3`, which run 46 served, predates it). A deploy at a pin
   naming a head that carries it re-runs the two display rows. Existing path.
2. **Two simultaneous callers, and a physical room.** Covered by a callable test, not by
   hardware. This is the on-site rehearsal, and it is an operator task.
3. **Email.** Run 45's row is `PASS signup verification gate (D-1) — gate held 6s with no
   return to the signup form; verification send blocked in the browser`. That is a gate
   passing, not a message delivered. Unchanged, and on the operator's track.

## Owner decisions this map does not resolve

Both already recorded in `ATLAS.md`; neither is re-opened here, and neither blocks the six
requirements:

- The `/goals/new` **unit-shortcut proposal** (tiles from `ACTIVITY_GUIDES` beside the free
  text field) versus Batch B's free-text-only target. They compose; which ships is a
  product call.
- Whether `/community` should carry a **Join** control, live again since the premise for
  removing it (that a typed join code is not accepted) turned out to be false.

## Scope

Read-only everywhere but this file. No product, shared test, schema, backend or UI copy was
changed; W1B's kiosk files, W4's `start-community` / `index.tsx`, W2's display files and
W6's goal-setup files were read and not touched. No staging, cloud, mail or credential use;
the run-45 figures come from the GitHub job log, which needs only repository read.
