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

**Not in the matrix (next phases, designed for in CONTRACT.md):** the "My entries"
receipt surface, operator controls, paper import and duplicate review, close → freeze with
the immutable pool digest, the draw, redraws, exclusions, winner contact and claim.
