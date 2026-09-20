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
  shared player → review/receipt → cleared station. `hosted-player-journey.mjs` is built
  for exactly this gate and has **not yet been run**.
  Its first dispatch never reached product code. It was written as a standalone
  workflow, `.github/workflows/wsf-player-journey.yml`, and died at `config` with
  `unauthorized_client: The given credential is rejected by the attribute condition`:
  the workload identity provider pins
  `assertion.workflow_ref=='idevinsimpson/goarrive/.github/workflows/wsf-staging-deploy.yml@refs/heads/main'`
  (FEDERATION-PLAN.md line 37), so no other workflow file can ever authenticate. That
  was a design error on my side — a second privileged workflow written without reading
  the federation plan. The correction makes the journey a deploy-free `player-journey`
  **mode** of the trusted workflow and retires the standalone file; it is pinned by
  `tests/workflow-contract.test.mjs` (the plan's `workflow_ref` must name this file, no
  other workflow may request `id-token`, player mode must reach neither build nor deploy
  nor the 24-row suite, deploy mode must still reach all three, and a failed or skipped
  journey must still clean up, scan, and fail the run).
  **Run 33 (`35495928362`, `main` `aa66869`, `mode=player-journey`, app `42dd32a`) then
  ran in the new mode and FAILED.** What it did establish, from its own log: the trust
  path is correct — `gate` and `config` succeeded and `Authenticate to Google Cloud`
  passed at 07:05:57Z, the exact step that had failed before — and the mode gating is
  real, with `build`, `deploy` and `hosted-verify` all recorded `skipped`. Nothing about
  the player flow was established. The journey step failed after 73 seconds, waiting for
  `wsf-event-title` on the first cold QR open; on the served build a fresh browser is
  shown `wsf-device-choice` first, and a signed-out visitor then lands on
  `wsf-event-signed-out`. That ordering error is the harness's, not the product's, and is
  **uncorrected as of this entry**. Five captures were taken, all station surfaces, not
  28; `EVIDENCE_SCAN=clean` over 8 files.
  **The run also left fixtures on staging.** Cleanup reported
  `CLEANUP_STATUS=MANIFEST_UNUSABLE`, `CLEANUP_REASON=manifest identity check failed`,
  `CLEANUP_MANIFEST_PRESERVED=true` — **zero deletions**. The journey mints `e5j-…` run
  tags and `cleanup-synthetic.mjs` accepted `^e5h-` alone, so *every* player run would
  have ended this way. The manifest survives in that run's `wsf-player-evidence`
  artifact, which is the record recovery works from. Fixed by moving the predicate into
  `run-tag.mjs`, where each prefix is declared beside the harness that mints it, and by a
  regression that evaluates **each harness's own tag expression** and requires the
  cleaner to accept it — the cross-check that never existed is what let this ship.
  **Those fixtures are now gone — run 34 (`35498461701`), the cleanup recovery.**
  `mode=cleanup-recovery`, `recover_run_id=35495928362`, on `main` `09bb39e`. Every other
  job was `skipped`: no gate, no config, no build, no deploy, no 24-row suite, no browser,
  and no fixture of its own. From its log:

  | | |
  | --- | --- |
  | `CLEANUP_STATUS` | `COMPLETE` |
  | documents requested / deleted / already absent | 56 / 56 / **0** |
  | profile documents linked | 3 |
  | linked documents verified / already absent | 5 / **0** |
  | users requested / verified by email / deleted / already absent | 3 / 3 / 3 / **0** |
  | manifest preserved | `false` — removed only because the run completed |
  | `EVIDENCE_SCAN` | clean, 1 file |

  **Both `ALREADY_ABSENT` figures are zero**, which is the part worth reading twice: all
  56 documents and all 3 accounts were still present, an hour after run 33 created them.
  Nothing had been cleaned up, so the leak was exactly as large as the manifest said, and
  the recovery removed all of it — confirmed by read-back, not assumed.

  These counts are read from the run's own log. The evidence artifact could not be
  downloaded from the environment this entry was written in (the blob host is refused by
  its egress proxy), so nothing here is taken from the receipt file itself.
  Scan, explicit activity selection, the shared follow-along player, rep review, the hall
  clearing and the station session ending are **not covered**, and a green turn-service
  row does not cover them. That gate is separate and open.
- ~~**The turn row has never fully passed.**~~ **Closed by run 32**, which reached its PASS
  row. Runs 28, 29, 30 and 31 each failed later than the last; run 31 died on the
  ten-second result read, which was the row spending the window it was measuring.
- ~~**The live-document-content verification branch** — reading a stored document and
  confirming it references its declared owner before admitting it — has **not** run on
  hosted staging.~~ **Closed by run 34** (`35498461701`), the cleanup recovery. Runs 28
  and 29 never reached it; on run 30 all nine read-branch documents were already gone
  (404) before the verifier looked, so `VERIFIED=2` there was the two **path**-admitted
  documents.
  Run 34 reported `CLEANUP_LINKED_DOCUMENTS_VERIFIED=5` with
  `CLEANUP_LINKED_DOCUMENTS_ALREADY_ABSENT=0` — every linked document was still present
  when the verifier read it, because run 33 died before its in-run deletions and the
  recovery was the first thing to touch them.
  All five went through the **read** branch, established from the journey's own
  `trackLinked` call sites rather than from the counter (which still cannot tell the two
  branches apart):

  | linked document | `via` | branch |
  | --- | --- | --- |
  | `wsfCombinedGoals/{setupId}` | `groupId` | read — `setupId` is server-minted and contains no `e5jgrp-` |
  | `wsfKioskStations/{stationId}` ×2 | `activityA goalId` | read — station ids are server-minted |
  | `wsfKioskPairings/{pairingId}` ×2 | `activityA goalId` | read — pairing ids are server-minted |

  Run 33 failed in the cold scan, after `seedEvent` and both screen enrolments and
  before any phone reached the line, so those five are exactly the set that existed —
  which is why the count is 5 and why none of them is path-linked.
  *(The uid/path-linked branch was established earlier — run 30, two documents. That
  entry was the wrong way round until 2026-09-19 22:02Z.)*

