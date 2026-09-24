# Expo prize-drawing core — Packet A contract

**Status: proposed contract, delivered on `claude/wsf-expo-prize`; not accepted, not integrated, nothing enabled.**
Every `file:line` below is cited at base `16cf96dcbecc4b64cfd9a11a5ae7acd770cc1453`
(`index.ts` = `functions-westayfit/src/index.ts`). Packet reference: #365 `5806424724`.

## 0. The one-paragraph contract

A **promotion** is a configured, versioned, server-only record. It is *disabled* unless
an operator enables it, and a disabled promotion awards nothing and promises nothing.
While it is `enabled` or `closing`, the server **observes committed canonical sources** —
today exactly one kind of movement source, the durable
`wsfContributions/{goalId}_{uid}_{attemptId}` row, plus one kind of form source, a
server-verified community-interest completion receipt — and **adjudicates** each source
exactly once into at most one **entry** for an **opaque entrant**. One qualifying completed
challenge is one entry regardless of repetitions; phone and station are one path; a
qualifying form is one bonus; the cap, if any, is an explicit configured number of
entrants and never limits movement; a contribution committed before the cutoff is never
lost because processing finished later; the award never touches, and can never roll back,
the contribution it observed. Close, freeze, draw and claim are designed here and not
built in A+B.

## 1. Resolutions from source

### (a) Reuse the canonical contribution path

| fact | where |
| --- | --- |
| `wsfContribute` is only the authenticated door onto `performContribution` | `index.ts:3273`, call at `:3297` |
| `performContribution` is the one contribution; it validates `goalId` / `attemptId` / `count` itself | `:3322–3343` |
| The durable key: `wsfContributions/${goalId}_${uid}_${attemptId}` | `:3355` |
| Idempotent replay: an existing row returns the original receipt and writes nothing | `:3413–3450` |
| Gates, in order: active membership → goal active → server-time window → repeat policy | `:3455–3532` |
| The row is written with `goalId`, `attemptId`, `userId`, `count`, `communityGroupId`, `createdAt: serverTimestamp()` | `:3538–3550` |
| The combined-parent credit is written **in the same transaction**, as a second row `wsfCombinedCredits/{goalId}_{uid}_{attemptId}` named after the contribution | `:3606–3660`, naming rationale `:2927–2958` |
| `completeTurnEntry` calls `performContribution` with the attempt the turn minted; contribution first, bookkeeping second | `:8819–8833` |
| Station completion (`wsfCompleteTurn`) and phone completion (`wsfCompleteMyTurn`) both go through `completeTurnEntry` | `:8939 / :8970` and `:8999 / :9021` |
| Contributions are immutable; a correction is a new row on `wsfGoalAdjustments/{goalId}_{correctionId}` that moves totals, never the contribution | `:4191`, `:4821` |
| `/event/[goalId]` resolves a **turn event** (`goal:<id>` or `setup:<id>`) through `resolveTurnEvent`; the route parameter is a goal id or a setup id, never a promotion | `resolveTurnEvent` `:7646–7710`, `wsfEventContext` `:7985–8010`, `TurnEntryDoc.eventKey` |

**Decisions.**
- **Movement source identity** = `(promotionId, goalId, uid, attemptId)`. The source key is
  `c_{goalId}_{uid}_{attemptId}` — the complete canonical contribution identity, and nothing
  else. It is the same triple the ledger, the recent-additions row and the combined credit
  are keyed on, so every replay, retry, and second completion path collapses onto it.
- **Same-attempt phone/station completion** is one source by construction: both paths land
  on one `wsfContributions` row (`:8807–8817`), so there is one source key and one entry.
- **Combined-parent credit never yields a second entry.** The only movement source the core
  accepts is a `wsfContributions/…` document path. `wsfCombinedCredits/…`,
  `wsfCombinedCounters/…`, `wsfGoalCounters/…`, `wsfGoalMemberTotals/…`,
  `wsfGoals/…/recentAdditions/…` and `wsfTurnReceipts/…` are refused as source paths
  (reason `notAContributionPath`). A combined **setup** is never an eligible source; only
  child goals are listed in a promotion, so the parent's credit row has no way in.
