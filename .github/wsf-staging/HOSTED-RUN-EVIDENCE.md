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
  **`LINKED_DOCUMENTS_VERIFIED=2`, `ALREADY_ABSENT=9`**, 11 linked documents in total.

  **Corrected 2026-09-19 22:02Z — my first reading of these two numbers was wrong, and
  in the flattering direction.** `linkedDocumentsVerified` is incremented by *two*
  different branches: the path-linked branch (`docPath.includes(via)` → admitted with
  **no read at all**) and the live-content branch (read the stored document, confirm it
  references `via`). The counter cannot tell them apart, so a non-zero `VERIFIED` never
  meant what I claimed it meant.

  What run 30 actually exercised, reconstructed from the smoke's own `trackLinked` calls
  and forced by the arithmetic:

  | linked document | `via` | branch |
  | --- | --- | --- |
  | `wsfCombinedGoals/{setupId}` | `groupId` | read |
  | `wsfKioskPairings/{pairingId}` ×2 | `activityA` | read |
  | `wsfKioskStations/{stationId}` ×2 | `activityA` | read |
  | `wsfTurnEntries/{entryId}` ×3 | `activityA` | read |
  | `wsfTurnLines/setup__{setupId}` | `groupId` | read |
  | `wsfTurnMembers/{lineId}__{uid}` | `uid` | **path** |
  | `wsfTurnReceipts/{lineId}__{uid}` | `uid` | **path** |

  Exactly two paths contain their own `via`, and `ALREADY_ABSENT=9` accounts for every
  one of the nine read-branch documents — all 404, already deleted in-smoke. So
  `VERIFIED=2` is **the two path-linked documents, admitted without a read**, and the
  live-content branch ran **zero** times.

  Run 30 therefore establishes the **uid/path-linked admission branch** on staging. It
  does **not** establish live-content verification. The criterion I carried since run 28
  was itself badly specified: "non-zero `VERIFIED`" cannot distinguish the two branches,
  which is how I came to claim the wrong one.

## Run 31 — `35472452869`, main `5ab03cd`, app `42dd32a`

- **23 PASS, 1 FAIL** (`FAILURES=1`). Served SHA `42dd32a` confirmed by the health marker;
  `app_sha` input checked against `approved-candidate.json` before dispatch. Station
  callable transport row PASS (4/4 reached their handler anonymously). Public dynamic
  route reload PASS — fourth consecutive run.
- **The combined-parent fix is proven on staging.** The row cleared
  `parent.combinedTotal === TURN_COUNT` — run 30's failure point — along with both child
  pulses, and then went further than any previous run.
- **Turn row — FAIL**, at the ten-second station result:
  `the screen shows no result at all in the ten seconds after recording`.
  **The ROW was wrong for the fifth time running; the product is not implicated.**

  Diagnosed in `index.ts` at the served candidate, not assumed:
  - `completeTurnEntry` writes `lastResult: { stationId, code, amount, unit, atMillis }`
    with `stationId = entry.attemptStationId` — the station that STARTED the turn. The
    row started at `stationOne` and read `stationOne`, so this is not a station mismatch.
  - `atMillis` is re-stamped on **every** completion call, including the two idempotent
    retries, so the window starts at the last retry, not at the first recording.
  - `wsfStationState` serves a result only while `now - last.atMillis <
    TURN_RESULT_VISIBLE_MS` (10 000 ms).
  - The row then spent **three more round-trips inside that window** — two `wsfGoalPulse`
    calls and `wsfCombinedGoalPulse`, the last of them very likely a cold start — before
    reading the station state.

  A row that consumes the window it is measuring is not testing the window; it is timing
  staging. By elimination in source, an expired window is the only cause consistent with
  the code — but the run carried no elapsed reading, so this run cannot prove it
  outright.

  **The fix removes the measurement interval entirely rather than shortening it.**
  `wsfCompleteTurn` returns `{ ...readTurnState(...), recorded, anyoneWaiting }` — the
  same projection `wsfStationState` serves, computed immediately after the transaction
  that wrote `lastResult`. The row now asserts the result off that response (code,
  amount, no name, `secondsLeft > 0`), so there is no interval in which the window could
  close, and the only `wsfStationState` after the completion is the one that proves the
  result expired.
