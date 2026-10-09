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

## Still not established — the snapshot as of run 33 (SUPERSEDED; see the current section below)

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

## Run 37 — `35518446637`, main `6316030`, app `6b257c3` (mode=player-journey)

FAILED, one control further on, and **the product is again not what failed.**

- **`phone-390-05-member-event.png` EXISTS.** No previous run produced it. It is the
  first evidence that a visitor who scans the QR, is told they need an account, and
  signs in is landed back **on the event as a member by the product itself**. Runs 33
  and 36 both died before this frame.
- **Cleanup complete again**, identical to run 36: `COMPLETE`, `56/56` documents,
  `3/3` users, `ALREADY_ABSENT=0`, `MANIFEST_PRESERVED=false`. The `e5j-` fix holds
  across runs. `EVIDENCE_SCAN=clean` over 12 files, which as always means the scanner
  found no text it could reject — all ten PNGs are listed `UNSCANNABLE`.
- **Where it died:** `06-activity-chosen` is absent, so inside `chooseActivityByTitle`.
  The step ran **38 seconds** against a 45s wait in that function: an **immediate throw,
  not a timeout**.
- **The same root cause as run 36, one control apart — AND NOT THE PREFIX SCANNER.**
  Run 37 threw at `visible(page.getByTestId('wsf-event-activity'), 45_000)`, the raw
  activity CARD, which matched the visible route and the retained one: a strict-mode
  refusal, exactly as on the title in run 36. **It never reached the prefix scan.**
  *(Corrected after run 38. This entry first said the scanner counted route copies and
  saw four options. That was wrong on both counts — the scanner did not run, and the
  overcount run 38 later found has nothing to do with route copies. The number four was
  my arithmetic, not a figure any run reported.)*
- **The systematic correction:** one `memberRoot()` helper resolves the single visible
  `wsf-event-member` root and asserts exactly one root, exactly one title inside it, and
  the exact seeded title. Every positive post-arrival `wsf-event-*` read is scoped to
  that root; the prefix scan was scoped to it (and later retired outright, see run 38);
  post-arrival absence checks count
  **visible** copies; pre-arrival reads stay page-scoped because no member root exists
  yet. A contract regression rejects page-scoped positive post-arrival locators by name.
- **A defect found by enumeration, not by a run:** `joinSecondPhone` called
  `reachMemberEvent` without the expected title, so the second participant would have
  compared against `undefined` and failed case 4 even once the member view was
  reachable. Introduced by run 36's fix; corrected before it could cost a run.

## Run 38 — `35521393874`, main `2520aa9`, app `6b257c3` (mode=player-journey)

FAILED at the same capture boundary as run 37, **on a different defect one line further
in.** The identical boundary is what made this easy to misread.

- **#376 worked.** The journey reached the one correct visible member root and the real
  two-activity event; `05-member-event` is present again. Run 37's strict-mode refusal on
  the activity card is gone, which is *why* this run got as far as the option count.
- **Cleanup complete**, third run running: `COMPLETE`, `56/56` documents, `3/3` users,
  `MANIFEST_PRESERVED=false`. `EVIDENCE_SCAN=clean` over 12 files, all PNGs `UNSCANNABLE`.
- **Where it died:** still inside `chooseActivityByTitle`, step **36 seconds** against a
  45s wait — an immediate throw. `06-activity-chosen` absent.
- **EIGHT options for two movements, inside ONE correct root.** Not route copies.
  `OptionRow.tsx` sets the testID on the row and derives four more from it:
  `-indicator`, `-indicator-dot` (selected only), `-label`, `-description`. So a
  `wsf-event-activity-` PREFIX scan matches each row plus three of its own descendants:

      2 rows x (row + indicator + label + description) = 8

  The count was never a count of choices. A testID prefix cannot tell a choice from a
  piece of one.
- **The correction:** the prefix enumeration is **retired**, not narrowed. The option
  group is a real `radiogroup` and each choice a real `radio` (`accessibilityRole` in
  `OptionRow.tsx`), so the journey asks for what the thing *is*: exactly two radio rows
  inside `wsf-event-activity-options`, the wanted one matched by the readable name
  (`label={activity.title ?? activity.label}`), and exactly one match required. No
  indicator, label or description is a radio, which is the property the prefix scan
  lacked. Mutation-checked: restoring a prefix selector fails the suite, and dropping the
  exact-two assertion fails it too.
- **What this run cost, honestly.** Runs 37 and 38 stopped at the same capture, so the
  second looked like the first. It was not, and reading it as "the fix did not work" was
  wrong: the fix worked and uncovered the next defect. Two different bugs can share a
  boundary.

