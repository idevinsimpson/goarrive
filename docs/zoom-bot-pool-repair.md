# HMTI bot pool repair — isolated draft

This draft adds a read-only inspectZoomBotHosts callable and an unconnected server-only reservation primitive. It does NOT create/register a host, allocate a meeting, change a pool, activate recording, or modify the current production allocator.

The inspection endpoint accepts 1–10 explicit email addresses, normalizes/deduplicates case, requires the platformAdmin role, and uses the existing S2S provider. Only GET /users/{email} is performed after the provider's existing authentication. It returns a minimal host ID/email/status/type/account-match projection, never credentials, PMI/join links or profile data. A denied permission returns a sanitized HTTP status. It does not request new scopes or licenses. Zoom API reference: https://developers.zoom.us/docs/api/users/

## Verified production trace (read-only)

- Single allocator: shared_pool queries zoom_rooms poolId=hmti/status=active, prioritizes bots, orders by lastUsedAt (lastAllocatedAt fallback). It then falls back to the caller's active rooms. No hmti pool or target coach rooms were found.
- Root collection inventory found zoom_rooms and coach_zoom_connections. The latter has a connected personal email scaffold for the target coach; it is not read by the allocator and is not evidence of provider authorization. The room collection contains only another coach's personal room. No case variant of either requested bot was discovered in these records.
- Existing allocateSessionInstance is revision allocatesessioninstance-00054-tan; allocateAllPendingInstances is allocateallpendinginstances-00048-yit. Neither resolves bots from personal connection records. Batch selection differs from single selection.
- Existing selection/conflict checks and lastUsedAt updates are not one transaction. maxConcurrentMeetings is stored but not used for allocation capacity. Thus source round-robin intent exists, but concurrency guarantees are missing.
- No claims are made about the named users' actual Zoom account/license state. getSystemHealth denied the legitimate role-admin account due its older boolean-claim check; no retry/bypass occurred. New inspection endpoint is NOT deployed.

## Reservation primitive

Private default-denied collections hold verified host registry, allocation jobs, per-host windows and pool cursor. Hosts must be active, explicitly verified live bots in hmti; normalized emails produce stable keys. Atomic transactions serialize cursor selection and capacity windows, selecting the least recently selected eligible host. Capacity measures peak overlap with exclusive end boundaries. A same-session retry returns create:false. Provider-start transitions are atomic and recheck session ownership, member, Playbook, timing, recording choice and host identity. An uncertain provider outcome remains quarantined instead of issuing another create call. This identifier is not a guest credential or host permission.

## Remaining integration gates

Do not wire this primitive into live allocation yet. First inspect the two exact existing Zoom users using the reviewed read-only endpoint; confirm actual account membership, host capability and permitted concurrency. Define an authenticated, idempotent registry-management path and reconcile existing provider meetings/legacy reservations before enabling new claims. Both single and batch allocator must then share the same flow. Preserve provider-success receipts atomically, handle cancellation/reschedule and manual reconciliation of unknown outcomes, and test injected failures. Existing external/legacy meetings must count against capacity; the isolated primitive currently counts its own reservations only. No migration, registry entries or existing-data edits are performed in this draft.

No hard-coded production host emails, new credentials, purchases, provider grants, shared-rule changes, broad deployment or automatic media activation.
