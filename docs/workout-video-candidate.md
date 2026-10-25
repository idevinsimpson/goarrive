# Optional in-workout video candidate

This branch is based on PR647 clone head 6f3fa946c53ecb79c0baa4d8536a24a602cbdf7a
and includes the separate PR649 host-URL patch as its own cherry-picked commit.
No live data, meeting, camera, microphone, recording, or credentials were used in acceptance.

## Policy and access

Playbook video defaults off. A workout can inherit, explicitly allow member opt-in,
or disable video. Settings are explicit authenticated saves and enforce owning-coach
identity in a transaction. They do not allocate a room, change recording, or alter progression.
Build duplicates retain the selected video default; enrollment retains template settings.
Guest/anonymous and standalone workouts without an assigned scheduled Playbook session
have no video capability. A guessed workout or Playbook ID never identifies a shared room.

The read-only availability callable requires session ownership, current Playbook membership,
matching coach on session/Playbook/workout, a pinned workout, policy enabled, allocated or
in-progress status, no workout completion, and server time inside the existing five-minute
entry window through the end instant. It then checks an active assigned coach room or the
explicit HMTI shared-pool allocation. Coach participants remain role 0, never host.
The signing callable rechecks this policy for every Playbook request, irrespective of the
client-supplied purpose. Existing non-Playbook signing behavior is outside this new capability.

The new path requires recording off AND a provider-reported allocation receipt of `none`.
The allocator stores the observed Zoom response mode, not just the requested value. Unknown
or legacy receipts fail closed. No meeting is created/reconfigured to make it eligible.
This does not revoke previously issued Zoom URLs/signatures or prevent an actual host from
changing recording later. No recording/RTMS/transcription feature is enabled by this change.

## UI and lifecycle

One tile lives inside WorkoutPlayer's existing modal overlay. It is unmounted on close,
completion request, session/account change, or navigation. Availability is rechecked every
15 seconds; denial/network failure closes the local client. There is no SDK load, capture
request, permission pre-warm, or automatic toolbar click on mount. A member must choose
Join video, then use Zoom's separate camera/audio controls. Workout playback remains usable
when video is unavailable or fails. Leave and Cancel connection remain visible.

A browser-wide lease prevents a new client until the old asynchronous join has settled,
been left again, and destroyed. Late completions cannot restore UI or media. The former
beta join route now enters the same scheduled player (coach goes to live view), retaining
validated sign-in destinations, instead of maintaining a second SDK/automatic-media owner.

## SDK migration evidence

Both entry routes share one loader pinned to 5.1.4. Official sources:
- https://developers.zoom.us/docs/meeting-sdk/web/get-started/
- https://developers.zoom.us/changelog/meeting-sdk/web/5.1.4
- https://raw.githubusercontent.com/zoom/meetingsdk-web/v5.1.4/package.json
- https://marketplacefront.zoom.us/sdk/meeting/web/components/interfaces/JoinOptions.html
- https://developers.zoom.us/docs/meeting-sdk/web/browser-support/

5.1.4 addresses Chrome 147 WebRTC negotiation. Its CDN bundle's external globals are React
and ReactDOM; both official versioned assets plus the root embedded bundle were fetched and
loaded offline with network/capture blocked. The latest generic docs also list react-redux,
but that 5.1.4 CDN URL returned 403 and the pinned bundle does not need that external global.
The existing signature builder already includes the appKey required by SDK5. No SDK key,
OAuth scope, domain, or signature algorithm change was made.

Load-only checks passed desktop, Android Chrome emulation and an iPhone-sized Chromium
context with zero capture attempts and no client or meeting creation. This is NOT a real
Android/iPhone media delivery test. Component View is officially desktop-oriented; retain
that limitation rather than claim mobile support based on emulation.

## Verification and release gates

525 app tests passed; 20 synthetic Firestore policy tests passed; 66 Functions contracts
passed, plus four provider-recording cases; both type checks passed.
Local desktop and Android Chrome emulated browser acceptance used real emulator Auth, policy saves, and session/player data. The mobile run caught an obsolete recording-era render reference; it was removed and the run passed. Final UI/loader/lifecycle coverage is 11 tests. The Android-emulated browser also verified minimize controls retain one client and leave workout controls visible. One earlier parallel run hit a worker startup timeout during export; the same tests passed after export finished.
Default-off made zero capture calls. A failed real local join-config request displayed retry.
A clearly mocked SDK/config then proved overlay join/leave without completing the workout.
No real meeting or provider token was used. Actual SDK verification was load-only separately.

Deployment requires independent exact-head review and fresh comparison with deployed source.
Named GoArrive functions only: getSessionVideoAvailability, setWorkoutVideoPolicy,
getEmbeddedSessionJoinConfig, allocateSessionInstance, allocateAllPendingInstances,
and rescheduleInstance, plus separately approved PR647 functions. Do not deploy all/default
codebase wholesale, accept function deletions, touch WSF, or upgrade Node runtime here.
No rules/index change. Preserve current Hosting and named-function rollback references;
backend compatibility first, Hosting preview before public promotion. Keep live video off
where any admission/recording/room/capability gate is unverified. Real media acceptance needs
separate consent and an actual device; synthetic tests cannot substitute for that claim.
