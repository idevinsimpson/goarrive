# MEMBER-SNAPSHOT-INDEX-1: the one composite index the member snapshot needs

Director release #396 `5846469721`; W4's seam #447 `5846201367`; decision #447 `5846469655`.
**Source only. The index is NOT deployed.**

- **Base:** development `74d1928145bbc76267498ee63b9423b6f6cdfae8`.
- **Files:** `firestore.indexes.json`, plus this receipt.

## The delta

One entry, appended after the only other `wsf*` composite, `wsfContributions (communityGroupId ASC, createdAt DESC)`:

```json
{
  "collectionGroup": "wsfGoalMemberTotals",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "DESCENDING" }
  ]
}
```

## Semantic proof, computed against the base file

| check | result |
| --- | --- |
| parses as JSON | yes |
| composite count | 49 → 50 |
| entries added | exactly one, the entry above |
| entries removed | none |
| first 49 entries | identical and in the same order |
| `fieldOverrides` | identical (2 entries, neither on a `wsf` collection) |
| duplicates | 0 |
| existing `wsfGoalMemberTotals` composite or override | none |

## The query shape it serves

The query W4 will write, as approved in `5846469655`:

- `where('userId', '==', uid).orderBy('updatedAt', 'desc').limit(N + 1)`
- next page: `startAfter(lastUpdatedAt, lastDocId)`

This is served by the index as follows:

1. **The equality field** `userId` leads the index.
2. **The one ordered field** `updatedAt` follows it, in the same direction as the query's `orderBy` (DESC).
3. **The document-id tiebreak** is implicit. Firestore appends `__name__` in the direction of the last `orderBy`, so a `(updatedAt, docId)` cursor needs no further field.

**No other query reads this collection.** Today `functions-westayfit` reads `wsfGoalMemberTotals` only as direct documents `{goalId}_{uid}` (W4's source survey), so the index serves the new query and nothing else.

**Why no test can prove this:** the Firestore emulator does not enforce composite indexes. An unindexed query passes every local test and fails on the first real call. Serving is therefore established from the index definition above, and in staging only by the index's READY receipt.

## Release boundary: what this receipt does not do

1. **Nothing is deployed.** After acceptance, one permitted staging operator deploys this **single** index and reads back READY.
   - The procedure is `docs/wsf-staging/social-inventory/SINGLE-INDEX-OPERATOR-PROCEDURE.md` on `main`.
   - **Never** `firebase deploy --only firestore:indexes`. `firestore.indexes.json` is the whole shared catalog, 48 GoArrive indexes among them, and a catalog deploy prunes whatever the file does not list.
   - The staging workflow never deploys indexes.
2. **It changes the next staging pin's boundary.** `firestore.indexes.json` is on the pin's protected-path list, so the first pin carrying this commit will report a non-empty protected delta: this one entry.
3. **The snapshot callable must not stage before the READY receipt.**

No functions, app, rules, packages, workflows, IAM or credentials were touched.
