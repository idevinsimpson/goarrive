<!-- wsf-control ledgerHead=a27d95b13a13e1f5003b020d2f58d91c4f16538e5011edf7c0f11fb991a78874 events=787 rendered by tools/wsf-control/render-current.mjs; do not edit -->
# WSF control state: CURRENT

Derived from `events.jsonl` on the `wsf-control-state-2` branch. Do not edit; record a decision with `append.mjs`, then re-render.
GitHub is the authority for facts (PR state, heads, CI, comments). This page records decisions and pointers only.

- Repository: `idevinsimpson/goarrive`
- Ledger head: `a27d95b13a13e1f5003b020d2f58d91c4f16538e5011edf7c0f11fb991a78874` (787 events)
- Genesis: bootstrap as of 2026-09-29T01:03:19Z. Packets whose origin is `bootstrap` were imported in their phase at that instant; the ledger did not observe their earlier transitions.
- Supersedes: `wsf-control-state` at commit `92c3744752d21569e9a31451708366d7f3db8978` (ledger head `f48d256eeea36639d991d1391e82558141d50fbc5558333b0df9a345941ea1eb`), a wrong bootstrap with no program history. It is kept unchanged as the audit record; nothing from it is replayed.
- Surfaces: control inbox #365; CURRENT is comment 5847443607 on #365
- Canonical: development `claude/wsf-app-shell` at `9a506766dce251fd500c2a93ca0ccafd7c847690`; operational main `f95bc0a623df475966ae61fc2b1a23e54f085962`
- Staging: serves `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (run 37025084843, #60); rollback `a31276516e786ac8f848269de4c839b3b9e13123`; pin PR #522
- Unattended fast-path dispatch: ENABLED (set-fastpath)
- Staging target (fast path): `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (KIOSK-PAIRING-CLARITY-PROOF-1), checked against the full-path pin `a31276516e786ac8f848269de4c839b3b9e13123`
- Staging retry authorized once (authorize-retry, decision 5955316632): `ab77fbfce97e60c1c22492397b2ab6b491f9e0db` (KIOSK-PAIRING-CLARITY-PROOF-1) after failed run 37012494776, repaired by STAGING-FASTPATH-INVENTORY-BASELINE-FIX at `745b4f6270a90555757b9b01255ee77f0a74e8fb`; spent once any newer attempt at that target exists
- Critical path: none
- Schema: v2. Every line is written by the `wsf-control-writer` App and names its authority class and rule.
- Contracts pinned: autonomy-architecture@9ca268d2 (`docs/westayfit/ops/AUTONOMY_ARCHITECTURE_1B_1C.md`); autonomy-contract@9ca268d2 (`docs/westayfit/ops/AUTONOMY_ACCEPTANCE_CONTRACT.md`); capabilities@9ca268d2 (`docs/westayfit/ops/control/capabilities.v1.json`); control-state@9ca268d2 (`docs/westayfit/ops/CONTROL_STATE.md`); fable-operating-protocol@9ca268d2 (`docs/westayfit/ops/control/contracts/FABLE_OPERATING_PROTOCOL_v1.md`); north-star-journeys@9ca268d2 (`docs/westayfit/ops/journeys/NORTH_STAR_JOURNEY_MANIFEST.v1.json`); owner-test-card@9ca268d2 (`docs/westayfit/ops/control/contracts/OWNER_TEST_CARD_AND_SMOKE_CONTRACT.md`); program-director-skill@9ca268d2 (`.claude/skills/wsf-program-director/SKILL.md`); staging-control-plane@9ca268d2 (`skills/wsf-staging-deploy/SKILL.md`); worker-inboxes@9ca268d2 (`docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`); writer@89351735 (`tools/wsf-control`); writer-workflow@cc33f4e7 (`.github/workflows/wsf-control-reconcile.yml`)
- **SHADOW CURRENT.** This rendering is comment 5878724949 on #365. The human CURRENT (comment 5847443607) stays authoritative until Step 5 exits; nothing routes or wakes from this page.

## Accepted residuals (A+, v1)

- worker-origin facts are ATTESTED, not identity-authenticated: every role posts as the same GitHub user
- the writer boundary is only as strong as operational main: a malicious writer change is detected (writer-code pin), not prevented
- a dead worker session is a typed wake-undelivered exception that a human or the Director reassigns; it is never respawned automatically

