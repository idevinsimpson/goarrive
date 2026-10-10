# GoArrive Known Issues & Lessons Learned

_Last refreshed: 2026-10-10 (22:20 ET)._

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


### WSF Staging Proof Sequence Must Be Derivable on Any Writer Run, Not Only at Deploy Time (PR #557)
A fast-path staging deploy (run 60) succeeded and served the exact target, but the proof sequence — begin-proof, R-STAGE, proof-pass — was never derived automatically. Three separate gaps blocked derivation: begin-proof had no deriver at all; the R-STAGE rule read `snap.staging`, which is populated only by the full-path writer, never by the fast-path target flow; and proof-pass was only suggested to L0 rather than derived. The result was four proof lines that had to be recorded by hand, leaving the control-state ledger in a half-committed state until manual intervention.

The fix (`shadow.mjs` `stagingProofLines`) derives the proof sequence on any writer run — scheduled fallback, comment, PR event, or `workflow_run` — by reading the ledger's staging target, the newest concluded-success deploy-mode run whose title names that target, and the hosted `/health` marker. It derives only the lines the packet still lacks and sources each on the `workflow_run`. `set-staging` is intentionally not derived: moving the full-path staging pointer to a fast-path target would make every subsequent fast-path candidate `FULL_PATH_REQUIRED`, which is reported as a separate consequence.

A W4 test-fixture finding (commit `cc180898`) surfaced a related gap: the wrong-marker test used an unrelated SHA as the "bad" marker case, but the realistic wrong-marker situation after a successful run is staging still serving the previous build — the ledger's `staging.servedSha` or `staging.rollbackSha`. A mutant that accepted the broader freshnessFacts served set passed unnoticed until the fixture was corrected to use those realistic markers.

