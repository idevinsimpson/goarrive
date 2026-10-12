# Expo prize-drawing core — Packet B evidence

**Delivered** on `claude/wsf-expo-prize`; the exact SHA is in the PR checkpoint comment and
in the README status table. **Not accepted, not integrated, not deployed, nothing enabled.**
Base `16cf96dcbecc4b64cfd9a11a5ae7acd770cc1453`; every path below is under this lane's
reservation. `src/index.ts`, rules, indexes, firebase configs, package files and every
app route are untouched (`git diff --stat 16cf96dc..HEAD` lists only the reserved paths and
the new jest config).

## What was built

| file | lines | what |
| --- | --- | --- |
| `functions-westayfit/src/expo-prize/policy.ts` | 240 | typed contract, `validatePromotionConfig`, `configDigest`, `readPromotion` (the fence), `withinWindow` |
| `functions-westayfit/src/expo-prize/adjudicate.ts` | 181 | pure verdicts: `contributionDocIdFromPath`, `readContributionRow`, `adjudicateContribution`, `adjudicateFormReceipt`, the source/entry id functions |
| `functions-westayfit/src/expo-prize/award.ts` | 376 | `ingestContribution`, `ingestFormReceipt` — one transaction per source (CONTRACT §d), `refs`, `COLLECTIONS` |
| `functions-westayfit/src/expo-prize/form.ts` | 37 | `FormReceiptSource` (the trusted seam) and the synthetic `InMemoryFormReceiptSource` |
| `functions-westayfit/src/expo-prize/reconcile.ts` | 138 | `reconcileGoal` (one bounded page), `reconcilePromotion` (full pass, `converged`) |
| `functions-westayfit/src/expo-prize/trigger.ts` | 40 | `onContributionCreatedBody` — the proposed trigger's body, **unregistered** |
| `functions-westayfit/src/expo-prize/status.ts` | 34 | `classifyEntryStatus` |
| `functions-westayfit/src/expo-prize/index.ts` | 14 | barrel; **not** re-exported from `src/index.ts` |
| `functions-westayfit/jest.expo-prize.config.cjs` | 20 | new config; `tests/expo-prize/**`; same isolation setup file; no npm script |
| `functions-westayfit/tests/expo-prize/{fixtures,pure.test,award.test,form.test,cap.test,reconcile.test}.ts` | 1248 | the matrix |

`tsc --noEmit -p functions-westayfit/tsconfig.json`: 0 errors (strict, `noUnusedLocals`,
`noImplicitReturns`). `npm run build` would compile the module into the gitignored `lib/`;
nothing imports it, so the deployed function set is unchanged by construction.

## How it was run

```
cd <repo root>
METADATA_SERVER_DETECTION=none <firebase-tools 15.31.0>/firebase emulators:exec \
  --only firestore,auth --config firebase.westayfit.emulators.json --project demo-wsf-local \
  "cd functions-westayfit && GCLOUD_PROJECT=demo-wsf-local METADATA_SERVER_DETECTION=none \
   npx jest --config jest.expo-prize.config.cjs"
```

Firestore emulator 1.22.0, Auth emulator, Java 21 in the container; `firebase-tools`
installed in a scratch directory outside the repo (`docs/westayfit/DEPENDENCIES.md:26`
already keeps it out of the repo). The isolation setup file refused nothing: project
`demo-wsf-local`, loopback hosts, external fetch blocked.

## Measured results (real core)

| suite | tests | kind |
| --- | --- | --- |
| `pure.test.ts` | 39 | **pure core only** — no Firestore; proves logic, not atomicity |
| `award.test.ts` | 14 | emulator; rows 1–7, 18, 20, 21, 22, 24, 25, 26, trigger body |
| `form.test.ts` | 6 | emulator; rows 8, 8b, 9, 10, 11+12, cutoff/disabled bonus |
| `cap.test.ts` | 6 | emulator; row 13 ×3, 14, 15, explicit no-cap |
| `reconcile.test.ts` | 3 | emulator; rows 16, 17, fenced pass |
| **total** | **68 passed, 0 failed** (67 at `8a434dd`; one pure case added by the W7 corrections) | three consecutive full runs at `8a434dd`, one after the corrections |

