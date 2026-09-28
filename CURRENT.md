<!-- wsf-control ledgerHead=f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb events=2 rendered by tools/wsf-control/render-current.mjs; do not edit -->
# WSF control state: CURRENT

Derived from `events.jsonl` on the `wsf-control-state` branch. Do not edit; record a decision with `append.mjs`, then re-render.
GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.

- Repository: `idevinsimpson/goarrive`
- Ledger head: `f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb` (2 events)
- Genesis: bootstrap as of 2026-09-27T17:12:00Z. Packets whose origin is `bootstrap` were imported in their phase at that instant; the ledger did not observe their earlier transitions.
- Surfaces: control inbox #365; CURRENT is comment 5847443607 on #365
- Canonical: development `claude/wsf-app-shell` at `9a506766dce251fd500c2a93ca0ccafd7c847690`; operational main `ace92b0b82d32dc6a13c764fef02e809d218adb7`
- Staging: serves `a31276516e786ac8f848269de4c839b3b9e13123` (run 36264562975, #55); rollback `938e00d8c985993f69becc8924d3037f18425afc`; pin PR #522
- Critical path: AUTONOMY-STATE-1B (ACKED, W3)
- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.
- Contracts pinned: autonomy-architecture@d694b007 (`docs/westayfit/ops/AUTONOMY_ARCHITECTURE_1B_1C.md`); autonomy-contract@d694b007 (`docs/westayfit/ops/AUTONOMY_ACCEPTANCE_CONTRACT.md`); capabilities@d694b007 (`docs/westayfit/ops/control/capabilities.v1.json`); control-state@d694b007 (`docs/westayfit/ops/CONTROL_STATE.md`); fable-operating-protocol@d694b007 (`docs/westayfit/ops/control/contracts/FABLE_OPERATING_PROTOCOL_v1.md`); north-star-journeys@d694b007 (`docs/westayfit/ops/journeys/NORTH_STAR_JOURNEY_MANIFEST.v1.json`); owner-test-card@d694b007 (`docs/westayfit/ops/control/contracts/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`); program-director-skill@d694b007 (`.claude/skills/wsf-program-director/SKILL.md`); staging-control-plane@d694b007 (`skills/wsf-staging-deploy/SKILL.md`); worker-inboxes@d694b007 (`docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`); writer@d694b007 (`tools/wsf-control`); writer-workflow@d694b007 (`.github/workflows/wsf-control-reconcile.yml`)
- **SHADOW CURRENT.** This rendering is comment 5878724949 on #365. The human CURRENT (comment 5847443607) stays authoritative until Step 5 exits; nothing routes or wakes from this page.

## Accepted residuals (A+, v1)

- worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user
- the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented
- a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically

## Workers

| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3 | #396 | AUTONOMY-STATE-1B | — | — | — | — | — | on |
| W4 | #394 | — | — | — | — | — | — | off |
| W5 | #395 | — | — | — | — | — | — | off |
| W7 | #434 | — | — | — | — | — | — | off |
| W9 | #497 | — | — | — | — | — | — | off |

## Packets

| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTONOMY-STATE-1B | W3 | work | INTEGRATED (source-only) | bootstrap | ACKED | — | — | — | — | — | — | — | comment:5857966052 | comment:5857966052 | — | Serial step 5: authoritative control state, App writer, bootstrap and shadow reconcile | 1×ops-source then director | — |

