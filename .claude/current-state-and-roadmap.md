# GoArrive Current State & Roadmap

## What Is Built and Working
The platform has a strong operational backbone. The following systems are fully functional and deployed to production at `goarrive.web.app`.

**Plans**: The full plan builder with pricing engine is operational, including CTS (Commit-to-Save) opt-in, plan sharing, and intake-to-plan flow.

**Scheduling**: Recurring slots, session instance generation, Zoom room allocation, phase transitions, skip requests, no-show detection, and Google Calendar sync (posting and conflict checking) are all live.

**Session Lifecycle**: Session generation, allocation, reminders, and no-show detection are automated via scheduled Cloud Functions.

**Billing Foundation**: Stripe Connect (Standard mode) is integrated with checkout sessions, webhook handling, subscription management, and ledger entries. Prorated earnings caps with yearly admin configuration and automatic carryover are implemented.

**Role-Based Auth**: Three roles (platformAdmin, coach, member) with custom claims, route guards, and Firestore security rules. Admin impersonation is fully functional.

**Admin Operations**: Coach management, profit share settings, yearly earnings cap configuration, dead letter queue, event log, and system health monitoring are available.

**Member Portal**: Home, sessions, plan view, payment selection, profile, and checkout success pages are live.

**Public Routes**: Intake form (8-step wizard), coach signup, and shared plan view are accessible without authentication.

**Build System**: The unified Build tab is live, combining movements and workouts into a single creative workspace. Features include bulk movement upload with AI auto-analysis (GPT-4.1-mini), dynamic workout thumbnail grids (2x2, 3x3, 4x4 scaling with 4:5 aspect ratio), folder organization, and most-recently-edited sorting across all libraries.

**Member Management**: Duplicate email prevention during member creation is implemented.

## What Is Built but Disconnected
Several components have been built but are not yet wired into active page routes. These represent significant development investment (approximately 1,674 lines of code) that needs integration.

| Component | Lines | Status |
|---|---|---|
| `WorkoutPlayer.tsx` | ~500 | Built, not imported by any page route. |
| `WorkoutForm.tsx` | ~400 | Built, used within Build page. |
| `WorkoutDetail.tsx` | ~300 | Built, used within Build page. |
| `MovementForm.tsx` | ~200 | Built, used within Build page. |
| `MovementDetail.tsx` | ~150 | Built, used within Build page. |
| `AssignedWorkoutsList.tsx` | ~125 | Built, not imported by any page route. |

## What Is Completely Missing
The following features represent the most significant gaps in the platform and should be prioritized according to the build priority order.

**Member Workout Page**: Members currently have no dedicated page to view and start their assigned workouts within the app.

**Post-Workout Journal**: The Glow/Grow reflection system exists as a component (`PostWorkoutJournal.tsx`) but is not connected to the workout completion flow.

**Coach Review/Feedback Queue**: The `CoachReviewQueue.tsx` component exists but is not integrated into the coach dashboard as a primary workflow.

**In-App Messaging**: No direct messaging between coach and member exists within the app.

**Progress Photos/Measurements**: No system for tracking visual or metric-based progress.

**Live Push Notifications (Server-Side)**: Push notifications are mock-only on the server. The client-side registration exists, but server-side sending is not live.

**Monthly Billing Close**: No automated monthly billing reconciliation process.

## Build Priority Order
When deciding what to build next, follow this priority order:

| Priority | Area | Rationale |
|---|---|---|
| 1 | Workouts and movement system | Wire orphaned components, build member workout page. |
| 2 | Workout player quality and reliability | `WorkoutPlayer.tsx` exists but is disconnected from the member experience. |
| 3 | Coach command center refinement | 10 of 14 MemberDetail tiles are "Coming Soon". |
| 4 | Coach-review speed and acknowledgment loops | No review queue or reactions in the main workflow. |
| 5 | Notification reliability | Push is mock-only; email and SMS are conditional. |
| 6 | Deeper admin visibility | Analytics tab, recording dashboard. |
| 7 | Secondary expansions | Messaging, progress photos, check-in calls. |

## Recent Changes (April 2025)
The most recent development sprint addressed several critical issues and feature requests.

The admin impersonation crash was fixed by resolving a lazy-loaded component issue. The dashboard member count was corrected to use the effective coach ID during admin override. Duplicate email prevention was added to the member creation flow. Prorated earnings caps were implemented based on the profit share start date, along with an admin UI for setting yearly earnings caps with automatic carryover. The "Getting Started" checklist was fixed to recognize created workouts by querying the correct Firestore collection. The "Movement Library" and "Workout Builder" cards on the dashboard were replaced with a single "Build" card. Dynamic workout thumbnail grids were implemented with 2x2 to 3x3 to 4x4 scaling using 4:5 aspect ratios. A bulk movement upload feature was built with AI auto-analysis via ChatGPT (GPT-4.1-mini). Sorting across all libraries and folders was updated to show the most recently edited items first.
