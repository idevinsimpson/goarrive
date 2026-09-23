# Creating the one `wsfContributions` index on staging — and nothing else

**Packet** `5797676140`, deliverable 2. **Nothing here was run:** no `gcloud`, no
`firebase`, no console action, no IAM change, no deploy. This is a procedure for an
operator to review and perform, written from the source and configs rather than from a run.

**Scope: `westayfit-staging` only, one index, no deletion.**

---

## 1. Which index, verified from the query rather than from the request

`wsfCommunityActivity` at app-shell `37367fd` (`functions-westayfit/src/index.ts:9597`):

```js
db.collection('wsfContributions')
  .where('communityGroupId', '==', groupId)
  .orderBy('createdAt', 'desc');
// plus, when a cursor is supplied:
q.where('createdAt', '<=', Timestamp.fromMillis(cursor.b));
```

An equality filter on one field with an `orderBy` on another is exactly the shape that
requires a composite index. `firestore.indexes.json` at the same SHA declares it:

```json
{ "collectionGroup": "wsfContributions", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "communityGroupId", "order": "ASCENDING" },
              { "fieldPath": "createdAt",        "order": "DESCENDING" } ] }
```

The source says the rest itself: *"declared in firestore.indexes.json on this branch and
**NOT DEPLOYED** here. The emulator does not enforce indexes, so this query passes locally
with or without it."* A green emulator run is therefore **not** evidence that this index
exists.

**One index, not two.** `wsfCommunityMembers` (`:9340`) queries `wsfMemberships` with two
**equality** filters and a `limit` and no `orderBy`; equality-only conjunctions are served
from single-field indexes and need no composite. I checked rather than assumed, because
"the members feature needs an index" would otherwise be carried as two.

## 2. Why the catalog must not be deployed

`firebase deploy --only firestore:indexes` deploys **the whole shared catalog**:
`firestore.indexes.json` holds **49** indexes at `37367fd` and **48** on `main` — the one
difference is the `wsfContributions` entry. The other 48 are GoArrive's (`session_instances`,
`workout_logs`, `ledgerEntries`, `billingEvents`, `agent_messages`, …) and have nothing to
do with We Stay Fit.

There is a second reason beyond blast radius: a catalog deploy is also a **pruning**
operation in Firebase's model — indexes absent from the file can be removed — so pointing
that command at a project whose live index set was not built from this file is how an
unrelated production query loses its index. **Never that command here.** The staging deploy
config already refuses the whole area: *"firestore and storage are deliberately absent:
rules and indexes are not part of any WSF deploy."*

## 3. The one operation

**Preferred — gcloud, one index, named project:**

```
gcloud firestore indexes composite create \
  --project=westayfit-staging \
  --database='(default)' \
  --collection-group=wsfContributions \
  --query-scope=COLLECTION \
  --field-config=field-path=communityGroupId,order=ascending \
  --field-config=field-path=createdAt,order=descending
```

`--project` is passed explicitly rather than relying on the active configuration, because
the default project is the one thing that turns a staging action into a production one.
`--query-scope=COLLECTION` matches the declaration; `COLLECTION_GROUP` would be a different
index and would not serve this query.

**I could not execute or version-check this command** — no `gcloud` call is permitted to me
and none was made. The operator should confirm the flag spelling against their own CLI
(`gcloud firestore indexes composite create --help`) before running it; `--field-config` is
the current form and older releases spelled it differently.

**Equivalent, if the CLI is unavailable — Firebase console:**
Firestore → Indexes → Composite → Create index, collection ID `wsfContributions`, scope
*Collection*, fields `communityGroupId` Ascending then `createdAt` Descending. Confirm the
project selector reads **westayfit-staging** before saving.

**What it needs:** the `datastore.indexes.create` permission, carried by
`roles/datastore.indexAdmin` (and by owner/editor). This is a **new** capability for whoever
performs it — the deploy service account `wsf-staging-deployer@westayfit-staging` is not
established to hold it, and nothing here grants it. If the operator's identity lacks it, the
answer is to report that, not to widen the deploy SA: this is a one-off human action, not a
pipeline capability, and giving the deploy identity index rights would enlarge what a
compromised deploy can do for no recurring benefit.

## 4. Reading the state, and the receipt to record

```
gcloud firestore indexes composite list \
  --project=westayfit-staging --database='(default)' \
  --format="table(name, queryScope, state, fields)"
```

`state` is `CREATING` while it builds and `READY` when it can serve. `NEEDS_REPAIR` means it
must be deleted and recreated — the one case where a deletion is correct, and it needs its
own review.

**The receipt:** the index's resource name, `queryScope=COLLECTION`, the two fields in order,
`state=READY`, and the timestamp of the reading. That is metadata only; nothing in it is a
secret and nothing in it identifies a member.

Build time on a staging project with a small `wsfContributions` collection should be short,
but **"submitted" is not "READY"** and only the second one is evidence.

## 5. What the queries do before READY

The callable fails — it does not degrade. Firestore answers a query whose index is missing or
still building with `FAILED_PRECONDITION`, and the client sees the callable's error path, not
an empty list. So:

- **Before the index exists:** every `wsfCommunityActivity` call for any community fails.
- **While it is `CREATING`:** the same. A partially built index serves nothing.
- **After `READY`:** the query is served.

`wsfCommunityMembers` and `wsfSetCommunityVisibility` are unaffected — neither needs this
index (§1).

## 6. Where this sits in the sequence

**Create it, and confirm `READY`, BEFORE the functions deploy that ships the callables.**

The ordering follows from §5 rather than from taste: the deploy is what makes
`wsfCommunityActivity` reachable, so a deploy that lands before the index is `READY` opens a
window in which every activity call fails. Creating the index first costs nothing — an index
on a collection no deployed callable queries yet is inert — and closes that window entirely.

Against the rest of the rollout (full version in `SOCIAL-ROLLOUT-SEQUENCE.md` §6):

```
verifier change on main  →  members rewrite on the staging config  →
**this index, to READY**  →  pin  →  dispatch deploy  →  transport read  →  smoke
```

## 7. Rollback: leave it

**The rollback for this step is to do nothing**, deliberately:

- A composite index is **additive**. It changes no document, no rule and no callable; its
  cost is storage and a small write amplification on `wsfContributions`.
- Deleting it while any deployed callable still queries that shape causes the §5 outage —
  so a delete during a rollback would create the very failure the rollback is meant to undo.
- If the social callables are rolled back, the index simply serves nothing, and it is
  already correct for the next attempt.

The only case for deleting it is `NEEDS_REPAIR` (§4), which is a repair rather than a
rollback and needs its own review.

## 8. What the current operator can and cannot do here

| | |
| --- | --- |
| **Can**, given `datastore.indexes.create` on `westayfit-staging` | create this one index by either route in §3, and read its state |
| **Cannot, from this pipeline** | create it as part of a dispatch — the workflow never deploys indexes at all, and the only `--only firestore` in it is a GoArrive **emulator** regression |
| **Must not** | run `firebase deploy --only firestore:indexes` (§2), target the default project, or delete any index |
| **Not established** | that the deploy service account holds the permission; nothing here grants it, and the answer to a refusal is to report it |

**No Claude session performs any of this.** It is written to be reviewed and then performed
by the operator who holds the permission, and the receipt in §4 is what comes back.