Every emulator row creates its movement through the real `wsfContribute`, and rows 3 and 4
through the real turn callables (`wsfJoinTurnLine → wsfCallNext → wsfTurnReady →
wsfStartTurn → wsfCompleteMyTurn / wsfCompleteTurn`) and the real `wsfCreateCombinedGoal`,
so the sources adjudicated are the canonical rows `performContribution` writes, not
fixtures shaped like them.

**Concurrency claims rest on real emulator transactions**, not mocks: row 2b (six
concurrent first ingestions of one contribution → 1 accepted, 5 replay), row 8b (four
concurrent receipts for one subject → 1 bonus), row 13 (six concurrent first-time entrants
against a cap of 2 → exactly 2 admitted, three runs). The server SDK's transactions lock
the documents they read (pessimistic; `@google-cloud/firestore` 7.x, default 5 attempts):
a loser is retried and then replays, and a fifth consecutive loss throws rather than
recording — the end state is identical either way, liveness under sustained contention is
not measured. Production behaviour is the same model but was not measured against a live
project (none is authorised).

## Failing-before controls (one mutation at a time, targeted suite, then restored)

Each mutation was applied with `sed`, the named suites run on the same emulator session,
the file restored and `git diff --quiet` confirmed clean before the next. The full real-core
suite was run again afterwards in the same session (67/67).

| mutation | line changed | suites run | result | rows that caught it |
| --- | --- | --- | --- | --- |
| M1 dedupe removed | `award.ts` both `if (sourceSnap.exists)` → `if (false && …)` | award, cap | **7 failed** / 13 passed | 2, 2b, 3, 13 ×3, trigger body |
| M2 cap inverted | `award.ts` `>= policy.entrantCap` → `<` | cap | **5 failed** / 1 passed | 13 ×3, 14, 15 |
| M3 cutoff on wall-clock | `adjudicate.ts` `withinWindow(policy, row.createdAtMs)` → `Date.now()` | award | **1 failed** / 13 passed | 7 + 22 |
| M4 fence admits `disabled` | `policy.ts` `AWARDING_STATUSES` + `'disabled'` | award, pure | **2 failed** / 50 passed | 21, readPromotion ordering |
| M5 bonus repeatable | `adjudicate.ts` `formBonusAwarded` check removed | form | **2 failed** / 4 passed | 8, 8b |
| M6 per-goal rule ignored | `adjudicate.ts` `repeatBlocks` → `false` | award, reconcile, pure | **3 failed** / 52 passed | 18, 16, pure perGoal |
| M7 entitlement uses count | `adjudicate.ts` refuse `row.count < 2` | award, cap, pure | **9 failed** / 49 passed | 1, 15, seven pure verdict rows |

Two defects the suite caught in my own first draft, recorded because they are the kind of
thing the matrix exists for: (1) the per-entrant tally was written with a dotted key under
`set(…, { merge: true })`, which Firestore stores as a literal field name, so the per-goal
rule never saw a prior goal — rows 16 and 18 failed until the write became a nested map;
(2) the source-path parser dropped empty segments, so `/wsfContributions/x/` passed — row 27
failed until the parser required exactly two non-empty segments.

## Row 28 — existing behaviour intact

Same emulator session, the existing callable config, unchanged files:
`wsf-contribute.test.ts`, `wsf-turn.test.ts`, `wsf-combined-goal.test.ts` — **81 passed,
0 failed** (3 suites). Earlier, before any lane code existed, `wsf-contribute.test.ts`
alone passed 25/25 as the harness control.

## Matrix coverage

| rows | status |
| --- | --- |
| 1–18, 20–27 | implemented and passing; 19, 23, 25 (digest half), 27 and the verdict table are **pure-core only** |
| 28 | run as the control above |
| extra | trigger body in isolation; concurrent first ingestion (2b); concurrent receipts (8b); explicit no-cap; fenced reconciliation; bonus disabled by `formBonusEntries: 0`; receipt after cutoff |

## Limitations, stated plainly

- **Nothing is wired.** No export, callable, trigger, rules block, index or npm script.
  The core cannot be reached from a client or from production. That is the packet.
- **The form store is synthetic.** `InMemoryFormReceiptSource` proves the adapter
  contract (re-read by id, subject binding, forged refused). Binding it to
  `interest_responses` or to a promotion-scoped form is the owner's decision and a
  separate reviewed step; the identity binding (verified email ↔ uid) is unproven here.