## Run 61 — `37912780869`, main `df8d4d6`, app `ec162d1` (mode=deploy)

FAILED in the Package E smoke and the changed journeys. **Every failure was a harness
defect on the #587 contract or on timing; no row in this run shows a product refusal
that was wrong.** Fixed by STAGING-TURN-DRIVERS-1.

- **Served build:** `PASS correct staging build — health marker ec162d1`.
- **Smoke:** `RESULTS=24`, `FAILURES=1`. The one failure is
  `hosted turn-service contract — start the turn: application refusal (INVALID_ARGUMENT)`.
  This is #587 KIOSK-EXPECTED-TURN-1 working: `wsfStartTurn`, `wsfCompleteTurn` and
  `wsfCancelTurn` now refuse a command that does not name its turn (`expectedTurn`), and
  the row's raw callables named none.
  - **Fix:** the row reads `called.assigned.turnRef`, requires it to match
    `^tr_[A-Za-z0-9_-]{16,64}$`, and sends it as `expectedTurn` on both the start and the
    retried record.
  - **Test:** a structural test in `hosted-smoke-contract.test.mjs` rejects a station
    command that omits it.
- **Changed journeys:** `3 passed, 6 failed, 0 blocked`. `event-use-my-phone`,
  `event-join-line` and `two-station-turns` passed. This was the **first hosted run** of
  the expo attendee drivers: run 60's main (`b4b479a6`) did not contain them, and the
  pins between were never served. Cleanup was `COMPLETE`: 242/242
  documents and 28/28 users. The row-level card is in the run's artifact, which was not
  read: this environment refused the download. Each cause below is therefore taken from
  the printed message and the `ec162d17` source, then reproduced on the hermetic model.
  - **`phone-and-stations-converge` and `station-lost-answer`** — *"the started turn
    carries no attempt yet"*.
    - **Where:** that message is `fixture-kit.mjs` `trackStationTurn`, which finds no
      attempt on the turn entry. No turn had begun.
    - **Cause:** the drivers tapped I'm ready straight after Call next. A waiting phone
      learns of its call on its next poll (`TURN_POLL_MS = 3_000`), so the tap often found
      no button. Start never opened, and the drivers ignored both the `enabled` wait and
      `startTurn`'s answer.
    - **Fix:** `sayReady` waits up to 25 s for the phone to show I'm ready. Each step is
      then required by name: the tap, Start enabled, and the turn begun. A step that does
      not happen ends the journey naming it.
  - **`closed-goal-turn`** — *"wsfApproveStation refused: INVALID_ARGUMENT"*.
    - **Cause:** the driver enrolled four stations on one event. `normalizeStationSlot`
      admits slot 1 or 2 only.
    - **Fix:** the journey now runs on two events with two stations each. The manifest
      entry's setup, actions and expected rows say so.
    - **Found in review, not by the run:** only a called place lapses, after 45 s, and a
      ready one never does (`isTurnLeaseLapsed`). Main's order called the member for the
      `ready` row before a waiter's join, a fifth member's page load and two other
      refusals, which on hosted could outlast the call.
    - **Fix:** that member is now called last, just before the closure, and the `ready`
      row is read first after it.
    - **Also found in review:** a venue-width station hides its total while a turn runs
      there (`turnRunningWide`). The `nothing` row read the first event's total from the
      station running that turn, so it could never hold on hosted.
    - **Fix:** that total is now read from the event's own display (`/kiosk/{goal}`),
      which runs no turn. Its pulse cache lives for 2 s.
  - **`line-place-ends`** — *"an expected assertion did not hold"*, the `noShow` row.
    - **Cause:** the phone says Your turn timed out for **one poll**. Its next read, 3 s
      later, finds the place still gone and drops the notice (`app/queue/[goalId].tsx`
      :178-181, unchanged since `ab77fbfc`).
    - The driver slept 47 s and then read once, so it passed or failed by chance. A
      simulation over the real poll timing puts that at about 58% pass.
    - The emulator proof (#563) never slept: it waits for the sentence.
    - **Fix:** the 45 seconds are read off the phone's own countdown (`wsf-queue-lease`,
      which the server computes from the lease on every 1-second poll).
      - When the call first shows, the countdown must stand at 40 to 45 s.
      - It is then watched down to its last 3 s with the call still standing.
      - Only then is the phone watched until it shows the heading and the reason in one
        read.

      A call that ends early, or one offered for longer, fails the row. Main's single read
      rejected a short call only by accident and accepted a long one.
    - The Let them go setup is folded into its row, so a step that does not happen fails
      that row by name instead of throwing.
  - **`shared-screen-finish`** — *"an expected assertion did not hold"*.
    - **Cause:** on the kiosk receipt, own credit is a tile whose label is styled
      `textTransform: uppercase` (`app/contribute/[goalId].tsx`:2078-2079). `innerText`
      reads it as `YOUR TOTAL ON THIS GOAL: 20 squats`, so the exact-match reads in
      `finish` and `next` could not hold.
    - The emulator's `toHaveText` compares `textContent` and never saw the capitals.
    - The row's evidence string left the credit text out (main's template was
      `start ${atStart}; signed-out gate ${gate}`), so even the unread card could not
      say why `finish` failed. It now prints the credit text it read.
    - **Fix:** match the words and the figure, not the case, as run 57 taught the Home
      pill. The leftover-values checks are case-blind too, so a capitalised leftover is
      still caught.
    - `countdown` holds: the installed clock keeps flowing in real time, and the
      20 seconds the failing credit read used to waste no longer eat into the margin.
  - **`unverified-participant`** failed, as its manifest entry expects. Not touched.
