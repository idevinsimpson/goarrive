# HMTI bot pool integration — disabled draft

The read-only inspection endpoint at 78bb3c68019b0724bf976a81149505eb906a3d4e was deployed independently. On October 25 at 16:19 UTC it verified both requested hosts as active, type 2, same account. No registry, room, meeting, recording, or new credential was created.

## Integration delta

Both allocateSessionInstance and allocateAllPendingInstances call the same allocateVerifiedBotSession flow for shared_pool sessions only when ZOOM_VERIFIED_BOT_POOL_ENABLED is exactly true. The absent/false gate retains legacy allocation for unregistered hosts; any private registered host is fenced from legacy allocation, including inactive records and legacy aliases. No production gate change is included. Personal rooms remain on the existing path.

The private verified registry, per-host leases, allocation jobs and shared cursor serialize least-recently-selected host choice and peak concurrent capacity. Same-session retries reuse the job. Provider creation begins once; uncertain failures are quarantined rather than retried on another host. Session assignment, recording choice, timing and host identity are rechecked before creation and after provider response. Successful allocation and the private video receipt commit atomically. A receipt persistence failure leaves the attempt locked, preventing duplicate creation.

Legacy room IDs must be explicitly reconciled. All legacy documents with a meeting ID count alongside private leases, deduplicated by session ID; cancelled/completed status alone is not evidence of provider release. Canonical UTC timestamps take precedence, with the existing timezone conversion for legacy wall times. Only a server-owned release proof bound to the same meeting/provider identity removes legacy occupancy. No release-proof writer is implemented yet. Invalid timing or more than 200 records per legacy room fails closed. Existing sessions cannot be silently rescheduled across a provider attempt.

## Proposed registration — NOT executed

Create no records until the management path, room relationship, external meeting reconciliation and exact registration changes are reviewed. Private record keys are SHA256 of normalized email; they are identifiers, not credentials.

| Field | HMTI2 | Maia |
|---|---|---|
| email | hmti2@goa.fit | maia@goa.fit |
| providerUserId | Ci-5tmwMSE6IiZG5wU_QLw | faqYhkgPQJO6ruQ9Re8odg |
| poolId | hmti | hmti |
| providerMode | live | live |
| isBot | true | true |
| maxConcurrentMeetings | 1 | 1 |
| status | inactive until reconciliation | inactive until reconciliation |
| reconciled | false until reconciliation | false until reconciliation |

Licensed status does not prove additional concurrent-meeting entitlement. Use one meeting per host unless verified otherwise. roomId and legacyRoomIds are deliberately unset here: these must reference reviewed real mappings, not fabricated IDs. The earlier inventory found no bot room records. The separate approved MVP subsequently registered one coach-owned HMTI2 room; that live room and test are outside this draft and must be reconciled before any registry activation. coach_zoom_connections are email scaffolds, not allocator configuration. The private registry must never trust coach-writable room metadata as proof of host identity.

## Remaining release gates

The code and provider are tested with synthetic fixtures only. External/provider meetings must be reconciled before activation, including how their reservations remain authoritative; this draft does not prove capacity against independently created Zoom meetings. A supported authenticated registry-management path and reviewed room mapping are still required. No registry writer or activation is included. Future bot additions must repeat provider identity/account/status verification and reconciliation. Unknown provider outcomes require read-only reconciliation before any retry or lease release.

The new allocation path does not create reminder/email jobs; those integrations must be deliberately reviewed before replacing existing production scheduling behavior. No live meeting, media, recording, migration, runtime upgrade, global rules change, WSF or billing change is included.

## Validation

The final remediation checks passed 36 Firestore emulator cases across three suites (20 reservation cases on the corrected rerun, plus 16 allocation/mutation cases) and 10 actual-handler contracts, plus Functions type checking. Final regressions cover legacy alias IDs after editable identity changes, deadline expiry during the last room read, and concurrent mutation/allocation admission. Provider calls remain synthetic; no live provider or media test is represented by these checks.

## Review remediation and remaining activation blockers

Capacity starts five minutes before the scheduled start. Unknown provider outcomes and overdue holds remain occupied until explicit reconciliation. Capacity is restricted to one simultaneous meeting per host. A reserved job snapshots the room ID, mapping version and Firestore room version; creation rechecks the deadline after asynchronous preparation. Post-provider writes are attempt-fenced, and a successful stale provider response is recorded privately as an orphan instead of overwriting a replacement job. Existing completed jobs must still match the current session and private meeting receipt before reporting success.

Shared-session cancel/reschedule obtains a transaction lock before reservation moves or provider/session writes. An existing allocation job rejects the edit before mutation; uncertain deletion retains its lock. This is deliberately fail-closed, not a completed managed cancellation/rescheduling workflow. Batch managed allocation preserves earlier successes and continues after a later failure.

Still required before activation: authenticated registry management, quiescing/reconciling in-flight legacy allocation during registration, provider-authoritative external meeting inventory and release proofs, safe managed cancellation/reschedule reconciliation, and reminder parity. No code here proves capacity against meetings created outside GoArrive. No automatic lease expiration or live registry writes are included. The parent requested local-only remediation while the separate MVP is being tested; this branch must not be deployed as a bundle over the newer live source.