- **Cap contention is measured on the emulator**, not on live Firestore.
- **The reconciliation query's index-freedom is reasoned**, not proven: the emulator does
  not enforce indexes. Equality on `goalId` + `orderBy(documentId)` is the shape chosen
  because it should need no composite index; confirm at wiring time.
- **The trigger is a body, not a trigger.** Eventarc, service-agent IAM and the region
  are operator facts this lane cannot read.
- **`revoked` entries, paper entrants, contacts, the frozen pool, the draw** exist in the
  schema and the state machine only. No writer exists for any of them.
- **`sourceKey` / `entryId` embed the canonical contribution id**, which contains the uid
  by construction (it is `wsfContributions`' own key). Row 26 asserts that is the only
  place the uid appears outside the link document. A later phase that publishes an entry
  id to a member must publish a derived opaque id, not this one.
- The emulator warns about IPv6 port probes (`EAFNOSUPPORT ::1`) in this container; it
  binds IPv4 and the runs are unaffected.

## Corrections after W7 Check 22 (`5808214593`)

Behaviour of every delivered row unchanged; the suite passes 68 / 68 after these:

- `award.ts`: `storedVerdict` returns the real source key on replay (was `''`); the form
  receipt is re-read **behind** the fence and the dedupe, so a fenced promotion or a replay
  never touches the seam; the header no longer claims every write is create-or-noop.
- `status.ts`: `classifyEntryStatus` takes `goalEligible` and answers `notEntered /
  goalNotInPromotion` for a contribution to an unlisted goal instead of `pending`.
- Tests: row 26 scans document ids as well as values; row 10 scans the entrant and link
  documents too; one pure case added for the unlisted goal.
- `CONTRACT.md`: ABORTED-retry-then-replay (not ALREADY_EXISTS); idempotence borrowed from
  the co-transactional creates; `b_{entrantId}` vs `f_{receiptId}`; `tickets` / `goalId` on
  entries and `entryCount` counting tickets; "refuses to adjudicate" (no enable step
  exists); cites `:3550` and `resolveTurnEvent :7646–7710`; `eligibleGoalIds` named in the
  schema as derived-and-digested-at-enable (W7 F5, not built); the cap-after-enable seam
  (W7 D, not built); the freeze's pool-relevant convergence and start-after-cutoff guard
  (W7 G, not built).
- This file: the server SDK's pessimistic locking and the fifth-attempt throw; the
  line-count table.

## EXP2A — the enable transition (Director #467 `5810305427`)

**Delivered** as new commits on `63a2c4df` (integrated in development `61dd7b6a`); no rewrite.
Files: `src/expo-prize/enable.ts` (new), `policy.ts` (operators required; `eligibleGoalIds`
derived and digested; `readPromotion` drift-fences a stored array that disagrees),
`index.ts` (barrel), `tests/expo-prize/enable.test.ts` (new), `pure.test.ts`, `fixtures.ts`
(seeds go through the same derivation), and the three docs. Still nothing exported from
`src/index.ts`; nothing callable, triggered, wired or deployed.

**Measured, real core** (same emulator command): **83 / 83** on the first run — no initial
failure, no rerun, no skip. `enable.test.ts` 9 (all emulator), `pure.test.ts` 45 (+6
pure-core rows), the EXP1 suites unchanged in count. `tsc --noEmit` 0 errors.

| proof | row | result |
| --- | --- | --- |
| 1 invalid / missing decision → no write | `repeatRule`, `entrantCap` 0 and absent, `operatorUids` empty, inverted window, empty goals, `ruleVersion` 0 → `refused / invalidConfig` naming the field; the document is byte-identical after | pass |
| 2 forged array replaced; later drift fences | draft seeded with `['forged', goalB]` → enabled with the sorted derived pair; reordered → `fenced / configDrift` for `ingestContribution` and for the trigger body's routed award; widened → fenced; removed → the trigger body no longer routes and a direct ingest is fenced; restored exactly → adjudication resumes | pass |
| 3 entrant under a draft → refused, incl. cap null → number | enabled cap-less, one admission, set back to draft with cap 1 → `fenced / enableArtefactsPresent`; artefacts scrubbed → `fenced / entrantsExist`; a stale link alone and a nonzero counter alone each refuse; `entrantCount` stays 0 (never initialised) | pass |
| 4 other statuses cannot enable or mutate | `enabled`, `closing`, `disabled`, `frozen`, `drawn`, `archived` → `fenced / notDraft`, document byte-identical; a second enable on an enabled document is fenced and the first enablement untouched; a post-enable cap edit is `configDrift` for the award and enable cannot bless it | pass |
| 5 concurrency | eight concurrent enables on one draft → exactly 1 `enabled`, 7 `fenced / notDraft`; one digest, one `enabledAt`, the derived array; three runs | pass |
| 6 award and persistence unchanged | fenced under the draft (contribution intact), accepted after enable, replay on the second ingest, a later contribution accepted without a new entrant; both contribution rows keep their counts | pass |

**Failing-before controls** (one mutation, targeted suite, restored, then the real core 83 / 83
and the existing callable suites 81 / 81 in the same session):

| mutation | line changed | result | rows that caught it |
| --- | --- | --- | --- |
| M8 fence admits `enabled` | `enable.ts` `status !== 'draft'` → also allows `enabled` | **4 failed** / 5 | proof 4, proof 5 ×3 |
| M9 admission check removed | `enable.ts` `if (await anyAdmission(…))` → `if (false && …)` | **1 failed** / 8 | proof 3 |
| M10 stored array trusted | `enable.ts` writes `doc.eligibleGoalIds` when present instead of the derived array | **2 failed** / 7 | the first-enable row, proof 2 |
| M11 drift check on the array removed | `policy.ts` `storedEligibleGoalIdsMatch` gate → `false &&` | **2 failed** / 52 | proof 2, pure readPromotion ordering |
| M12 artefact check removed | `enable.ts` `enabledConfigDigest / enabledAt` gate → `if (false)` | **1 failed** / 8 | proof 3 |

**Unmeasured / limitations, stated plainly:**
- The enable-vs-award race (an admission landing while the enable transaction runs) is not
  driven: under `draft` the award is fenced before it writes, so an admission can only
  pre-exist from an earlier enablement, which proof 3 covers. The prefix queries inside the
  transaction are the emulator's semantics; live Firestore query-in-transaction contention
  was not measured (no live project is authorised).
- Operators are part of the digest, so an operator change after enablement fences awards.
  That is a stated consequence, not a measured product decision; nothing reads the list
  for authorisation yet.
- `closing → frozen`, the pool, and W7 G's convergence and start-after-cutoff guards are
  not built and not measured here.
- Nothing is reachable: no callable invokes `enablePromotion`; the grep for `expo-prize` /
  `wsfPromotion` across `src/index.ts`, rules, indexes, firebase configs, `.github`, the
  app and the package files still returns nothing.

## EXP2B — close → reconcile → freeze core (Director #365 `5811972490`; transfer `5812848258`)

**Delivered** as new commits on `41cb6dff` (EXP2A, accepted #469 `5811301305`, integrated in
development `5c897ab5`); no rewrite; draft PR #470 into `claude/wsf-app-shell`. First commit
`6cc0a36eed309448b372808a2184cae703917f07` (code, tests, CONTRACT §d″, TEST-MATRIX, README);
this section's commit is the evidence commit named in the PR checkpoint. **Not accepted,
not integrated, not deployed, nothing enabled, no draw.** Implementation session
`session_012wBbh1M7m3i8WDZe5hHDUS`, the single replacement authorised by the transfer ruling.

Files (reservation only): `src/expo-prize/close.ts` (new, 63 lines), `pool.ts` (new, 195),
`freeze.ts` (new, 412), `award.ts` (+2 collection names, +2 refs), `reconcile.ts` (page query
extracted as `contributionPageQuery` / `clampPageSize`; the `converged` comment now says what
it is not), `index.ts` (barrel); `tests/expo-prize/close.test.ts` (new), `freeze.test.ts` (new),
`pool.test.ts` (new), `fixtures.ts` (+`awaitServerTimePast`, `comparable`, `promotionDoc`,
`poolDoc`, `freezeAttempts`, `seedClosing`); the three docs. `enable.ts`, `adjudicate.ts`,
`policy.ts`, `form.ts`, `status.ts`, `trigger.ts` and every existing test file are
byte-identical to `41cb6dff`. Still nothing exported from `src/index.ts`; the grep for
`expo-prize` / `wsfPromotion` across `src/index.ts`, rules, indexes, firebase configs,
`.github`, the app and the package files returns nothing.

### How it was run

Same command as above (README), firebase-tools 15 in a scratch directory outside the repo,
`npm ci` for `functions-westayfit`, Java present, project `demo-wsf-local`, loopback only;
the isolation setup refused nothing. `tsc --noEmit -p functions-westayfit/tsconfig.json`: 0 errors.

### Measured, real core

| run | result | initial failures | reruns | skips |
| --- | --- | --- | --- | --- |
| control at `41cb6dff`, before any change | 83 / 83 | 0 | 0 | 0 |
| new suites only: `pool` 8 (**pure**), `close` 8 (emulator), `freeze` 17 (emulator) | 33 / 33 | 0 | 0 | 0 |
| full lane suite, 9 files, at `6cc0a36e` | **116 / 116** | 0 | 0 | 0 |
| existing callable control (`wsf-contribute`, `wsf-turn`, `wsf-combined-goal`), same session | 81 / 81 | 0 | 0 | 0 |
| full lane suite again, after the mutation session below, same emulator session | 116 / 116 | 0 | 0 | 0 |

Every emulator row makes its movement through the real `wsfContribute`; every cutoff is
waited out on Firestore's clock (`awaitServerTimePast` commits a probe with `serverTimestamp()`
and reads it back). Contributions are made **before** the promotion is seeded with its
cutoff a moment ahead, so no row's eligibility depends on a race with the emulator.

