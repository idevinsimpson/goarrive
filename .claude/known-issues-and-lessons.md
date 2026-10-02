# GoArrive Known Issues & Lessons Learned

_Last refreshed: 2026-08-18._

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
When PR #207 (playbook live view) merged, a merge conflict in `app/live-session/[sessionInstanceId].tsx` was resolved incorrectly, overwriting the existing 3-state UI (pre-session countdown / active session / post-session) with an earlier version of the file. The clobber was not caught before the prod push; a follow-up fix (2026-07-28 prod push) restored the correct 3-state logic. Lesson: after merging any large feature PR that touches a shared route file, diff the result against the pre-merge HEAD to confirm all pre-existing UI states are intact — especially for files that both the feature branch and main modified independently.

### Coach Setup Persistence: Firestore Permission Denials
The coach-setup guide's 6 modules failed to save any data because the Firestore rules for coach profile/setup documents were missing write access for the coach's own UID. All coach-setup persistence appeared to succeed client-side but silently failed at the rules layer. Fixed by adding the correct Firestore rules grants for the coach setup path. Lesson: whenever a new screen writes to a Firestore path not covered by an existing rule, verify the rules path with a rules-playground test before shipping — silent rule denials have no visible error in the UI.

### Per-Day Module Cards Regressed by Global-Times Refactor
A refactor that introduced a "global times" mode for the playbook scheduling panel accidentally replaced the per-day module card layout with a single global time field, removing the individual day configuration UI entirely. The regression was caught and reverted before coaches widely noticed, restoring the per-day cards (with day-specific time, duration, and workout slots). Lesson: the scheduling panel's per-day module card layout is the UX contract for coaches; any scheduling UI refactor must verify all per-day controls remain visible and functional in the coach scheduling panel.

### iOS Safari Stretches Absolute-Positioned Drop Trays
When a drag-and-drop interaction uses an absolutely-positioned drop tray that covers the viewport, iOS Safari's rubber-band scroll can stretch the tray beyond its intended height, causing layout jitter and mis-positioned drop targets. Fix: pin the tray's height explicitly in CSS rather than letting it grow with content. Lesson: any overlay or drop target that must stay at a fixed visual height on iOS should have an explicit `height` (or `max-height`) set — do not rely on the browser respecting inferred sizes during active drag gestures.

### Staging Combined Build Can Drop Open PRs
The combined staging branch process merges all open PRs onto main before building. If a PR is open but not included in the branch list when the combined build is triggered, its changes are silently absent from staging and can be omitted from the production ship. The folder + playbook icon inline fix (PR on fix/build-folder-icon-inline) was dropped from staging-combined-08012239 this way and had to be re-landed separately. Lesson: before cutting a combined staging build, explicitly enumerate all open PRs and confirm each is included. The standing release policy in `AGENTS.md` codifies this check.

### Music Genre Reverts on Style Switch
`useWorkoutMusic`'s `changeStyle` function ran async and could overwrite a track already attached by `advance()` during `fetchReadyList`, causing the player to revert to the server-supplied style instead of the newly selected one. Fixed (PR #233) by guarding `changeStyle` against overwriting an already-attached track and always using the locally-held `requestedStyle` (not the server fallback) in `attachTrack`. Lesson: whenever a style/mode selector races with an async fetch, the local selected value must win — never let a server response silently overwrite a user-initiated state change.