- **`/event/[goalId]` is a goal route, not a legal promotion id.** A promotion id is its own
  random document id; the promotion lists the goal ids it accepts. No route parameter is
  ever read as a promotion id.
- **Count is read, never used for entitlement.** `performContribution` already guarantees
  `count ≥ 1` (`:2524–2529`); the adjudicator checks only that the row exists and is
  well-formed. 1 rep and 100 reps are the same entitlement.
- **Corrections** (`wsfGoalAdjustments`) are not a source and do not automatically revoke an
  entry. A human-reviewed revocation is a next-phase operator action; the entry status
  `revoked` exists in the schema for it. Rationale: a correction moves *amounts*, and the
  entry is not about amounts.

### (b) Separation of concerns

Seven collections, all `wsf`-prefixed, all Admin-SDK-only (default-deny under the WSF
rules section `firestore.rules:1198–…`, the same posture as `wsfContributions` per
`index.ts:2071–2077`). No rules change is needed for a server-only slice; a
`DATA_OWNERSHIP.md` entry is owed when any of them ships (that file's own rule, lines
17–22).

| collection | holds | never holds |
| --- | --- | --- |
| `wsfPromotions/{promotionId}` | configuration: status, rule version, eligible goals (map), `eligibleGoalIds` (derived sorted array the trigger body routes on — written by the enable step, digested, drift-fenced; EXP2A), window, cap, bonus policy, repeat rule, operator uids (nonempty, digested), config digest, `enabledAt` | entrants, entries, contact |
| `wsfPromotionEntrants/{promotionId}_{entrantId}` | the opaque entrant: `entrantId` (random), `identityBasis` (`firebaseUid` \| `paperSlip`), `createdAt`, `mergedInto` (reserved, human-reviewed) | uid, email, phone, name |
| `wsfPromotionEntrantLinks/{promotionId}_uid_{uid}` | uid → entrantId, one per uid per promotion; the only place a uid meets an entrant | contact |
| `wsfPromotionContacts/{promotionId}_{entrantId}` | the private prize-only contact record (schema only in A+B; no writer exists) | anything a community, kiosk or display surface reads |
| `wsfPromotionSources/{promotionId}_{sourceKey}` | adjudication of one observed source: `kind`, `verdict` (`accepted` \| `refused`), `reason`, `ruleVersion`, `canonicalPath`, `sourceCommittedAt`, `entryId` | the count, the contact |
| `wsfPromotionEntries/{promotionId}_{entryId}` | one entry: `entrantId`, `kind` (`movement` \| `formBonus` \| `paper`), `status` (`confirmed` \| `pending` \| `revoked`), `tickets` (1 for movement, `formBonusEntries` for the bonus), `goalId` (movement only), `sourceKey`, `ruleVersion`, `awardedAt` | uid, name |
| `wsfPromotionEntrantTallies/{promotionId}_{entrantId}` | per-entrant counters read inside the award transaction: `entryCount` (counts **tickets**, not entry documents), `formBonusAwarded`, `movementGoals` (map goalId → true) | anything global |
| `wsfPromotionCounters/{promotionId}` | `entrantCount` — the only cross-entrant document, touched once per entrant, only when a cap is configured | ticket counts |
| `wsfPromotionPools/{promotionId}` | **next phase**: the frozen, immutable ticket mapping, count, rule version, digest | — |
| `wsfPromotionDraws/{promotionId}_{prizeId}` | **next phase**: one persisted draw result per prize before reveal; redraws and exclusions with audit | — |

- **One uid is not proof of one human.** The link is uid → entrant, never merged
  automatically. Two uids on one phone are two entrants until a human resolves them
  (`mergedInto`, next phase). A paper slip is an entrant with `identityBasis: 'paperSlip'`
  and never a Firebase account or a contribution.
- **Ordinary Champions are not operators.** `wsfPromotions.operatorUids` is an explicit
  list. Nothing in `wsfMemberships.role` grants promotion authority. In A+B no operator
  action exists at all; fixtures seed the configuration directly.

