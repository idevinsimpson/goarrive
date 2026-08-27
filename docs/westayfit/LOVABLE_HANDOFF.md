# We Stay Fit — Lovable ↔ Firebase Handoff

WSF has two active surfaces: a Lovable-built marketing/interest site and this Firebase-side first-party app. They live in the same Firebase project (they share Firestore and Auth) but are treated as separate systems for data flow.

## The Four Never-Builds

These are non-negotiable at every milestone.

### 1. No dual-write

No single write operation (from either surface) may fan out to a second collection with "keep them in sync" as the reason. Every write targets exactly one collection.

**Why:** dual-write is the shortest path to divergence. When two collections drift, there is no ground truth, and reconciling them costs weeks.

### 2. No bidirectional sync

Cross-collection copies flow one way per collection. If collection A receives copies of B, then B does not receive copies of A. No triggers exist that read from A and write back to B (or vice versa).

**Why:** bidirectional sync creates cycles that are hard to detect, cheap to introduce, and expensive to unwind.

### 3. No auto-conversion of `interest_responses`

An `interest_responses` document is a marketing-side artifact. It does not automatically become a user account, membership, or profile document. Conversion requires an explicit, user-triggered action.

**Why:** interest capture is a low-friction top-of-funnel event; account creation is a deliberate high-consent event. Collapsing them silently confuses consent boundaries and produces zombie accounts.

### 4. No auto-conversion of `champion_campaigns`

A `champion_campaigns` document is a Lovable-side submission artifact. It does not automatically become a live campaign, a member communication, or a downstream Firebase document. Conversion requires an explicit, human-reviewed action.

**Why:** campaign submissions are unvetted user input. Auto-conversion turns unvetted input into system state.

## Allowed Cross-Boundary Reads

The WSF Firebase app may **read** from Lovable-written collections (`interest_responses`, `champion_campaigns`) once appropriate `firestore.rules` blocks land in a future milestone. Reads are one-way and do not imply conversion.

## Conversion Contract (for future milestones)

Every conversion path (interest → account, campaign submission → live campaign, etc.) is a discrete milestone with:

- A single dedicated Cloud Function invoked by an explicit user action.
- An audit document written to a WSF-owned `wsf_conversion_log` collection.
- No trigger-based fan-out to other collections.
- Rules that require the initiating user's `uid` to match the target document owner.

## What Ships In M-U1

Nothing that touches the boundary. M-U1's WSF app does not read `interest_responses` or `champion_campaigns` and does not write to any Lovable-owned collection.
