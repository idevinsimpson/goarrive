# Optional access without sign-in — proposal only

This feature is not implemented or enabled by the authenticated member-link PR.
No real bearer link has been created. `/playbook/{playbookId}` continues to require
authentication and current membership.

## Existing implementation

`createShareToken`, `resolveShareToken` and the `/share/{shareId}` page support
random 16-byte workout share IDs, expiry/revocation and visibility modes. These
tokens identify a single workout, not a scheduled Playbook/member assignment.
The existing resolver also tracks views and the page can submit guest reflections.
Its legacy default is anyone-with-link. Those defaults and write behavior are not
appropriate for a new private scheduled-member capability.

## Smallest separate change

- Add an explicit coach-owned **Allow viewing without sign-in** setting, off by
  default. Enabling it explains that anyone receiving the URL can view this
  member's eligible workout. No member profile is included.
- Issue a high-entropy opaque capability dedicated to exactly one
  `{coachId, playbookId, memberId}` assignment. Never let a plain Playbook ID,
  booking token, or another member's token grant anonymous access. A group
  Playbook needs a separate capability per member; a generic group link cannot
  identify which member's scheduled workout to show safely.
- Keep the URL stable while enabled. Turning it off revokes it immediately;
  **Replace link** rotates it and invalidates the old URL. Removing/reassigning
  the member, deleting the Playbook, or changing its coach invalidates access.
  Server-side checks must run on every resolution and media refresh. Existing
  downloaded data cannot be recalled; coach copy should say so.
- Use a separate resolver with explicit projection and no automatic analytics,
  guest reflection, journal, live-player state, or completion writes. Return only
  the eligible workout's required playback fields/media, with the same five-minute
  early window, end boundary and unambiguous session selection. Reject early,
  ended, cancelled and unassigned requests without exposing the schedule/history.
- Sensitive capability URLs must be excluded from telemetry, logs, referrers,
  search indexing, public metadata and service-worker caches; resolver responses
  use `Cache-Control: no-store`. Do not put personal information in the URL.
  Review media access and revocation semantics before implementation: existing
  long-lived public media URLs must not be assumed revocable.
- Guest playback completion stays local. **Sign in to record completion** uses
  the existing authorized/idempotent transaction. Possession of a forwarded link
  cannot establish who completed a member's workout. Anonymous progression writes
  therefore require a separate explicit product/security decision, not an
  incidental extension of the read capability.

## Review and activation gates

Implement and test separately with synthetic capabilities only: coach ownership,
default-off behavior, cross-member/group denial, rotation/revocation/reassignment,
time gates/DST, no metadata leakage, cache/privacy behavior and zero member writes.
Before any live activation, obtain release approval for the exact resolver/UI and
explicit approval to enable a capability for a named dedicated test assignment.
Do not change existing sharing visibility, mint live tokens, or broaden public
Firestore rules as part of the authenticated feature's release.