### (c) Ingestion path and bounded reconciliation

The core is transport-agnostic: `ingestContribution(promotionId, contributionPath)` and
`reconcileGoal(promotionId, goalId, cursor, pageSize)` are plain async functions over the
Admin SDK. Two supported transports are specified; both call the same idempotent ingest.

1. **Operator-invoked reconciliation (primary, proven transport).** An `onCall`
   (`region: 'us-central1'`, the shape every WSF callable already deploys with) that an
   operator uid calls to drain a goal page by page. It needs no new API, no Eventarc, no
   scheduler, and its invoker-IAM behaviour is the one this project already measured
   (`docs/westayfit/staging-station-transport.md`). Its `index.ts` export is a reservation
   request to L0, not part of this packet.
2. **Firestore-created trigger (candidate, latency improvement).**
   `onDocumentCreated('wsfContributions/{id}')` from `firebase-functions/v2/firestore`
   (available in the installed 4.9.0; `functions-westayfit` currently deploys **no**
   Firestore trigger, only `onCall`). First deployment of a v2 Firestore trigger requires
   Eventarc enablement and service-agent IAM that firebase-tools grants at deploy — an
   operator action to verify, never assumed here — and the function region must match the
   Firestore database location, which this lane cannot read. Packet B tests the handler
   body in isolation by calling it with a synthetic event; no trigger is registered.

**Convergence.** Every ingestion is one transaction whose durable rows (source, entry,
entrant, link) are `create`s under deterministic ids; the counter and the tally are
`increment` merges and the entrant id is random, so their idempotence is borrowed from the
co-transactional creates rather than being their own (§d). A transaction that loses a race
is retried by the SDK (ABORTED) and then observes the source row and returns `replay`. So
at-least-once delivery, duplicate delivery, out-of-order delivery and an interrupted
reconciliation all converge to the same end state: run it again. The reconciliation query is
`wsfContributions.where('goalId','==',goalId).orderBy(FieldPath.documentId()).startAfter(cursor).limit(pageSize)`
— an equality on one field ordered by document name, chosen because it needs **no
composite index** (`firestore.indexes.json` is not reserved). The cutoff is evaluated in
code from each row's `createdAt`. The emulator does not enforce indexes, so this is a
reasoned claim to re-verify at wiring time, not a proven one.

**Never trusted:** client ticket totals, `formCompleted` flags, displayed totals, request
bodies naming a count, and any newly invented contribution writer. The ingest accepts a
*path* and re-reads the row inside the transaction.

### (d) Transaction boundary

One Firestore transaction per source:

```
reads  : wsfPromotions/{p}                          status, ruleVersion, digest, eligibility, cap, rules
         wsfPromotionSources/{p}_{sourceKey}         dedupe — exists ⇒ return the stored verdict, write nothing
         wsfContributions/{goalId}_{uid}_{attemptId} the canonical row: exists, goalId/userId/communityGroupId match the path, createdAt
         wsfPromotionEntrantLinks/{p}_uid_{uid}      entrant for this uid, if any
         wsfPromotionEntrantTallies/{p}_{entrantId}  one-time bonus, per-goal rule, entry count   (only if entrant exists)
         wsfPromotionCounters/{p}                    only when creating an entrant AND a cap is configured
writes : wsfPromotionSources/{p}_{sourceKey}         create (verdict accepted|refused, reason, ruleVersion)
         wsfPromotionEntries/{p}_{entryId}           create, entryId == sourceKey c_{contributionId} (movement) or b_{entrantId} (bonus; its source row is f_{receiptId})
         wsfPromotionEntrantTallies/{p}_{entrantId}  merge
         wsfPromotionEntrants + EntrantLinks          create, only for a first accepted source
         wsfPromotionCounters/{p}                    increment entrantCount, only on entrant creation under a cap
```

- **The award never rolls back movement**: the contribution row is in the read set only.
  Nothing in the transaction writes to `wsfContributions`, `wsfGoalCounters`,
  `wsfGoalMemberTotals`, `wsfCombinedCredits` or any turn document. A failed award leaves
  the accepted movement exactly as `performContribution` committed it.