Lesson: a proof sequence that requires manual recording after every automated deploy is a broken proof sequence. Every step needs a deriver that fires from observable state — here a deploy run ID and a hosted marker — rather than waiting for a human gesture or a future L0 suggestion. When adding a new proof step, verify at write time that all inputs to derive it are readable from the writer's event payload, not from ledger fields that only get populated on a different code path.
### WSF Staging Pin Generator Must Derive Baseline from Ledger, Not from a Computed Add Count
The staging pin generator (STAGING-PIN-FASTPATH-SERVED-BASELINE-1, PR #565) was computing the served baseline as a derived value (e.g. current served plus items the PR adds) rather than reading what the ledger actually records as the live baseline. This caused fast-path preflight comparisons to check against an inflated baseline — as if items being introduced by the PR were already present on the live site — making genuine fast-path candidates appear to exceed the baseline and triggering unnecessary full-path deploy fallbacks.

The fix reads the baseline directly from the ledger's authoritative served record. Lesson: a pin generator that computes what *will* be served after a successful deploy is predicting a future state, not describing a current one. Any metric that gates a fast-path preflight must be read from the ledger's recorded state, not derived from the pending delta. This is the same root class as the STAGING-FASTPATH-INVENTORY-BASELINE-FIX (#555) that corrected the preflight itself — both bugs let a predicted post-merge count masquerade as the actual live baseline.


### WSF Staging Pin: Superseded Never-Served Approvals Must Be Recorded Truthfully (PR #570)
The pin generator was not handling the case where an approval was generated and accepted but then superseded by a newer candidate before it was ever deployed to staging. The old approval remained visible in the ledger as if it were still active, conflicting with the newer approval and creating ambiguity about which candidate the ledger actually endorsed.

The fix (commit `c70edcb5`) explicitly records superseded never-served approvals as such when the generator advances to a newer candidate. It does not overwrite the superseded entry — it annotates it so the ledger history remains truthful and downstream preflight checks are not confused by two live-looking approvals.

Lesson: a staging approval captures intent at a point in time. When a later candidate supersedes it before any deploy occurs, that fact must be written to the ledger — not silently overwritten, and not left as an open approval. Two open approvals pointing at different candidates will cause preflight and proof-sequence checks to fail on the wrong target. The invariant to enforce: at most one approval per staging slot can be in a non-terminal state at any time; when a new approval advances, all prior approvals for the same slot must be closed with a superseded-never-served annotation if they were never served.

### WSF Staged Journey Suites Need Wording-Variant Seeded Defects, Not Just Behavior-Boolean Ones (PR #573)
The EXPO-LATEST-FULL-STAGING-PIN-1 suite (PR #573) added closed-goal journey drivers that proved all five queue-gate refusals emulator-side. Nine seeded defects initially covered gate-skip and post-advance-refusal cases. A W4 mutant audit (#394) then found that dropping the sentence-level text checks for each refusal message left the full suite green — meaning mutants that refused in wrong words, or that let a Start refusal end the turn instead of holding it, passed without detection.

The root cause: boolean coverage (refused / did not refuse) proves the gate exists; it does not prove the gate says the right thing. A user who hits a refusal that says "No seats available" when the event is closed, or whose turn ends instead of being held at a Start refusal, sees a broken product even if the gate fired. Five additional wording-variant defects (one per gate: start, ready, call, join, closedStartEndsPlace) corrected this — each fails exactly its own row, and W4 mutants D1, D3, D4, D7, and D11 are now killed.

Lesson: when seeding defects for any gate that produces user-visible copy, always include at least one wording-variant defect alongside the boolean skip. The two failure modes — gate absent vs. gate present but wrong copy — are independent, and a suite that only kills one is half-verified. This applies to any error, refusal, or confirmation message the suite reads from the screen rather than from Firestore directly.

### WSF Control Writer: Ascending-Page Probe Copies Are Unsafe for Window-Building Under Concurrent Arrivals and Deletions
The GitHub `recentComments` reader (`tools/wsf-control/github.mjs`) builds a bounded window of the N newest comments for a conversation. The original approach probed pages in ascending order starting from the estimated last page, keeping each page's response as the window was filled backward. A W9 finding (#497, comment 6019310772) identified a correctness gap: if a new comment arrives after the initial count read (rolling onto a further page that the ascending probe then reads), and an older comment is deleted between two probe page requests, the newest comment can shift onto a page already consumed by the probe — silently absent from the window with no error or signal.

The fix (PR #579, CONTROL-RECENT-COMMENTS-SAFE-READ-1) separates the end-finding step from the window-building step. The forward ascending probe runs only to find the actual last page and its result copies are immediately discarded. The window is then built from a fresh descending read starting at that end page, walking toward older pages. Reading newest-to-oldest means a mid-read deletion can only shift a held comment onto an earlier page (caught by dedup on comment id) — the newest comment is always on an already-read page and cannot be skipped. The regression test for W9's exact case fails on the prior commit and passes on the fix; a mutant that trusts the probe copies again is killed by that test alone.

Lesson: when reading a paginated API feed with an estimated starting page, the ascending probe is safe for end-detection but not for content collection — probe copies can be stale relative to later pages by the time the window is assembled. Separate end-finding (forward probe, disposable results) from window-building (fresh descending read), so every page in the final window is read after every later page.

**Transport hardening addendum (PR #581):** a follow-on W4 review found two remaining gaps. The GitHub API page size was left at the default (100), so a transient network failure on a single page fetch could lose up to 100 comments' worth of window — reducing the page size to 25 shrinks that blast radius without changing the correctness fix. A GET retry was also added, but only for explicit transport failures (network timeouts, connection resets); logical failures such as a wrong marker or a bad pagination state do not retry and fail closed immediately. Retrying on logical failures would loop a misconfigured caller against the API without producing a correct window. Rule: any retry in a paginated read must distinguish transport failures from logical ones — transport errors may succeed on retry; logical errors require a caller-level fix.

### WSF Control Writer: A State-Mutating PATCH Must Not Retry on Transport Failure (PR #588)
`editComment` (`tools/wsf-control/github.mjs`) was treating a PATCH 404 as success and had no defined behavior for transport failures. Run 37661819992 surfaced this when a `TypeError: fetch failed` at the shadow CURRENT PATCH left the control writer in an undefined state.

The correct behavior for a state-mutating PATCH that fails at the transport layer is to **read back, not re-send**. Re-sending risks double-application: the write may have landed on the server even if the response never returned. The fix sends the PATCH exactly once, then on transport failure reads the comment back via GET to confirm whether the edit was applied. If the exact body is found, it returns 'confirmed-by-readback'; if not, it throws an unconfirmed error — never retransmitting.

The fix also separately handles HTTP error statuses (404, 4xx, 5xx), which previously could be silently swallowed. A PATCH that returns 404 means the target resource does not exist; treating it as success hides the problem. Each failure class now has an explicit outcome: 2xx returns 'acknowledged' without parsing the body; non-2xx throws `GitHubError`; transport failure triggers one read-back attempt; programmer errors rethrow immediately.

Lesson: a state-mutating API call (PATCH, PUT, POST, DELETE) is not safe to retry on transport failure — the write may have landed. The correct recovery is a read-back to confirm the current state, with the retry decision made from what was observed, not from the failure class. Distinguish transport failures (where a read-back makes sense) from HTTP error statuses (which are definitive answers) and programmer errors (which should propagate immediately). This is the same principle as idempotency keys for public write endpoints, applied to internal writer calls that cannot carry a client-supplied key.
### WSF Lovable Kiosk Hosted Proof: A Bind Step Alone Does Not Bind What the Browser Executes (PR #589)
The LOVABLE-KIOSK-HOSTED-PROOF-1 proof mode (PR #589) introduced a served-code guard after W9 finding #497 identified a gap in the original design. The `--bind` step hashes the entry page and every same-origin asset from a single HTTP fetch and compares the set to a pinned `REVIEWED_BUILD`. That check is sufficient to block a run if the host has drifted since review — but it checks a **fetch the proof script made**, not what the browser actually loads during the journey. The Lovable host is mutable: a new publish could land between the bind and the first page navigation; the entry page could inline a script that was not fetched during the walk; a lazily-loaded script from another origin could load after the initial walk was complete. Any of these would let unreviewed code execute in a browsing context that holds a live Firebase credential.

The fix is a **served-code guard** on every browser context: Playwright routes every request through `codeGuard`, service workers are blocked so none can intercept around it, every document and `/assets/` script or stylesheet from the Lovable host must carry its reviewed digest and is fulfilled with exactly the hashed bytes, and anything else executable is refused. A refusal stops the journey before the next step — the kiosk is never approved and no password is typed into an unreviewed page. `host-build` is PASS only when the bind matched **and** the browser loaded at least one verified document **and** nothing was refused.

A further precision (W4 finding #394, Director finding #365): exchanged callables must be paired by request identity — each exchange is the request the page sent paired with that specific request's own response, not a later response to a different request. The entry-page digest and the asset manifest must both be pinned together; assets without an entry digest are BLOCKED, so an inline-script change in `index.html` cannot pass even if every asset digest matches.

**`REVIEWED_BUILD` is empty in the shipped change by design.** The first dispatch stops at the credential-free gate, prints the observed manifest, and a separately-reviewed commit pins it. This prevents the same commit that writes the proof from self-approving the build it will run against — an observed digest is evidence for review, never self-approval.

Lesson: a hosted proof that audits a mutable third-party host must bind what the browser actually loads during the journey, not only what a pre-run HTTP walk observed. The two can diverge on any publish, lazy load, or cross-origin script. Implement the guard at the Playwright request-routing layer rather than as a pre-check, and route every browser context through it so no context can run unguarded. A refusal must stop the journey immediately — never record a result from a context that loaded unreviewed code.
### WSF Production Firebase Inventory as Pre-Activation Gate (PR #599)
Before activating staged WSF features in production, PR #599 (PRODUCTION-FIREBASE-INVENTORY-1) established a read-only production Firebase inventory pattern: owner readbacks confirm which service account owns each deployed Cloud Function revision; invoker truth records which callables carry the `allUsers run.invoker` binding; and deploy stoppers identify conditions — missing IAM grants, conflicting function names, version mismatches — that would prevent a safe deploy. Running this inventory against production before any WSF activation deploy provides a baseline that distinguishes expected state from unexpected drift.

This is especially important for the single-project setup: `.firebaserc` declares a single `goarrive` project, so any Functions or Storage Rules deploy is live on production immediately. A callable that acquires `allUsers run.invoker` is publicly callable the moment it deploys; knowing the pre-deploy invoker state is the first line of defense against unintentionally making a new callable public.

Lesson: for any staged feature that introduces new Cloud Functions or changes invoker bindings, run a read-only production inventory immediately before deploying and compare against the expected state. Fail the deploy if any invoker binding or function owner deviates from the plan.

### WSF Staging Pin: Adversarial Review Must Land Corrections Before QA Record Is Finalized (PR #597)
The EXPO-FULL-STAGING-RECOVERY-4 pin (PR #597) required an adversarial review pass that returned corrections before the QA record was finalized and the pin was accepted. The pin also proved a three-link never-served chain — a candidate that superseded two prior never-served approvals in sequence — making the approval lineage more complex than the normal single-link case.

The pin generator must handle bounded inner-link chains correctly so the ledger records the full supersession history. A pin that arrives via adversarial review should not be assumed stable until the QA record commit is present; if the review catches issues requiring corrections, those corrections must land as separate commits before the pin is finalized.

Lesson: do not co-author a pin commit and a corrections commit — keep them separate so the ledger's correction history is explicit. The adversarial review exists to catch problems the original author missed; collapsing corrections into the original commit defeats that audit trail.

### WSF Control Writer: Non-Writer Workflow Runs Must Not Share the Control-Writer Concurrency Group (PR #603)
The `wsf-control-writer` GitHub Actions concurrency group serializes writer runs to prevent concurrent state mutations on the ledger. If a non-writer workflow — a PR check, a scheduled job, or an unrelated workflow dispatch — uses the same concurrency group name, it can cancel a queued writer run the moment it starts. The writer's pending state mutation is silently dropped: no error, no retry, just a run that never executed.

The fix (WRITER-CONCURRENCY-1) conditions the concurrency group assignment so only genuine writer runs enter the group. Non-writer runs receive a null or unique group name, which GitHub Actions treats as no concurrency constraint — they queue independently without competing for the writer slot.

Lesson: a GitHub Actions concurrency group protects a resource by serializing access — but only among runs that actually need that resource. Any workflow that shares the group name becomes a contender, not just a bystander. When a new workflow is added to a repository that uses named concurrency groups for critical serialized writers, explicitly verify whether the new workflow should enter those groups. The failure mode (queued writer cancelled silently) is non-obvious because the cancelled run leaves no error in the context of the writer — it just disappears from the queue.

### WSF Staging Drivers Must Be Kept in Sync with Their Feature Baseline (PR #604)
STAGING-TURN-DRIVERS-1 (PR #604) surfaced that staging test drivers for the WSF kiosk turn lifecycle had not been updated when the underlying feature (KIOSK-EXPECTED-TURN-1, PR #587) shipped. The driver suite was testing behavior from a prior baseline, so run 61's failures were driver/feature mismatches rather than genuine regressions in the new feature.

The fix brings the turn-row and expo drivers forward to the #587 baseline and documents run 61's root causes so the failure pattern is recoverable.

Lesson: when a feature changes the observable contract of a kiosk journey step, the staging drivers for that step must update in the same PR or the immediately following one — not in a catch-up PR later. A stale driver does not merely fail to catch regressions; it actively produces false failures that cost investigation time on the new feature and erode trust in the suite. The discipline: for every PR that changes observable behavior at a journey step, name the driver rows that cover that step and confirm they are updated.

### WSF Callables Must Refuse Anonymous-Provider Firebase Tokens (PR #601)
Firebase allows anonymous sign-in, which creates a real UID with `providerData` empty or set to the anonymous provider. A callable that only checks `context.auth != null` will accept anonymous callers, letting unauthenticated visitors fabricate a token and call business-logic endpoints.

ANON-GATE-1 (PR #601) adds an explicit anonymous-provider check at every WSF callable auth site. The check runs before any business logic and rejects the call immediately when the caller's token carries the anonymous Firebase provider.

Lesson: for any WSF callable (or any GoArrive callable that should be member/coach-only), `context.auth` being present is not sufficient — verify the provider is not anonymous. This is especially critical for callables that write state or read private data, since anonymous Firebase sessions are trivial to create without real credentials.

### WSF LOVABLE-REVIEWED-BUILD-1: Route-Aware Bind and Literal NUL Handling (PR #609)
The `LOVABLE-KIOSK-HOSTED-PROOF-1` bind step (PR #589) was not route-aware: it bound the entry page as a single blob. If the Lovable host serves different HTML per route (e.g. `/` vs `/go/slug`), a new route added after review would have a different entry digest and could slip through the check unnoticed.

PR #609 makes the bind route-aware — each route the proof exercises is bound individually, so a post-review route change is caught per-route rather than masked behind a shared entry hash.

A second gap: the original guard treated NUL bytes (`\x00`) as whitespace or stripped them before hashing, so an asset with embedded NULs could produce a different digest on the serve than on the bind walk. The fix takes NUL bytes literally in both the bind and the guard so digests are byte-exact.

The host's `~flock.js` was blocked explicitly because it is executable and was not present in the reviewed asset set.

Lesson: a bind step that hashes a multi-route host must bind each route the journey visits, not only the root. Any byte normalisation (whitespace collapsing, NUL stripping) in a content-addressing step introduces a gap between what was reviewed and what is verified at runtime — use raw bytes throughout.
### WSF Lovable Device Matrix: BLOCKED Rows Must Name the Reason and Unblocking Condition (PR #614)
When LOVABLE-MATRIX-ALIGN-1 realigned the device matrix with served build `db3fd2f2`, a W3 open-item review found that several BLOCKED kiosk station rows lacked explanations — they were recorded as BLOCKED but gave no indication of why or what change would unblock them. An engineer picking up the work had no way to know from the matrix alone whether their change addressed the blocker.

The fix (commit `bab7e980`, "say what the kiosk station rows actually lack") adds explicit gap descriptions to each BLOCKED row.

Lesson: in any staging device matrix or proof-row table, a BLOCKED status without a reason is an incomplete record. Every BLOCKED row should state (a) what specific condition blocks it and (b) what feature, PR, or prerequisite is expected to unblock it. This applies both when the matrix is first written and during any realignment pass — updating passing cells without updating BLOCKED reasons leaves the matrix partially stale.

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

### WSF Control Writer: A Pooled HTTP Connection Can Stall a State-Mutating PATCH for the Full Client Timeout (PR #591)
`editComment` was issued through undici's pooled HTTP connection. Runs 37671900853 and 37672822242 each spent ~315 s waiting for a status line that never arrived — exactly undici's 300 s header timeout — before the ACK-1 read-back correctly refused success. The cost was a near-full-run delay on every affected invocation.

The failure mode: a pooled connection can carry the request to the server but fail to return a status line if the underlying socket went half-closed after the pool acquired it. Undici waits until its own default timeout; there is no shorter per-request deadline by default.

The fix (`sendOnce`, PR #591) sends the PATCH on its own fresh connection: `node:https` with `agent: false` (no pool), `Connection: close`, and a byte-exact `Content-Length`, settling on the first status line within `PATCH_TIMEOUT_MS` (30 s). The body is never read — only the status code matters. A transport failure, deadline expiry, or connection close before any status line rejects with a `TransportError` code; the ACK-1 read-back path then determines whether the edit landed. HTTP redirect answers (3xx) now fail closed rather than passing silently through the 2xx check. GET and POST paths are unchanged and continue to use the existing `fetchImpl`.

Lesson: a state-mutating HTTP call that must not be retried also must not be allowed to hang indefinitely. A pooled client's connection-reuse behavior can produce a stall that produces no error and no response — the caller cannot distinguish a hung connection from a slow server without its own deadline. For one-shot PATCH calls, use a fresh connection and a short explicit deadline so the transport layer forces a decision within a bounded window. This is distinct from the retry question (PR #588): that entry covers *not retransmitting* on transport failure; this entry covers *bounding the wait* before a transport failure is even declared.

### WSF LOVABLE-REVIEWED-BUILD-2: A Pin Advance Surfaces Test Coverage Gaps (PR #610)
The initial LOVABLE-REVIEWED-BUILD-1 suite (PR #609) passed the bind and was accepted. When the next Lovable build (`db3fd2f2`) was pinned in PR #610, the test suite required corrections for coverage gaps that REVIEWED-BUILD-1 had not exercised: asset charset declarations were not asserted; events API response ID fields and userinfo endpoint fields were not checked; and BOM bytes (`\xEF\xBB\xBF`) in asset bodies were not handled literally, meaning a build that included BOM-prefixed assets could produce a different digest on the serve than on the bind walk. The hosting preview screenshot URL also embedded a non-normalized filename, causing the bind walk to produce a different asset key than the served path.

Lesson: a proof suite that passes for build N can have undetected coverage gaps that only become visible when build N+1 differs in the uncovered dimension. When advancing a `REVIEWED_BUILD` pin, treat the new pin cycle as an opportunity to audit what the test suite does *not* assert: schema fields present in the new build but absent from test expectations, BOM or charset edge cases in new assets, and any URL normalization assumptions baked into the bind walk. A green suite on the old build does not guarantee the new build is equally covered.

### WSF Operator Access Map Must Precede Any Production Activation (PR #612)
Before any WSF production activation deploy, PR #612 (WSF-OPERATOR-ACCESS-1) produces a read-only operator access map and gap table documenting which GitHub, Firebase, and Lovable operator accounts have access to which WSF production resources. A read-only audit script (`docs/westayfit/ops/operator-access/audit-access.mjs`) captures the state at a named point in time with a pinned SHA. Nothing is granted, deployed, or changed; this is documentation and baseline capture only.

The value is pre-activation clarity: the gap table records which permissions are missing relative to the expected deployment configuration *before* any changes are made. Any IAM grants or permission additions can then be verified against this baseline rather than inferred from memory. The script is reusable across activation runs so subsequent runs confirm the baseline is unchanged.

Lesson: produce the operator access map before the first activation deploy, not after. A post-deploy gap table measures drift from an unknown starting state; a pre-deploy gap table confirms the deploy plan is coherent with actual permissions. The two are not equivalent documents. For any staged feature approaching production activation, treat the access map as a mandatory pre-deploy artifact alongside the production Firebase inventory.

### WSF Served-Code Guard Must Allow Firestore Listen Pings to API Origins (PR #613)
The served-code guard (`codeGuard`, added in PR #589) routes every browser request through a Playwright request handler and allows only requests whose bodies carry a reviewed digest. Firestore's real-time SDK maintains live listeners by sending periodic ping requests — resource type `ping` in Playwright's request API — to the Firestore API origins. These pings carry no code and are not navigation requests.

When the guard treated pings the same as navigation and script requests, real-time Firestore listeners stalled mid-journey: the SDK could not send its keepalive, the listen connection degraded, and any journey step that relied on live Firestore data produced stale or missing results. The failure was not a hard error — it presented as stale data or a missed update, which could pass most assertions while the underlying listener connection was silently broken.

The fix (PR #613) explicitly passes resource type `ping` through to the exact same-origin API origins as non-navigation data only — never executable content, never from the Lovable host. All other interception rules are unchanged. Each row's seen text is now printed in the job log so the effect of the guard on real traffic is observable.

Lesson: a strict Playwright request guard for a third-party host must enumerate which resource types and origins are allowed for SDK keepalives, not just for navigation and scripts. For any Firestore-connected proof, resource type `ping` to Firestore API origins must be whitelisted as data. A guard that blocks SDK pings produces a journey that appears healthy but silently degrades any live-listener read after the first missed ping interval. The distinction axis is navigation/code vs. data — ping is unambiguously data, and the guard must encode that distinction explicitly.

### WSF Hosted Proof Drivers Must Poll for UI State, Not Assert Immediately After Navigation (PR #620)
LOVABLE-KIOSK-STATION-DRIVER-2 fixed a timing regression introduced by DRIVER-1: the harness looked for a Join button immediately after `goto`, while the app shell was still loading. This caused a deterministic 8 FAIL result in staging run 38079242076 — every station row reported "not reached: the kiosk QR link shows the control no Join", and `qr-join` reported "phone choice absent" on timing-sensitive runs.

The root cause: the served Lovable app is a single-page app with a multi-step shell boot sequence. `FirebaseRuntimeBoundary` captures the `?join=&goal=` params into sessionStorage on mount, but the `ConnectedJoinFlow` itself is not available until three sequential steps complete — runtime boot ("Loading…"/"Connecting…"), `MemberEntry` session restore, and a first `Bootstrapped` hydrate ("Loading your community…"). Together these add roughly 4 seconds before any interactive state is available; the choice stage follows ~7 seconds after the Join button appears.

A driver that asserts once on navigation is never racey — it is deterministically wrong for any SPA with a non-trivial boot sequence. The fix polls for each target state (`JOIN_WAIT_MS = 30 s`, 1 s interval) and polls again for the choice after Join is confirmed. A fake offline app was built to reproduce the served timing so the fix could be verified locally without a live dispatch.

Lesson: when writing a hosted proof driver for a third-party SPA, never assert immediately after `goto` or after a form submit. Identify the shell boot sequence (it is almost always observable in the network tab or the DOM) and poll for the first interactive element that signals the sequence is complete. The staging host's timing is the ground truth — reproduce it in the offline fake before committing a driver, so "deterministic FAIL on staging, PASS locally" cannot slip through review. The specific sequence here (runtime boot → session restore → hydrate → flow mount → choice) is the canary: if a new driver row's element does not appear within 5 s of navigation on the offline fake, the driver is not accounting for boot time.