| packet proof | rows (TEST-MATRIX) | result |
| --- | --- | --- |
| close state / config fences, byte-identical no-write outcomes | C1–C4 | pass |
| a before-cutoff server marker cannot freeze; a later resolved marker begins the pass | F1 | pass — `startedAtMs` < `windowEndMs` → `notReady / beforeCutoff`, marker only; after the server clock passes, the pass runs |
| a missing pre-cutoff source → first pass `notReady`, second clean pass freezes; accepted and refused sources both accounted for | F2a, F2b, F4 | pass — F2a is the refusal-verdict case with `newAccepted 0` |
| post-cutoff-only rows do not prevent a clean pool-relevant pass | F3 | pass — first attempt `frozen`, `postCutoffIgnored 2`; the old summary on a sibling: `writes 2, converged false` |
| committed before cutoff, processed after close → included | F4 (and F1) | pass |
| `formBonusEntries > 0` without an enumerable trusted source refuses freeze | F5 | pass — `refused / formSourceUnbound`, no marker; the zero-bonus twin freezes |
| deterministic aggregation / ranges / digests, zero-ticket and oversize refusal, no sensitive fields | F6, F7, F8, P1–P8 | pass |
| concurrent freeze attempts → one byte-stable pool; retries replay | F9 ×3, C5 ×3 | pass — 1 `replay:false`, 5 `replay:true`, one digest, one `frozen` marker, byte-identical after retries |
| `frozen` fences every later award path | F10 | pass |
| existing EXP2A enable, award persistence / dedupe / cap / privacy evidence unchanged | `enable`, `award`, `form`, `cap`, `reconcile`, `pure` | carried: the six suite files are byte-identical to `41cb6dff`, 83 / 83 within the 116; M8–M12 not re-run (their targets `enable.ts` / `policy.ts` are unchanged) |

