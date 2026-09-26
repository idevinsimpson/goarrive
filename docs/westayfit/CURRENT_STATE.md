# We Stay Fit — Current State Pointer

This file intentionally does not duplicate volatile WSF status.

## Canonical live state

Read the single editable comment headed:

`CANONICAL CURRENT STATE — EDIT THIS COMMENT IN PLACE`

in the Fable/L0 control inbox, GitHub PR #365.

Canonical comment:
https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5847443607

Fable/L0 updates that comment in place on material state transitions. Detailed receipts
remain on the relevant task/release threads.

## Why this file is only a pointer

The previous version of this document described the August 26 M-U1 shell as though it were
still the current product: two routes, no Firestore reads/writes, and the original staging
channel. That is historical evidence, not current WSF.

Do not create a second mutable status ledger here. Current implementation, staging,
blockers, active worker packets, and watermarks move too quickly.

## Before acting

1. Read the canonical CURRENT STATE comment.
2. Read only events newer than its watermarks unless investigating history.
3. Verify the exact canonical development SHA for product work.
4. Verify operational `main` for control-plane/release work.
5. For staging claims, verify the actual served build marker/deployment receipt.
6. For member-visible work, verify the exact frozen reference in
   `docs/westayfit/ops/NORTH_STAR_JOURNEY_MANIFEST.json`.

## Durable authority

See:
- `WE_STAY_FIT_STRATEGIC_MASTER_v3_1_ADDENDUM_2026-09-26.md`
- `WE_STAY_FIT_PROJECT_INSTRUCTIONS_v3_1_2026-09-26.txt`
- `DOCUMENT_AUTHORITY_AND_SUPERSESSION.md`
- `ops/FABLE_OPERATING_PROTOCOL_v1.md`

Historical release evidence remains in `RELEASES.md` and task/release receipts.
