# GoArrive Known Issues & Lessons Learned

_Last refreshed: 2026-07-28._

## Resolved Issues (Reference for Future Work)
The following issues were encountered and resolved during development. They are documented here as institutional knowledge to prevent regression and inform future decisions.

### Admin Impersonation Crash (Lazy-Loaded Components)
When a Platform Admin used the "View as [Coach]" feature, the app would crash because certain components were lazy-loaded and did not properly handle the `effectiveClaims` context. The fix ensured that all components consuming auth context use `effectiveUid` and `claims.coachId` from `useAuth()` rather than `user.uid` directly. Any new component that queries Firestore or triggers Cloud Functions must follow this pattern.

### "View as Coach" Not True to Coach
Even with `effectiveClaims`, impersonation still diverged from the real coach experience: some Firestore rules did not grant admins read/write access to coach-scoped data, and the admin's own role leaked through in places. The fix (PR #168) added explicit rules grants for impersonating admins and a role mask so the UI renders exactly what the coach sees. Follow-up fixes (PR #175) corrected the impersonated identity/avatar in settings. Any new coach-scoped collection needs the corresponding admin-impersonation rules grant.

### Dashboard Member Count During Admin Override
The dashboard member count was showing the admin's own member count (typically zero) instead of the impersonated coach's member count. The fix involved updating the Firestore query in the dashboard to use the effective coach ID from `AuthContext` when an admin override is active.

### Getting Started Checklist (Wrong Firestore Collection)
The "Getting Started" checklist on the dashboard was not recognizing created workouts because it was querying the wrong Firestore collection. The fix updated the query to use the correct collection name (`workouts`).

### Duplicate Member Email Prevention
Before the fix, coaches could create multiple members with the same email address, leading to authentication conflicts and data integrity issues. The solution added a pre-creation check that queries the `members` collection for existing entries with the same email before allowing creation.

