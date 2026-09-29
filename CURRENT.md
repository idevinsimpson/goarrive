<!-- wsf-control ledgerHead=d37838465c1387a4405324e86341b1f77d253cbd4d90f73794d0ef150e99d2f6 events=5 rendered by tools/wsf-control/render-current.mjs; do not edit -->
# WSF control state: CURRENT

Derived from `events.jsonl` on the `wsf-control-state-2` branch. Do not edit; record a decision with `append.mjs`, then re-render.
GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.

- Repository: `idevinsimpson/goarrive`
- Ledger head: `d37838465c1387a4405324e86341b1f77d253cbd4d90f73794d0ef150e99d2f6` (5 events)
- Genesis: bootstrap as of 2026-09-29T01:03:19Z. Packets whose origin is `bootstrap` were imported in their phase at that instant; the ledger did not observe their earlier transitions.
- Supersedes: `wsf-control-state` at commit `92c3744752d21569e9a31451708366d7f3db8978` (ledger head `f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb`), a wrong bootstrap with no program history. It is kept unchanged as the audit record; nothing from it is replayed.
- Surfaces: control inbox #365; CURRENT is comment 5847443607 on #365
- Canonical: development `claude/wsf-app-shell` at `9a506766dce251fd500c2a93ca0ccafd7c847690`; operational main `f95bc0a623df475966ae61fc2b1a23e54f085962`
- Staging: serves `a31276516e786ac8f848269de4c839b3b9e13123` (run 36264562975, #55); rollback `938e00d8c985993f69becc8924d3037f18425afc`; pin PR #522
- Critical path: none
- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.
- Contracts pinned: autonomy-architecture@ed6ee90f (`docs/westayfit/ops/AUTONOMY_ARCHITECTURE_1B_1C.md`); autonomy-contract@ed6ee90f (`docs/westayfit/ops/AUTONOMY_ACCEPTANCE_CONTRACT.md`); capabilities@ed6ee90f (`docs/westayfit/ops/control/capabilities.v1.json`); control-state@ed6ee90f (`docs/westayfit/ops/CONTROL_STATE.md`); fable-operating-protocol@ed6ee90f (`docs/westayfit/ops/control/contracts/FABLE_OPERATING_PROTOCOL_v1.md`); north-star-journeys@ed6ee90f (`docs/westayfit/ops/journeys/NORTH_STAR_JOURNEY_MANIFEST.v1.json`); owner-test-card@ed6ee90f (`docs/westayfit/ops/control/contracts/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`); program-director-skill@ed6ee90f (`.claude/skills/wsf-program-director/SKILL.md`); staging-control-plane@ed6ee90f (`skills/wsf-staging-deploy/SKILL.md`); worker-inboxes@ed6ee90f (`docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`); writer@ed6ee90f (`tools/wsf-control`); writer-workflow@ed6ee90f (`.github/workflows/wsf-control-reconcile.yml`)
- **SHADOW CURRENT.** This rendering is comment 5878724949 on #365. The human CURRENT (comment 5847443607) stays authoritative until Step 5 exits; nothing routes or wakes from this page.

## Accepted residuals (A+, v1)

- worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user
- the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented
- a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically

## Workers

| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3 | #396 | AUTONOMY-ROUTER-1C | — | — | — | — | — | on |
| W4 | #394 | — | — | — | — | — | — | off |
| W5 | #395 | — | — | — | — | — | — | off |
| W7 | #434 | — | — | — | — | — | — | off |
| W9 | #497 | — | — | — | — | — | — | off |

## Packets

| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTONOMY-ROUTER-1C | W3 | work | INTEGRATED (source-only) | ledger | RELEASED | — | — | — | — | — | — | — | comment:5882824399 | comment:5882824399 | — | Serial step 6: state-derived routing, wakes, and real-event proof | 1×ops-source then director | — |
| AUTONOMY-STATE-1B | W3 | work | INTEGRATED (source-only) | bootstrap | INTEGRATED | #538 | 073b7946 | 073b7946 | — | d42a3307 | — | — | comment:5857966052 | comment:5857966052 | — | Serial step 5: authoritative control state, App writer, bootstrap and shadow reconcile | 1×ops-source then director | — |