- Cleanup `COMPLETE`, 349/349, `EVIDENCE_SCAN=clean`, 23 files.
  `LINKED_DOCUMENTS_VERIFIED=2`, `ALREADY_ABSENT=9`, 11 linked documents — **the same
  composition as run 30**: the two uid-in-path documents admitted by path with no read,
  and all nine read-branch documents already gone. **The live-content branch again ran
  zero times.** Stated this way from the start, rather than corrected afterwards.

## Run 32 — `35474881609`, main `5ab03cd`… merged `657f656`, app `42dd32a`

- **24 PASS, `FAILURES=0`.** All five jobs green, and the **"Preserve an incomplete
  functions deployment" guard was skipped** — the independent signal that the deploy
  completed rather than a `continue-on-error` step reading green.
- **The turn row PASSED, for the first time in its history.** Runs 28, 29, 30 and 31 each
  died later than the last; this one reached its PASS row. It cleared, on staging: two
  screens enrolled and approved · an independent participant reading the event without
  joining · explicit join · leave-as-switch-to-phone · the real 45-second lease expiring ·
  the rejoin that recovered the place · call next · the outsider refused at the ready gate ·
  ready · start at the screen · phone completion · a phone retry and a screen retry that
  both added nothing · chosen activity 12, unchosen 0, combined parent `combinedTotal` 12 ·
  the immediate anonymous result · and its expiry after the real ten-second window.
- Cleanup `COMPLETE`, 349/349, `ALREADY_ABSENT=0`, `EVIDENCE_SCAN=clean`, 23 files.
- **`LINKED_DOCUMENTS_VERIFIED=2`, `ALREADY_ABSENT=9`** — the same composition as runs 30
  and 31: two uid-in-path documents admitted **by path with no read**, nine read-branch
  documents already gone. **The live-content branch has now run zero times on three
  consecutive runs.**
- `CLEANUP_USERS_DELETED=0` with `USERS_ALREADY_ABSENT=40`: the accounts were removed
  in-smoke before the cleaner looked. Complete, but not evidence that the cleaner's own
  user-deletion path ran.

---

## Still not established by any run

- **The browser/player journey.** No hosted row opens a browser against the turn flow.
  Three defects were found in the unrun proof before it was ever dispatched, and all
  three would have cost a run: the entry abandoned by Leave was never tracked (the
  rejoin mints a second document and only that one was recorded, so the first leaked
  with no way to recover its id afterwards); both claimed `wsfKioskPairings` documents
  leaked, because the tracking branch read `approved.pairingId` and `wsfApproveStation`
  returns no such field — dead code that could never run; and the pairing captures
  carried the **live six-character enrolment code**, which `scan-evidence.mjs` cannot
  catch because it lists PNGs as UNSCANNABLE and exits clean. An artifact reader could
  have enrolled a screen on that goal.
  Run 32's PASS does not change this and must never be cited for it: a service-level row
  cannot establish QR → retained activity/auth → phone-or-queue choice → ready/start →
  shared player → review/receipt → cleared station. `hosted-player-journey.mjs` and its
  own deploy-free workflow are built for exactly this gate and have **not yet been run**.
  Scan, explicit activity selection, the shared follow-along player, rep review, the hall
  clearing and the station session ending are **not covered**, and a green turn-service
  row does not cover them. That gate is separate and open.
- ~~**The turn row has never fully passed.**~~ **Closed by run 32**, which reached its PASS
  row. Runs 28, 29, 30 and 31 each failed later than the last; run 31 died on the
  ten-second result read, which was the row spending the window it was measuring.
- **The live-document-content verification branch** — reading a stored document and
  confirming it references its declared owner before admitting it — has **not** run on
  hosted staging. On runs 28 and 29 nothing reached it; on run 30 all nine read-branch
  documents were already gone (404) before the verifier looked. It is covered locally
  (`tests/cleanup-synthetic.test.mjs` proves eight of nine by content and one by path),
  and local coverage is not hosted proof.
  *(The uid/path-linked branch is established — run 30, two documents. This entry was
  the wrong way round until 2026-09-19 22:02Z.)*

- **A counter that separates the two admission branches.** `LINKED_DOCUMENTS_VERIFIED`
  conflates the path-linked branch with the live-content branch, so no hosted receipt
  can currently evidence one rather than the other. Proposed, not implemented: emit
  `CLEANUP_LINKED_PATH_ADMITTED` and `CLEANUP_LINKED_CONTENT_VERIFIED` separately.