### Share-Link Sanitizer Must Include All New Share Types
The `resolveShareToken` Cloud Function sanitizes workout documents before serving them to unauthenticated users. When the marketing share type was added (PR #232), the sanitizer needed to be extended to expose `shareType`, `emailGateEnabled`, `ctaConfig`, and `coachId` — without this, those fields were silently dropped for guest visitors. Lesson: any new `shareToken` field that the client needs to render a guest experience must be explicitly added to the `resolveShareToken` sanitizer and its TypeScript `Teaser` interface, not just written to Firestore.

### Subscription Pause/Resume: Coach Ownership Verification
The `pauseStripeSubscription` and `resumeStripeSubscription` callables (PR #233) verify coach ownership by checking that the subscription's `coachId` Firestore field matches the caller's `coachId` claim — they do not trust the client-supplied member ID alone. Lesson: any billing-mutation callable that acts on a member's subscription must verify the calling coach owns that member's record at the function layer, not just in Firestore rules.

### React Native Web: View Wrappers Can Swallow Pointer Events on Pressable Children
On React Native Web, a plain `View` wrapper placed around `Pressable` children absorbs pointer events, silently killing all taps — the Pressables render but never fire. The funnel gender radio (PR #248) was completely non-functional on web for this reason. Fix: add `pointerEvents="box-none"` to the wrapper `View`. Lesson: any `View` that wraps interactive children and behaves as a layout-only container must carry `pointerEvents="box-none"` on web — otherwise taps are swallowed with no visible error.

### Enrollment Funnel Rules Gap Requires Explicit Audit Before Prod Ship
The Phase 4 enrollment funnel introduced several new Firestore collections (`onboarding_submissions`, `drip_email_queue`, `discount_codes`, `playbook_folder_members`) and new access patterns (anonymous create for public funnel, server-only updates via Cloud Functions). A pre-prod audit (`docs/prod-ship-checklist.md`) surfaced rule gaps: guest-onboarding rate limits, `enrollSubscriber` chunking for large member lists, drip dedup across retry windows, and the price fallback on `createFunnelCheckoutSession`. Lesson: any multi-step public funnel that touches multiple new Firestore collections needs an explicit rules audit before prod ship — enumerate every (role × collection × operation) combination, because public-create paths in particular are easy to leave over-permissioned or under-protected.

### Unauthenticated Funnel Read: Callable Projection Over Direct Firestore
The Phase 4 onboarding wizard and checkout page needed to read `playbook_folders` — a coach-owned collection — for unauthenticated visitors. Opening that collection to unauthenticated reads in Firestore rules would have over-permissioned it. Instead, PR #252 added `getFunnelFolder`: a public callable that reads the doc server-side with the admin SDK and returns only the fields the funnel UI needs (folder name, subscription paths, cover image). Firestore rules were not touched. Lesson: when public visitors need data from a coach-owned collection, use a callable with explicit field projection rather than relaxing Firestore rules — this keeps the collection private for direct reads and makes the exposed surface auditable in one place.

### iOS Safari Canvas PiP: Hidden Canvas Does Not Populate MediaStream
During Phase 2 PiP QA (PR #251), it was discovered that a canvas element with `display:none` or `visibility:hidden` does not produce frames in its `captureStream()` MediaStream on iOS Safari's WKWebView — the stream exists but carries no video. The capture canvas therefore remains off-screen but present in the rendering tree. PR #271 later removed the visible green debug thumbnail and its rAF mirror from `WorkoutPlayer` while preserving the off-screen capture canvas, hidden video handoff, and PiP stream; the current `usePipCanvasStream` API has no debug-visibility flag. Lesson: keep the capture source renderable for iOS, but separate that requirement from temporary user-visible QA overlays and remove those overlays after verification.

### `/ship` Still Mandates a Retired Relay Smoke Test — Documented Deadlock
**`.claude/commands/ship.md` and `.claude/relay-handoff.md` directly contradict each other, and following the former as written cannot terminate.** Found 2026-08-15; **not fixed here**, because editing a command that governs deploys is a process change.

`relay-handoff.md:3` records Devin's own decision verbatim: *"Relay/Manus automated smoke tests are RETIRED (Devin, #goarrive-notes, 2026-08-11 ~11:40 AM ET: 'Relay no longer does smoke tests. Devin will do them.'). Do NOT mention `<@U0B1YQS8L12>` (Relay) after staging deploys — **it will not respond**."* Line 38 repeats it: *"Never ping Relay — retired 2026-08-11."*

`ship.md` was not updated to match. Step 4b is headed **"Trigger Relay Smoke Test (MANDATORY — do not skip)"**, line 79 posts `<@U0B1YQS8L12> smoke test —`, and the step then says *"Wait for Relay's response in the thread"* and *"Do not create a PR until the smoke test passes."* Step 4a is likewise **MANDATORY** and still runs `scripts/update-briefing-doc.js` to prepare context for Manus (the script does still exist).

**The failure mode is a guaranteed hang, not a wrong result.** An agent following `/ship` literally will deploy to staging, ping a bot that is documented as never responding, wait on a thread reply that cannot arrive, and then refuse to open a PR — with every blocking step labelled MANDATORY. Nothing in `ship.md` provides a timeout or an escape.

In practice the requirement is already dead: the 2026-08-14/15 staging deploys were carried out and reported without any Relay step, and no one noticed the omission. That is precisely how a stale mandatory instruction stays dangerous — it is silently ignored until someone follows it faithfully, and the person who does is usually a fresh agent with no context for why everyone else skips step 4.

**Lesson: retiring a workflow means removing it from the files that execute it, not only from the files that describe it.** The retirement note landed in the handoff doc, which is read for context; it never reached the command file, which is read for instructions. When a decision retires a step, grep for the step's identifying token — here `U0B1YQS8L12` — and fix every hit, or the retirement is only half-applied.

### The Canvas PiP Path Is Not Gated on iOS — It Is Unfinished
Recorded 2026-08-15 while deciding between the canvas-PiP and pre-rendered-video architectures. An earlier version of this entry claimed `usePipCanvasStream` disables itself on iOS through two independent gates. **That was wrong, and the correction inverts the conclusion:** the hook is not disabled on iOS at all. It runs, on every environment we device-test in, and the composite it produces is simply never shown to anyone.

**There is exactly one gate, and it passes.** `usePipCanvasStream.ts:87` feature-detects: `if (!('captureStream' in HTMLCanvasElement.prototype)) return;`. PR #236's description states the rationale — *"iOS Safari (no captureStream) silently no-ops and falls through to existing behavior."* That premise appears to be false: Safari release notes from 16.4 through 27 contain no *introduction* of `captureStream`, only *fixes* in Safari 17 (*"Fixed MediaStream from a canvas (captureStream) to be able to render into a different canvas"*) and further work in 17.4. A fix implies pre-existence. (Bounded claim: the release-note set consulted starts at 16.4, so the introducing version could not be named.)

**The UA sniff is not a second gate. It is dead code.** `hasWorkingCaptureStream` (`:62`) sets `false` for iP(hone|od|ad) excluding CriOS/FxiOS/EdgiOS, and it has **zero consumers** — three occurrences exist in the whole repository, all inside the hook that defines it: the interface field (`:32`), the computation (`:62`), and the return (`:237`). `WorkoutPlayer.tsx:201` destructures `const { mediaStream } = usePipCanvasStream({...})` and never reads the flag. The "fallback to direct canvas mirror" its comment promises does not exist either.

For the record, since the mis-citation sent one investigation down the wrong path: the comment describes WebKit bug 181663 as *"captureStream() returns a stream whose video track never emits fresh frames."* The bug's actual title is **"Video Element cannot playback local Canvas.captureStream on iOS"** — a `<video>` playback failure, not a frame-emission failure. Current WebKit source shows no MediaStream restriction in `MediaElementSession::allowsPictureInPicture()`, and both `hasMediaStreamSrcObject()` call sites there are permissive.

**What actually runs today.** `pipEnabled = isStagingHost() && workoutFlags.pipCanvasEnabled` (`WorkoutPlayer.tsx:191`), with the flag hardcoded `true` at `:81`, and `enabled` is never gated on `isPiP` (`:202`). `isStagingHost()` (`lib/runtimeEnv.ts:9`) is true for `__DEV__`, localhost, hosts containing `staging`, **and every Firebase Hosting preview channel** (`host.includes('--')`). So from player mount onward, on every environment used for device testing, there is a 30fps `requestAnimationFrame` loop plus a hidden `<video>` at `left:-10000px` playing a MediaStream that carries live copies of the voice and music buses. It is set to `vid.volume = 0` (`:249`), which iOS ignores — see the native-volume entry below.

**And nothing ever presents it.** There is one `requestPictureInPicture()` call in application code, `WorkoutPlayer.tsx:718`, and it targets `getDomVideo()` (`:694`) — the expo-av movement `<Video>`. The `webkitSetPresentationMode` branches at `:715` and `:719` target that same element. `pipCanvasVideoRef` is created (`:217`), given `srcObject` (`:248`) and played (`:250`), and is then never handed to PiP. This is why the 2026-08-15 device test produced a PiP tile with the bare movement video and no timer, title, next-up or music: the button does exactly what it did before #236 landed.

**That reframes the architecture question.** The canvas path is not blocked by an iOS platform gate — it is unfinished by one missing call, and *"does iOS allow a `<video>` playing a canvas `captureStream` to enter PiP"* has never been asked on a device, because nothing has ever tried. A standalone spike page remains the way to answer it; as of this writing no such page exists in git, and `firebase.json`'s catch-all rewrite (`{"source": "**", "destination": "/index.html"}`) makes a missing spike URL serve the app rather than 404, which already cost one device session.

**Three lessons.** A capability gate should record *what was observed*, not a second-hand bug summary — the summary here drifted from the bug's actual claim and aimed a whole investigation at the wrong mechanism. A UA sniff written against a platform bug needs a re-test date attached; this one silently outlived the behaviour it was written for by several major versions. And most cheaply of all: **a flag that is computed but never read is not a gate.** Before describing any code path as disabled, grep for the consumer. This entry asserted a gate that a single grep would have disproved, and asserting it made a running feature look switched off.

**Status after PRs #289 and #290 (2026-08-18):** Both issues identified above are now resolved. PR #289 added the `isPiP` gate — `usePipCanvasStream` and the hidden `<video>` are now inert until the member is actually in Picture-in-Picture mode, so the 30fps rAF loop and MediaStream fan-out no longer run unconditionally. PR #290 (passes 2–22b) added `requestPictureInPicture` targeting `pipCanvasVideoRef` — the one missing call that was causing PiP to open the bare expo-av movement video instead of the canvas tile. The `hasWorkingCaptureStream` dead-code flag (`:62`) remains unused; it should be removed if the UA-sniff logic is no longer needed. The feature is still staging-gated and awaiting device QA sign-off before production activation.

### iOS Safari Web Audio Graph Suspends on App Backgrounding
When an `HTMLAudioElement` is wrapped in the Web Audio graph via `createMediaElementSource`, iOS Safari suspends it the instant the user backgrounds the app (exits to the home screen or switches to another app). Tab-switching within Safari does not trigger the suspension. The Web Audio `AudioContext` is subject to iOS background-app suspension; the native `HTMLAudioElement` pipeline is not, because iOS keeps it alive via MediaSession. PR #258 moved voice-bus elements onto the native path. PR #259 then merged a v3 dual-element music handoff: foreground music stays on the graph for the player controls, while a gesture-blessed native shadow element takes over in the background. Exact-head staging and physical-iPhone Case D passed, but the test still observed an audible volume jump at the handoff; a fast-follow correction has not been built. Production handoff remains off by default, and the attempted production hotfix stopped on conflicts with the cherry-pick aborted and no deploy. Lesson: test continuity and perceived loudness separately across both handoff directions, and never equate a merge or physical-device proof with production activation.

### Plaintext Credentials Must Not Appear in Docs
Commit `8ae995e` removed plaintext credentials from `.claude/relay-handoff.md`. No broader cleanup of seed scripts, setup guides, or service-account snippets is attributed to that commit without separate evidence. Lesson: docs in the repo are public — never include passwords, API keys, or service-account JSON snippets in any `.md` or doc file; reference environment variables or Secret Manager paths instead.

### iOS Native Audio Element Ignores `element.volume`
When `HTMLAudioElement` is played via the native pipeline (not wrapped in the Web Audio graph), iOS ignores programmatic changes to `element.volume` — the property appears to set but has no audible effect. This means the v3 blessed-shadow music handoff (#259) keeps music alive through app-backgrounding but plays at full track loudness regardless of the member's in-app slider. The accepted fix is the volume-bucket system (PRs #273/#276/#277): `generateMusicVolumeVariants` pre-renders multiple loudness variants of each Mubert track server-side, and the client picks the variant closest to the slider value at handoff time. Lesson: any audio feature that routes through the native `HTMLAudioElement` pipeline for iOS backgrounding survival must implement loudness control through pre-rendered variants, not `element.volume`.

### Modern pnpm Blocks Postinstall Scripts by Default
Cloud Build began failing because `ffmpeg-static`'s postinstall never ran, so the binary
was missing from the deployed package and `generateMusicVolumeVariants` failed at runtime
with `ffmpeg ENOENT`. Recent pnpm majors block lifecycle scripts for packages that are not
explicitly allowlisted.

What actually fixed it, verified against the repo: **PR #280 pinned the package manager**,
via the `packageManager` field — `functions/package.json:36` reads `"packageManager":
"pnpm@9.15.9"`. **PR #279's allowlist approach did not take.** There is no `.npmrc` and no
`.tool-versions` anywhere in this repository, so do not go looking for them; an earlier
version of this entry cited both and sent readers after files that do not exist.

Lesson: when a project depends on native-binary npm packages (`ffmpeg-static`, `sharp`,
`canvas`), a pnpm major upgrade can silently stop their postinstall. Verify the binary
exists in the built package before deploying — `test -x node_modules/ffmpeg-static/ffmpeg`
— rather than trusting a green install.

### A Paused Element That Must Take Over Instantly Needs a Warm Buffer
The v3 blessed-shadow handoff (#259) keeps a native `HTMLAudioElement` paused in the
foreground and starts it at the hide seam. Devin heard a ~1s silence on backgrounding.

**The cause was buffering, not permission.** The shadow was already gesture-blessed — that
`play()` shipped with #259 — so autoplay was never the issue. It was simply paused with no
`preload`, so mobile Safari kept it at metadata-only; asking it at the seam to seek to an
arbitrary mid-track position and play cost a range request plus a decode before any sound
emerged. #284 set `preload='auto'` and made the position tick variant-aware.

**The follow-on mistake is the more useful lesson.** #284's tick re-seeked whenever drift
exceeded 100ms — but a *paused* element never advances, so drift grew a full second every
tick and the condition was true every single time. Each seek restarted buffering before the
previous fetch landed, so the element stayed permanently cold: a warm-up routine that
guaranteed coldness. #285 replaced it with a check against what the element has *actually*
buffered, plus a cooldown so it cannot re-seek mid-fetch.

Lesson: keeping a paused media element ready means maintaining a *buffer* around the
takeover position, not repeatedly assigning `currentTime`. Seeking on a timer defeats the
buffering it is meant to produce. Verify warmth by reading `buffered`, never by inferring
it from the absence of a symptom.



### Canvas PiP Hook Starving Foreground Music (Resolved by PR #289)
Verified 2026-08-15: the always-on `usePipCanvasStream` silenced `musicGain→destination` on every staging/preview environment. The hook ran unconditionally from player mount — before the member ever tapped the PiP button — and the MediaStream fan-out connected to `mediaStreamDest` caused the music gain node to stop routing to the speaker destination. The mechanism was never fully isolated (destination vs. `mediaStreamDest` contention was hypothesized but not formally proven).

Fixed in PR #289 by gating the hook and its hidden `<video>` behind `isPiP`. The hook is now inert until PiP is actually active, so the fan-out only runs when it is needed.

Lesson: any hook that sets up a MediaStream or Web Audio routing must be gated on the user action that activates it. An unconditional hook that attaches to the audio graph from mount can silently alter the routing for all other consumers, with no error visible in the UI. Verify fanout routing behavior against speaker output, not just against the stream output.

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
Public share links go through `resolveShareToken`, which sanitizes workout documents before serving them to unauthenticated users. Every new per-workout or per-movement field that the player needs (swap fields, crop fields, intro announcement, share type, email gate config, etc.) must be explicitly added to the sanitizer or it will silently vanish on shared links.

### Completion-Write Integrity
Workout completion writes derive `coachId` from trusted server-side data, guard against double submission, and are crash-safe (PR #167). Any new member-initiated write that a coach later reads should follow the same trust model — never accept coach/tenant IDs from the client.

### Dynamic Public Routes Need Hosting Rewrites
The static Expo export only emits HTML for routes known at build time. Dynamic public paths like `/live-session/**` need an explicit Firebase Hosting rewrite to the SPA entry (or a function) or they 404 for direct visits. Any new tokenized/public route must ship with its hosting rewrite.

### Onboarding Progress: Dashboard Card + Dedicated Screen
The coach post-agreement onboarding (PR #223) uses a `CoachSetupCard` dashboard widget that tracks module completion and links to a dedicated `coach-setup.tsx` screen. This card-plus-screen pattern (surface progress on the dashboard, full detail on a separate route) is the template for any future multi-step onboarding or checklist feature — do not embed large step-by-step flows inline in the dashboard.

### Coach-Branded Intake Deeplinks and Program Attribution
The intake route (`/intake/[coachId]`) accepts `?ref=` and `?source=` URL params so external booker pages (e.g. `bookerfitness.goarrive.fit`) can pass session-type context through the intake flow. Both params are saved to `intakeSubmissions` as `programRef` / `programSource`. The intake form header swaps the GoArrive logo for the coach's name and photo when a `coachId` is present (fetched from Firestore). Lesson: any new public intake or landing surface that originates from a third-party or coach-branded URL should capture the originating ref/source at submission time and write it to the intake record — retro-fitting attribution is expensive once the param is lost at page load.

### Audio Fan-Out Pattern for PiP
The audio PiP foundation (PR #231) uses parallel fan-out: `voiceGain` and `musicGain` connect to both `audioCtx.destination` (speakers) and a `MediaStreamAudioDestinationNode` (PiP stream). This keeps the speaker path unchanged while adding a second output. The `getPipAudioStream()` export is the handshake point for Phase 2 canvas-stream PiP. Lesson: when adding a second audio consumer (recording, PiP, monitoring), always fan out from the existing gain nodes rather than rerouting — rerouting risks breaking the speaker path and requires re-testing all iOS audio unlock behavior.

### New Firestore Collections Need Rules + Admin-Impersonation Grants
Every new top-level Firestore collection (e.g. `playbook_folders`, `playbook_folder_members`, `marketing_leads`) must ship with: (a) Firestore security rules covering all access patterns (coach-owner read/write, member-scoped read, optional public create), and (b) admin-impersonation rules grants so platform admins can access coach-scoped data when using "View as Coach." Missing either causes silent failures that only surface under the affected auth context.

### Prod-Ship Checklist for Feature Phases
`docs/prod-ship-checklist.md` is now the durable ledger for REQUIRED-BEFORE-PROD flags surfaced during staging audits (e.g. price fallback, chunking limits, dedup logic, rate limits). When a multi-phase feature ships to staging and an audit surfaces blockers, log them in this file immediately so they are not forgotten between staging and prod. Do not keep these flags only in PR descriptions — PR descriptions are archived on merge.

### Public Coach-Owned Data: Use Callable Projection, Not Rule Relaxation
When an unauthenticated surface (public funnel, share link, booking page) needs to read data from a coach-owned Firestore collection, do not open that collection to unauthenticated reads in security rules. Instead, create a callable (e.g. `getFunnelFolder`, `resolveShareToken`) that reads with the admin SDK and returns only the fields the client needs. This keeps collection rules strict, makes the exposed surface auditable in one place, and prevents accidental over-exposure of coach data. See PR #252 for the `getFunnelFolder` pattern.

### iOS Safari Permits Backgrounded `play()` on a Never-Loaded `src` (device-verified)
**A gesture-blessed `HTMLAudioElement` can be given a brand-new `src`, `load()`ed, and `play()`ed while the app is backgrounded, with no user gesture anywhere near the call — and iOS Safari allows it.** Device-verified on Devin's iPhone 2026-08-15 via PR #287; the blessing from the original Start tap survives a source change.

This was genuinely unknown before that test, and it is not obvious: `load()` resets `readyState` to `HAVE_NOTHING`, and iOS generally treats a source change as a *new media load* rather than a continuation, which is exactly the situation where autoplay blessings are normally dropped. The conservative assumption — that only a *resume* of already-loaded media would be permitted — turned out to be wrong in our favour.

Record it because the cost of re-deriving it is high and asymmetric. No code had ever attempted a backgrounded fresh-`src` play, so nobody could observe it; the design work stalled on the unknown, and a MediaSession `nexttrack` fallback was scoped as Plan C purely to survive a refusal that never came. **Do not rebuild that fallback** — it exists only to solve a problem iOS does not have.

Lesson beyond this API: when an unknown gates a design, prefer the cheap probe that produces the answer over the elaborate fallback that survives either answer. The probe here was one log line at one track boundary. Note also the corollary — a probe only answers the question it actually asks: a same-`src` replay would have cleared a *weaker* permission bar and produced a false green, licensing plumbing that could still have failed on the real path.

### Media Listeners Must Live on Whichever Element Is Actually Playing
The v3 handoff has two music elements — a graph-wired `audible` one for the foreground and a blessed native `shadow` one for the background — and the hide seam **pauses the audible** when handing over. Any listener that drives application state must therefore be attached to *both*, or the app goes deaf the moment ownership moves.

This bit us concretely: `ended` (which advances the playlist) lived only on the audible element. While backgrounded that element is paused, and **a paused media element never fires `ended`** — so the shadow played the current track to its end and then simply stopped, with nothing to advance it. Returning to the app resumed the audible at the shadow's position, which immediately hit the end, fired `ended`, and advanced — which is why the symptom presented as "music stops when the track switches" and recovered on re-entry. The track was never switching at all. Fixed in PR #287 by giving the shadow its own `ended`/`error` handlers, guarded by element identity and `inBackgroundRef`.

Two design rules fall out. **When you add a second element that can own playback, audit every listener on the first one** and decide explicitly whether it needs a twin — the failure is silent and only appears at a boundary the tests never reach. And **a handler that can trigger a retry cascade needs a circuit breaker**: `error → advance → error` would have burned an entire playlist in seconds with the real first cause buried at the top of the log, so #287 caps consecutive failures and stops.