- **The player journey** did not run in run 61 (its job was skipped).
  `hosted-player-journey.mjs` was examined against #587 and **needs no change**:
  - it waits for the ready panel before pressing I'm ready;
  - it starts the turn through the station's own Start, which sends `expectedTurn` itself
    at `ec162d17`;
  - the phone records through `wsfCompleteMyTurn`, which is not a station command.
- **The hermetic model now behaves as the served build does**, so main's drivers fail on
  it as they did on hosted, four of the five with run 61's own message:
  - a phone shows its call 3 s after the station calls;
  - a station sees I'm ready 2 s after it is pressed;
  - the no-show notice lasts one poll;
  - the kiosk tile's label reads in capitals;
  - station enrolment refuses a slot other than 1 or 2;
  - a venue-width station hides its total while a turn runs there;
  - a page with an installed clock keeps it flowing during waits.

  On that model, main's drivers show run 61's own pattern: the same three journeys pass,
  and five fail:
  - `converge` (*no attempt yet*);
  - `lost-answer` (Start still disabled). The model refuses a click on a disabled control
    at once, so this journey stops before `trackStationTurn` and does not reproduce
    hosted's *no attempt yet*. How hosted reached that message is not established here;
  - `closed-goal-turn` (*INVALID_ARGUMENT*);
  - `line-place-ends` `noShow` (*Join from the event page.*);
  - `shared-screen-finish` `finish` and `next`.

  The fixed drivers pass all of them, and each seeded defect still fails exactly its named
  rows.
  - **Pinned:** six model tests hold those served behaviours in place, so a kinder model
    cannot quietly prove the drivers.
  - **New defects:**
    - `noShowEarly`, where the call lapses at 10 s under a countdown still running and the
      notice stays. Only the countdown watch catches it.
    - `noShowShortLease` (36 s) and `noShowLongLease` (50 s), with the real one-poll
      notice. The countdown bounds catch them.
    - `noShowHeading` and `noShowReason`, where one of the two is wrong.
    - `finishKeepsNameCaps`, where the previous name is left in a capitalised label.
  - **Mutants:** 21 of 22 driver and model mutants are killed. The survivor drops a
    setup guard whose failure the next step already names. All 5 smoke-row mutants are
    killed.
- **A product observation, not changed here and not asserted either way:**
  - the timed-out notice is gone 3 s after it appears, so a member who looks at their phone
    later sees You're not in the line with no reason given;
  - a station's Let them go, on a member whose phone last saw the call but not their I'm
    ready, shows Your turn timed out for that one poll.

  Both are product questions for the queue screen, outside this packet.
- **Not established:** the smoke's turn-service row and the five fixed journeys are
  unproven on hosted staging until a hosted run uses this harness. Everything above about
  them is hermetic.

## Still not established by any run — CURRENT

- **The player journey end to end.** Runs 33 and 36 both failed before the queue. What
  run 36 newly establishes is the front half only: the scanned link, the device question,
  the signed-out landing, two enrolled screens, and complete cleanup. The activity
  choice, the queue, the ready/start handoff, the shared player, the receipt and the
  cleared station remain unproven on hosted staging, and the later-state captures do not
  exist yet — so **visual acceptance of those screens is also still pending.**
- **`wsfCloseCombinedGoal`, `wsfRepairCombinedGoal`, `wsfListStations`, `wsfRevokeStation`**
  are transport-open (run 32's receipt) but are called by **no hosted suite at all**.
