<!-- wsf-control ledgerHead=c80adc94437ef3a88e4f509363266846f576c8d586f827e25d402c54e8d42b10 events=175 rendered by tools/wsf-control/render-current.mjs; do not edit -->
# WSF control state: CURRENT

Derived from `events.jsonl` on the `wsf-control-state-2` branch. Do not edit; record a decision with `append.mjs`, then re-render.
GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.

- Repository: `idevinsimpson/goarrive`
- Ledger head: `c80adc94437ef3a88e4f509363266846f576c8d586f827e25d402c54e8d42b10` (175 events)
- Genesis: bootstrap as of 2026-09-29T01:03:19Z. Packets whose origin is `bootstrap` were imported in their phase at that instant; the ledger did not observe their earlier transitions.
- Supersedes: `wsf-control-state` at commit `92c3744752d21569e9a31451708366d7f3db8978` (ledger head `f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb`), a wrong bootstrap with no program history. It is kept unchanged as the audit record; nothing from it is replayed.
- Surfaces: control inbox #365; CURRENT is comment 5847443607 on #365
- Canonical: development `claude/wsf-app-shell` at `9a506766dce251fd500c2a93ca0ccafd7c847690`; operational main `f95bc0a623df475966ae61fc2b1a23e54f085962`
- Staging: serves `a31276516e786ac8f848269de4c839b3b9e13123` (run 36264562975, #55); rollback `938e00d8c985993f69becc8924d3037f18425afc`; pin PR #522
- Unattended fast-path dispatch: ENABLED (set-fastpath)
- Staging target (fast path): `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (KIOSK-PAIRING-CLARITY-PROOF-1), checked against the full-path pin `a31276516e786ac8f848269de4c839b3b9e13123`
- Critical path: none
- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.
- Contracts pinned: autonomy-architecture@745b4f62 (`docs/westayfit/ops/AUTONOMY_ARCHITECTURE_1B_1C.md`); autonomy-contract@745b4f62 (`docs/westayfit/ops/AUTONOMY_ACCEPTANCE_CONTRACT.md`); capabilities@745b4f62 (`docs/westayfit/ops/control/capabilities.v1.json`); control-state@745b4f62 (`docs/westayfit/ops/CONTROL_STATE.md`); fable-operating-protocol@745b4f62 (`docs/westayfit/ops/control/contracts/FABLE_OPERATING_PROTOCOL_v1.md`); north-star-journeys@745b4f62 (`docs/westayfit/ops/journeys/NORTH_STAR_JOURNEY_MANIFEST.v1.json`); owner-test-card@745b4f62 (`docs/westayfit/ops/control/contracts/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`); program-director-skill@745b4f62 (`.claude/skills/wsf-program-director/SKILL.md`); staging-control-plane@745b4f62 (`skills/wsf-staging-deploy/SKILL.md`); worker-inboxes@745b4f62 (`docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`); writer@745b4f62 (`tools/wsf-control`); writer-workflow@745b4f62 (`.github/workflows/wsf-control-reconcile.yml`)
- **SHADOW CURRENT.** This rendering is comment 5878724949 on #365. The human CURRENT (comment 5847443607) stays authoritative until Step 5 exits; nothing routes or wakes from this page.

## Accepted residuals (A+, v1)

- worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user
- the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented
- a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically

## Workers

| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3 | #396 | — | — | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | — | — | — | off |
| W4 | #394 | — | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | — | — | — | — | on |
| W5 | #395 | — | — | — | — | — | — | off |
| W7 | #434 | — | — | — | — | — | — | off |
| W9 | #497 | — | — | — | — | — | — | off |

## Packets

| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTONOMY-ROUTER-1C | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #544 | 37c49bbd | 37c49bbd | — | 5f7b63c9 | — | W4 | comment:5882824399 | pull_request:544 | — | Serial step 6: state-derived routing, wakes, and real-event proof | 1×ops-source then director | — |
| AUTONOMY-ROUTER-1C-INTEGRATE | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #545 | fd697e0f | fd697e0f | — | 8ba39e19 | — | W4 | comment:5929164484 | pull_request:545 | — | Step 6 correction: derive integrate from ACCEPTED plus merged PR with same-cycle or successor reconcile and idempotency proof | 1×ops-source then director | — |
| AUTONOMY-STATE-1B | W3 | work | INTEGRATED (source-only) | bootstrap | INTEGRATED | #538 | 073b7946 | 073b7946 | — | d42a3307 | — | — | comment:5857966052 | comment:5857966052 | — | Serial step 5: authoritative control state, App writer, bootstrap and shadow reconcile | 1×ops-source then director | — |
| CONTROL-EXPO-ROUTE-PATH-GRAMMAR | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #552 | 3cc44d30 | 3cc44d30 | — | 6687440d | — | W4 | comment:5944968693 | pull_request:552 | — | Allow exact Expo Router filenames in control packet path reservations without widening other path syntax | 1×ops-source then director | — |
| KIOSK-PAIRING-CLARITY-PROOF-1 | W9 | work | STAGED (hosted) | ledger | INTEGRATED | #553 | 4537c26c | 4537c26c | — | ab77fbfc | — | W4 | comment:5945136749 | pull_request:553 | — | Clarify venue-station pairing from the Champion's own phone and prove the existing flow end-to-end | 1×journey-qa then director | — |
| STAGING-FASTPATH-DOCS-LINEAGE-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #551 | 963dd558 | 963dd558 | — | 9825aa36 | — | W4 | comment:5944563639 | pull_request:551 | — | Step 7 correction: allow provably non-runtime docs/instruction lineage while preserving fail-closed fast-path invariants | 1×ops-source then director | — |
| STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | W3 | work | INTEGRATED (source-only) | ledger | UNDER_REVIEW | #556 | f7057129 | f7057129 | — | — | — | W4 | comment:5954269955 | comment:5954503095 | — | Add a fail-closed one-shot recorded retry authorization for an exact repaired staging target and failed run | 1×ops-source then director | — |
| STAGING-FASTPATH-INVENTORY-BASELINE-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #555 | 825b9c01 | 825b9c01 | — | 745b4f62 | — | W4 | comment:5953663400 | pull_request:555 | — | Correct fast-path inventory preflight to use the reviewed complete measured baseline without double-counting retained functions | 1×ops-source then director | — |
| STAGING-FRESHNESS-DISPATCH | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #549 | ffe48217 | ffe48217 | — | 3c38046f | — | W4 | comment:5940812824 | pull_request:549 | — | Step 7 completion: bounded main-only workflow-token dispatch of the existing ledger fast path and unattended proof | 1×ops-source then director | — |
| STAGING-FRESHNESS-FASTPATH | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #548 | c295d5c1 | c295d5c1 | — | 73d87d4e | — | W4 | comment:5938517396 | pull_request:548 | — | Step 7: automate preview-eligible accepted/integrated to deterministic candidate, pin, existing staging dispatch, and FRESH readback | 1×ops-source then director | — |

## Wakes

| Wake | Worker | Packet | Reason | Status | Comments | ACK |
| --- | --- | --- | --- | --- | --- | --- |
| eee5b3c49e14 | W3 | AUTONOMY-ROUTER-1C | release | acked | 5887164849 | comment:5887186862 |
| 6ffa9335e811 | W4 | AUTONOMY-ROUTER-1C | review | acked | 5924970076 | comment:5924987835 |
| 449cd143d9ec | W3 | AUTONOMY-ROUTER-1C-INTEGRATE | release | acked | 5929178858 | comment:5929185474 |
| eccccc309ebb | W4 | AUTONOMY-ROUTER-1C-INTEGRATE | review | acked | 5929384517 | comment:5929404005 |
| 50de6da1c175 | W3 | STAGING-FRESHNESS-FASTPATH | release | acked | 5938532864 | comment:5938557977 |
| a52cb6ddf8bf | W4 | STAGING-FRESHNESS-FASTPATH | review | acked | 5939454206 | comment:5939481985 |
| 415e663bcb83 | W3 | STAGING-FRESHNESS-FASTPATH | handback | acked | 5939573699 | comment:5939583222 |
| 49e02ef8bfa0 | W4 | STAGING-FRESHNESS-FASTPATH | review | acked | 5939829834 | comment:5939844596 |
| ac7a17467bef | W3 | STAGING-FRESHNESS-DISPATCH | release | acked | 5940836085 | comment:5940850285 |
| 149b4bc87e80 | W4 | STAGING-FRESHNESS-DISPATCH | review | acked | 5941329900 | comment:5941345918 |
| bef6780888dc | W3 | STAGING-FASTPATH-DOCS-LINEAGE-FIX | release | acked | 5944573564 | comment:5944592322 |
| 263a7995736f | W4 | STAGING-FASTPATH-DOCS-LINEAGE-FIX | review | acked | 5944691576 | comment:5944707181 |
| 869b62557264 | W3 | CONTROL-EXPO-ROUTE-PATH-GRAMMAR | release | acked | 5944978944 | comment:5944981792 |
| d30fdc119635 | W4 | CONTROL-EXPO-ROUTE-PATH-GRAMMAR | review | acked | 5945036391 | comment:5945047502 |
| 031e79b98518 | W9 | KIOSK-PAIRING-CLARITY-PROOF-1 | release | acked | 5945147405 | comment:5945165041 |
| 1ba204ff5c02 | W7 | KIOSK-PAIRING-CLARITY-PROOF-1 | review | timed-out (wake-undelivered) | 5945337933, 5945912678 | — |
| d5e0f4697dcf | W4 | KIOSK-PAIRING-CLARITY-PROOF-1 | review | acked | 5951270703 | comment:5951307156 |
| 7a354460d6df | W9 | KIOSK-PAIRING-CLARITY-PROOF-1 | handback | acked | 5951700962 | comment:5951723354 |
| 0ecfde9b6f92 | W4 | KIOSK-PAIRING-CLARITY-PROOF-1 | review | acked | 5952393124 | comment:5952412371 |
| 5d40857c9942 | W9 | KIOSK-PAIRING-CLARITY-PROOF-1 | handback | acked | 5952487458 | comment:5952501156 |
| ec6df4a165b6 | W4 | KIOSK-PAIRING-CLARITY-PROOF-1 | review | acked | 5952640463 | comment:5952655330 |
| e5632e3de432 | W3 | STAGING-FASTPATH-INVENTORY-BASELINE-FIX | release | acked | 5953688427 | comment:5953704615 |
| 3abbbf51e4bd | W4 | STAGING-FASTPATH-INVENTORY-BASELINE-FIX | review | acked | 5953815703 | comment:5953831475 |
| 63b50d508d2e | W3 | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | release | acked | 5954305151 | comment:5954314406 |
| 5408edd1df49 | W4 | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | review | acked | 5954528967 | comment:5954543919 |

