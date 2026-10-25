# Guest link draft: private lifecycle and isolated unavailable route

This is NOT a releasable guest player. Issuance and playback remain unavailable, regardless of environment configuration. No live token, grant, Storage permission or production record has been changed.

## Implemented source boundaries
- guestWorkoutCapability.ts: digest-only, expiring/revocable/rotatable per-assignment capability core. Final admission requires one consistent grant/assignment/session/plan snapshot. Pin/scheduled/carry-forward order matches the member player. Zoom-ended status does not imply workout completion. Internal admission is never a public response or permission to return a full document.
- guestCapabilityStore.ts and guestAssignmentLifecycle.ts: real Firestore transaction adapter, private generation, creation-time binding, atomic membership replacement. Existing protected plans can remove members even when the global rollout is off. First activation defaults off.
- firestore.rules: only Playbook rules change. Clients cannot create/change the server lock; protected membership/coach fields cannot be changed directly. Private version/grant collections remain covered by default deny. Existing unlocked plans retain legacy membership writes.
- Coach Build add/remove and SchedulePanel membership edits use updatePlaybookMembers. Protected plans use server transaction, no fallback after rejection. The Build menu displays guest access unavailable. Standalone confirmation controls distinguish expiring guest links from permanent authenticated links; canRevoke is independent of canIssue.
- Three management endpoints are exported: status (always canIssue:false), owner-scoped revocation (works during rollout shutdown), and gated assignment management. No issue endpoint, anonymous workout response or media stream endpoint exists.
- /guest-workout is a separate static unavailable page: no Expo/Auth/Sentry or third-party scripts, no-referrer/no-store/noindex, camera/mic denied, strict script hash CSP, fragment/query cleared from the current history entry before rendering. Hosting rewrite prevents nested guest paths falling into the SPA. Both service workers bypass it and generated precache excludes it. Telemetry filters also suppress stale guest URLs/credential fields from existing app events.

## Assignment writer inventory
Current source inspection identifies Build add/remove, SchedulePanel writeMembers (routed), Build create/duplicate (new document with no grants), enrollment clone (new document; server guest lock stripped), Build delete (future recreated document has different server creation time), template sync (workoutIds/musicStyle/description only), and detach (unsynced only). Booking creates sessions and does not mutate Playbook member assignment. The private generation is changed synchronously, not by a trigger. Future server assignment writers must use the transaction; this is not a claim that arbitrary Admin SDK writes can be prevented by Firestore rules.

## Remaining media dependency and activation gates
Current Storage movements/workouts are authenticated and existing player URLs are long-lived. The existing share serializer passes notes and media URLs and is not reused. guestMediaBoundary.ts validates only canonical coach-owned movements/workouts object references and explicit single ranges capped at 1 MiB, with a 100 MiB object ceiling. It does not fetch anything or authorize access.

Still required: a strict workout projection resolving only owner-verified asset references, a server stream implementation that revalidates admission on each bounded range, and guest player fetch/Blob or MediaSource plumbing without unrestricted URLs. No arbitrary HTTP fetch, signed public URL, global Storage permission change, notes/PII/Zoom data or guest progression writes. Audio/music/intro/outro asset ownership mapping needs explicit treatment; do not silently reuse public caches or coach voice endpoints. Until that adapter/player is reviewed, the static page loads no workout and canIssue remains hard-disabled.

## Verification
- 528 app tests passed before the last membership helper test addition; three additional helper cases passed; app tsc passed.
- 31 core/clone contracts and two media-boundary contracts passed; Functions tsc passed. Includes cancellation/completion/reschedule/workout races and Zoom lifecycle distinction.
- 14 lifecycle/Firestore emulator cases passed, including real late cancellation/completion/reschedule/workout changes. 59 shared GoArrive/WSF rules regressions passed.
- 46 generated/public service-worker tests passed.
- Real local Chromium: static page has no external requests, no credential in requests/logs, no storage/cache, no-referrer, no-store, fragment/history scrub on initial load, reload and Back. This is a disabled route test, not media acceptance.
- Normal Expo export and SW/PWA postprocessing passed. The isolated guest shell remains byte-identical after the build (SHA256 67712f7554f4a44363ca71d9c0f192da56908432f081a8d2c010663c2c962d8d). Explicit EXPO_ROUTER_APP_ROOT and a direct dependency junction were needed for this Windows worktree. No deployment permitted from this draft.