### Coach-Created Members Could Not Log In
Members created directly by a coach had no way to set a password, so they could never sign in. The fix added a `sendMemberInvite` flow plus Send Invite / Password Reset actions in the coach member hub (PRs #85/#86). Any flow that creates auth users on behalf of someone must also provide a credential-setup path.

### Intake Form Race Condition
When a new member completes the intake form, `createUserWithEmailAndPassword` fires `onAuthStateChanged` before the `members` document is written to Firestore. The `AuthContext` handles this by defaulting to the `member` role when no profile document is found, which is safe because new users from intake are always members, not coaches.

### iOS Audio: Unlock, Revocation, and Overlap
The workout player's audio pipeline produced a long series of iOS Safari bugs, all rooted in autoplay policy:
- Audio elements must be "blessed" (played once) **inside a user tap gesture**; blessing now uses a silent WAV so the unlock is inaudible.
- iOS can **revoke** autoplay permission after a phone call or backgrounding — playback now retries on `NotAllowedError` and re-syncs touch hit-testing after interruptions.
- Start-of-workout cues could overlap (intro announcement + first movement cue); fixed by routing announcements through the audio queue with a music hold, and stopping stalled clips before starting new ones.
- A queue deadlock could kill all workout audio mid-session; fixed alongside the revocation recovery (PR #195).
- Demo and outro cues must be **preloaded** or iOS silently drops them (PR #189).
Lesson: every new audio feature must go through the shared queue/unlock machinery — never a bare `new Audio().play()`.

### Frozen Movement Videos
Videos could freeze permanently after backgrounding or a decoder stall. The fix (PR #198) resumes playback on foreground and escalates through reload strategies when a stall is detected. Any new media surface should reuse this recovery path.

### Video Crop Transform (Reverted Once, Redone Right)
PR #120 applied saved video crop transforms in the player but broke rendering and was reverted (#121). The redo (#132) applied the transform with proper frame-ratio scaling, and later fixes (#124/#125) plumbed `cropFrameWidth`/`cropFrameHeight` through the flatten + hydrate pipeline. Lesson: the builder → flatten → share-sanitizer → hydrate → player pipe has multiple lossy hops; any new per-movement field must be threaded through **all** of them (swap fields hit the same issue — PRs #116, #153, #154).

### iPhone HEVC Uploads
Videos recorded on iPhone upload as HEVC, which many browsers cannot play. Uploads are now transcoded to H.264 server-side (PR #122). Assume any user-uploaded video needs transcoding.

### Callable Function "functions/internal" After Redeploy
Gen 2 callable functions can start returning `functions/internal` with null details after a redeploy because the `run.invoker` IAM binding (allUsers) is dropped. Fixed for the Zoom/calendar callables in PR #163. If a callable suddenly 500s for all clients after a deploy, check the invoker binding first.

### Firestore Rules Gaps Found Late
Two access gaps shipped and were only caught in production-style testing: members could not read movements owned by their coach (PR #152), and workout intro-announcement audio in `voice_cache/workouts` 403'd for anonymous share-link visitors until public read was granted. Lesson: when a new feature reads data under a different auth context (member, guest, impersonating admin), test the rules path for that context explicitly.

### Pending Server Timestamps Break Client Sorting
Lists sorted by `updatedAt` jumped around after a drag-drop because pending `serverTimestamp()` writes read back as null. Fixed by reading snapshots with `serverTimestamps: 'estimate'` so drops re-sort instantly. Use estimate mode anywhere a serverTimestamp field feeds a client sort.

### Scheduling UI Timezone Bugs (Booking Ship)
The playbook scheduling/booking UI shipped with several date bugs, all the same root cause: building calendar-day strings from UTC ISO dates instead of the viewer's local calendar. Today/Tomorrow grouping was wrong for coaches west of UTC in the evening, the week grid highlighted the wrong day, and the past-date cutoff used the wrong timezone. Fixes derived `dateStr` from device-local calendar components and used the coach's timezone for the past-date cutoff. Lesson: never call `toISOString().slice(0, 10)` for anything a human reads as "today" — always build date strings from local (or explicitly coach-tz) calendar parts.

### Auto-Save Panels That Lost Edits
The playbook availability/settings panels auto-save, and three loss bugs shipped: availability edits were silently dropped before a booking link existed (the save path assumed the link's doc was already there), the Record Sessions / Book Ahead / Weekly Cap toggles never persisted, and closing the panel could race the debounced save. Fixes persist settings independently of the booking-link doc and flush pending auto-saves on close. Lesson: an auto-save surface must (a) not depend on a sibling document existing and (b) flush its debounce on unmount/close.

### Double Bookings From Retries
Guest booking submissions could double-book on retry/refresh. Fixed by making `bookViaBookingToken` idempotent: the client sends a `clientRequestId`, the function writes a dedupe doc in `booking_requests`, and a daily scheduled job TTL-cleans expired dedupe docs. Lesson: any public write endpoint that users can retry needs an idempotency key, and dedupe artifacts need a cleanup job so the collection doesn't grow forever.

### Heavy Imports in Public Callables
`bookViaBookingToken` initially imported the notifications module at the top level, dragging its whole dependency tree into the public booking callable. Switched to a lazy `import()` at the call site. Lesson: keep public/high-traffic callables' top-level imports minimal — lazy-import heavy modules (email, PDF, AI SDKs) where they are used.

### Vitest vs Jest APIs
The test suite runs on vitest; `jest.spyOn` in older player tests silently broke under the vitest runner and had to be converted to the vitest API. Write new tests against vitest (`vi.*`) only.

### Expo Export in Git Worktrees
`npx expo export` fails when `node_modules` is a symlink into the main checkout (Metro resolves through the symlink and escapes the project root). When building the web app from a secondary worktree, use a hardlink copy (`cp -al`) of `node_modules` instead of a symlink.

### Large Feature PR Merge Conflicts Can Clobber Existing UI
When PR #207 (playbook live view) merged, a merge conflict in `app/live-session/[sessionInstanceId].tsx` was resolved incorrectly, overwriting the existing 3-state UI (pre-session countdown / active session / post-session) with an earlier version of the file. The clobber was not caught before the prod push; a follow-up fix restored the correct 3-state logic. Lesson: after merging any large feature PR that touches a shared route file, diff the result against the pre-merge HEAD to confirm all pre-existing UI states are intact — especially for files that both the feature branch and main modified independently.

## Known Performance Risks

### GIF Memory Consumption at Scale
Largely mitigated: movement tiles now render static poster thumbnails and only lazy-swap in the animated GIF when visible (PR #133), fixing blank tiles on mobile. `FlatList` virtualization remains the backstop. GIFs still consume memory once animated, so keep posters as the default for any new list surface.

### Client-Side Sorting Performance
The app performs client-side sorting and filtering for movement and workout libraries using `useMemo`. This works well for libraries under a few hundred items but may become a bottleneck for very large libraries. If performance issues arise, consider implementing server-side sorting via Firestore composite indexes.

### AI Job Polling
Runway variation jobs and Mubert music generation run as background jobs with scheduled pollers persisting outputs. Long-running external AI jobs must survive the user closing the modal/tab — the background-mode pattern from the variation pipeline (PR #190) is the template.

## Architectural Decisions Worth Preserving

### Effective Claims Pattern
The `effectiveClaims` pattern in `AuthContext` is the cornerstone of the admin impersonation feature. It creates a modified copy of the auth claims with the overridden `coachId`, allowing all downstream components to work without modification. This pattern must be preserved and extended to any new auth-dependent features — including matching Firestore rules grants (see "View as Coach Not True to Coach" above).

### Audit Logging for Impersonation
Every admin impersonation event (start and end) is logged to the `eventLog` collection with a fire-and-forget pattern. This provides an audit trail without blocking the UI. The same pattern should be used for any sensitive admin operations.

### Soft Deletes Over Hard Deletes
The platform uses `isArchived` flags for soft deletion of movements and workouts rather than hard deletes. Firestore rules enforce `allow delete: if false` for these collections. This preserves data integrity and allows for potential recovery. New collections should follow the same pattern.

### Cache Headers: Never Immutable for Metro Bundles
The Metro/Expo export does **not** guarantee a new JS bundle filename on every build, so static assets must never be served with immutable/1-year cache headers — users can get stuck on stale bundles after a deploy. The SPA entry point (`/index.html`), service worker, and manifest are never cached; JS/static assets use short-lived, revalidating cache headers. As of the July booking ship, a service worker additionally auto-reloads open tabs when a new deploy lands; its registration snippet must be injected into **every** exported route page (handled by `scripts/inject_pwa_meta.py`), not just the root — deep-linked routes are their own entry HTML files.

### Share-Link Sanitizer Is a Contract
Public share links go through `resolveShareToken`, which sanitizes workout documents before serving them to unauthenticated users. Every new per-workout or per-movement field that the player needs (swap fields, crop fields, intro announcement, etc.) must be explicitly added to the sanitizer or it will silently vanish on shared links.

### Completion-Write Integrity
Workout completion writes derive `coachId` from trusted server-side data, guard against double submission, and are crash-safe (PR #167). Any new member-initiated write that a coach later reads should follow the same trust model — never accept coach/tenant IDs from the client.

### Dynamic Public Routes Need Hosting Rewrites
The static Expo export only emits HTML for routes known at build time. Dynamic public paths like `/live-session/**` need an explicit Firebase Hosting rewrite to the SPA entry (or a function) or they 404 for direct visits. Any new tokenized/public route must ship with its hosting rewrite.

### Onboarding Progress: Dashboard Card + Dedicated Screen
The coach post-agreement onboarding (PR #223) uses a `CoachSetupCard` dashboard widget that tracks module completion and links to a dedicated `coach-setup.tsx` screen. This card-plus-screen pattern (surface progress on the dashboard, full detail on a separate route) is the template for any future multi-step onboarding or checklist feature — do not embed large step-by-step flows inline in the dashboard.
