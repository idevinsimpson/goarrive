# MEMBER-SNAPSHOT-1 Phase A — receipt

- **Product:** `b71cf07f24bb388822c4c355357873dcb76515c2` on `claude/wsf-w4-member-snapshot`, from exact development `74d1928145bbc76267498ee63b9423b6f6cdfae8`.
- **Assignment:** Director #447 `5843367693`, activated `5845751888`, indexed personal-first decision `5846469655`.
- **Files:** `functions-westayfit/src/index.ts` (one additive export, `wsfMyMemberSnapshot`, plus the `FieldPath` import) and `functions-westayfit/tests/callable/wsf-my-member-snapshot.test.ts`. No app, rules, `firestore.indexes.json`, package, auth or `.github` change.

## Dependency: the composite index (not in this change)

The spine query needs:

```json
{ "collectionGroup": "wsfGoalMemberTotals", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "userId", "order": "ASCENDING" },
              { "fieldPath": "updatedAt", "order": "DESCENDING" } ] }
```

W3 owns that one-entry index packet. The Firestore emulator does not enforce composite indexes, and the staging workflow never deploys indexes, so **no test here can prove the index exists**. This callable must not be deployed, pinned or consumed by a client until the index source is accepted and the staging index has a verified READY receipt. There is no unordered fallback. Adding the export also moves the functions inventory from 49 to 50, so any future pin must list it in `candidateAddedFunctions`.

## The callable

- **Auth:** anonymous → `unauthenticated`. The subject is `request.auth.uid` only; any other request field is ignored. The one accepted field is `cursor`.
- **Request:** `{}` for the first page, `{ cursor }` for the next.
- **Response:**
  - `schemaVersion: 1`
  - `communities[]`: `groupId, displayName, groupType, role, memberCount (number|null), isSample, goals (Goal[]|null), partial`
  - `Goal`: `goalId, title, unit, target, status, startsAt, endsAt, timezone, sharedTotal (number|null), ownCredit (number|null)`, plus optional `reachedAt`, `closedAt` (historical, passed through)
  - `truncated: { communities, goals }`
  - `nextCursor: string | null`
- **Algorithm (first page):**
  1. active memberships (the `wsfMyCommunities` query); `getAll` the group docs; one `count()` per kept community;
  2. `wsfGoalMemberTotals where userId == uid orderBy updatedAt desc, documentId desc limit 26`;
  3. `getAll` only those goal docs; drop any whose community is not an active, kept membership;
  4. at most 3 `active` goals per community (equality-only query; no composite), and a direct `getAll` of the caller's own-total docs for any of them not on the page;
  5. one `sumGoalShardsForMany` for every returned goal.
  - Next pages repeat 1–3 and 5 from the cursor, without step 4.

## Cursor, truncated and partial

- **Cursor:** opaque base64url of `{ t: updatedAt millis, id: own-row doc id }`. It resumes with `startAfter(updatedAt, docId)` inside `userId == caller`, so a forged cursor can only move within the caller's own rows. Malformed, oversized, negative or path-bearing cursors are `invalid-argument`.
- **`truncated.communities`:** more than 20 active communities; the first 20 by display name (then id) are kept.
- **`truncated.goals`:** more own rows than the page (a `nextCursor` is set), more than 3 active goals in a community, or a 35-per-community / 50-total cap cut.
- **`partial: true`:** the own-rows query or the owned-goal read failed, or this community's active-goal query failed. **`goals: null`** only when no section could be read at all for that community.
- **Unknown is never 0:**
  - `ownCredit: 0` only for an own-total doc read and found absent;
  - `null` when the row is malformed (non-number, negative, non-finite) or the read failed;
  - `sharedTotal: null` when the shard read failed;
  - `memberCount: null` when its count failed.

## First-page reads and response size (descriptive, emulator)

Counted by instrumenting `getAll`, `Query.get` and aggregate `count().get()` during one call. Docs are billed reads (an empty query counts 1).

| fixture (communities / active per community / owned) | goals returned | RPCs | document reads | response bytes |
|---|---|---|---|---|
| 1 / 2 / 2 | 2 | 7 | 29 | 723 |
| 5 / 2 / 12 | 12 | 15 | 169 | 3,757 |
| 20 / 4 / 25 (max page: 50-goal cap) | 50 | 47 | 725 | 14,900 |

The shard read dominates, at 10 docs per returned goal (500 of the 725 at the cap). The rest scales with communities plus owned goals, not with every historical goal in every community.

## Proof

- **Focused tests:** `wsf-my-member-snapshot.test.ts`, **10 / 10** pass on `b71cf07f`. **All 10 fail on `74d19281`**, which has no export.
- **Constituent callables unchanged:** my-communities, list-goals (with history), my-contribution and package-e run together with the snapshot file: **65 / 65**.
- **Deploy-config:** **17 / 17**. **tsc** (functions): 0.
- **Mutants: 4 / 5 caught.** Malformed own row → 0; absent own doc → null; shard failure → 0; departed goal leaking into a kept community (both membership filters removed).
  - The fifth, removing only the first membership filter, is **equivalent**: the later kept-community filter, a subset of active memberships, still drops the goal. The filter stays as defence in depth.
- **Command:** `firebase emulators:exec --only firestore,auth --project demo-wsf-local --config firebase.westayfit.emulators.json "npm --prefix functions-westayfit run test:callable -- --testPathPatterns='wsf-(my-member-snapshot|my-communities|list-goals|my-contribution|package-e)'"`

## Limitations and open points

- **Legacy rows:** own rows written before `userId` / `updatedAt` were stamped are invisible to the ordered spine, because Firestore excludes documents missing an `orderBy` field. Every current writer stamps both.
- **Phase B:** each community's `goals` is the member's own page plus a small active set, **never** the full `wsfListGoals` list. Phase B must not seed full-list cache keys from it, and it lacks `joinPolicy`, visibility and `activeChallenge` by contract.
- **Caps:** the contract's caps (20 / 35 / 50) govern over the audit's (20 / 25+10 / 100).
- **Shape:** the nested shape of `5841254277` is kept, with the personal-first page expressed as `nextCursor`.
- **Staging:** a new service arrives transport-SHUT on staging (#396 packet 16), so a client must keep its fallback to the constituent reads.
