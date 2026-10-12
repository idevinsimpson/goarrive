# Contract note · a member's own contribution history

**Not built in this slice, and not to be built without explicit owner and
privacy review.** This is the seam Progress Phase A stopped at, written down
so the decision is taken deliberately rather than discovered during
implementation.

## Why it is needed

Progress cannot show a private consistency view — a streak, "you moved on
these days", "you have recorded N times" — because nothing can hand the
client a dated list of the member's own contributions.

The data already exists. Every contribution writes
`wsfContributions/{goalId}_{uid}_{attemptId}` with `count`, `unit`,
`communityGroupId`, `crossedTarget` and **`createdAt`, a server timestamp**.
`wsfGoalMemberTotals/{goalId}_{uid}` additionally holds `contributionCount`.

Neither is reachable. `wsfMyContribution` returns `ownCredit`, `unit` and
`repeatPolicy` and nothing else, and `firestore.rules` names only
`wsfMemberProfiles`, `wsfCommunityGroups` and `wsfMemberships`, so both
collections fall to `match /{document=**} { allow read, write: if false; }`.

## What the callable would have to promise

### Scope — own, confirmed contributions only

- **Own only.** The Firestore query is built from `request.auth.uid`, never
  from a client-supplied id, exactly as `wsfMyContribution` already does. A
  caller must not be able to name another member, in any parameter, ever.
- **Confirmed only.** A contribution document exists because a transaction
  committed. An attempt that refused writes nothing and must not appear.
- **No other member's row, aggregate or count** rides along. This is not a
  smaller version of an aggregate endpoint; it is a different subject.

### Authorization

- `unauthenticated` for an anonymous caller. There is no display route here
  and there must never be one: a member's dated movement is not an aggregate
  and a Champion's display authorization does not reach it.
- **Membership is NOT the gate; authorship is.** A member who has left a
  community still deserves the credit they earned, which is already
  `wsfMyContribution`'s discipline. The row belongs to whoever recorded it.
- A platform admin path is **out of scope** and should not be added quietly.

### Pagination and bounds

- The response is **bounded by the query**, as `wsfGoalRecentAdditions` is —
  an unbounded subcollection must never become an unbounded response.
- A cursor over `(createdAt, documentId)`, descending, so paging is stable
  when two contributions share a timestamp.
- A hard server-side maximum per page **and** a maximum reachable depth, so
  "page forever" is not a way to export a member's whole history in one go.
- `wsfContributions` has no composite index on `(userId, createdAt)` today.
  Adding one is a **deploy the owner must authorize** — index deploys are on
  the explicit-permission list, and this note is not that permission.

### Idempotent attempts

- `attemptId` is the contribution's identity. A replay of one attempt is one
  row, never two, and the published row must be derived from the stored
  document rather than recomputed.
- A corrected goal (`wsfAdjustGoal`) moves `wsfGoalMemberTotals`, not the
  contribution rows. The history and the own-credit total can therefore
  disagree after a correction, and **the response must not imply they add
  up**. Either publish the correction as its own event or say plainly that
  history is what was recorded, not what is currently credited.

### Timestamps and day boundaries

- `createdAt` is a server timestamp — an instant, not a day.
- **A streak needs a day, and a day needs a zone.** The goal's stored
  `timezone`, the member's device zone and UTC give three different answers,
  and a member who moves at 11pm can gain or lose a day depending on which is
  chosen. Pick one, state it in the response, and never let the client infer
  it: the product already learned this on `formatEndsAt`, where the zone
  decides how an end is *written* and never whether it has happened.
- Publish the instant and let the caller render it, or publish an explicit
  `day` plus the zone it was computed in. Do not publish a bare date.
- A streak spanning goals in communities with different zones is a product
  question, not an implementation detail.

### Retention

- How long a member's dated history stays readable is a **privacy decision**,
  not a default. It is the most identifying thing this product would expose
  about a person's routine: when they are usually awake, and where their week
  has gaps.
- Deletion of an account must remove it, and that path must be stated before
  the read path ships.
- Whether a Champion closing or deleting a goal removes the member's own rows
  is likewise a decision — today closing a goal does not touch them.

## What it must not become

No leaderboard, no comparison, no "most consistent member", no export of one
member's history to another, and no surface where a streak becomes public
pressure. Progress is the one screen whose promise is that it is not scoring
anyone; a dated history makes that promise easier to break, not harder.