### Failing-before controls (one mutation at a time, targeted suites, restored, then the real core in full)

Each mutation applied with `sed` on the named line inside one `emulators:exec` session, the
targeted suite(s) run, the file restored from a copy and `git diff --quiet` on it confirmed
clean before the next; the real core then ran in full in the same session (116 / 116).

| mutation | line changed | suites | result | rows that caught it |
| --- | --- | --- | --- | --- |
| M13 post-cutoff marker guard removed | `freeze.ts` `if (startedAtMs < policy.windowEndMs)` → `if (false && …)` | freeze | **1 failed** / 16 | F1 |
| M14 missing-source guard removed | `freeze.ts` `pass.preCutoffWithoutSource += 1` → `+= 0` | freeze | **3 failed** / 14 | F1, F2a, F2b |
| M15 form-source fence removed | `freeze.ts` `if (policy.formBonusEntries > 0)` → `if (false && …)` | freeze | **1 failed** / 16 | F5 |
| M16 size fence removed | `pool.ts` `if (serializedBytes > maxBytes)` → `if (false && …)` | freeze, pool | **2 failed** / 23 | F8, P7 |
| M17a pool existence check removed | `freeze.ts` `if (poolSnap.exists) return … poolExistsWithoutFrozen` → `if (false && …)` | freeze | **1 failed** / 16 | F12 (the create-only write then throws ALREADY_EXISTS) |
| M17b … and `create` → `set` | M17a plus `tx.create(r.pool, {` → `tx.set(r.pool, {` | freeze | **1 failed** / 16 | F12 (the foreign pool is overwritten) |
| M17c pool written outside the transaction | `freeze.ts` `tx.create(r.pool, {` → `void r.pool.create({` | freeze | **4 failed** / 13 | F13 (pool survives the abort), F9 ×3 (five ALREADY_EXISTS) |
| M17d status change not on the promotion | `freeze.ts` `tx.update(r.promotion, {` → `tx.update(r.freezeAttempt(attemptId), {` | freeze | **6 failed** / 11 | F1, F6, F9 ×3, F10 (pool without transition) |
| M18 post-cutoff rows counted against readiness (the old broad behaviour) | `freeze.ts` `pass.postCutoffIgnored += 1` → `pass.preCutoffWithoutSource += 1` | freeze | **1 failed** / 16 | F3 (W7 G is load-bearing) |

