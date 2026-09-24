# Expo prize-drawing core — Packet A test matrix

The matrix Packet B implements. Every row names the failure it exists to catch. Rows
marked **emulator** run real Firestore transactions on the local emulator
(`demo-wsf-local`) and, where they need a real canonical source, create it through the
real `wsfContribute` / turn callables from `src/index.ts` — the same way the existing
callable suite does. Rows marked **pure** exercise the core with no Firestore and are
labelled as such in the evidence; they prove logic, never atomicity.

Legend: P = promotion, E = entrant, S = source row, N = entry.

| # | proves | how | kind |
| --- | --- | --- | --- |
| 1 | one valid contribution → one entry; entitlement identical for 1 and 100 reps | real `wsfContribute` with `count: 1` and, for another member, `count: 100`; ingest both; each has exactly one `confirmed` movement N, and the N documents carry no count | emulator |
| 2 | replay / duplicate ingestion → one entry | ingest the same contribution path 5× sequentially and 5× concurrently (`Promise.all`); one S, one N, tally `entryCount` 1 | emulator (concurrent) |
| 3 | same-attempt phone/station completion → one entry | real turn scene (`wsfJoinTurnLine` → `wsfCallNext` → `wsfTurnReady` → `wsfStartTurn`), `wsfCompleteMyTurn` then `wsfCompleteTurn` retry; one `wsfContributions` row, ingest twice, one N | emulator |
| 4 | combined credit → no extra entry | real `wsfCreateCombinedGoal` over two children; one contribution to a child; ingest the contribution → one N; ingest the `wsfCombinedCredits/...` path → refused `notAContributionPath`, no N | emulator |
| 5 | wrong goal / wrong community → no entry | contribution to a goal not listed in P → S `refused / goalNotInPromotion`, no N; a listed goal id under a different `communityGroupId` → refused | emulator |
| 6 | invalid / non-existent source → no entry | a path that does not exist, a malformed path, a path whose row's `userId` disagrees with the path → refused, no N, no E created | emulator |
| 7 | post-cutoff source → no entry; pre-cutoff late processing → entry | P with `windowEndsAt` in the past relative to one row's `createdAt` and in the future relative to another; both ingested after `closing` → one refused `afterCutoff`, one confirmed | emulator |
| 8 | form receipt → one bonus; replay/edit → still one | synthetic `FormReceiptSource` with one receipt; ingest 3×, then a second receipt id for the same subject → one `formBonus` N, `formBonusAwarded` true | emulator |
| 9 | forged receipt refused | receipt id unknown to the source → `unknownReceipt`; receipt whose subject is another uid → `subjectMismatch`; no N, no E | emulator |
| 10 | marketing opt-out does not alter eligibility | two receipts, `marketingOptIn` true / false in the adapter's view → identical verdict and identical N shape; the S and N carry no consent field | emulator |
| 11 | a form never changes movement | after row 8 the member's `wsfGoalMemberTotals` and the goal's shard sum are unchanged (0 movement for a form-only entrant) | emulator |
| 12 | form-only entrant is a valid entrant | a uid with no contribution and one receipt → E created, one `formBonus` N | emulator |
| 13 | concurrent last-slot claims respect an explicit cap | P with `entrantCap: 2`; 6 distinct members each with one real contribution; ingest all 6 concurrently → exactly 2 E, `entrantCount` 2, 4 S `refused / capReached`; run 3× | emulator (concurrent) |
| 14 | the cap never limits movement | after row 13 every one of the 6 contributions still exists with its count; a 7th member's real `wsfContribute` succeeds after the cap is full and its S is refused | emulator |
| 15 | an already-admitted entrant is not blocked by a full cap | under `entrantCap: 1`, the admitted E's second contribution (`perContribution`) still becomes an N | emulator |
| 16 | delayed / out-of-order ingestion converges | 12 contributions across 3 members; ingest in a shuffled order and in reverse; final S/N/tally sets identical to the in-order run | emulator |
| 17 | interrupted reconciliation converges | `reconcileGoal` with a fault injected after k rows (throw); re-run from the start and from the returned cursor; final state identical; no duplicate N; the run reports `writes: 0` on the third pass | emulator |
| 18 | repeat rule `perGoal` vs `perContribution` | same 3 contributions by one member to one goal: `perGoal` → 1 N + 2 S `refused / goalAlreadyEntered`; `perContribution` → 3 N | emulator |
| 19 | pending / unknown is distinct from confirmed | `classifyEntryStatus`: contribution exists + no S → `pending`; S accepted → `confirmed`; S refused → `notEntered`; no contribution → `unknown` | pure |
| 20 | prize failure leaves accepted movement intact | a storage adapter that throws on the N write; the real contribution row, shard sum and member total are byte-for-byte unchanged after the failed award; a retry then succeeds → one N | emulator |
| 21 | a disabled promotion produces no award and no promise | P in `draft`, `disabled`, `frozen`, `drawn`, `archived`: ingest writes nothing at all (no S, no N, no E, no counter) and returns `fenced`; the classifier reports `notEntered` with reason `promotionInactive`, never `pending` | emulator + pure |
| 22 | the write fence in `closing` still accepts pre-cutoff commits | same as row 7's accepted half, asserted separately with status `closing` | emulator |
| 23 | enabling requires explicit decisions | `validatePromotion`: missing `repeatRule`, missing `entrantCap` key (undefined, not null), empty `eligibleGoals`, `windowEndsAt ≤ windowStartsAt`, missing `ruleVersion` → each refused with a named reason; `entrantCap: null` is accepted as "explicitly no cap" | pure |
| 24 | config drift after enablement is refused | enable (digest stored), then change `repeatRule` in the P document; a drifted P must not adjudicate at all: ingest returns `fenced / configDrift` and writes no S, N or E | emulator |
| 25 | rule version is stamped and frozen | every S and N carries `ruleVersion` equal to P's at adjudication; a P with a different `ruleVersion` than its digest → `configDrift` | emulator |
| 26 | entrant identity is opaque | no S, N, tally or entrant document contains the uid, an email or a name; the uid appears only in `wsfPromotionEntrantLinks`; asserted by deep-scanning every written document | emulator |
| 27 | no source path outside `wsfContributions/` is accepted | `wsfGoalCounters/...`, `wsfGoalMemberTotals/...`, `wsfGoals/x/recentAdditions/y`, `wsfTurnReceipts/...`, `wsfCombinedCredits/...` → `notAContributionPath` | pure |
| 28 | existing contribution behaviour is intact | the existing `tests/callable/wsf-contribute.test.ts` and `wsf-turn.test.ts` still pass unchanged on the same emulator run (control, recorded in EVIDENCE.md) | emulator |

