<!-- wsf-control ledgerHead=1fe8c431918500c4a17429fed534d64b559e18ae0178cb8aa374220758618e90 events=46 rendered by tools/wsf-control/render-current.mjs; do not edit -->
# WSF control state: CURRENT

Derived from `events.jsonl` on the `wsf-control-state-2` branch. Do not edit; record a decision with `append.mjs`, then re-render.
GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.

- Repository: `idevinsimpson/goarrive`
- Ledger head: `1fe8c431918500c4a17429fed534d64b559e18ae0178cb8aa374220758618e90` (46 events)
- Genesis: bootstrap as of 2026-09-29T01:03:19Z. Packets whose origin is `bootstrap` were imported in their phase at that instant; the ledger did not observe their earlier transitions.
- Supersedes: `wsf-control-state` at commit `92c3744752d21569e9a31451708366d7f3db8978` (ledger head `f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb`), a wrong bootstrap with no program history. It is kept unchanged as the audit record; nothing from it is replayed.
- Surfaces: control inbox #365; CURRENT is comment 5847443607 on #365
- Canonical: development `claude/wsf-app-shell` at `9a506766dce251fd500c2a93ca0ccafd7c847690`; operational main `f95bc0a623df475966ae61fc2b1a23e54f085962`
- Staging: serves `a31276516e786ac8f848269de4c839b3b9e13123` (run 36264562975, #55); rollback `938e00d8c985993f69becc8924d3037f18425afc`; pin PR #522
- Critical path: none
- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.
- Contracts pinned: autonomy-architecture@8ba39e19 (`docs/westayfit/ops/AUTONOMY_ARCHITECTURE_1B_1C.md`); autonomy-contract@8ba39e19 (`docs/westayfit/ops/AUTONOMY_ACCEPTANCE_CONTRACT.md`); capabilities@8ba39e19 (`docs/westayfit/ops/control/capabilities.v1.json`); control-state@8ba39e19 (`docs/westayfit/ops/CONTROL_STATE.md`); fable-operating-protocol@8ba39e19 (`docs/westayfit/ops/control/contracts/FABLE_OPERATING_PROTOCOL_v1.md`); north-star-journeys@8ba39e19 (`docs/westayfit/ops/journeys/NORTH_STAR_JOURNEY_MANIFEST.v1.json`); owner-test-card@8ba39e19 (`docs/westayfit/ops/control/contracts/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`); program-director-skill@8ba39e19 (`.claude/skills/wsf-program-director/SKILL.md`); staging-control-plane@8ba39e19 (`skills/wsf-staging-deploy/SKILL.md`); worker-inboxes@8ba39e19 (`docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`); writer@8ba39e19 (`tools/wsf-control`); writer-workflow@8ba39e19 (`.github/workflows/wsf-control-reconcile.yml`)
- **SHADOW CURRENT.** This rendering is comment 5878724949 on #365. The human CURRENT (comment 5847443607) stays authoritative until Step 5 exits; nothing routes or wakes from this page.

## Accepted residuals (A+, v1)

- worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user
- the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented
- a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically

## Workers

| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3 | #396 | STAGING-FRESHNESS-FASTPATH | — | — | — | — | — | on |
| W4 | #394 | — | — | — | — | — | — | off |
| W5 | #395 | — | — | — | — | — | — | off |
| W7 | #434 | — | — | — | — | — | — | off |
| W9 | #497 | — | — | — | — | — | — | off |

## Packets

| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTONOMY-ROUTER-1C | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #544 | 37c49bbd | 37c49bbd | — | 5f7b63c9 | — | W4 | comment:5882824399 | pull_request:544 | — | Serial step 6: state-derived routing, wakes, and real-event proof | 1×ops-source then director | — |
| AUTONOMY-ROUTER-1C-INTEGRATE | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #545 | fd697e0f | fd697e0f | — | 8ba39e19 | — | W4 | comment:5929164484 | pull_request:545 | — | Step 6 correction: derive integrate from ACCEPTED plus merged PR with same-cycle or successor reconcile and idempotency proof | 1×ops-source then director | — |
| AUTONOMY-STATE-1B | W3 | work | INTEGRATED (source-only) | bootstrap | INTEGRATED | #538 | 073b7946 | 073b7946 | — | d42a3307 | — | — | comment:5857966052 | comment:5857966052 | — | Serial step 5: authoritative control state, App writer, bootstrap and shadow reconcile | 1×ops-source then director | — |
| STAGING-FRESHNESS-FASTPATH | W3 | work | INTEGRATED (source-only) | ledger | CHANGES_REQUESTED | #548 | aafa9b51 | aafa9b51 | — | — | — | W4 | comment:5938517396 | comment:5939557841 | — | Step 7: automate preview-eligible accepted/integrated to deterministic candidate, pin, existing staging dispatch, and FRESH readback | 1×ops-source then director | — |

## Wakes

| Wake | Worker | Packet | Reason | Status | Comments | ACK |
| --- | --- | --- | --- | --- | --- | --- |
| eee5b3c49e14 | W3 | AUTONOMY-ROUTER-1C | release | acked | 5887164849 | comment:5887186862 |
| 6ffa9335e811 | W4 | AUTONOMY-ROUTER-1C | review | acked | 5924970076 | comment:5924987835 |
| 449cd143d9ec | W3 | AUTONOMY-ROUTER-1C-INTEGRATE | release | acked | 5929178858 | comment:5929185474 |
| eccccc309ebb | W4 | AUTONOMY-ROUTER-1C-INTEGRATE | review | acked | 5929384517 | comment:5929404005 |
| 50de6da1c175 | W3 | STAGING-FRESHNESS-FASTPATH | release | acked | 5938532864 | comment:5938557977 |
| a52cb6ddf8bf | W4 | STAGING-FRESHNESS-FASTPATH | review | acked | 5939454206 | comment:5939481985 |
| 415e663bcb83 | W3 | STAGING-FRESHNESS-FASTPATH | handback | requested | — | — |