### Unmeasured / limitations, stated plainly

- **No live-Firestore claim.** Query-in-transaction semantics (the freeze reads
  `wsfPromotionEntries/{p}_*` inside its transaction) and the monotonicity of commit
  timestamps that the marker argument rests on (CONTRACT §d″) are the emulator's as measured.
  The reasoning is stated; the live behaviour is not.
- **One clock in this container.** The emulator and the test process share the machine
  clock, so the guard's use of the **server-resolved** instant rather than `Date.now()` is
  proven by the code path (the local clock is never read) and by M13, not by inducing skew.
- **Drift injected mid-pass** (between two ingests of one pass) is not driven. Drift before
  the pass (F11), drift at the transaction's re-read (the re-read is in the code path; the
  re-read fence is exercised only through the status checks in F9/F12) and the award's
  own per-row drift fence (EXP2A proof 2) are.
- **Liveness under sustained contention is not measured**: F9 drives six concurrent
  finalizers three times; the server SDK's five-attempt retry applies as in Packet B.
- **The size bound is conservative by construction** (512 KiB of canonical JSON against a
  1 MiB document limit); the exact stored-document overhead was not measured on the emulator.
- **`formSourceUnbound` is a refusal, not a seam.** No enumerator interface exists; binding
  a real form store, and proving a bonus-bearing pool complete, is a later reviewed packet.
- **Nothing is reachable.** No callable invokes `closePromotion` or `freezePromotion`; no
  operator authorisation reads `operatorUids`; no draw exists.

## EXP3A — the private "My entries" read core (Director #365 `5815271789`)

**Delivered** as new commits on `24d95cfe` (EXP2B successor, accepted #470 `5815201024`,
integrated in development `68d159c1`; `24d95cfe` is an ancestor of that head and the
reservation is byte-identical at both, so the branch was not merged forward — new commits
only, no rewrite). Draft PR into `claude/wsf-app-shell`; the exact SHA is in the PR
checkpoint. **Not accepted, not integrated, not deployed; no callable, no UI, nothing
reachable.** Session `session_012wBbh1M7m3i8WDZe5hHDUS`.

Files (reservation only): `src/expo-prize/receipt.ts` (new, 250 lines), module
`index.ts` (one barrel line), `tests/expo-prize/receipt.test.ts` (new), the four docs.
`fixtures.ts` was **not** changed (the focused test needed no new helper). Everything else
in the lane is byte-identical to `24d95cfe`; nothing outside the reservation is touched.

### Measured, real core (same emulator command; `tsc --noEmit -p functions-westayfit/tsconfig.json` 0 errors)

| run | result | initial failures | reruns | skips |
| --- | --- | --- | --- | --- |
| `receipt.test.ts` alone, **first run** | **10 / 11** | **1** — R6 | — | 0 |
| `receipt.test.ts` alone, after the fixture correction below | 11 / 11 | 0 | 1 (the correction run) | 0 |
| full lane, 10 files, before the controls | **127 / 127** | 0 | 0 | 0 |
| full lane, 10 files, after the controls, same session | 127 / 127 | 0 | 0 | 0 |