**Control evidence Packet B records for every failure-catching row:** the row is run once
against a deliberately broken core (a one-line mutation named in EVIDENCE.md — e.g. the
dedupe read removed, the cap check inverted, the cutoff compared to wall-clock instead of
`createdAt`) and must fail; then against the real core and must pass. A row that cannot
be made to fail is reported as such, not counted as a proof.

## EXP2B rows — close → reconcile → freeze (CONTRACT §d″; #365 `5811972490`)

Suites: `close.test.ts` (emulator), `freeze.test.ts` (emulator), `pool.test.ts` (**pure**).
Every pre-cutoff contribution is made through the real `wsfContribute` before the
promotion is seeded with a cutoff a moment ahead; the cutoff is then waited out on
Firestore's own clock (`awaitServerTimePast`: a probe committed with `serverTimestamp()`
and read back), never the process clock.

| # | proves | how | kind |
| --- | --- | --- | --- |
| C1 | close is one write | `enabled` + valid digest → `closed`; only `status` and `closingRequestedAt` (a server `Timestamp`) differ | emulator |
| C2 | repeated close is idempotent and cannot reopen | three more closes → `alreadyClosing`, byte-identical (first timestamp kept); `enablePromotion` on it → `fenced / notDraft` | emulator |
| C3 | every other status is fenced, no write | `draft`, `disabled`, `frozen`, `drawn`, `archived` → `fenced / notEnabled`, byte-identical; missing → `promotionMissing` | emulator |
| C4 | drift / invalid config cannot close | cap edited, stale digest → `fenced / configDrift`; `repeatRule` removed → `fenced / invalidConfig`; byte-identical | emulator |
| C5 | concurrent closes | 8 concurrent → 1 `closed`, 7 `alreadyClosing`, one timestamp; three runs | emulator (concurrent) |
| C6 | the write fence under `closing` | closed **before** the cutoff; a pre-cutoff commit processed after close → `accepted`; a post-cutoff commit → `refused / afterCutoff`; the old `reconcilePromotion.converged` recorded for contrast | emulator |
| F1 | a before-cutoff server marker cannot freeze; a later marker begins the pass | cutoff 2.5 s ahead → `notReady / beforeCutoff`, marker with `startedAt` = the returned `startedAtMs` < `windowEndMs`, no source row, no pool, still `closing`; after the server clock passes → the pass runs (`newAcceptedEntries`), then `frozen` | emulator |
| F2a | a pre-cutoff row without a source blocks even when its verdict is a refusal | `perGoal`, second round un-ingested → `notReady / preCutoffSourceMissing` with `newAccepted 0`; both verdicts now durable; next pass `frozen` | emulator |
| F2b | accepted and refused pre-cutoff sources are both accounted for | `perGoal` + `entrantCap 1`, three un-ingested rows → first pass `newAccepted 1`, refusals `goalAlreadyEntered` + `capReached` recorded; second pass `replayed 3` → `frozen`, 1 ticket | emulator |
| F3 | post-cutoff-only rows do not prevent a clean pass (W7 G) | pre row ingested; two post-cutoff commits un-ingested → **first** attempt `frozen`, `postCutoffIgnored 2`, both refusals recorded; a sibling promotion through `reconcilePromotion` reports `writes 2, converged false` for the same rows | emulator |
| F4 | committed before cutoff, processed after close → included | contribute, `closePromotion`, wait, freeze → `notReady / newAcceptedEntries`, then `frozen` with the entry; the contribution row unchanged | emulator |
| F5 | `formBonusEntries > 0` refuses freeze | `refused / formSourceUnbound`, byte-identical promotion, **no marker**, no pool, repeatable; the zero-bonus twin over the same row freezes | emulator |
| F6 | deterministic, digest-intact, privacy-safe pool | 3 entrants × (3, 1, 2) tickets → `totalTickets 6`, ranges sorted and contiguous from 1, widths by entrant, `storedPoolIntact`; exact key set of the pool and of every range; deep scan for every uid, the goal id, every attempt id and contribution id, `c_`/`f_`/`b_` keys and entry ids; promotion carries `frozen`, `poolDigest`, `frozenAt`, `freezeAttemptId` | emulator |
| F7 | zero tickets refused | no contributions → `refused / poolEmpty`, no pool, still `closing`, marker noted; repeat identical | emulator |
| F8 | oversize refused before any write | `maxPoolBytes 120` over 3 entrants → `refused / poolTooLarge` with measured bytes, no pool, still `closing`; the real bound then freezes the same pool | emulator |
| F9 | concurrent freeze attempts → one byte-stable pool; retries replay | 6 concurrent → exactly 1 `replay:false`, 5 `replay:true`, one digest; 6 markers, one `frozen/replay:false`; three retries `replay:true` with the same digest; pool and promotion byte-identical after; three runs | emulator (concurrent) |
| F10 | `frozen` fences every later award path | `readPromotion` → `promotionInactive`; ingest of a post-cutoff row and of the already-awarded pre-cutoff row → `fenced`; `reconcilePromotion` → `converged false, processed 0`; enable → `notDraft`; close → `notEnabled`; second freeze → replay; classifier → `notEntered / promotionInactive`; promotion byte-identical | emulator |
| F11 | fences write nothing, not even a marker | `draft`, `enabled`, `disabled`, `drawn`, `archived` → `notClosing`; drift → `configDrift`; invalid → `invalidConfig`; missing → `promotionMissing`; `freezeAttempts` empty | emulator |
| F12 | an existing pool is never overwritten; a frozen promotion without an intact pool is fenced | foreign pool under `closing` → `fenced / poolExistsWithoutFrozen`, pool byte-identical, still `closing`; `frozen` with no pool → `poolMissingWhileFrozen`; with an edited pool → `poolCorrupt`; no marker | emulator |
| F13 | the freeze transaction is atomic | `beforeFreezeCommit` throws → no pool, promotion byte-identical; retry → `frozen` | emulator |
| F14 | the pass covers every eligible goal and every page | 2 goals, 7 rows, `pageSize 2` → `goals 2, processed 7`; pool spans goals, 3 entrants, 7 tickets | emulator |
| P1–P8 | pool builder | aggregation / canonical order / contiguous ranges; order-independence over 10 shuffles; digest covers rule version, enablement digest and every range, edited pool detected; bonus tickets count, `pending` / `revoked` excluded; zero → `poolEmpty`; malformed entry → whole pool refused; oversize against the real 512 KiB bound (12 000 entrants) and against an override; exact allowed key set and no sensitive string | **pure** |

