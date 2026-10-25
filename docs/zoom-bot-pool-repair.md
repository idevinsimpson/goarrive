# HMTI bot pool integration — disabled draft

The separately reviewed read-only `inspectZoomBotHosts` endpoint was deployed at 78bb3c6. All allocator, registry, reconciliation, and lifecycle changes in this branch remain undeployed. The active single-host MVP is independent and untouched.

## Implemented paths

- Both single and batch shared-pool allocation use the same allocator only when `ZOOM_VERIFIED_BOT_POOL_ENABLED=true`. Capacity remains one meeting per verified host.
- Registry management (`reconcileZoomBotHost`) requires platform-admin authentication and a separate `ZOOM_BOT_MANAGEMENT_ENABLED=true` flag. It verifies existing provider identity/account/license, checks actual room mapping, and writes no credentials. Neither flag is enabled by this code.
- Registration first quiesces the host. Legacy provider creation and registration transact on the same host fence. In-flight or unknown legacy requests block registration. Registered email/provider/room aliases cannot use the legacy allocator. Busy mappings cannot be silently replaced.
- Bounded, GET-only provider inventory projects meeting IDs and timing; no join URL, password, host capability, or profile is returned. Allocation refreshes inventory, fails on stale/incomplete observations, and counts external/unknown occupancy. Recurring or untimed external meetings block conservatively.
- Reservations include the existing five-minute early window. Unknown and overdue occupancy persists pending provider reconciliation. Fair host selection uses a transaction cursor and per-host leases.
- Before creating a meeting, the job rechecks assignment, room version, mapping, inventory freshness and deadline. Provider outcome and session/receipt/reminder writes are attempt-fenced. Receipt/commit failure cannot create another meeting; a known provider ID is retained for reconciliation.
- Join signing performs fresh provider occupancy checks for bot receipts, even on the omitted-purpose legacy signer path. An earlier live or unknown meeting prevents joining a later allocated session. Final session/job/assignment checks follow the provider read.
- Managed cancellation/rescheduling is serialized against allocation. Member-policy denial occurs before locking. A transactional overlap rejection releases only its own lock. Rescheduling holds both old and proposed member slots until verified provider deletion and atomic session commit. Uncertain deletion keeps holds and stops the mutation.
- Known provider outcomes can be reconciled by a separate disabled-by-default admin callable. Only confirmed provider absence releases capacity and unused proposed slots. An unknown meeting ID is never guessed or automatically released.
- Reminder jobs are created in the allocation transaction with deterministic attempt/type IDs and UTC instants. Retry cannot duplicate them. Existing reminder processing performs delivery; tests never send messages.

## Verified host identities, not new registrations

HMTI2 (`hmti2@goa.fit`) and Maia (`maia@goa.fit`) were previously verified as active licensed users on the existing account. Licensed status does not establish more than one simultaneous meeting. No private registry record or Maia room was created by this work. The separate approved HMTI2 coach-owned MVP room must be reconciled explicitly before future registry activation.

## Validation and limits

The main local lifecycle run passed 48 emulator cases; two additional registry regressions passed on the final registry rerun (8 cases). Three rules tests deny member, coach and client-side platform-admin reads/writes to all new private coordination collections. Provider requests are synthetic in these tests. The full Functions contract suite passed 115 tests across 18 suites, and Functions type checking passed. The existing screen test harness gained its missing overlay stub; cancellation assertions were preserved.

Real Zoom inventory permissions have not been exercised under this local-only task. No new OAuth scope, credentials, host license, live room, recording, email, WSF, billing, runtime or rules deployment is included. Provider-side activity can change after an observation; application admission does not revoke already-issued Zoom signatures or direct provider join URLs. This must be part of controlled acceptance rather than a claim of universal provider enforcement.

Both allocator and management flags remain off. Registration needs verified actual mappings and current provider inventory, including existing MVP and external meetings. Unknown provider outcomes without an identifiable meeting require operator/provider investigation; automatic release would risk duplicate meetings.

This branch is based on the earlier video candidate. Before any deployment it must be reconciled with the newer released PR655 recording/owner-admin compatibility code and exact live Functions inventory. Never deploy this branch wholesale over production or unrelated Connect/WSF functions.

## New timing request (separate pending source work)

The user now requests coach-configurable scheduled-time-only/up-to-15-minute early entry, post-end grace for both late joining and finishing, and an upcoming-workout/countdown waiting screen. The complete host reservation must span start minus early allowance through end plus grace. Existing no-show grace is an attendance policy, not access grace. This draft still uses the existing five-minute access window; the new settings have not been activated or silently applied to any booking.

## Provider references

Inventory uses the documented user meetings `scheduled` and `live` views with bounded `next_page_token` pagination: https://developers.zoom.us/docs/api/meetings/ and https://developers.zoom.us/docs/api/pagination/ . Absence from a list alone is never proof of deletion; release uses the existing provider GET returning not-found.