**The one initial failure, stated plainly:** R6 builds a "foreign" pool by freezing a
second promotion and copying its pool over the first's. My first draft seeded that second
promotion over the **same goal**, so its freeze pass walked the first promotion's earlier
row too, adjudicated it, and correctly returned `notReady` — the freeze behaved exactly as
EXP2B specifies; the fixture was wrong. Corrected by giving the second promotion its own
goal (`tests/expo-prize/receipt.test.ts`, the "other" scene in R6; no source change). One
rerun after the correction: 11 / 11.

`receipt.test.ts`: 8 emulator rows (R1–R8) + 3 pure rows (P9–P11) = 11 cases. Every
emulator row reads documents the real award and freeze wrote (real `wsfContribute`,
`ingestContribution`, `closePromotion`, `freezePromotion` after the server clock passes the
cutoff).

| packet proof | rows | result |
| --- | --- | --- |
| account isolation | R3 | pass — eight mixed reads on one deps, sequential and concurrent, each its own value |
| account switching with no carried value | R3 | pass |
| provisional → settled | R5 (and R2 for `closing`) | pass — same count before and after the freeze, `settled` flips; `drawn` / `archived` identical |
| pending / revoked exclusion | R4 | pass — tally still 4, read says 2; malformed `tickets` counts zero |
| link-missing states | R2, R5, R6 | pass — current zero before, final zero after an intact freeze; a link to an entrant absent from the pool is final zero; a malformed link reads as missing |
| corrupt / missing pool fences | R6 | pass — edited range, deleted pool, another promotion's intact pool, edited stamped digest, drift after freeze → `unavailable`; restored → the count returns |
| payload allow-list / deep privacy scan | R7 (and every row via `assertShape`) | pass — exact key sets; none of the strings the lane stores for the promotion appears; the only number is `tickets` |
| no mutation | R8 | pass — every lane document byte-identical **including `updateTime`** across ok / stranger / drifted-unavailable reads and across settled reads; no document for a stranger uid |
| draft / disabled / missing → unavailable | R1 | pass; malformed ids → `unavailable`; extra `tickets` / `entrantId` input fields ignored |
| functions TypeScript | — | 0 errors |

### Disclosed failure controls (one mutation at a time, `receipt.test.ts`, file restored and confirmed identical, then the real core 127 / 127 in the same session)

| mutation | line changed | result | rows that caught it |
| --- | --- | --- | --- |
| M19 pending / revoked filter removed | `receipt.ts` `if (e.status !== 'confirmed') continue;` → `if (false && …)` | **2 failed** / 9 | R4, P10 |
| M20 pool-intact check removed | `receipt.ts` `if (!storedPoolIntact(pool)) {` → `if (false && …)` | **1 failed** / 10 | R6 |
| M21 pool-binding check removed (digest / rule version / stamped digest) | `receipt.ts` the three-way binding `if` → `if (false)` | **1 failed** / 10 | R6 |
| M22 settled flag lies (frozen answers `settled:false`) | `receipt.ts` the settled return → `settled: false` | **4 failed** / 7 | R5, R6, R7, R8 |
| M23 allow-list removed (`sealReceipt` spreads its input) | `receipt.ts` `return { status, tickets, settled }` → `return { ...input, … }` | **1 failed** / 10 | P9 only — the real call sites already pass minimal objects, so the emulator scan cannot see this one; the pure row is the guard |
| M24 configuration gate removed on the current path | `receipt.ts` first `if (!config.ok) {` → `if (false && …)` | **2 failed** / 9 | R6, R8 |

### Unmeasured / limitations, stated plainly

- **No live-Firestore claim.** Read-only transactions and the equality-plus-document-name
  query for the member's own entries (`where('entrantId','==',…)` + `orderBy(documentId)`
  + prefix bounds, the reconcile's index-free shape) are the emulator's semantics as
  measured; index-freedom against the live project is reasoned, not proven, as for the
  reconciliation query.
- **Nothing is reachable.** No callable takes an auth context and calls `readMyEntries`;
  the "trusted uid" is a contract on that future caller, proven here only by the input
  type and by R1's ignored extra fields. Authorisation, rate limits and the surface's own
  privacy are that packet's.
- **Post-freeze revocation** is not modelled: `settled:true` answers from the immutable
  pool by design; no revocation writer exists.
- **`unavailable` is reasonless on the wire.** The `trace` hook receives the reason and no
  id; it is a dependency-injection seam for tests and server logs, not a member field.