**Mutation controls for EXP2B** are recorded in EVIDENCE.md §EXP2B: marker guard
removed, missing-source guard removed, form fence removed, size fence removed, pool
`create` → `set` with the existence check removed, pool write dropped from the
transaction.

## EXP3A rows — the private "My entries" read (CONTRACT §d‴; #365 `5815271789`)

Suite: `receipt.test.ts` — emulator rows R1–R8 against documents the real award and
freeze wrote; a `pure` block for the three helpers.

| # | proves | how | kind |
| --- | --- | --- | --- |
| R1 | draft, disabled, missing and malformed ids are unavailable; a caller cannot smuggle a count or an entrant | `draft` / `disabled` → `unavailable` (trace `promotionInactive`); missing → `promotionMissing`; empty / slashed / path-shaped ids → `invalidInput`; extra `tickets` / `entrantId` fields on the input are ignored | emulator |
| R2 | exact current count under `enabled` and `closing`, `settled:false`; link-missing is current zero | 3 real awards → 3; another member → 0; a never-seen uid → 0; a 4th contribution moves the count only once awarded; after `closePromotion` still provisional | emulator |
| R3 | account isolation and switching carry nothing | a=3, b=1, c=0 on p and a=2 on q; eight sequential reads on one deps object in mixed order, then the same eight concurrently → each its own value | emulator |
| R4 | pending / revoked exclusion; the tally is not consulted | 4 awards; one entry set `revoked`, one `pending` → 2 while the tally still says 4; a malformed `tickets` counts zero → 1 | emulator |
| R5 | provisional → settled; link-missing becomes final zero; `drawn` / `archived` answer from the pool | a=2, b=1, z=0 provisional; real freeze after the server clock passes; a=2 / b=1 / z=0 `settled:true`; `drawn` and `archived` identical; the pool total (3) never appears | emulator |
| R6 | fail closed before and after freeze | drift and invalid config before freeze → `unavailable`; after freeze: edited range → `poolCorrupt`, deleted pool → `poolMissing`, another promotion's intact pool copied in → `poolUnbound`, the promotion's stamped `poolDigest` edited → `poolUnbound`, config drift after freeze → `configDrift`; each restored → the count returns; a link to an entrant absent from the pool → final zero; a malformed link → link-missing | emulator |
| R7 | payload allow-list and deep privacy scan | exact key sets `{status,tickets,settled}` / `{status}`; the receipt JSON contains none of every string the lane stores for the promotion (entrant, link, source, entry, tally, pool and promotion documents and ids) nor the uids, goal, group, attempt and contribution ids; the only numeric field is `tickets`; plain prototype, no symbols | emulator |
| R8 | a read never mutates | every lane document under two promotions byte-identical **including `updateTime`** after 9 reads (ok / stranger / drifted-unavailable), and again after the freeze across 6 settled reads; no document appears for a stranger uid in any lane collection | emulator |
| P9–P11 | `sealReceipt` allow-list and non-count refusal; `ticketsFromEntries` confirmed-positive-integer rule; `ticketsFromPool` width / absent-zero / unusable-null | — | **pure** |

**Failure controls for EXP3A** are recorded in EVIDENCE.md §EXP3A.

**Not in the matrix (next phases, designed for in CONTRACT.md):** the callable that would
expose the "My entries" read, operator controls, paper import and duplicate review, the form-store
binding and its enumerator, the draw, redraws, exclusions, winner contact and claim.
