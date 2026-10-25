# Guest workout capability draft: offline foundation, not releasable

This draft adds a dependency-injected capability core and standalone coach confirmation controls. Neither is imported by the app or exported by the Functions entry point. No endpoint, grant, Storage rule, assignment mutation, guest route, or live media access is added. The default gate is closed. This is a partial implementation for review, not a completed no-sign-in player.

## Completed code
- 256-bit random capability generation only after owning-coach checks and explicit confirmation; SHA-256 digest at rest, reveal once, maximum seven-day expiry.
- Store contract requires atomic rotation/revocation and a server-owned assignment generation, including remove/re-add. No client-editable field or asynchronous trigger is accepted as sufficient.
- Read-only resolution rejects wrong assignment/tenant, expired/revoked/cancelled/ended/completed/ambiguous sessions. It selects pinned, then scheduled, then carry-forward workout, without pinning or advancing progression. Absolute times avoid DST wall-clock ambiguity. Rechecks revocation after asynchronous reads.
- Coach UI distinguishes permanent authenticated links from expiring guest capabilities, requires confirmation, handles retry/duplicate clicks and stale assignment responses, and defaults unavailable.

## Confirmed architecture blockers
1. storage.rules protects movements/{coachId} and workouts/{coachId} with authentication. Existing download URLs are bearer-style long-lived URLs. workoutPlayerSanitizer passes media URLs, notes, descriptions, coaching cues and coachId through. Reusing that response would neither provide least-data guest access nor enforce revocable media delivery. No rules or global URL changes are made here.
2. Current Playbook assignment edits are client writable. A private server-owned generation must be changed atomically with assignment edits to prevent an old token reviving after remove/re-add. An asynchronous Firestore trigger alone is insufficient. The core's store adapter is intentionally absent until assignment write paths can be consolidated/reviewed.
3. A guest route must avoid app-wide Sentry initialization, token referrers/history analytics and service-worker caches. This draft does not add a route until that boundary is reviewed. A future fragment-based token must never enter logs or persistent browser storage.

## Next implementation slice
Build a server-authorized streaming/media adapter with strict coach-owned object-path allowlist (no arbitrary URL fetch/SSRF), range support, short admission lifetime and revocation recheck; audit media/voice/music projection. Consolidate assignment lifecycle writes behind an owner-authorized transaction and deny client edits to the affected membership/version fields, with GoArrive and WSF rules regression before release. Then wire management/resolver endpoints behind independent default-false server gate and integrate controls plus isolated privacy-safe guest player. No anonymous completion or video calls. No real capability issuance until explicitly authorized for a named test assignment.

## Validation scope
Synthetic core contracts and React DOM controls tests only; deterministic fixture bytes, no providers/database/media. The store is an in-memory implementation that enforces its transaction contract. Actual Firestore adapter, emulator access-control proof, and real playback do not exist yet and are release blockers, not passing tests. Existing authenticated link, player and completion transactions are untouched.

Verified locally: 22 capability contracts; five React DOM controls tests; app and Functions TypeScript checks; localhost Chromium default-disabled/explicit-confirmation/revoke fixture with all external network blocked. Browser callbacks were synthetic and created no token. No emulator or production claim.