## Workers

| Worker | Inbox | Active now | Reviewing | Waiting on review | Blocked | Next | Queue | WATCH |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W3 | #396 | — | — | WORKER-EXECUTION-PROFILES-1 | KIOSK-UNVERIFIED-STAGING-RECOVERY-1, NORTHSTAR-MIRROR-INTAKE-1 | — | — | off |
| W4 | #394 | — | — | — | — | — | — | off |
| W5 | #395 | EVENT-LIFECYCLE-BACKEND-1 | — | — | — | — | — | on |
| W7 | #434 | KIOSK-EXPECTED-TURN-NATIVE-CALLER-1 | — | — | — | — | — | on |
| W9 | #497 | — | — | PROFILE-PHOTOS-FIREBASE-1 | MEMBER-TRUTH-BACKEND-1 | — | — | off |

## Packets

| Packet | Owner | Kind | Completes at | Origin | Phase | PR | Subject | PR head | Evidence | Merge | Proof | Reviewers | Released by | Last transition | Blocked by | Label | Review policy | Pending finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTONOMY-ROUTER-1C | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #544 | 37c49bbd | 37c49bbd | — | 5f7b63c9 | — | W4 | comment:5882824399 | pull_request:544 | — | Serial step 6: state-derived routing, wakes, and real-event proof | 1×ops-source then director | — |
| AUTONOMY-ROUTER-1C-INTEGRATE | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #545 | fd697e0f | fd697e0f | — | 8ba39e19 | — | W4 | comment:5929164484 | pull_request:545 | — | Step 6 correction: derive integrate from ACCEPTED plus merged PR with same-cycle or successor reconcile and idempotency proof | 1×ops-source then director | — |
| AUTONOMY-STATE-1B | W3 | work | INTEGRATED (source-only) | bootstrap | INTEGRATED | #538 | 073b7946 | 073b7946 | — | d42a3307 | — | — | comment:5857966052 | comment:5857966052 | — | Serial step 5: authoritative control state, App writer, bootstrap and shadow reconcile | 1×ops-source then director | — |
| CONTROL-CURRENT-PATCH-ACK-1 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #588 | 85e1d35f | 85e1d35f | — | cc33f4e7 | — | W9 | comment:6044037834 | pull_request:588 | — | Repair CURRENT comment acknowledgment and verify uncertain PATCH by exact readback without mutation retries | 1×ops-source then director | — |
| CONTROL-CURRENT-PATCH-TRANSPORT-2 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #591 | 9070a3cf | 9070a3cf | — | 89351735 | — | W4 | comment:6050347861 | pull_request:591 | — | Make the single CURRENT PATCH complete through a bounded transport while preserving exact readback and no resend | 1×ops-source then director | — |
| CONTROL-EXPO-ROUTE-PATH-GRAMMAR | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #552 | 3cc44d30 | 3cc44d30 | — | 6687440d | — | W4 | comment:5944968693 | pull_request:552 | — | Allow exact Expo Router filenames in control packet path reservations without widening other path syntax | 1×ops-source then director | — |
| CONTROL-RECENT-COMMENTS-SAFE-READ-1 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #579 | 758d686f | 758d686f | — | e5416da1 | — | W4 | comment:6020607329 | pull_request:579 | — | Bound recent-comment reads so the control App can consume current decisions without socket failure | 1×ops-source then director | — |
| EMAIL-STAGING-REPAIR | W3 | work | STAGED (hosted) | ledger | INTEGRATED | #559 | 39484f78 | 39484f78 | — | f84346d3 | — | W4, W9 | comment:5959200686 | pull_request:559 | — | Diagnose and repair staging verification and password-reset delivery without weakening mail security | 1×ops-source+1×security then director | — |
| EMAIL-STAGING-REPAIR-STAGING-PIN | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #570 | 5be8f661 | 5be8f661 | — | 01a07ef3 | — | W4 | comment:5965875967 | pull_request:570 | — | Pin the exact integrated email repair and coalesced accepted expo lineage through the reviewed full staging path | 1×ops-source then director | — |
| EVENT-LIFECYCLE-BACKEND-1 | W5 | work | INTEGRATED (source-only) | ledger | RELEASED | — | — | — | — | — | — | — | comment:6044610796 | comment:6044610796 | — | Implement canonical event lifecycle transactions and authorization in an isolated module without competing with kiosk receipt ownership | 1×journey-qa+1×security then director | — |
| EVERGREEN-MARKER-ENTRY-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #583 | 1545f36d | 1545f36d | — | 09cc4cb1 | — | W4 | comment:6027873710 | pull_request:583 | — | Evergreen physical marker entry: permanent QR resolves to configured community and goal, then phone or optional kiosk participation | 1×journey-qa then director | — |
| EXPO-ACCOUNT-ENTRY-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #561 | e603a39c | e603a39c | — | 5705dc3b | — | W4 | comment:5961789672 | pull_request:561 | — | Expo account-entry seam: preserve event context and make the existing phone/kiosk choice fast and truthful without bypassing verified identity | 1×journey-qa then director | — |
| EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #566 | 04ca5d05 | 04ca5d05 | 04ca5d05 | 08a2f08d | — | W4 | comment:5963494417 | pull_request:566 | — | Pin exact integrated expo account-entry milestone through the existing reviewed full staging path | 1×ops-source then director | — |
| EXPO-ATTENDEE-HOSTED-DRIVERS-1 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #569 | f2c0e4e9 | f2c0e4e9 | — | dcf86674 | — | W4 | comment:5965372716 | pull_request:569 | — | Add the missing hosted attendee drivers and generated owner-card inputs using the existing staging journey framework | 1×ops-source then director | — |
| EXPO-ATTENDEE-JOURNEY-PROOF-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #563 | 12e70c5a | 12e70c5a | — | 0669c446 | — | W4 | comment:5963015704 | pull_request:563 | — | Prove the existing attendee phone and two-station journey and expose only real missing seams; test and evidence source, not live expo acceptance | 1×journey-qa then director | — |
| EXPO-CLOSED-GOAL-QUEUE-GATE-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #571 | 3a3ddb55 | 3a3ddb55 | — | 0d3598d4 | — | W4 | comment:5967515210 | pull_request:571 | — | Close GAP-2 by refusing queue and turn admission after a goal closes without changing the existing expo systems | 1×journey-qa then director | — |
| EXPO-LATEST-FULL-STAGING-PIN-1 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #573 | a0bb252a | a0bb252a | — | 65b8b798 | — | W4 | comment:5970558946 | pull_request:573 | — | Pin the latest accepted expo candidate and activate the fixed closed-goal hosted journey through the existing full staging path | 1×ops-source then director | — |
| EXPO-MOVEMENT-VIDEO-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #575 | 526cea95 | 526cea95 | — | 0745c732 | — | W4 | comment:5971282758 | pull_request:575 | — | Loop approved demo media in the existing shared player with truthful fallback and no contribution side effects | 1×journey-qa then director | — |
| EXPO-STATION-LOST-ANSWER-COPY-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #564 | 1d290f74 | 1d290f74 | — | 5be74f3f | — | W4 | comment:5963613447 | pull_request:564 | — | Replace station vendor error text with existing product-safe callable wording without changing retry truth | 1×journey-qa then director | — |
| KIOSK-EXPECTED-TURN-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #587 | 4bc9a0b8 | 4bc9a0b8 | — | 934f24f0 | — | W4 | comment:6042840991 | pull_request:587 | — | Bind kiosk mutations to the intended turn and preserve exactly-once phone and station completion | 1×journey-qa then director | — |
| KIOSK-EXPECTED-TURN-NATIVE-CALLER-1 | W7 | work | INTEGRATED (source-only) | ledger | RELEASED | — | — | — | — | — | — | — | comment:6044062885 | comment:6044062885 | — | Wire native station commands to the exact turn and preserve safe retry across later visitors | 1×journey-qa then director | — |
| KIOSK-PAIRING-CLARITY-PROOF-1 | W9 | work | STAGED (hosted) | ledger | STAGED | #553 | 4537c26c | 4537c26c | — | ab77fbfc | hosted run 37025084843: PASS | W4 | comment:5945136749 | comment:5955903159 | — | Clarify venue-station pairing from the Champion's own phone and prove the existing flow end-to-end | 1×journey-qa then director | — |
| KIOSK-UNVERIFIED-PARTICIPANT-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #586 | a17ee3e2 | a17ee3e2 | — | 819c26f0 | — | W4 | comment:6041849013 | pull_request:586 | — | Allow real authenticated unverified attendees to complete the ordinary WSF event participation backend journey | 1×journey-qa then director | — |
| KIOSK-UNVERIFIED-PARTICIPANT-1-STAGING-PIN | W3 | work | INTEGRATED (source-only) | ledger | WITHDRAWN | — | — | — | — | — | — | — | comment:6043102398 | comment:6043983205 | — | Pin and prove the integrated unverified-attendee backend through the reviewed full staging path | 1×ops-source then director | — |
| KIOSK-UNVERIFIED-STAGING-RECOVERY-1 | W3 | work | INTEGRATED (source-only) | ledger | BLOCKED (from RELEASED) | — | — | — | — | — | — | — | comment:6043993150 | comment:6044034555 | CONTROL-CURRENT-PATCH-ACK-1≥INTEGRATED | Finish the blocked staging pin with verified approval ancestry and tracked unverified synthetic fixtures | 1×ops-source then director | — |
| LOVABLE-KIOSK-HOSTED-PROOF-1 | W3 | work | VERIFIED (hosted) | ledger | INTEGRATED | #589 | 8c9093c0 | 8c9093c0 | — | 41bff6c6 | — | W4, W9 | comment:6044894488 | pull_request:589 | — | Run the pinned Lovable kiosk journey with bounded real staging fixtures and cleanup inside the existing trusted runner | 1×ops-source+1×security then director | — |
| MEMBER-PREVIEW-LABEL-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #584 | 37529ea3 | 37529ea3 | — | 245c7717 | — | W4 | comment:6035517752 | pull_request:584 | — | Deliver the isolated privacy-safe public preview label without waiting for crossing attribution | 1×journey-qa then director | — |
| MEMBER-TRUTH-BACKEND-1 | W9 | work | INTEGRATED (source-only) | ledger | BLOCKED (from ACKED) | — | — | — | — | — | — | — | comment:6029989725 | comment:6035507739 | TOGETHER-CROSSING-DESIGN-DECISION (Director and Owner) | Unblock real member Together crossing and privacy-safe public preview labels for the shared Firebase backend and Lovable Web Twin | 1×journey-qa then director | — |
| MOVE-CAMERA-NATIVE-PORT-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #577 | d6d47879 | d6d47879 | — | 856e20e0 | — | W7 | comment:5997538756 | pull_request:577 | — | Port the owner-accepted camera-assisted squat MOVE North Star into the current Expo app without automatic contribution credit | 1×journey-qa then director | — |
| NORTHSTAR-MIRROR-INTAKE-1 | W3 | work | INTEGRATED (source-only) | ledger | BLOCKED (from ACKED) | — | — | — | — | — | — | — | comment:6035534615 | comment:6040736205 | W3-SOURCE-EDIT-CONSENT (Devin) | Complete the existing automatic Lovable delta receiver so Devin never has to relay native handoffs | 1×ops-source then director | — |
| PROFILE-PHOTOS-FIREBASE-1 | W9 | work | INTEGRATED (source-only) | ledger | UNDER_REVIEW | #593 | 57fd86b8 | 57fd86b8 | — | — | — | W4 | comment:6052427068 | comment:6053397847 | — | Canonical private profile photos and permitted community roster for native and Lovable staging | 1×journey-qa then director | — |
| STAGING-FASTPATH-DOCS-LINEAGE-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #551 | 963dd558 | 963dd558 | — | 9825aa36 | — | W4 | comment:5944563639 | pull_request:551 | — | Step 7 correction: allow provably non-runtime docs/instruction lineage while preserving fail-closed fast-path invariants | 1×ops-source then director | — |
| STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #556 | 92fdfecd | 92fdfecd | — | b4b479a6 | — | W4 | comment:5954269955 | pull_request:556 | — | Add a fail-closed one-shot recorded retry authorization for an exact repaired staging target and failed run | 1×ops-source then director | — |
| STAGING-FASTPATH-INVENTORY-BASELINE-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #555 | 825b9c01 | 825b9c01 | — | 745b4f62 | — | W4 | comment:5953663400 | pull_request:555 | — | Correct fast-path inventory preflight to use the reviewed complete measured baseline without double-counting retained functions | 1×ops-source then director | — |
| STAGING-FRESHNESS-DISPATCH | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #549 | ffe48217 | ffe48217 | — | 3c38046f | — | W4 | comment:5940812824 | pull_request:549 | — | Step 7 completion: bounded main-only workflow-token dispatch of the existing ledger fast path and unattended proof | 1×ops-source then director | — |
| STAGING-FRESHNESS-FASTPATH | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #548 | c295d5c1 | c295d5c1 | — | 73d87d4e | — | W4 | comment:5938517396 | pull_request:548 | — | Step 7: automate preview-eligible accepted/integrated to deterministic candidate, pin, existing staging dispatch, and FRESH readback | 1×ops-source then director | — |
| STAGING-PIN-FASTPATH-SERVED-BASELINE-1 | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #565 | a72a399e | a72a399e | — | e3598578 | — | W9 | comment:5963657922 | pull_request:565 | — | Teach the existing pin generator to represent a ledger-fast-path served baseline truthfully and fail closed otherwise | 1×ops-source then director | — |
| STAGING-PROOF-RECONCILE-ROUTING-FIX | W3 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #557 | cc180898 | cc180898 | — | 9ca268d2 | — | W4 | comment:5956038540 | pull_request:557 | — | Derive the exact successful staging run proof and pointer sequence when the workflow-run wake is missed | 1×ops-source then director | — |
| TOGETHER-COMPLETION-1 | W9 | work | INTEGRATED (source-only) | ledger | INTEGRATED | #567 | e4e32ed6 | e4e32ed6 | — | 22766935 | — | W4 | comment:5964984624 | pull_request:567 | — | Port the owner-selected Together completion from the frozen Lovable reference to the confirmed member receipt with truthful totals, one-time motion and reduced-motion parity | 1×journey-qa then director | — |
| WORKER-EXECUTION-PROFILES-1 | W3 | work | INTEGRATED (source-only) | ledger | UNDER_REVIEW | #562 | 0790876b | 0790876b | — | — | — | W4, W9 | comment:5962925247 | comment:5963579258 | — | Finish existing PR 562 credential-mode safety and pilot readiness without activating or replacing live workers | 1×ops-source+1×security then director | — |

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
| c9b0da9807d3 | W3 | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | handback | acked | 5954697239 | comment:5954704448 |
| 463e673a965d | W4 | STAGING-FASTPATH-FAILED-TARGET-RETRY-FIX | review | acked | 5954766753 | comment:5954775347 |
| 0664144166e3 | W3 | STAGING-PROOF-RECONCILE-ROUTING-FIX | release | acked | 5956063211 | comment:5956070784 |
| f13c4d257ded | W4 | STAGING-PROOF-RECONCILE-ROUTING-FIX | review | acked | 5956269103 | comment:5956283838 |
| 75d7712d7d13 | W3 | STAGING-PROOF-RECONCILE-ROUTING-FIX | handback | acked | 5956441809 | comment:5956449319 |
| 4060de349ff9 | W4 | STAGING-PROOF-RECONCILE-ROUTING-FIX | review | acked | 5957183376 | comment:5957198544 |
| 61abf7ab8e70 | W3 | EMAIL-STAGING-REPAIR | release | acked | 5959269932 | comment:5959278164 |
| 096d4a65d902 | W4 | EMAIL-STAGING-REPAIR | review | acked | 5959679569 | comment:5959704009 |
| 846f65f02bf7 | W5 | EMAIL-STAGING-REPAIR | review | redelivered | 5959679953, 5960538807 | — |
| 7e4ed4f05658 | W3 | EMAIL-STAGING-REPAIR | handback | acked | 5960698473 | comment:5960724869 |
| 5e98b190d1e9 | W4 | EMAIL-STAGING-REPAIR | review | acked | 5960912888 | comment:5960925680 |
| d2400a79c8d1 | W5 | EMAIL-STAGING-REPAIR | review | timed-out (wake-undelivered) | 5960913077, 5961195025 | — |
| b5198e757e61 | W9 | EXPO-ACCOUNT-ENTRY-1 | release | acked | 5961804762 | comment:5961821621 |
| ead5e1d14bd6 | W4 | EXPO-ACCOUNT-ENTRY-1 | review | acked | 5962746864 | comment:5962757741 |
| a746440f0a4d | W3 | WORKER-EXECUTION-PROFILES-1 | release | acked | 5962940661 | comment:5962947369 |
| 95ba0af09ab9 | W9 | EXPO-ATTENDEE-JOURNEY-PROOF-1 | release | acked | 5963032791 | comment:5963036221 |
| b5114d452723 | W4 | EXPO-ATTENDEE-JOURNEY-PROOF-1 | review | acked | 5963431384 | comment:5963446733 |
| 72a007ddbcca | W3 | EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | release | acked | 5963513342 | comment:5963516349 |
| 8f948e13771d | W4 | WORKER-EXECUTION-PROFILES-1 | review | acked | 5963533867 | comment:5963540126 |
| d40fde353cb7 | W9 | WORKER-EXECUTION-PROFILES-1 | review | acked | 5963534021 | comment:5963540260 |
| c6ae6c91cff8 | W9 | EXPO-STATION-LOST-ANSWER-COPY-1 | release | acked | 5963628023 | comment:5963632669 |
| acde5e63767d | W3 | STAGING-PIN-FASTPATH-SERVED-BASELINE-1 | release | acked | 5963674729 | comment:5963685160 |
| 88c6283835fa | W4 | EXPO-STATION-LOST-ANSWER-COPY-1 | review | acked | 5963737115 | comment:5963742004 |
| a73fe0dad472 | W9 | STAGING-PIN-FASTPATH-SERVED-BASELINE-1 | review | acked | 5963815274 | comment:5963818954 |
| e45c6df52e38 | W9 | EMAIL-STAGING-REPAIR | review | acked | 5963986717 | comment:5963990921 |
| bb43e7091a92 | W3 | EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | release | acked | 5963986818 | comment:5963990988 |
| 1b956b036938 | W4 | EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | review | acked | 5964030312 | comment:5964035278 |
| 5f6ac2ab4259 | W3 | EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | handback | acked | 5964095206 | comment:5964097860 |
| 63e649716cbc | W3 | EMAIL-STAGING-REPAIR | handback | acked | 5964906178 | comment:5964907774 |
| 76939a4d36a6 | W4 | EXPO-ACCOUNT-ENTRY-1-STAGING-PIN | review | acked | 5964906243 | comment:5964911077 |
| 8948c387eef6 | W4 | EMAIL-STAGING-REPAIR | review | acked | 5964977244 | comment:5964981889 |
| 4925976176a1 | W5 | EMAIL-STAGING-REPAIR | review | redelivered | 5964977381, 5965368070 | — |
| bac3c3b6a769 | W9 | TOGETHER-COMPLETION-1 | release | acked | 5964997619 | comment:5965001839 |
| 16dc80b65205 | W3 | EXPO-ATTENDEE-HOSTED-DRIVERS-1 | release | acked | 5965388642 | comment:5965391205 |
| 6d515ae981f9 | W4 | TOGETHER-COMPLETION-1 | review | acked | 5965459389 | comment:5965466432 |
| 8b8734ebce12 | W9 | EMAIL-STAGING-REPAIR | review | acked | 5965480450 | comment:5965498912 |
| 15a2ece9e520 | W9 | TOGETHER-COMPLETION-1 | handback | acked | 5965574494 | comment:5965578661 |
| dbef9def72f2 | W4 | EXPO-ATTENDEE-HOSTED-DRIVERS-1 | review | acked | 5965831025 | comment:5965836487 |
| ad6a58e5d240 | W7 | TOGETHER-COMPLETION-1 | review | timed-out (wake-undelivered) | 5965852256, 5965986986 | — |
| 5237c5bb6ba2 | W3 | EMAIL-STAGING-REPAIR-STAGING-PIN | release | acked | 5965892101 | comment:5965893676 |
| 8cc40fee1a41 | W4 | EMAIL-STAGING-REPAIR-STAGING-PIN | review | acked | 5966219478 | comment:5966226264 |
| bbb96cee8584 | W4 | TOGETHER-COMPLETION-1 | review | acked | 5966716452 | comment:5966720423 |
| fc57d7509e59 | W9 | EXPO-CLOSED-GOAL-QUEUE-GATE-1 | release | acked | 5967569216 | comment:5967575943 |
| 1def1466c4df | W4 | EXPO-CLOSED-GOAL-QUEUE-GATE-1 | review | acked | 5968552774 | comment:5968577994 |
| c5a5ccb39664 | W9 | EXPO-CLOSED-GOAL-QUEUE-GATE-1 | handback | acked | 5969399911 | comment:5969408731 |
| 67b559da37e6 | W4 | EXPO-CLOSED-GOAL-QUEUE-GATE-1 | review | acked | 5969904095 | comment:5969912322 |
| 9d92a765d5fd | W3 | EXPO-LATEST-FULL-STAGING-PIN-1 | release | acked | 5970615640 | comment:5970619310 |
| 298a348ebd11 | W4 | EXPO-LATEST-FULL-STAGING-PIN-1 | review | acked | 5970822479 | comment:5970830916 |
| c1d9c6f06b06 | W3 | EXPO-LATEST-FULL-STAGING-PIN-1 | handback | acked | 5971282910 | comment:5971285970 |
| 639b4213f451 | W4 | EXPO-LATEST-FULL-STAGING-PIN-1 | review | acked | 5971339022 | comment:5971343438 |
| c686e1a75995 | W9 | EXPO-MOVEMENT-VIDEO-1 | release | acked | 5971339122 | comment:5971344397 |
| 74d8ff350858 | W4 | EXPO-MOVEMENT-VIDEO-1 | review | acked | 5971765380 | comment:5971771902 |
| 2816280f22f4 | W9 | EXPO-MOVEMENT-VIDEO-1 | handback | acked | 5980141629 | comment:5980152156 |
| a89e696d6315 | W4 | EXPO-MOVEMENT-VIDEO-1 | review | acked | 5984088201 | comment:5984100414 |
| 9b6184715f9d | W9 | MOVE-CAMERA-NATIVE-PORT-1 | release | acked | 5997646784 | comment:5997687652 |
| 25c8cd7a7502 | W4 | MOVE-CAMERA-NATIVE-PORT-1 | review | acked | 6009235376 | comment:6009248820 |
| e2fea6086a17 | W9 | MOVE-CAMERA-NATIVE-PORT-1 | handback | delivered | 6019689592 | — |
| a0fb1d7864a4 | W4 | CONTROL-RECENT-COMMENTS-SAFE-READ-1 | review | acked | 6024568757 | comment:6024592026 |
| 283b9ce7ac60 | W7 | MOVE-CAMERA-NATIVE-PORT-1 | review | acked | 6024568998 | comment:6024595043 |
| a0fff7452f7a | W9 | EVERGREEN-MARKER-ENTRY-1 | release | acked | 6027915479 | comment:6027932645 |
| 686c1307a737 | W4 | EVERGREEN-MARKER-ENTRY-1 | review | acked | 6028932505 | comment:6028951508 |
| 2fd64e203963 | W9 | MEMBER-TRUTH-BACKEND-1 | release | acked | 6030038232 | comment:6030044447 |
| ab137da797c1 | W9 | MEMBER-PREVIEW-LABEL-1 | release | acked | 6035573927 | comment:6035601782 |
| 80177860322c | W3 | NORTHSTAR-MIRROR-INTAKE-1 | release | acked | 6035648701 | comment:6035668980 |
| 664c6548f982 | W4 | MEMBER-PREVIEW-LABEL-1 | review | acked | 6035730058 | comment:6035757428 |
| f4ea622a1226 | W9 | MEMBER-PREVIEW-LABEL-1 | handback | acked | 6035992343 | comment:6036001486 |
| a3a1ba72e3e3 | W4 | MEMBER-PREVIEW-LABEL-1 | review | acked | 6036066074 | comment:6036085110 |
| f60e1371d95c | W9 | KIOSK-UNVERIFIED-PARTICIPANT-1 | release | acked | 6042042985 | comment:6042073922 |
| f46e958912c6 | W4 | KIOSK-UNVERIFIED-PARTICIPANT-1 | review | acked | 6042281043 | comment:6042323747 |
| dd7bb9d5cae1 | W9 | KIOSK-EXPECTED-TURN-1 | release | acked | 6042910254 | comment:6042925619 |
| 1bb58afbb79e | W3 | KIOSK-UNVERIFIED-PARTICIPANT-1-STAGING-PIN | release | acked | 6043175500 | comment:6043195547 |
| 8f6be434c744 | W3 | KIOSK-UNVERIFIED-STAGING-RECOVERY-1 | release | delivered | 6044057222 | — |
| 849b8aa43eb2 | W3 | CONTROL-CURRENT-PATCH-ACK-1 | release | acked | 6044193318 | comment:6044199224 |
| 8ad8a042b172 | W4 | KIOSK-EXPECTED-TURN-1 | review | acked | 6044193561 | comment:6044222667 |
| 4f2f3ee721ad | W7 | KIOSK-EXPECTED-TURN-NATIVE-CALLER-1 | release | timed-out (wake-undelivered) | 6044193835, 6044557410 | — |
| 574ab7e48385 | W9 | CONTROL-CURRENT-PATCH-ACK-1 | review | acked | 6044366439 | comment:6044453646 |
| ffb8060ed493 | W9 | KIOSK-EXPECTED-TURN-1 | handback | acked | 6044557669 | comment:6044566138 |
| 5031a01de83a | W5 | EVENT-LIFECYCLE-BACKEND-1 | release | timed-out (wake-undelivered) | 6044759515, 6045098010 | — |
| cb513479a2e2 | W3 | LOVABLE-KIOSK-HOSTED-PROOF-1 | release | acked | 6044987161 | comment:6044994583 |
| 827c4cd558a0 | W4 | KIOSK-EXPECTED-TURN-1 | review | delivered | 6045746368 | — |
| 9ccddb32af25 | W9 | KIOSK-EXPECTED-TURN-1 | handback | acked | 6045860637 | comment:6045874171 |
| e60f0b948571 | W3 | LOVABLE-KIOSK-HOSTED-PROOF-1 | handback | acked | 6045860843 | comment:6045941455 |
| 1d9f6e64f3df | W3 | CONTROL-CURRENT-PATCH-TRANSPORT-2 | release | acked | 6050398019 | comment:6050437106 |
| b756432786d4 | W4 | CONTROL-CURRENT-PATCH-TRANSPORT-2 | review | acked | 6050537782 | comment:6050571407 |
| d0731cdb3af5 | W3 | CONTROL-CURRENT-PATCH-TRANSPORT-2 | handback | acked | 6050787763 | comment:6050793033 |
| c457e466bc6c | W4 | CONTROL-CURRENT-PATCH-TRANSPORT-2 | review | acked | 6050907527 | comment:6050914866 |
| 3ef4588cb522 | W4 | KIOSK-EXPECTED-TURN-1 | review | acked | 6051288553 | comment:6051302022 |
| b019b8763591 | W4 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6051465629 | comment:6051475054 |
| ea24f1e616cf | W9 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6051465790 | comment:6051520120 |
| 8c75fc18867b | W3 | LOVABLE-KIOSK-HOSTED-PROOF-1 | handback | acked | 6051576301 | comment:6051580738 |
| 1eb4f1a4aeb8 | W4 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6051810195 | comment:6051816252 |
| a41210dad68a | W9 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6051810362 | comment:6051841574 |
| 54e56adf719b | W3 | LOVABLE-KIOSK-HOSTED-PROOF-1 | handback | acked | 6052399946 | comment:6052507556 |
| 5de76c7c05dc | W9 | PROFILE-PHOTOS-FIREBASE-1 | release | acked | 6052504001 | comment:6052517710 |
| 2399e8f191fe | W4 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6052814327 | comment:6052827762 |
| c71bc50dd0c3 | W9 | LOVABLE-KIOSK-HOSTED-PROOF-1 | review | acked | 6052814610 | comment:6052849697 |
| b743b66ebea2 | W4 | PROFILE-PHOTOS-FIREBASE-1 | review | acked | 6052929342 | comment:6052937344 |
| 08b59f3a9771 | W9 | PROFILE-PHOTOS-FIREBASE-1 | handback | acked | 6053169686 | comment:6053176393 |
| 0944310db4ba | W4 | PROFILE-PHOTOS-FIREBASE-1 | review | acked | 6053292989 | comment:6053300849 |

