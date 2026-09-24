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
| `functions-westayfit/jest.expo-prize.config.cjs` | 21 | new config; `tests/expo-prize/**`; same isolation setup file; no npm script |
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

## The next seam

In order, each its own reserved and reviewed packet:

1. **Wiring (L0 reservation on `src/index.ts`)**: one operator-authorised `onCall`
   exposing `reconcilePromotion` / `reconcileGoal`, and the decision on the trigger.
2. **Owner decisions into a real (still disabled) promotion document**: repeat rule,
   cap-or-null, eligible goals and window, form store, operators.
3. **"My entries"**: a member-only read that returns `classifyEntryStatus` for the caller's
   own contributions and nothing about anyone else; no counts on any shared surface.
4. **Close → reconcile → freeze**: the transition that requires `converged` and writes
   `wsfPromotionPools/{promotionId}` with the immutable ticket mapping, count, rule version
   and digest.
5. **Draw**: unbiased server selection over tickets, one persisted result per prize before
   reveal, redraws and exclusions with audit; then manual private winner contact.