- **A counter that separates the two admission branches.** `LINKED_DOCUMENTS_VERIFIED`
  conflates the path-linked branch with the live-content branch, so no hosted receipt
  can currently evidence one rather than the other. Proposed, not implemented: emit
  `CLEANUP_LINKED_PATH_ADMITTED` and `CLEANUP_LINKED_CONTENT_VERIFIED` separately.

---

## Run 35 — `35515299057`, main `cabd11f`, app `6b257c3` (mode=deploy)

The promotion. `approved-candidate.json` on `main` was moved to
`6b257c398737e88ff399ba132166533ff3504523` by #374, and this run deployed it.

- **All five deploy-mode jobs green**, and `player-journey` and `cleanup-recovery` were
  both **skipped at 14:03:44 without taking a runner** — the `inputs.mode == 'deploy'`
  equality gating from #368, behaving in production rather than only in the contract test.
- **`VERIFY=pass`**, `INVENTORY_BEFORE=46`, `INVENTORY_AFTER=46`,
  `CREATED_THIS_DEPLOY=none`, `PREEXISTING_TRANSPORT_VERIFIED=22/22`,
  `HOSTED_MARKER_MATCHES=true`. The functions deploy was a no-op on function code, as
  the UI-only measurement predicted.
- The **"Preserve an incomplete functions deployment" guard was skipped**, which is the
  independent signal that the deploy completed rather than a `continue-on-error` step
  reading green.
- Staging now serves `6b257c3`. **This is the first hosted build that returns to the
  scanned event after sign-in.**

## Run 36 — `35515986745`, main `cabd11f`, app `6b257c3` (mode=player-journey)

FAILED, and **the failure was the harness's locator, not the product.**

- **The fixture leak is closed.** `CLEANUP_STATUS=COMPLETE`,
  `REQUESTED_DOCUMENTS=56` / `DOCUMENTS_DELETED=56` / `ALREADY_ABSENT=0`,
  `REQUESTED_USERS=3` / `USERS_DELETED=3`, `MANIFEST_PRESERVED=false`. Run 33 stranded
  exactly these 56 documents and 3 users behind `MANIFEST_UNUSABLE` because the journey
  mints `e5j-` tags and the cleaner accepted `^e5h-` alone; #369's shared `run-tag.mjs`
  fixes it, and this is its **first live exercise**.
- **`CLEANUP_USERS_DELETED=3` with `USERS_ALREADY_ABSENT=0`** — the cleaner's *own*
  user-deletion path ran for the first time. Runs 30–32 all reported `DELETED=0` against
  a large `ALREADY_ABSENT`, because the smoke removed its accounts before the cleaner
  looked. **`LINKED_DOCUMENTS_VERIFIED=5` still does not separate the two admission
  branches**, so it remains no evidence for the live-content branch.
- **How far it got, which is much further than run 33:** both screens enrolled and
  approved, both pairing codes captured redacted, the member QR read off the screen, and
  the cold scan proved device-question-then-signed-out-landing with the line empty before
  and after. `EVIDENCE_SCAN=clean` over 11 files — which, as always, means the scanner
  read no text it could reject and **not** that the nine PNGs are safe; it lists every
  one `UNSCANNABLE`.
- **Where it died:** inside `reachMemberEvent`, after `04-signed-out-landing` and before
  `05-member-event`, which was never taken. The step ran **20 seconds** while every wait
  in that region has a 30–60s timeout, so this was an **immediate throw, not a timeout**.
  `getByTestId('wsf-event-title')` matched the visible route *and* the copy expo-router
  keeps mounted underneath it, and Playwright strict mode refuses two.
  **`waitForURL` had already passed**, so the product's sign-in return had happened.
  Fixed by `visibleEventTitle()`: `[data-testid="wsf-event-title"]:visible`, plus an
  assertion that exactly one is visible and that it carries the event's own title.
  The count assertion is load-bearing and pinned by a regression — without it the helper
  would paper over a screen that genuinely rendered two titles.

## Still not established by any run

- **The player journey end to end.** Runs 33 and 36 both failed before the queue. What
  run 36 newly establishes is the front half only: the scanned link, the device question,
  the signed-out landing, two enrolled screens, and complete cleanup. The activity
  choice, the queue, the ready/start handoff, the shared player, the receipt and the
  cleared station remain unproven on hosted staging, and the later-state captures do not
  exist yet — so **visual acceptance of those screens is also still pending.**
- **`wsfCloseCombinedGoal`, `wsfRepairCombinedGoal`, `wsfListStations`, `wsfRevokeStation`**
  are transport-open (run 32's receipt) but are called by **no hosted suite at all**.
