# E3 — Challenges, moves, and check-ins

**Dispatch spec · 2026-09-05 · Code task · Implementation owner: Maia**
Parent: M-U4. Approved 2026-09-05. Governed by `WE_STAY_FIT_MASTER.md`.
Depends on: E2 (a person must be able to join before they can check in).

## Primary workflow — the only one

> A member sees what the community is doing, marks that they did one of them, and watches
> the shared number move.

**This is the product at FitLife.** Everything before it is plumbing to get someone here,
and everything after it is presentation. The FitLife brief names the whole point:
*"I did that"* becomes *"We did that."*

---

## 1. The shape FitLife actually needs

The charter models challenges as multi-day programmes — `duration_days`, day numbers,
streaks. **FitLife is not that.** It is one five-hour window in which someone does a
handful of discrete things: a fitness class, the walk, a vendor activity, moving with
their family.

So: a **challenge** holds a set of **moves**, and a move is one discrete thing a member
can complete. `dayNumber` stays on the model but is nullable and unused at FitLife. That
covers a future 30-day walking challenge without building for it now.

"Move" is also the right word rather than an accident — the master doc mandates *movement*
over *exercise*, and the working event identity is *FitLife Moves*.

---

## 2. The failure mode that would take down the event

> ### A single Firestore document sustains roughly one write per second.

A naive `wsfChallenges/{id}.completedCount` increment is one document. Average load at
FitLife is trivial — maybe 2,000 check-ins across five hours, 0.11/sec. **The average is
not the problem.** The emcee says "everyone do this now," a hundred people tap within
thirty seconds, and that is 3+ writes/sec against one document. Writes contend, retry, and
fail.

That happens at the loudest, most-watched moment of the activation — precisely when the
counter is the thing everyone is looking at.

**Required: a sharded counter.** `wsfChallengeCounters/{challengeId}/shards/{0..9}`. Each
check-in increments one shard chosen at random; any read sums the ten. Ten shards gives
~10 writes/sec, comfortably past any burst this event can produce.

Do not defer this as an optimisation. Discovering it on October 11 is not recoverable.

---

## 3. No `firestore.rules` change — deliberate, and time-boxed

E2 established the pattern; E3 keeps it. **All reads and writes for challenges go through
callables.** `git diff -- firestore.rules` must be empty.

The reasoning is the same: a rules deploy replaces the **entire live ruleset including
GoArrive's** (R-9, GATE 0). With 23 days to the event, putting that on the critical path
buys nothing and risks the coaching platform.

**State the cost honestly, because this is a trade and not a free win.** Callable-only
means an extra round trip on check-in and no Firestore listener for live updates. Both are
acceptable here — the kiosk polls (one device, one poll every 3s is nothing) and the member
gets the new total in the check-in response itself. Set `minInstances: 1` on the check-in
callable so a cold start does not put a two-second pause between a person's tap and their
number moving.

**This is an Expo-window decision, not the permanent architecture.** Rules-based reads are
the correct long-term design and are a named post-Expo follow-up. Do not let the callable
pattern silently become the default everywhere.

---

## 4. Scope

### In — data (all new, additive)

| Collection | Purpose |
|---|---|
| `wsfChallengeTemplates` | Curated, staff-approved starter content. Not member-authored. |
| `wsfChallenges` | A challenge running inside one community group. Fields include `groupId`, `title`, `status` (`draft`/`active`/`completed`), `goalTarget` (**nullable**), `startsAt`, `endsAt`. |
| `wsfChallengeMoves` | One discrete completable thing. `challengeId`, `title`, `instructions`, `sequence`, `dayNumber` (nullable), optional `locationLabel` for expo placement. |
| `wsfCheckIns` | `{moveId}_{membershipId}` as the document ID — deterministic, which is what makes idempotency free. |
| `wsfChallengeCounters/{challengeId}/shards/{n}` | Ten shards. See §2. |

**`goalTarget` is nullable and admin-set.** Devin was explicit that the goal number is not
decided and "2,000 challenges" is illustrative. **Do not hardcode any number anywhere.**
If no goal is set, the display shows totals without a percentage.

### In — callables

- `wsfListChallenge({ groupId })` — the active challenge, its moves, which the caller has already completed, and current aggregates. Members only.
- `wsfCheckIn({ moveId })` — the one that matters. Transaction: verify membership → create the check-in document if absent → increment a random shard. Already checked in returns success with `alreadyCheckedIn: true`, **never an error**. Returns the new totals so the member's number moves without a second round trip.
- `wsfChallengePulse({ challengeId })` — public-safe aggregates for the kiosk display: participant count, completed count, goal if set. **No member identities, ever.**

### In — member UI

The challenge list on the community page, and a check-in control per move. Optimistic:
tick immediately, reconcile on response, roll back visibly if it fails.

### In — seeding

A script that creates the FitLife community, its challenge, and its moves. Run by hand
before the doors open. **Manual is fine and honest here** — the master doc permits manual
back-office at the Expo, provided it is not disguised as automation.

### Out — do not build

Custom challenge authoring by members · workout uploads · health data of any kind ·
leaderboards · streaks and day-based progression · challenge history · scheduled or
recurring challenges · the Pulse *display screen* itself (that is E5; E3 provides the data
it reads) · anything touching `firestore.rules`.

---

## 5. Acceptance criteria

Emulator-verified through the GATE 1 harness:

1. A joined member sees the active challenge and its moves.
2. Checking in increments the total by exactly one, and the member sees the new number.
3. **Checking in twice increments by exactly one.** Assert the total, not just the absence of an error.
4. Two members checking in concurrently produce a total of two — no lost update. Drive this concurrently, not sequentially; a sequential test cannot fail the way production does.
5. **Burst test: 50 concurrent check-ins produce exactly 50.** This is the §2 failure mode. Nothing else in this spec is worth as much as this test.
6. A non-member calling `wsfCheckIn` is refused.
7. `wsfChallengePulse` returns no member identity under any input.
8. Groups flagged `isSample` are excluded from any total presented as real.
9. `git diff -- firestore.rules` is empty.
10. E2 and M-U2 flows unchanged; full suite green.

Report `E3: <ACCEPTED|BLOCKED> — n/10` with raw output. Label every claim
**EMULATOR VERIFIED** or **LIVE VERIFIED**.

---

## 6. Do not

- Deploy. This ends at a green gate and a pushed branch.
- Touch `firestore.rules` or `firestore.indexes.json`.
- Hardcode a goal number.
- Count sample data into any real total.
- Collect anything about a body: weight, measurements, calories, heart rate, medical detail. The master doc's prohibited list is not advisory.
- Build a leaderboard. Explicitly deferred, and the FitLife framing is collective rather than competitive — a ranking actively undercuts *"We did that."*
- Store a raw administrative token in anything that reaches a printed QR.

---

## 7. Open decision — flagged, not decided

**How does a check-in get verified at the event?**

Three options, real trade-offs:

- **Honour system** — tap "I did this." Fastest, warmest, most in keeping with the brief. Inflatable, and the success metric is the numbers being real.
- **QR at the location** — scanning a vendor's or activity's code performs the check-in. Much harder to game, makes vendors part of the challenge network (the strongest part of the FitLife concept), and requires per-location codes printed in advance.
- **Mixed** — QR where a code exists, honour system elsewhere.

**Devin decides, and it affects printed materials, so it has a lead time — it cannot slip
to October.** Build the check-in path so the move carries an optional `requiresCode`, and
default to the honour system until he chooses. That keeps the decision a data change
rather than a rewrite.