- **M23 is caught by the pure allow-list row only** (see the table): a future call site
  that passed a richer object would rely on `sealReceipt`; the pure test is what pins it.

### EXP3A successor — the stored-pool integrity boundary (W7 Check 26 item 5b; Director #471 `5816858655`)

**The defect, as W7 measured it on `80615cae`:** `storedPoolIntact` checked field types and
digest equality only, and `ticketsFromPool` inspected the reading member's own range only,
so a stored pool that had been edited **and re-stamped with the digest of its edited
content** — overlapping or gapped ranges, a wrong `totalTickets` or `entrantCount`, ranges
not starting at 1, unsorted, a malformed or duplicated other range, or empty ranges —
answered with a member count (12 of 12 shapes for at least one member). No privacy leak;
a truth defect. The freeze's replay fence relied on the same check.

**The correction (form b, the shared boundary, as ruled):** `poolStructurallyValid` in
`pool.ts`, applied inside `storedPoolIntact` before the digest test: ranges non-empty;
`entrantCount === ranges.length`; entrant ids valid and strictly increasing by code unit;
`ticketStart` / `ticketEnd` safe integers, 1-based, end ≥ start; the first start is 1 and
every later start is the previous end + 1; `totalTickets` equals the final end; then the
recomputed digest must still match. No migration or repair: a malformed stored pool fails
closed for the member read (`poolCorrupt`) and for the freeze replay (`fenced /
poolCorrupt`). The builder's own output is unchanged and stays accepted. `receipt.ts` and
`freeze.ts` are untouched: both already route through `storedPoolIntact`.

Files (the Director's expanded reservation for this correction only): `src/expo-prize/pool.ts`
(+42 / −2), `tests/expo-prize/pool.test.ts` (P12: the 12 D2 shapes plus three more, each
re-stamped, refused; builder output at four sizes accepted), `tests/expo-prize/receipt.test.ts`
(R9: the 12 shapes re-stamped **and stamped on the promotion** against the real read → both
members `unavailable` / `poolCorrupt`, the freeze replay fenced, the intact pool restored →
2 / 1 and replay), `tests/expo-prize/freeze.test.ts` (proof 12b: six malformed shapes → `fenced /
poolCorrupt`, nothing written, no marker; restored → replay with the same receipt), this file,
TEST-MATRIX, CONTRACT (one sentence on the pool schema), README.

| run | result | initial failures | reruns | skips |
| --- | --- | --- | --- | --- |
| focused first run: `pool` + `receipt` + `freeze` (39 cases) | **39 / 39** | 0 | 0 | 0 |
| full lane, 10 files (127 + 3 new rows) | **130 / 130** | 0 | 0 | 0 |
| full lane again after the control, same session | 130 / 130 | 0 | 0 | 0 |
| `tsc --noEmit -p functions-westayfit/tsconfig.json` | 0 errors | | | |

| mutation | line changed | result | rows that caught it |
| --- | --- | --- | --- |
| M25 structural check removed | `pool.ts` `if (!poolStructurallyValid(…)) return false;` → `if (false && …)` | **3 failed** / 36 | P12, R9, freeze 12b |

Not re-run, as ruled: M13–M24, the callable batteries, the concurrency runs. Check 26's
PASS rows carry. `poolVersion` is still only type-checked (the builder writes `1`; a version
invariant was not asked for and is not added).

## The next seam

In order, each its own reserved and reviewed packet:

1. ~~**Close → reconcile → freeze**~~ — delivered by EXP2B above (W7 G closed), awaiting
   W7 QA and Director acceptance.
2. **Wiring (L0 reservation on `src/index.ts`)**: one operator-authorised `onCall`
   exposing `enablePromotion` / `reconcilePromotion` / `reconcileGoal` / `closePromotion` /
   `freezePromotion`, and the decision on the trigger.
3. **Owner decisions into a real (still disabled) promotion document**: repeat rule,
   cap-or-null, eligible goals and window, form store, operators.
4. **The form store and its enumerator** (owner decision, CONTRACT §e), after which a
   bonus-bearing promotion can freeze.
5. ~~**"My entries"**~~ — the read core is delivered by EXP3A above; the member-only
   callable that exposes it (auth context → trusted uid) is wiring, item 2.
6. **Draw**: unbiased server selection over tickets, one persisted result per prize before
   reveal, redraws and exclusions with audit; then manual private winner contact.
