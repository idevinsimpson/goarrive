# Page 4 · Progress — BEFORE, TARGET and AFTER

**`/activity` is implemented (Phase A).** The gate ran in full: ACTUAL BEFORE
→ reviewed TARGET → ACTUAL AFTER → visual acceptance.

The contract for the callable that a private consistency view would need is
in `PRIVATE-HISTORY-CONTRACT.md`. It is **not built** in this slice.

- `before/` — the product as it renders today, captured before any Progress
  target existed. **Frozen**: the capture spec is opt-in (`WSF_CAPTURE_BEFORE=1`)
  and `npm run check:evidence` fails if a routine run changes a byte.
- `TARGET-*.png` — real React Native from the real kit, through the gated
  preview route `/design-target/progress`. Each frame carries its own
  `TARGET / CONCEPT — NOT IMPLEMENTED` strip **inside** the captured element,
  and the capture asserts the strip is there, says what it says, sits flush
  inside the frame's 1px border and spans its width.

## The data audit, done before anything was drawn

The brief asked for this first, and it decided the design.

### Reachable, and used

| Fact | Source |
| --- | --- |
| The member's own part on a goal | `wsfMyContribution` → `ownCredit`, `unit`. Private by construction: the path is built from `request.auth.uid`, so a caller can only ever read their own. |
| Active vs completed goals | `wsfListGoals` → `status` |
| Whether a goal was reached, and when it ended | same → `reachedAt`, `endsAt`, `closedAt` |
| The goal's own shared total and target | same, with `includeHistory` → `sharedTotal`, `target`, `unit` |
| Which community a goal belongs to | `wsfMyCommunities` |

### Exists in storage, and is **not** reachable

`wsfContributions/{goalId}_{uid}_{attemptId}` stores **`createdAt`, a server
timestamp, one document per contribution** — real, timestamped, personal
history. `wsfGoalMemberTotals` stores `contributionCount`.

**Neither is returned by any callable.** `wsfMyContribution` answers with
`ownCredit`, `unit` and `repeatPolicy` and nothing else — no dates, no counts.
And the client cannot go around it: `firestore.rules` names only
`wsfMemberProfiles`, `wsfCommunityGroups` and `wsfMemberships`, so
`wsfContributions` and `wsfGoalMemberTotals` fall through to
`match /{document=**} { allow read, write: if false; }`.

### So: no streak, and no dated personal history

A private consistency view — a streak, "you moved on these days", "you have
recorded N times" — needs a dated list of the member's own contributions.
Today nothing can hand the client one, and **a target that needs new backend
behaviour to be true is a target that lies**. None is drawn.

**The seam, recorded rather than built:** the history already exists and is
already written on every contribution. One callable publishing a member's own
`{count, unit, createdAt}` rows would make a truthful private consistency view
possible. What that callable would have to promise — scope, authorization,
pagination and bounds, idempotent attempts, timestamp and day-boundary
semantics, and retention — is written out in `PRIVATE-HISTORY-CONTRACT.md`.
It needs explicit owner and privacy review before any backend work.

## What the BEFORE does, and what the target undoes

| BEFORE | Why it is a problem | What the target does |
| --- | --- | --- |
| Two flat cream cards over roughly half a screen of empty page. | It is a list, not a record. Nothing carries weight and nothing is celebrated. | A summary that counts goals, then what you're part of now, then what you've been part of. |
| **Finished goals are dropped entirely** — the screen filters to `status === 'active'`, so 260 push-ups toward a goal the community *reached* simply vanishes. | The member's own record of what they completed is the most rewarding thing this page could hold, and it is thrown away. | **What you've been part of** — the finished goals, your part in each, whether the goal was reached, and when it ended. |
| Your part floats with no context: `120 squats`, and nothing about the goal it went into. | A number with nothing around it is hard to feel anything about. | The goal's own state sits under your part — total of target, percent and a slim track — so your part has somewhere to belong. |
| Serial nested reads: communities → goals → `wsfMyContribution`, one await at a time. | An N+1 chain whose latency grows with every community and every goal. | Recorded as an implementation note for the AFTER, not a drawing concern: bounded and parallel, the way `/community` now reads goals. |

## The state matrix

| State | 390×844 | 390×640 | 430×932 |
| --- | :---: | :---: | :---: |
| Running and finished | ✓ | ✓ | ✓ |
| Nothing finished yet | ✓ | | |
| Nothing recorded yet | ✓ | ✓ | ✓ |
| Loading | ✓ | | |
| Could not be loaded | ✓ | | |

## What these frames refuse, and why

- **No streak.** See the audit. The data is unreachable, so the claim would be
  invented.
- **No total across goals.** 120 squats and 45 step-ups do not add up to 165
  of anything. The summary counts **goals**, which is provable.
- **No ratio of your part to the shared total.** Both numbers are real, but
  "your 120 of 1,847" invites a member to read 6% as a verdict on themselves,
  on the one screen that promises not to score them.
- **No ranking, no comparison, no other member's figure.** The data this
  screen can see does not contain anyone else, and it stays that way.
- **No recent-movement ticker.** `wsfGoalRecentAdditions` is real, but it is
  **anonymous and community-wide**. Showing it here as "your recent movement"
  would present other people's contributions as the member's own.
- **One Living WE**, on the most recent goal the community actually finished,
  filled by that goal's **real final shared total** against its target. A mark
  filled to the top is the celebration. It is not decoration, and it is not
  attached to anything invented.
- **"Recorded" is the word throughout**, as it already is in the shipped
  screen. The system knows a contribution was recorded. It has never known
  that a person exercised, and Progress must not be the surface that implies
  it.

## Open, and explicitly not claimed

- Multi-movement selection remains separate later scope.
- Phase A is implemented; the private-history callable is **not**, and is
  gated on owner and privacy review.
- No You, no auth, no kiosk/event administration, no staging, no merge and no
  release work is part of this package.
