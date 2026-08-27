# We Stay Fit — Data Ownership

Anchor: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf`.

Firestore and Storage are shared at the project level. Collection-level ownership is explicit and enforced by `firestore.rules`.

## Ownership Rule

Every collection in the `goarrive` Firestore project belongs to exactly one owning app. Cross-app reads require a documented, one-direction path (see `LOVABLE_HANDOFF.md`).

## GoArrive-owned (pre-existing)

All collections that exist at anchor commit belong to GoArrive. This document does not enumerate them; the source of truth is `apps/goarrive/` code + `firestore.rules`. WSF must not read from or write to any GoArrive collection.

## WSF-owned (post-M-U1)

M-U1 introduces **zero** new WSF collections. The app does not read or write Firestore.

M-U2 and later will introduce WSF-owned collections under a `wsf_` prefix (planned; not committed until the milestone that creates them). Every new WSF collection gets:

- A dedicated rule block in `firestore.rules`.
- An entry in this file (name, purpose, allowed writers, allowed readers).
- Dual regression against GoArrive rules before merge.

## Lovable-side collections (existing, cross-boundary)

The Lovable WSF marketing surface writes to (at least):

- `interest_responses` — WSF marketing interest capture.
- `champion_campaigns` — WSF champion campaign submissions.

These collections are read-only from the WSF Firebase app's perspective until an explicit conversion milestone (see `MILESTONES.md` M-U3, M-U4). No auto-conversion; no dual-write; no bidirectional sync.

## User Records

Auth users are shared across both apps (single Firebase Auth pool). A user record does not encode "GoArrive user" vs "WSF user" via custom claims — see `ARCHITECTURE.md` (f). App-specific membership is expressed via WSF-owned Firestore documents keyed by `uid`, not via claims.
