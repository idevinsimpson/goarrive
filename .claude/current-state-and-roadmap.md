# GoArrive Current State & Roadmap

_Last refreshed: 2026-07-27._

## What Is Built and Working
The platform has a strong operational backbone. The following systems are fully functional and deployed to production at `goarrive.fit` (also `goarrive.web.app`).

**Plans**: The full plan builder with pricing engine is operational, including CTS (Commit-to-Save) opt-in, plan sharing, 3-month contracts with dynamic referral copy, and intake-to-plan flow.

**Scheduling**: Recurring slots, session instance generation, Zoom room allocation, phase transitions, skip requests, no-show detection, and Google Calendar sync (posting and conflict checking) are all live. A P0 fix batch (sync field, callable invoker IAM, conflict UI, redirects) landed in July.

**Playbook Scheduling & Booking** (Phases 3a + 3b, shipped via PR #208): Coaches attach a schedule to a playbook — a Calendly-style weekly-hours availability editor with date-specific overrides, per-day flexible durations, weekly session caps, book-ahead windows, and Record Sessions toggle, all auto-saving. A public booking link (token-based, revocable) lets members and guests book sessions with idempotent booking via `clientRequestId` and daily TTL cleanup of expired `booking_requests` dedupe docs. The coach scheduling panel supports drag-and-drop workout scheduling into day modules with mosaic tiles and instant live-swap preview. Members get a session page (`/live-session/**` hosting rewrite) with countdown, reschedule/cancel, and a Zoom-gated live player.

**Session Lifecycle**: Session generation, allocation, reminders, and no-show detection are automated via scheduled Cloud Functions.

**Billing Foundation**: Stripe Connect (Standard mode) is integrated with checkout sessions, webhook handling, subscription management, dispute handling, and ledger entries. Prorated earnings caps with yearly admin configuration and automatic carryover are implemented.

**Role-Based Auth**: Three roles (platformAdmin, coach, member) with custom claims, route guards, and Firestore security rules. Admin impersonation is fully functional and was hardened in July ("View as Coach true to coach" — rules grants + role mask, identity/settings fixes). Two P0 security audit batches (auth guards, impersonation, Stripe retry, completion-write integrity) shipped in early July.

**Admin Operations**: Coach management, profit share settings, yearly earnings cap configuration, per-coach module visibility (feature gating, including hiding the tab bar entirely when all gateable modules are off), dead letter queue, event log, and system health monitoring are available.

**Member Portal**: Home, sessions, plan view, payment selection, profile, checkout success, and a dedicated **member workouts page** (`app/(member)/workouts.tsx`) where members view and play assigned workouts.

**Workout Player**: `WorkoutPlayer.tsx` is fully wired into the member workouts page and public share links. It has been through an extensive hardening campaign: iOS audio unlock and autoplay-revocation recovery, audio queue deadlock fixes, frozen-video recovery (foreground resume + stall escalation), orientation/canvas scaling, 10s seek with block-boundary crossing, prescribed weight/reps display + speech, grab-equipment phase with AI-generated images, demo phase TTS cues, swap-sides playback, water breaks, Tabata blocks, and a spoken AI intro announcement. Live heart-rate monitoring via Web Bluetooth is in. A vitest regression suite covers video and TTS stability.

**PWA**: The web app registers a service worker that auto-reloads open tabs on a new deploy, with the registration snippet injected into every exported route page — no more users stuck on stale bundles.

**Post-Workout Journal**: The Glow/Grow reflection (`PostWorkoutJournal.tsx`) is connected to the workout completion flow on both the member workouts page and guest share links (guest reflections with a signup nudge).

**Coach Review**: `CoachReviewQueue.tsx` is integrated into `MemberDetail`, with canonical `coachNote`/`reviewStatus` fields and optional coach notes on single workout assignments.

**Sharing**: Google-Docs-style workout share links (visibility, expiry, view counter, revoke), dynamic Open Graph images for link previews, and a guest play flow with glow-and-grow reflection capture.

**Public Routes**: Intake form (8-step wizard), coach signup/application, shared plan view, workout share links, the public booking page (`app/book` — Calendly-parity guest booking flow), and the member live-session page.

**Build System**: The unified Build tab is live, combining movements and workouts into a single creative workspace. Features include bulk movement upload with AI auto-analysis, dynamic workout thumbnail grids (4:5 aspect ratio), equipment/muscle/difficulty filters, and most-recently-edited sorting. **Folders v2** shipped: universal drag-and-drop of all asset types into folders (including iOS springboard-style drag), folder tiles rendered as mini still-photo mosaics of their contents, drag-to-back to move assets up a level, and instant re-sort on drop. **Playbooks** (workouts-only folders with drill-in, ordered `workoutIds`, drag membership, assign-on-create) shipped as Phase 2, and now carry the Phase 3 scheduling/booking system described above.

**Movements**: Placeholder movements (create without video, add-video-later with AI confirm-merge, "Video Needed" badge, player logo fallback), duplicate-name soft warning, iPhone HEVC-to-H.264 transcode on upload, static poster thumbnails with lazy GIF swap, inline editing from inside a workout, and Duplicate action.

**AI Features**: Movement variations via Runway (build a variation from an existing movement, background-mode polling that persists outputs, motion remix from a still frame), AI workout music via Mubert (coach toggle + style, member playback with independent mute and coach volume setting), AI-generated spoken workout intro announcements, grab-equipment AI images, and follow-along video blocks.

**Coach Launch & Comms**: Guided onboarding journey (Phase 1 shell), automated branded coach welcome email, Coach Agreement v2, weekly "What's New" digest, and a coach feedback loop (in-app feedback page, admin email, shipped-note autofill).

**Member Management**: Duplicate email prevention, plus Send Invite / Password Reset links from the coach member hub so coach-created members can log in.

**Zoom**: RTMS backend + Meeting SDK embedded join are integrated; the player joins via Client View for iOS Safari camera support. See `docs/ZOOM_APPS_MAP.md` for the three-app layout.

## What Is In Flight (Open PRs as of 2026-07-27)
| PR | Area | Status |
|---|---|---|
| #207 | Playbook live view — coach split screen + member player-with-Zoom PiP | Open |
| #216 | Playbook three-dot settings menu (archive, move-to-folder, manage members, revoke/regenerate booking link) | Open |
| #204 | Playbook scheduling Phase 3a — booking guard, weekly cap, coach scheduling panel | Open — its content shipped to main inside #208; needs disposition (close or rebase) |
| #203 | Zoom HMTI platform pool LRU round-robin allocator | Open — overlaps #205 |
| #205 | Zoom true round-robin room allocation — lastUsedAt LRU + bot-pool preference | Open — overlaps #203; only one of the pair should merge |
| #201 | Remove coach "My Zoom Account" UI — hardcode Zoom identity to coach login email | Open |
| #214 | Docs: fix stale staging URL + deploy protocol in agent docs | Open |
| #215 | Docs: 2026-07-23 roadmap/known-issues refresh | Open — superseded by the 2026-07-27 refresh |

Note: #203 and #205 are two competing implementations of Zoom room round-robin. At production ship time, pick one and close the other — do not merge both.

## What Is Still Missing
**In-App Messaging**: No direct messaging between coach and member exists within the app (the coach feedback loop is coach-to-platform, not coach-to-member chat).

**Progress Photos/Measurements**: No system for tracking visual or metric-based progress.

**Live Push Notifications (Server-Side)**: Push notifications are still mock-only on the server. Client-side registration exists, but server-side sending is not live.

**Monthly Billing Close**: No automated monthly billing reconciliation process.

**Native Mobile Apps**: The platform is web/PWA only; no App Store or Play Store builds.

## Build Priority Order
When deciding what to build next, follow this priority order:

| Priority | Area | Rationale |
|---|---|---|
| 1 | Playbook live view + booking polish | Scheduling/booking (Phases 3a/3b) is now in production. Land live view (#207), settle #204's disposition, resolve the #203/#205 allocator overlap, and land #201. This completes the coach-schedules → member-books → live-session loop. |
| 2 | Workout player quality and reliability | Ongoing hardening — iOS audio/video edge cases keep surfacing; keep the regression suite growing. |
| 3 | Coach-review speed and acknowledgment loops | Review queue exists in MemberDetail; make review-and-respond the fastest path in the coach's day. |
| 4 | Notification reliability | Push is mock-only server-side; email and SMS are conditional. |
| 5 | Coach command center refinement | Continue replacing "Coming Soon" tiles in MemberDetail. |
| 6 | Deeper admin visibility | Analytics tab, recording dashboard. |
| 7 | Secondary expansions | Messaging, progress photos, check-in calls, native apps. |

## Recent Changes (May–July 2026)
Development since the last refresh moved through several major arcs. **May**: workout share links (Google-Docs-style sharing, OG previews), swap-sides system (builder editor + player playback), follow-along video blocks, and Zoom RTMS/Meeting SDK integration. **June**: a long workout-player correctness campaign (crop transforms, 10s seek, TTS ordering, video stability, HEVC transcode, poster thumbnails), placeholder movements, Tabata, grab-equipment redesign with AI images, and Build tab filters. **Early July**: two P0 security/correctness audit batches, coach launch onboarding + welcome email, per-coach module visibility, AI movement variations (Runway), AI music (Mubert), spoken intro announcements, guest glow-and-grow, heart-rate monitoring, and the coach comms loop. **Mid-to-late July**: Folders v2 (universal drag-and-drop, mosaic folder tiles), Playbooks Phase 2 (workouts-only folders), a combined all-open-PRs production ship (#191), and another player-audio hardening wave (interruption recovery, frozen-video recovery, start-audio overlap). **Late July (production ship, PR #208)**: playbook scheduling Phases 3a + 3b — Calendly-parity availability editor with date-specific overrides, public booking link with guest flow and idempotent booking, coach drag-and-drop workout scheduling, member live-session page — plus PWA service-worker auto-reload on deploy and a wave of timezone/auto-save correctness fixes. Playbook live view (#207) and the Zoom allocator consolidation are the active workstreams.
