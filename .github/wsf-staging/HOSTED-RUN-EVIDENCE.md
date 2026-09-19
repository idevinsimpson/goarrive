# WSF staging — cumulative hosted run evidence

What each hosted run actually established, and what it did not. Kept beside the
harness so the record and the code move together.

**Rule this file exists to enforce:** a green board is not evidence. A row proves
only the thing it asserts, on the run it asserted it.

---

## Run 28 — `35466096879`, main `eb3cc7f`, app `42dd32a`

- Served SHA `42dd32a`, `HOSTED_MARKER_MATCHES=true`, `VERIFY=pass`, inventory 46 → 46,
  nothing created. Incomplete-deployment guard **skipped** (it fired on run 27 attempt 1).
- Transport **22/22** by exact service name, all 23 candidate services
  `invoker_iam_check_disabled`, including the twelve that had been shut all day.
- **Public dynamic route reload — PASS**, first execution in history.
- **Hosted turn-service contract — FAIL** at the first call:
  `create combined goal: application refusal (FAILED_PRECONDITION)`.
  The ROW was wrong. `seedFixture` stamps children at its own now−60s and the case
  re-read the clock afterwards, so the parent began after its own children and the
  server correctly refused (`child.startsAt >= combined.startsAt`).
- Cleanup `COMPLETE`, 312/312. **`LINKED_DOCUMENTS_VERIFIED=0`** — the row died before
  any server-named document existed, so the linked path did **not** run. `COMPLETE`
  here was a true result for a run with nothing linked to clean.

## Run 29 — `35467140356`, main `0ba01f7`, app `42dd32a`

- Served SHA, transport and route-reload row unchanged and green.
- **Turn row — FAIL** at `station state: application refusal (NOT_FOUND)`, three steps
  further. The ROW was wrong again: `wsfStationState` serves the hall through
  `readGoalPulseTotals(goalId, null)` — the display route — which is gated on the goal's
  `aggregateDisplayAuthorized`. A station holds no membership, so a screen cannot show a
  goal whose Champion never authorized its public display. The row was skipping the step
  a real room takes.
- Cleanup `COMPLETE`, 339/339. **`VERIFIED=0`, `ALREADY_ABSENT=5`.** The manifest carriage
  and the in-smoke deletion of linked documents both ran for the first time; the
  **content-verification branch still did not**, because every linked path had already
  been deleted before the verifier looked. Recorded at the time as *not* meeting the
  non-zero-`VERIFIED` criterion.

## Run 30 — `35469822295`, main `75c3976`, app `42dd32a`

- Served SHA `42dd32a`, transport 22/22 by name, route-reload row PASS (third run).
- **Turn row — FAIL** on the **last arithmetic assertion**:
  `the combined parent holds undefined, expected 12`. The ROW again: `wsfGoalPulse`
  returns `sharedTotal`, `wsfCombinedGoalPulse` returns `combinedTotal` — the setup's own
  shards since activation, not a sum of the children's lifetime counters. Both child
  pulses passed in the same block, which is what pins it to the field rather than the
  arithmetic.
- **What run 30 did prove on staging**, in order: combined goal creation · display
  authorization · two pairings · two approvals · two claims · station state · event
  context · a scan does not enqueue · explicit join · leave-as-switch-to-phone · **the
  real 45-second lease expiring** · **the rejoin that recovered the place** · call next ·
  **the outsider refused at the ready gate** · ready · start · **phone completion** ·
  the phone retry · the cross-surface station retry · both child pulses at 12 and 0.
- Cleanup `COMPLETE`, 349/349, evidence scan clean.
  **`LINKED_DOCUMENTS_VERIFIED=2`, `ALREADY_ABSENT=9`.** First non-zero `VERIFIED`: the
  live-content verification branch — reading a stored document to confirm it references
  its declared owner before admitting it — executed against staging across 11 linked
  documents. The criterion carried since run 28 is **met**.

---

## Still not established by any run

- **The browser/player journey.** No hosted row opens a browser against the turn flow.
  Scan, explicit activity selection, the shared follow-along player, rep review, the hall
  clearing and the station session ending are **not covered**, and a green turn-service
  row does not cover them. That gate is separate and open.
- **The turn row has never fully passed.** Runs 28, 29 and 30 each failed later than the
  last; none reached its PASS row.
- **The uid/path-linked cleanup branch** (`wsfTurnMembers`, `wsfTurnReceipts` admitted by
  the member uid in their own path) has still not been observed, because the row has not
  yet created those documents on a run that reached the verifier with them present.