- **No globally contended ticket counter.** Entries are keyed documents; the per-entrant
  tally is the only document two of one person's contributions contend on. The single
  promotion-wide counter is touched at most once per entrant, and only if a cap is
  configured. The promotion document is read, never written, by ingestion.
- **Dedupe** is the source row's `create` plus the deterministic entry id. A concurrent
  duplicate loses the transaction's read-set check, is retried (ABORTED), observes the row
  and returns `replay`; ALREADY_EXISTS is not retryable and is not expected to be reached.
  **One-time bonus** is `tally.formBonusAwarded` plus the deterministic `b_{entrantId}`
  entry id (the receipt's own source row is `f_{receiptId}`) — two independent guards.
  **Cap**: the transaction that would create the (cap+1)-th entrant records the source
  `refused / capReached`; the server SDK's transactions lock the documents they read, so
  concurrent last-slot claims admit exactly one. **W7 D, closed by EXP2A (§d′):** under
  `entrantCap: null` the counter is never written, and the enable transition refuses to
  enable a draft under which any admission exists, so a cap can never be added or changed
  after an admission and no partial counter is ever initialised.
- **Rule version and config digest.** `ruleVersion` is stored on every source row and
  entry. At `enabled` the operator's configuration is digested (`enabledConfigDigest`); the
  ingest recomputes the digest from the fields it reads and refuses on mismatch
  (`configDrift`), so a configuration edited after enablement is tamper-evident rather than
  silently re-adjudicating.
- **Repeat rule** is explicit and required at enablement: `perContribution` (each distinct
  accepted contribution is an entry) or `perGoal` (one entry per goal per entrant). The
  eventual published rule is the owner's; the enable step (§d′) refuses to enable and the
  code refuses to **adjudicate** under a promotion without a value (`readPromotion` →
  `invalidConfig`) rather than defaulting to "one per unique activity".

**Lifecycle and write fence.**

```
draft ──enable──▶ enabled ──close──▶ closing ──freeze──▶ frozen ──draw──▶ drawn ──▶ archived
  │                  │
  └──disable──▶ disabled ◀──┘          (disabled: terminal for A+B; awards nothing)
```

| status | ingest writes? | rule |
| --- | --- | --- |
| `draft`, `disabled`, `frozen`, `drawn`, `archived` | **no** — the fence; the source row is not even written | a disabled promotion produces no award and no product promise |
| `enabled` | yes | sources with `windowStartsAt ≤ createdAt < windowEndsAt` accepted |
| `closing` | yes | same cutoff test on `createdAt`; late *processing* of an early *commit* is accepted |

**Authoritative cutoff** = the contribution's own `createdAt`, the server timestamp written
inside `performContribution`'s transaction (`:3550`), compared with the promotion's
`windowEndsAt`. Wall-clock at processing time is irrelevant to a row's eligibility.
`closing → frozen` (next phase) needs two guards this packet does not build: (1) a
**pool-relevant** convergence — a full pass that accepted no new row and observed no
pre-cutoff row without a source row — rather than `reconcilePromotion`'s `converged`,
which counts recorded refusals as writes and therefore toggles on post-cutoff movement
(W7 G); and (2) a **start-after-cutoff-by-server-clock** check, because a pass that begins
before `windowEndsAt` has passed on Firestore's clock cannot prove a pre-cutoff commit is
not still in flight, and a maximum observed `createdAt` is not a proof of absence.

### (d′) The enable transition — EXP2A (Director #467 `5810305427`)

`enablePromotion(deps, promotionId)` in `src/expo-prize/enable.ts`, unexported. One
transaction, one write, exactly `draft → enabled`:

```
reads  : wsfPromotions/{p}                       must be `draft`; must carry no enabledConfigDigest / enabledAt
         wsfPromotionEntrants  prefix {p}_ (limit 1)   any row ⇒ fenced entrantsExist
         wsfPromotionEntrantLinks prefix {p}_ (limit 1) any row ⇒ fenced entrantsExist
         wsfPromotionCounters/{p}                 entrantCount > 0 ⇒ fenced entrantsExist
decide : validatePromotionConfig(doc) — every decision explicit, now including a nonempty
         validated operatorUids; eligibleGoalIds DERIVED (sorted) from the validated map,
         never read from the document or a caller
write  : update { status: 'enabled', eligibleGoalIds: <derived>, enabledConfigDigest, enabledAt: serverTimestamp() }
```

| outcome | when | written |
| --- | --- | --- |
| `fenced / notDraft` | any status but `draft` (`enabled`, `closing`, `disabled`, `frozen`, `drawn`, `archived`) | nothing |
| `fenced / enableArtefactsPresent` | a draft already carrying a digest or `enabledAt` (an enabled document set back by hand) | nothing |
| `fenced / entrantsExist` | any entrant, link or counted admission under the promotion | nothing |
| `refused / invalidConfig` | a missing or invalid decision, each named | nothing |
| `enabled` | otherwise | the four fields above, atomically |

- **D closed (Director ruling):** a cap can never be added or changed after an admission.
  Enable fails closed on any admission; after enablement, every configuration field is
  covered by the digest (`readPromotion` fences `configDrift`), and there is no re-enable.
  No counter is ever initialised from entrant documents.
- **F5 closed:** `eligibleGoalIds` is derived and persisted by enable, covered by the
  digest, and `readPromotion` refuses a stored array that is missing, reordered, widened or
  edited (`configDrift`) — so both direct adjudication and the trigger body's routing are
  fenced by drift. A caller's or document's array is replaced, never trusted.
- **Operators are a decision:** `operatorUids` must be nonempty and valid; it is part of
  the digest, so an operator change after enablement is drift. That is a consequence the
  Director may relax later (a separate operator-roster document would do it); nothing in
  this packet reads the list for authorisation, since no callable exists.
- **Concurrency:** two enables read the same draft; one commits; the other's read set
  changed, the SDK retries it, it reads `enabled` and is fenced. One write means no partial
  state.
- **Not here:** `closing → frozen`, the pool, and the freeze's convergence / start-after-
  cutoff guards (W7 G) — the next packet.

### (e) The community-interest form and its trusted receipt seam

**What exists.** The public site (Lovable + Supabase, `westay.fit`) owns marketing and
inquiry capture (`WE_STAY_FIT_MASTER.md` §3, lines 234–238). Its interest capture lands
in `interest_responses` (`DATA_OWNERSHIP.md:29`), a Lovable-owned collection the WSF app
may **read one-way** once rules land and must **never auto-convert**
(`LOVABLE_HANDOFF.md:21–25, :35`). No current callable, route or test in `apps/westayfit`
or `functions-westayfit` reads it. There is no "formCompleted" flag anywhere in the WSF
product today.

**Decision.** The trusted seam is a **server-side re-read of a receipt by id** through a
`FormReceiptSource` adapter, never a client claim:

- the caller supplies only a `receiptId`; the server resolves it against the owning store
  and obtains `{ receiptId, subjectUid, completedAt }`;
- the receipt must bind to an authenticated, verified subject (`subjectUid`) that is the
  uid behind the entrant; a receipt that does not resolve is refused (`unknownReceipt`),
  one that resolves to another subject is refused (`subjectMismatch`);
- marketing consent is **not read and not stored** by the core; eligibility is the same
  either way, and consent stays in the marketing system of record;
- a form never creates a contribution or changes any total; a form-only entrant is a valid
  entrant with a `formBonus` entry and no movement — the entry path for people who do not
  exercise.

Which store backs the adapter is an **owner/Director decision** (§4): (A) the existing
`interest_responses` capture — requires a verified-email ↔ uid match and a fixed shape,
neither confirmed from this repo; or (B) a promotion-scoped form submitted from the
signed-in app, writing a promotion-only receipt (not a CRM; no marketing fields). Packet B
implements the adapter contract against a synthetic source and no live binding.

**Paper-only entrants**, if approved, are `identityBasis: 'paperSlip'` entrants with a
stable operator-assigned slip id, `pending` until human duplicate review, never a Firebase
account and never a contribution. Schema only in A+B.

### (f) Files, commands, prerequisites, decisions

**Files this lane adds (reservation only):**

```
docs/westayfit/expo-prize/README.md            lane index + delivered/accepted/integrated
docs/westayfit/expo-prize/CONTRACT.md          this document
docs/westayfit/expo-prize/TEST-MATRIX.md       the matrix Packet B implements
docs/westayfit/expo-prize/EVIDENCE.md          Packet B measured results (added with B)
functions-westayfit/src/expo-prize/policy.ts        typed promotion contract, validation, digest
functions-westayfit/src/expo-prize/adjudicate.ts    deterministic source adjudication (pure)
functions-westayfit/src/expo-prize/award.ts         the transaction: ingest contribution / form receipt
functions-westayfit/src/expo-prize/reconcile.ts     bounded page reconciliation
functions-westayfit/src/expo-prize/status.ts        confirmed / pending / not-entered classifier (pure)
functions-westayfit/src/expo-prize/enable.ts        the draft → enabled transaction (EXP2A)
functions-westayfit/src/expo-prize/index.ts         module barrel — NOT exported from src/index.ts
functions-westayfit/tests/expo-prize/*.test.ts      emulator tests
functions-westayfit/jest.expo-prize.config.cjs      NEW config (existing configs match tests/callable only) — reservation request
```

`tsconfig.json` includes `src`, so `npm run build` compiles the module into `lib/`
(gitignored). Nothing imports it; no export, route, trigger or rules block is added.

**Test command** (no npm script is added; the same shape the existing harness uses):

```
cd <repo root>
METADATA_SERVER_DETECTION=none npx -y firebase-tools@15 emulators:exec \
  --only firestore,auth --config firebase.westayfit.emulators.json --project demo-wsf-local \
  "cd functions-westayfit && GCLOUD_PROJECT=demo-wsf-local METADATA_SERVER_DETECTION=none \
   npx jest --config jest.expo-prize.config.cjs"
```

Control, run in this container before writing any test: the existing
`tests/callable/wsf-contribute.test.ts` under the same command shape passes 25/25
(`firebase-tools` 15.31.0, Firestore emulator 1.22.0, Java present).

**Deployment prerequisites (none are exercised by A+B; listed for the wiring packet):**

1. An `index.ts` export for the reconcile callable (L0 reservation).
2. If the Firestore trigger is chosen: Eventarc + service-agent IAM at first deploy of a
   v2 Firestore trigger, and a region matching the database location — operator-verified.
3. Confirm the reconciliation query needs no composite index against the live project.
4. `DATA_OWNERSHIP.md` entries for the new collections; no rules change for a server-only
   slice (default-deny), a rules block only if a member-facing read ("My entries") ships.
5. Existing W8 staging permission does not cover this system; a separate release action.

**Unresolved owner decisions (configurable; the code refuses to enable or adjudicate without them):**

| decision | where it lands |
| --- | --- |
| the published rule for repeated legitimate rounds (`perContribution` vs `perGoal`) | `wsfPromotions.repeatRule` |
| entrant cap, or explicitly none | `wsfPromotions.entrantCap` (`number` or `null`) |
| eligible goals for the expo (the child goal ids) and the window / cutoff | `eligibleGoals`, `windowStartsAt`, `windowEndsAt` |
| the form store behind the receipt adapter (A or B above) | adapter binding |
| whether a paper contingency is approved, and its handling | `paper` entries, next phase |
| actual prizes, one-prize policy, contact and claim deadlines, redraw rule, age policy, legal notice / retention | `wsfPromotionDraws`, contact record — all next phase |
| who the operators are | `operatorUids` |

**Effort and dependencies toward an October 4 device rehearsal (estimate, not a promise):**
Packet B (this lane, now) delivers the core and its proofs. Wiring the reconcile export
and the operator seed is small once reserved. The rehearsal additionally needs the private
"My entries" receipt, an event-scoped operator screen, the form-store decision, and the
close/freeze/draw transition — each a separate packet with its own review. The two
external dependencies are the operator (deploy, IAM if the trigger is chosen) and the
owner decisions above.
