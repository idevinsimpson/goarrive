# GoArrive (G➲A) — Unified Product Blueprint

**Version:** 2.0
**Date:** March 25, 2026
**Author:** Manus AI
**Status:** This document is the single source of truth for the GoArrive platform. It supersedes all prior documents including the OG Blueprint (v1.0) and the codebase-only audit. All product decisions, code changes, feature planning, and design work should reference this document.

---

## Table of Contents

1. Product Identity and Vision
2. Product Philosophy and Design Principles
3. Technology Stack
4. User Roles, Personas, and Permissions
5. Application Architecture
6. Navigation Structure and Route Map
7. Page-by-Page Breakdown
8. Core User Journeys
9. Data Model (Firestore Collections)
10. Cloud Functions Reference
11. Integrations
12. Security Model
13. Business Logic: Billing, Pricing, and Financial Rules
14. Component Library
15. Design System
16. Feature Inventory and Status
17. Build Priority Roadmap
18. Non-Functional Requirements
19. Do-Not-Build List
20. Open Questions

---

## 1. Product Identity and Vision

GoArrive (branded as G➲A) is an online fitness coaching platform and coach operating system. It is not a marketplace, not a gym app, and not a generic SaaS template. GoArrive exists to help independent fitness coaches run real businesses inside the G➲A ecosystem while giving members a premium, personalized coaching experience.

The platform is modeled on the Keller Williams franchise philosophy: coaches run their own client-facing businesses under the GoArrive umbrella, pay a tiered platform fee based on active-member volume, and can earn referral credits and profit-share distributions. The platform provides shared infrastructure — Zoom rooms, payment processing, scheduling automation, and operational tooling — so coaches can focus on coaching rather than administration.

**For coaches**, GoArrive is a turnkey business-in-a-box. It handles scheduling, billing, plan delivery, session hosting, and member management. A coach should be able to open the app and immediately know what to do next, who needs attention, and what is at risk — without navigating through layers of complexity.

**For members**, GoArrive is a premium, personalized fitness experience with a dedicated coach. The app should feel clear, supportive, and momentum-building. A member should always know what to do next, when to do it, how to start quickly, and whether their coach is involved live or asynchronously.

**For the platform**, GoArrive is a scalable multi-tenant system where each coach operates within their own tenant. The platform handles Stripe Connect payments, Zoom infrastructure, and coach onboarding with tiered revenue splits. Coaches are recruited via invite-only.

### 1.1 Core Product Loop

Every feature in GoArrive exists to support this loop:

```
Coach builds workout → Member plays workout → Member reflects/journals → Coach reviews and responds
```

Scheduling, billing, Zoom, reminders, plans, and analytics exist to SUPPORT this loop, not replace it. If a feature adds complexity without making this loop smoother, clearer, faster, or more valuable, it should be deprioritized or redesigned.

**Two reduction principles govern all product decisions:**

1. Reduce the steps from "I opened the app" to "I'm doing the workout."
2. Reduce the steps from "I finished" to "my coach saw it."

### 1.2 Brand Identity

| Element | Value |
|---|---|
| Full Wordmark | "GO" in sage green + arrow icon; "ARRIVE" in steel blue with shadow offset; gold underline sweep |
| Icon Mark | Large "G" + circular arrow in sage green, "Arrive" in steel blue overlay |
| Primary CTA Color | `#7BA05B` (sage green) |
| Link/Active Color | `#7BA7D4` (steel blue) |
| Accent/Highlight | `#F5A623` (gold) |
| Dark Background | `#0F1117` |
| Surface/Card | `#1A1D27` |
| Primary Text | `#E8EAF0` |
| Muted Text | `#7A7F94` |

### 1.3 Product Language

GoArrive uses specific terminology that must be consistent across all surfaces:

| Use This | Not This | Context |
|---|---|---|
| Coach | Trainer | All contexts |
| Member | Client | All contexts |
| Movement | Exercise | When referring to the library asset |
| Online fitness coaching | Virtual training | Marketing and descriptions |
| Command Center | Dashboard | Coach-facing operating surfaces |
| Encourager | Supporter | Future role for accountability partners |

Do not expose backend jargon (allocation failures, room pools, raw statuses, provider modes) in any user-facing copy.

---

## 2. Product Philosophy and Design Principles

These principles are grounded in peer-reviewed research on fitness app engagement, abandonment, and retention. They govern every design and product decision.

### 2.1 Savannah Bananas DNA

The Savannah Bananas' "Fans First" philosophy, translated into product design, yields five rules that apply to GoArrive when "fans" means members and coaches:

**Eliminate friction.** Payments should be crystal clear. Sessions should be one-tap join. Workouts should not require thinking. Post-workout reflection should take 30 seconds, not 10 minutes.

**Entertain always.** Delight without cheesiness. Smooth and memorable finish moments. Positive emotional momentum throughout the member journey. The experience should feel intentional, alive, and human.

**Experiment constantly.** The product should support rapid iteration. Features should be built to test, not to last forever on the first try.

**Engage deeply.** Every screen answers "what do I do next?" and gives a single best next action. Members should feel seen by their coach. Coaches should feel in control of their business.

**Empower action.** One-tap joins. One-tap workout starts. Fast coach acknowledgment. Reduce the distance between intention and action everywhere.

### 2.2 Keller Williams Command Pattern

The coach experience is modeled on the Keller Williams Command dashboard — a command center that tells coaches exactly what to do next. The mental model has three panels:

**Tasks:** Check-ins due, sessions requiring live presence, plan updates due, workouts to build.

**Who to Contact:** Members at risk (missed sessions, low streak, no journal, contract ending).

**Things to Know:** Tier changes, cap progress, upcoming expirations, system alerts.

High-signal first, drill-down second. Progressive disclosure so the dashboard does not become a wall of metrics. Show what matters now; reveal advanced controls when asked.

### 2.3 Member Experience Guardrails

Research on fitness app abandonment consistently identifies these triggers. GoArrive must avoid all of them:

**Do not be invasive or controlling.** No nagging, no shame-driven copy, no surprise penalties. Accountability features (like CTS) must be opt-in, transparent, and paired with clear control.

**Do not impose high data-entry burden.** If journaling is required, keep it minimal (1-3 prompts, 20-30 seconds) and make it emotionally rewarding. The Glow/Grow pattern (one positive, one area for growth) is the default.

**Do not break on technical friction.** Movement media must load reliably. The workout player must work in gyms with poor Wi-Fi. "It failed when I needed it" is fatal for retention.

**Do not feel generic.** The experience must feel personally relevant. "My coach built this for me" is the emotional target.

### 2.4 Media Delivery Strategy

For short looped movement demos, use MP4/H.264 as the universal baseline delivery format. Use WebM as an enhancement where supported, not the only format. Ship movement clips without audio (or muted) so autoplay is reliable across browsers and platforms. Use lightweight thumbnails or posters, then swap to full media quickly. Prefetch the next 1-3 movement clips during a workout to reduce gym-network friction. Movement media must feel reliable first and fancy second.

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React Native + Expo | Single codebase: web, iOS, Android |
| Routing | Expo Router (file-based) | Role-based route groups: `(auth)`, `(app)`, `(member)` |
| Language | TypeScript (strict mode) | Frontend and backend |
| Database | Cloud Firestore | 40+ collections, NoSQL document store |
| Auth | Firebase Authentication | Email/password + custom claims for RBAC |
| Backend | Firebase Cloud Functions (Gen 2) | 52 functions: callable, HTTP, scheduled, triggers |
| Hosting | Firebase Hosting | Web deployment with CDN |
| Payments | Stripe Connect | Split payments between coaches and platform |
| Video | Zoom API | Personal rooms + shared pool, webhooks |
| Calendar | Google Calendar API (OAuth2) | Session posting + multi-account conflict checking |
| Push | Firebase Cloud Messaging (FCM) | Client token registration works; server push is mock only |
| Email | Resend API | Live when API key present, otherwise mock |
| SMS | Twilio | Live when credentials present, otherwise mock |
| Region | us-central1 | All Cloud Functions deployed here |

**Architecture truth:** There is no MySQL, no TiDB, no Drizzle ORM, no Fastify, no S3, no standalone API server in this project. The entire backend runs on Firebase Cloud Functions. The entire data layer is Cloud Firestore. If any prior document references these technologies, it is describing an abandoned pre-code vision, not reality.

---

## 4. User Roles, Personas, and Permissions

### 4.1 Role Definitions

GoArrive implements a three-tier role-based access control system using Firebase Authentication custom claims.

| Role | Custom Claim | Scope |
|---|---|---|
| Platform Admin | `role: 'platformAdmin'` and/or `admin: true` | Full platform control, coach impersonation |
| Coach | `role: 'coach'`, `coachId: <uid>` | Own tenant only (members, plans, sessions, billing) |
| Member | `role: 'member'`, `coachId: <coach-uid>` | Own data only, scoped to assigned coach |

There is no CoachAssistant role. There is no Encourager role. These were in the original vision document but were never built and should not be built at this stage. The three-role model is clean, well-tested, and sufficient. See Section 19 (Do-Not-Build List) for details.

### 4.2 Personas

**Coach — "Jeremy"** runs a solo fitness coaching practice. He designs 3-phase programs for 12-20 members, records movement demo videos, and wants a clean command center that shows him who completed today's workout and who needs a nudge. He is moderately tech-savvy and values speed over complexity. His biggest frustration is context-switching between spreadsheets, messaging apps, and scheduling tools. GoArrive should be his single pane of glass.

**Member — "Belinda"** is a busy professional who works out at home and occasionally at a gym. She needs a distraction-free, full-screen workout player that tells her exactly what to do next. She opted into the Commit-to-Save program for accountability. She checks in with her coach once a week via Zoom. Her biggest frustration is apps that feel like homework. GoArrive should feel like momentum, not burden.

**Platform Admin — "Alex"** manages the GoArrive platform. Alex onboards new coaches, monitors system health, resolves operational issues (dead letters, allocation failures), and oversees billing. Alex needs to see the whole system at a glance and drill into any coach's practice when needed via impersonation.

### 4.3 Role Assignment Flows

**Platform Admin** — Set manually via the `setAdminRole` Cloud Function. Only existing admins can promote other users. The custom claim `admin: true` is set on the Firebase Auth token.

**Coach** — Created through the admin invite flow. An admin calls `inviteCoach`, which generates a `coachInvites` document with a unique token. The invited coach visits `/coach-signup?token=<token>`, creates their account, and calls `activateCoachInvite`, which sets `role: 'coach'` and `coachId: <uid>` on their token and creates a `coaches` document.

**Member** — Created through the intake form at `/intake/<coachId>`. The member fills out an 8-step wizard, creates a Firebase Auth account on the final step, and a `members` document is written with `coachId` pointing to their coach. The `claimMemberAccount` function can also link an existing member document (created by a coach via QuickAddMember) to a newly created auth account.

### 4.4 Admin Coach Impersonation

Platform admins can view any coach's dashboard via the `adminCoachOverride` state in AuthContext. When set, `effectiveClaims` replaces the admin's `coachId` with the target coach's ID. A gold banner indicates the override is active. All impersonation events are logged to the `eventLog` collection.

---

## 5. Application Architecture

### 5.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (React Native + Expo)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  (auth)  │  │  (app)   │  │ (member) │  Public Routes   │
│  │  Login   │  │  Coach/  │  │  Member  │  /intake/[id]    │
│  │          │  │  Admin   │  │  Portal  │  /coach-signup   │
│  └──────────┘  └──────────┘  └──────────┘  /shared-plan    │
│                      │                                      │
│           AuthContext (RBAC + Claims)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │  Firebase Services  │
            ├─────────────────────┤
            │  Authentication     │ ← Email/password + custom claims
            │  Firestore          │ ← 40+ collections, security rules
            │  Cloud Functions    │ ← 52 functions (Gen 2)
            │  Hosting            │ ← Web deployment
            │  Cloud Messaging    │ ← Push notifications
            └──────────┬──────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
   ┌─────┴─────┐ ┌────┴────┐ ┌─────┴─────┐
   │  Stripe   │ │  Zoom   │ │  Google   │
   │  Connect  │ │  API    │ │  Calendar │
   └───────────┘ └─────────┘ └───────────┘
```

### 5.2 Multi-Tenant Data Isolation

GoArrive uses a `coachId`-based multi-tenancy model. Every data document that belongs to a coach's practice includes a `coachId` field. Firestore security rules enforce that coaches can only read and write documents where `coachId` matches their own (via custom claims or UID bootstrap). Members are scoped to their coach through the `coachId` field on their member document. Platform admins bypass tenant isolation via the impersonation mechanism.

### 5.3 Client-Side Route Groups

| Route Group | Auth Required | Role Guard | Purpose |
|---|---|---|---|
| `(auth)/*` | No | Redirects authenticated users away | Login screen |
| `(app)/*` | Yes | Redirects members to `(member)` | Coach and admin dashboard |
| `(member)/*` | Yes | Redirects coaches/admins to `(app)` | Member portal |
| `intake/*` | No | None | Public intake form |
| `coach-signup` | No | None | Invite-based coach registration |
| `shared-plan/*` | No | None | Public read-only plan viewer |

---

## 6. Navigation Structure and Route Map

### 6.1 Coach/Admin Navigation — (app) Group

The coach and admin experience uses a bottom tab bar with four visible tabs and several hidden screens accessible via programmatic navigation.

| Tab | Route | Visible | Description |
|---|---|---|---|
| Dashboard | `/(app)/dashboard` | Yes | Home screen: stats, feature cards, onboarding checklist, check-in card |
| Members | `/(app)/members` | Yes | Member roster, search, QuickAddMember, MemberDetail modal (14 tiles) |
| Workouts | `/(app)/workouts` | Yes | **Coming Soon placeholder.** Components exist but are not wired. |
| Movements | `/(app)/movements` | Yes | **Coming Soon placeholder.** Components exist but are not wired. |
| Admin | `/(app)/admin` | Hidden | Platform admin dashboard (7 tabs) |
| Account | `/(app)/account` | Hidden | Settings: profile, Stripe Connect, Zoom, Google Calendar |
| Billing | `/(app)/billing` | Hidden | Revenue dashboard: tier split, profit share, referrals, ledger |
| Member Plan | `/(app)/member-plan/[memberId]` | Hidden | Full-screen plan builder/viewer (tab bar hidden) |

The tab bar uses a fixed-bottom layout on web with `position: fixed` and safe-area-aware padding for iOS. When viewing a member plan, the tab bar is hidden entirely for immersive editing.

### 6.2 Member Navigation — (member) Group

| Tab | Route | Visible | Description |
|---|---|---|---|
| Home | `/(member)/home` | Yes | Welcome, coach card, plan status, quick actions |
| Sessions | `/(member)/my-sessions` | Yes | Upcoming/past sessions, join button, reschedule, skip request |
| My Plan | `/(member)/my-plan` | Yes | Read-only plan view (same PlanView component as coach) |
| Profile | `/(member)/profile` | Yes | Edit name, phone, sign out |
| Payment Select | `/(member)/payment-select` | Hidden | Monthly vs. pay-in-full selection before Stripe checkout |
| Checkout Success | `/(member)/checkout-success` | Hidden | Post-payment confirmation with polling |

### 6.3 Public Routes

| Route | Purpose |
|---|---|
| `/intake/[coachId]` | 8-step member intake wizard tied to a specific coach |
| `/intake` | Intake index (redirects or shows coach selection) |
| `/coach-signup?token=<token>` | Invite-based coach account creation |
| `/shared-plan/[memberId]` | Public read-only plan viewer (no auth required) |
| `/checkout-success` | Root-level checkout success handler |

---

## 7. Page-by-Page Breakdown

### 7.1 Login — /(auth)/login

**Access:** Unauthenticated users only. Authenticated users are redirected based on role.

The login screen presents a card-style form with "COACH PORTAL" branding, a "Welcome back" heading, email and password fields, and a "Sign In" button. Below the form is a "Forgot password?" link that triggers Firebase's `sendPasswordResetEmail` flow inline. A note at the bottom reads "New coaches: contact your GoArrive administrator." After successful authentication, the handler reads custom claims (or falls back to Firestore document checks) and routes to `/(app)/dashboard` (coach/admin) or `/(member)/home` (member).

### 7.2 Coach Dashboard — /(app)/dashboard

**Access:** Coaches and Platform Admins.

The dashboard is the coach's home screen and the entry point to the Command Center. It displays a greeting with the coach's full name and a "COACH" role badge, a stats grid with quick metrics (active member count, upcoming sessions), an onboarding checklist for new coaches (four steps: add first movement, create a workout, add a member, assign a workout), a daily check-in card, and feature navigation tiles for Member Plans, Movement Library, Workout Builder, Member List, Scheduling, and Billing. Admin users see an additional "Admin Config" card. The AppHeader provides the GoArrive logo and an avatar button that opens the AccountPanel slide-in drawer.

### 7.3 Members List — /(app)/members

**Access:** Coaches and Platform Admins.

Displays the coach's member roster as a scrollable list with name, status badge (active, pending, archived), and basic info. Features include search filtering by name, a QuickAddMember floating action button (multi-step form, only first and last name required), and the MemberDetail modal on tap.

### 7.4 Member Detail Hub — MemberDetail Component

**Access:** Coaches and Platform Admins (via Members list).

The central command center for managing an individual member. Wrapped in an ErrorBoundary for crash resilience. The header shows member name, email, phone, status badge, guidance phase indicator, and a plan phase timeline bar. Below is a grid of 14 action tiles:

| Tile | Status | Description |
|---|---|---|
| Plan and Intake | **Live** | Opens full-screen plan builder at `/(app)/member-plan/[memberId]` |
| Workouts | Coming Soon | Workout playlist and rotation management |
| Sessions and Stats | Coming Soon | Past and upcoming session history |
| Schedule | **Live** | Opens scheduling modal for creating/managing recurring slots |
| Messages | Coming Soon | Direct coach-member communication |
| Check-in Call | Coming Soon | Start a Zoom check-in session |
| Measurements | Coming Soon | Progress photos and body measurements |
| Coach Notes | Coming Soon | Check-in call notes and observations |
| Referrals | Coming Soon | Members referred by this member |
| Coach Videos | Coming Soon | Social content shared with the member |
| Journal | Coming Soon | Member journal entries and coach comments |
| Password Reset | Coming Soon | Send a password reset link to the member |
| Assign Workout | **Live** | Opens AssignWorkoutModal for workout assignment |
| Archive | **Live** | Archive/unarchive the member |

The Schedule modal shows recurring slots with a phase timeline, and allows creating new slots with day of week, start time, duration, timezone, session type, and guidance phase. Google Calendar conflict checking runs before confirming.

### 7.5 Member Plan Builder — /(app)/member-plan/[memberId]

**Access:** Coaches and Platform Admins. Tab bar is hidden for immersive editing.

The most complex page in the application. Serves as both the plan builder (for coaches) and plan viewer (for members via the shared PlanView component). Sections include:

**Plan Hero:** Editable title, status badge (draft/presented/accepted/active), member and coach names.

**Goals Section:** Multi-select from 11 predefined goals (Feel healthier, Fat loss, Build muscle, Improve endurance, Lower stress, Better sleep, More energy, Increase flexibility, Build confidence, Manage pain, Sport-specific training), each with an emoji and color.

**Weekly Schedule:** Visual week grid showing session types per day (Strength, Cardio + Mobility, Mix, Rest). Sessions per week selector (2, 3, or 4). Each day's session type and guidance level configurable per phase.

**Phase Configuration:** Three-phase progression — Phase 1: Fully Guided (coach leads every session live), Phase 2: Shared Guidance (coach joins for a configurable portion), Phase 3: Self-Reliant (member trains independently with hosted infrastructure). Each phase has configurable week duration and a session type guidance matrix.

**Pricing Engine:** Computes hourly rate multiplied by session length multiplied by guidance factor per phase, plus check-in call hours, program build time hours, and monthly admin technology fee. Supports monthly subscription and pay-in-full (10% discount) options.

**Add-Ons:** Commit to Save (CTS) behavioral incentive with opt-in modal. Nutrition add-on (in-house or outsourced).

**Post-Contract/Continuation:** Month-to-month rate at self-reliant phase pricing with reduced coach time (3-5 min per session). CTS continuation at half the standard monthly rate.

**Plan Actions:** Save draft, present to member (sends notification), share link (generates public URL).

**Floating Dropdowns:** All dropdowns use `ReactDOM.createPortal` with `position: fixed` to avoid overflow issues inside ScrollViews.

### 7.6 Scheduling — /(app)/scheduling

**Access:** Coaches and Platform Admins.

The session command center with two views. **List View** (default) groups sessions by day (Today, Tomorrow, Upcoming) with member name, time, duration, guidance phase badge, hosting mode indicator, session type, and status. A "Needs Attention" section surfaces allocation failures and skip requests. **Calendar View** shows a week grid with day columns and time rows. Session Instance Detail shows full metadata, Zoom room assignment, recording status, attendance outcome, and cancel action.

### 7.7 Billing Dashboard — /(app)/billing

**Access:** Coaches and Platform Admins.

Comprehensive financial overview showing Stripe Connect status, revenue summary, tier progression, earnings cap info, profit share display, inter-coach referral info, client referral info, and recent ledger entries from the last 90 days. See Section 13 for full business rule details.

### 7.8 Admin Dashboard — /(app)/admin

**Access:** Platform Admins only.

The platform operations control tower with seven tabs:

| Tab | Purpose |
|---|---|
| Operations | Provider health (Zoom, Email, SMS, Push), scheduling operations (rooms, allocation, pending, failures) |
| Events | Filterable session event log with drill-down |
| Recordings | Recording visibility dashboard (ready, processing, missing, failed) |
| Dead Letter | Failed job queue with retry and resolve actions |
| CTS Billing | Commit to Save accountability fee tracking and waiver management |
| Analytics | Platform-wide metrics and trends |
| Coaches | Coach list, invite new coaches, view members, impersonate coaches |

### 7.9 Account / Settings — /(app)/account

**Access:** Coaches and Platform Admins.

Profile management (avatar, display name, email), Stripe Connect panel (connect, resume setup, refresh status, disconnect), personal Zoom connection, Google Calendar session posting (OAuth2), Google Calendar conflict checking (multi-account OAuth2 with sub-calendar selection), and sign out.

### 7.10 Member Home — /(member)/home

**Access:** Members only.

Welcoming home screen with greeting ("Welcome back, [First Name]"), coach card (name, email, phone), plan status card with "View My Plan" action, quick action navigation, and a loading skeleton for first-load perceived performance.

### 7.11 Member Sessions — /(member)/my-sessions

**Access:** Members only.

Upcoming and past sessions with premium, supportive copy (no backend infrastructure language). Features include join button, session type and time display, session detail modal with Zoom join link, single-occurrence reschedule via `rescheduleInstance`, and skip request with category (Holiday, Vacation, Illness, Other) and reason.

### 7.12 Member Plan — /(member)/my-plan

**Access:** Members only.

A thin wrapper around the coach's PlanView component. Loads the same Firestore document and renders PlanView with `isCoach=false`. One source of truth, one component, identical output. Also shows unread notifications.

### 7.13 Member Profile — /(member)/profile

**Access:** Members only.

View and edit profile information (display name, phone) and sign out.

### 7.14 Payment Flow — /(member)/payment-select and /(member)/checkout-success

**Access:** Members only.

**Payment Select:** Member chooses between monthly subscription or pay-in-full (10% discount). Calls `createCheckoutSession` to generate a Stripe Checkout URL. Member is redirected to Stripe.

**Checkout Success:** Polls `checkoutIntents` document until webhook confirms `status: 'completed'`. Shows success animation and redirects to My Plan. Includes a 30-second timeout fallback.

### 7.15 Public Intake Form — /intake/[coachId]

**Access:** Public (no authentication required).

An 8-step wizard for prospective members:

| Step | Title | Fields |
|---|---|---|
| 1 | About You | First name, last name, email, phone, date of birth, gender |
| 2 | Work and Lifestyle | Occupation, work schedule, stress level, sleep hours |
| 3 | Health History | Medical conditions, injuries, medications, surgeries |
| 4 | Diet and Routine | Current diet, meal frequency, water intake, supplements |
| 5 | Fitness Goals | Multi-select from 11 goal options |
| 6 | Motivation | Motivation level, previous fitness experience, barriers |
| 7 | Scheduling | Preferred days, times, session frequency |
| 8 | Create Account | Email (pre-filled), password, confirm password |

On the final step, creates a Firebase Auth account, writes a `members` document with `coachId` from the URL, and writes an `intakeSubmissions` document with all form data.

### 7.16 Coach Signup — /coach-signup

**Access:** Public (requires valid invite token in URL).

Validates the invite token, displays the invited coach's name, and provides a signup form. On submission, creates a Firebase Auth account and calls `activateCoachInvite`.

### 7.17 Shared Plan Viewer — /shared-plan/[memberId]

**Access:** Public (no authentication required).

Read-only view of a member's fitness plan via the `getSharedPlan` HTTP Cloud Function. Only shows plans with status 'presented', 'accepted', or 'active'.

---

## 8. Core User Journeys

### 8.1 Member Onboarding Journey

This is the primary acquisition flow — from first contact to first session.

```
Coach shares intake link (/intake/<coachId>)
        │
        ▼
Member completes 8-step intake form
        │
        ▼
Step 8: Firebase Auth account created
members doc written (coachId, hasAccount: true)
intakeSubmissions doc written (all form data)
        │
        ▼
AuthContext detects new user → role: 'member'
Redirect to /(member)/home
        │
        ▼
Coach sees new member in /(app)/members list
Coach opens MemberDetail → Plan & Intake tile
        │
        ▼
Coach builds personalized plan in member-plan/[memberId]
Coach presents plan → notification sent to member
        │
        ▼
Member views plan in /(member)/my-plan
Member accepts → redirected to payment-select
        │
        ▼
Member chooses monthly or pay-in-full
createCheckoutSession → Stripe Checkout
        │
        ▼
Stripe webhook → plan status: 'active'
contractStartAt and contractEndAt set
        │
        ▼
Coach creates recurring slots for the member
generateUpcomingInstances creates session instances
allocateSessionInstance assigns Zoom rooms
        │
        ▼
Member sees sessions in /(member)/my-sessions
```

### 8.2 Daily Workout Journey (Target State — Not Yet Built)

This is the core product loop in action. The infrastructure for steps 1-3 exists; steps 4-8 are the primary build gap.

```
1. Member opens app → sees /(member)/home
2. "Today's Workout" card shows assigned workout summary     [NOT BUILT]
3. Member taps "Start Workout" → full-screen player launches [NOT BUILT]
4. Player cycles through movements with timer, media loops,
   "Next" preview at T-5s, skip option                       [COMPONENT EXISTS, NOT WIRED]
5. Workout ends → Journal prompt appears (Glow & Grow)       [NOT BUILT]
6. Member submits reflection → session log saved             [NOT BUILT]
7. Coach sees completion badge on member card                [NOT BUILT]
8. Coach reacts with emoji or typed comment →
   push notification to member                               [NOT BUILT]
```

### 8.3 Session Lifecycle

This flow is fully built and operational.

```
Recurring Slot (template)
        │
        ▼  generateUpcomingInstances (daily cron)
Session Instance (status: 'scheduled')
        │
        ▼  allocateAllPendingInstances (every 15 min)
Session Instance (status: 'allocated', zoomRoomId assigned)
        │
        ▼  processReminders (every 5 min)
Reminder sent to member
        │
        ▼  Member joins Zoom
        │
        ▼  zoomWebhook: meeting.started
Session Instance (status: 'in_progress')
        │
        ▼  zoomWebhook: meeting.ended
Session Instance (status: 'completed')
        │
        ▼  detectNoShows (every 30 min)
Missed sessions flagged
        │
        ▼  enforceCtsAccountability (every hour)
CTS fees charged if applicable
```

### 8.4 Stripe Payment Flow

This flow is fully built and operational.

```
Coach presents plan to member
        │
        ▼
Member accepts → navigates to payment-select
Selects 'monthly' or 'pay_in_full'
        │
        ▼
createCheckoutSession Cloud Function:
  - Creates checkoutIntent doc (status: 'pending')
  - Creates acceptedPlanSnapshot doc (frozen plan data)
  - Creates Stripe Checkout Session with:
    - line items, subscription or one-time mode
    - application_fee_percent based on coach tier
        │
        ▼
Member redirected to Stripe Checkout
Stripe processes payment
        │
        ▼
stripeWebhook receives checkout.session.completed:
  - Updates checkoutIntent status to 'completed'
  - Updates member_plan status to 'active'
  - Sets contractStartAt and contractEndAt
  - For pay-in-full: creates deferred continuation subscription
        │
        ▼
Ongoing: invoice.paid, invoice.payment_failed,
subscription events handled by webhook handlers
```

### 8.5 Plan Phase Transition

This flow is fully built and runs automatically.

```
batchPhaseTransition (daily cron at 3:00 AM ET)
        │
        ▼
Reads all active member_plans with contractStartAt
Calculates weeks elapsed since contract start
        │
        ▼
Determines target phase based on cumulative phase weeks:
  Phase 1 weeks → Phase 2 weeks → Phase 3 weeks
        │
        ▼
Maps plan intensity to scheduling guidance phase:
  'Fully Guided'     → 'coach_guided'
  'Shared Guidance'   → 'shared_guidance'
  'Self-Reliant'      → 'self_guided'
        │
        ▼
Updates all active recurring_slots for the member
Updates all future session_instances
Changes hosting mode, room source, coach expected live flags
```


---

## 9. Data Model (Firestore Collections)

GoArrive uses over 40 Firestore collections. Below are the primary collections organized by domain. All field names use camelCase. All documents include a `coachId` field for tenant isolation unless otherwise noted.

### 9.1 User and Identity Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `users/{uid}` | Firebase Auth UID | displayName, email, phone, role, coachId, tenantId, photoURL, fcmToken | User profile (all roles) |
| `coaches/{coachId}` | Coach's UID | displayName, email, role, noShowGraceMinutes, autoApproveSkipCategories, autoApproveSkipLeadDays, icalToken | Coach profile and scheduling settings |
| `members/{memberId}` | Member's UID or auto-ID | displayName, email, phone, coachId, hasAccount, status, isArchived, createdAt | Member profile linked to a coach |
| `coachInvites/{inviteId}` | Auto-generated | email, displayName, status, token, createdAt, expiresAt | Pending coach invitations |
| `coach_brands/{coachId}` | Coach's UID | activeMemberCount, currentTier, branding settings | Coach branding and computed metrics |

### 9.2 Plan and Intake Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `member_plans/{planId}` | Member's doc ID | coachId, memberId, status, goals, weeklySchedule, phases, sessionsPerWeek, contractMonths, hourlyRate, displayMonthlyPrice, commitToSave, nutrition, continuationPricing, postContract | The core plan document |
| `intakeSubmissions/{id}` | Auto-generated | coachId, memberId, formData (all 8 steps), createdAt | Raw intake form data |
| `checkoutIntents/{id}` | Auto-generated | planId, memberId, coachId, status, paymentOption, stripeSessionId | Payment intent tracking |
| `acceptedPlanSnapshots` | Auto-generated | Frozen copy of plan data at acceptance time | Immutable billing record |

### 9.3 Scheduling Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `recurring_slots/{slotId}` | Auto-generated | coachId, memberId, memberName, dayOfWeek, startTime, durationMinutes, timezone, recurrencePattern, status, sessionType, guidancePhase, hostingMode, roomSource, coachExpectedLive, liveCoachingStartMin, liveCoachingEndMin, commitToSaveEnabled | Recurring session template |
| `session_instances/{id}` | Auto-generated | coachId, memberId, memberName, slotId, scheduledDate, startTime, durationMinutes, status, zoomRoomId, zoomMeetingId, zoomJoinUrl, guidancePhase, hostingMode, sessionType, recordingUrl, attendance, skipCategory, skipReason | Individual session occurrence |
| `zoom_rooms/{roomId}` | Auto-generated | coachId, label, zoomAccountEmail, zoomUserId, status, maxConcurrentMeetings, isPersonal | Zoom room inventory |
| `session_events/{id}` | Auto-generated | instanceId, occurrenceId, eventType, source, timestamp, metadata | Audit trail for session lifecycle |
| `scheduling_audit_log/{id}` | Auto-generated | action, details, timestamp | Scheduling operation audit log |
| `reminder_jobs/{id}` | Auto-generated | sessionInstanceId, memberId, scheduledFor, status, channel | Scheduled reminder delivery |
| `slot_templates/{id}` | Subcollection of coaches | Template data for reusable slot configurations | Coach-specific slot templates |
| `shared_templates/{id}` | Auto-generated | sharedBy, template data | Cross-coach shared templates |

### 9.4 Billing and Financial Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `coachStripeAccounts/{coachId}` | Coach's UID | stripeAccountId, onboardingStatus, chargesEnabled, payoutsEnabled, requirementsDue | Stripe Connect account status |
| `stripe_accounts/{coachId}` | Coach's UID | Similar to above | Legacy/alternate Stripe account reference |
| `billingEvents/{eventId}` | Stripe event ID | stripeEventId, stripeEventType, rawPayload, processedAt | Idempotent webhook event store |
| `memberSubscriptions/{id}` | Auto-generated | memberId, coachId, stripeSubscriptionId, status | Active Stripe subscriptions |
| `ledgerEntries/{id}` | Auto-generated | coachId, amount, type, description, createdAt | Financial transaction log |
| `earnings_caps/{id}` | Auto-generated | coachId, year, totalEarnings, cap | Annual earnings cap tracking |
| `profit_share/{id}` | Auto-generated | coachId, generation, amount | Multi-level profit sharing |
| `inter_coach_referrals/{id}` | Auto-generated | referringCoachId, referredCoachId, revenueShare | Coach-to-coach referral tracking |
| `referrals/{id}` | Auto-generated | referrerId, referredMemberId | Member referral tracking |
| `ctsAccountabilityFees/{id}` | Auto-generated | memberId, coachId, amount, chargedAt, waived | CTS missed session fees |

### 9.5 Workout and Movement Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `movements/{id}` | Auto-generated | coachId, name, description, muscleGroups, equipment, mediaUrl, canvaDesignId, isGlobal | Movement library entries |
| `workouts/{id}` | Auto-generated | coachId, name, description, movements (array of refs), duration, type | Workout templates |
| `assigned_workouts/{id}` | Auto-generated | coachId, memberId, workoutId, assignedAt, status | Workout assignments to members |

### 9.6 System and Operational Collections

| Collection | Doc ID | Key Fields | Purpose |
|---|---|---|---|
| `eventLog/{id}` | Auto-generated | userId, action, details, timestamp | General audit log (impersonation, admin actions) |
| `dead_letter/{id}` | Auto-generated | functionName, error, payload, timestamp, resolved | Failed job queue |
| `notifications/{id}` | Auto-generated | recipientId, type, title, body, read, createdAt | In-app notification store |
| `check_ins/{id}` | Auto-generated | coachId, date, completed | Daily coach check-in tracking |
| `rule_versions/{id}` | Auto-generated | ruleType, version, config | Versioned business rule configuration |
| `google_calendar_tokens/{id}` | Auto-generated | coachId, accessToken, refreshToken, calendarId | Google Calendar OAuth tokens |
| `zoom_tokens/{id}` | Auto-generated | coachId, accessToken, refreshToken | Zoom OAuth tokens |

---

## 10. Cloud Functions Reference

GoArrive has 52 Cloud Functions deployed to us-central1. They are organized by type and domain.

### 10.1 Callable Functions (invoked from client via `httpsCallable`)

| Function | Purpose |
|---|---|
| `setAdminRole` | Promote a user to platform admin (admin-only) |
| `inviteCoach` | Generate a coach invite with token (admin-only) |
| `activateCoachInvite` | Redeem invite token, set coach role and claims |
| `claimMemberAccount` | Link a QuickAdd member doc to a new auth account |
| `createCheckoutSession` | Generate Stripe Checkout session for plan payment |
| `cancelSubscription` | Cancel a member's Stripe subscription |
| `createRecurringSlot` | Create a new recurring session slot |
| `updateRecurringSlot` | Modify an existing recurring slot |
| `deleteRecurringSlot` | Remove a recurring slot and its future instances |
| `rescheduleInstance` | Move a single session instance to a new time |
| `cancelInstance` | Cancel a single session instance |
| `requestSkipInstance` | Member requests to skip a session |
| `approveSkipRequest` | Coach approves a skip request |
| `allocateSessionInstance` | Assign a Zoom room to a single session |
| `allocateAllPendingInstances` | Batch-allocate Zoom rooms for all pending sessions |
| `deallocateSessionInstance` | Release a Zoom room from a session |
| `connectZoomRoom` | Register a personal or shared Zoom room |
| `disconnectZoomRoom` | Remove a Zoom room from the pool |
| `connectGoogleCalendar` | OAuth2 flow for Google Calendar posting |
| `connectGoogleCalendarConflict` | OAuth2 flow for conflict checking calendars |
| `disconnectGoogleCalendar` | Revoke Google Calendar connection |
| `postSessionToCalendar` | Write a session instance to Google Calendar |
| `removeSessionFromCalendar` | Delete a session from Google Calendar |
| `checkCalendarConflicts` | Query connected calendars for scheduling conflicts |
| `connectStripeAccount` | Initiate Stripe Connect onboarding |
| `refreshStripeStatus` | Refresh Stripe account status from Stripe API |
| `savePlan` | Save a member plan (draft or update) |
| `presentPlan` | Change plan status to 'presented' and notify member |
| `sharePlan` | Generate a public share URL for a plan |
| `waiveCtsAccountabilityFee` | Admin waives a CTS fee |
| `retryDeadLetter` | Retry a failed job from the dead letter queue |
| `resolveDeadLetter` | Mark a dead letter as resolved without retry |
| `sendTestNotification` | Send a test push/email/SMS notification (admin) |

### 10.2 HTTP Functions (external webhooks and public endpoints)

| Function | Purpose |
|---|---|
| `stripeWebhook` | Handles all Stripe webhook events (checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.updated/deleted) |
| `zoomWebhook` | Handles Zoom webhook events (meeting.started, meeting.ended, recording.completed) |
| `getSharedPlan` | Public HTTP endpoint for shared plan viewer (no auth) |
| `stripeConnectReturn` | Return URL handler after Stripe Connect onboarding |
| `googleCalendarCallback` | OAuth2 callback for Google Calendar |

### 10.3 Scheduled Functions (cron jobs)

| Function | Schedule | Purpose |
|---|---|---|
| `generateUpcomingInstances` | Daily at 2:00 AM ET | Create session instances from recurring slots for the next 14 days |
| `allocateAllPendingInstances` | Every 15 minutes | Batch-assign Zoom rooms to unallocated sessions |
| `processReminders` | Every 5 minutes | Send session reminders (email, SMS, push) at configured lead times |
| `detectNoShows` | Every 30 minutes | Flag sessions where the member did not join within grace period |
| `enforceCtsAccountability` | Every hour | Charge CTS accountability fees for confirmed no-shows |
| `batchPhaseTransition` | Daily at 3:00 AM ET | Advance members through plan phases based on elapsed weeks |
| `cleanupExpiredInvites` | Daily at 4:00 AM ET | Remove expired coach invites |
| `syncRecordingStatus` | Every 30 minutes | Check Zoom for recording availability and update session instances |
| `refreshProviderHealth` | Every 10 minutes | Check Zoom, Email, SMS, Push provider connectivity |

### 10.4 Firestore Trigger Functions

| Function | Trigger | Purpose |
|---|---|---|
| `onMemberCreated` | `members/{id}` onCreate | Initialize member-related documents and send welcome notification |
| `onPlanStatusChanged` | `member_plans/{id}` onUpdate | Handle plan lifecycle transitions (presented → accepted → active) |
| `onSessionInstanceUpdated` | `session_instances/{id}` onUpdate | Log session events, update scheduling audit log |
| `onCheckoutIntentCompleted` | `checkoutIntents/{id}` onUpdate | Activate plan and subscription after successful payment |
| `onCoachStripeAccountUpdated` | `coachStripeAccounts/{id}` onUpdate | Recalculate tier and update coach_brands |

---

## 11. Integrations

### 11.1 Stripe Connect

GoArrive uses Stripe Connect in **Standard** mode. Each coach has their own Stripe account connected to the platform. The platform takes an `application_fee_percent` on every transaction, calculated from the coach's current tier.

**Connection flow:** Coach navigates to Account → Stripe Connect Panel → clicks "Connect Stripe." The `connectStripeAccount` function creates a Stripe account link. After completing Stripe's onboarding, the coach is redirected to `stripeConnectReturn`. The `refreshStripeStatus` function updates `coachStripeAccounts` with `chargesEnabled` and `payoutsEnabled` status.

**Payment flow:** When a member checks out, `createCheckoutSession` creates a Stripe Checkout Session with the coach's connected account as the destination. The `application_fee_percent` is set based on the coach's tier (40% for Tier 1, 35% for Tier 2, 30% for Tier 3). The `stripeWebhook` handles all post-payment events.

**Webhook events handled:** `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`. All events are stored in `billingEvents` for idempotency.

### 11.2 Zoom

GoArrive uses the Zoom API for session hosting. There are two room types:

**Personal Rooms:** Connected to a coach's own Zoom account via OAuth2. Used for coach-led (Fully Guided) sessions where the coach is expected to be present.

**Shared Pool Rooms:** Platform-managed Zoom accounts. Used for hosted sessions (Shared Guidance and Self-Reliant phases) where the member trains independently in a Zoom room with infrastructure but no live coach.

**Allocation logic:** The `allocateSessionInstance` function checks room availability based on `maxConcurrentMeetings` and time conflicts. Personal rooms are preferred for coach-guided sessions; shared pool rooms are used for hosted sessions. If no room is available, the session is flagged for attention in the admin Operations tab.

**Webhooks:** `meeting.started` → session status becomes 'in_progress'. `meeting.ended` → session status becomes 'completed'. `recording.completed` → recording URL is saved to the session instance.

**Important:** GoArrive does NOT use the Zoom Embedded SDK. Sessions are joined via external Zoom join links (`zoomJoinUrl`). This is intentional — see Section 19 (Do-Not-Build List).

### 11.3 Google Calendar

Two separate OAuth2 connections serve different purposes:

**Session Posting:** Connects a single Google account. When sessions are created or updated, `postSessionToCalendar` writes calendar events so the coach sees sessions in their Google Calendar.

**Conflict Checking:** Connects one or more Google accounts with sub-calendar selection. When creating recurring slots, `checkCalendarConflicts` queries all connected calendars to warn about scheduling conflicts. This supports coaches who use multiple Google accounts (personal + business).

### 11.4 Notification Providers

GoArrive uses a clean provider abstraction with mock/live switching:

| Channel | Live Provider | Mock Behavior | Status |
|---|---|---|---|
| Email | Resend API | Logs to console | Live when `RESEND_API_KEY` is set |
| SMS | Twilio | Logs to console | Live when Twilio credentials are set |
| Push | Firebase Cloud Messaging | Logs to console | **Mock only** — FCM token registration works on client, but server-side push sending is not yet implemented |

The admin Operations tab shows provider health status for all four channels.

---

## 12. Security Model

### 12.1 Authentication and Claims

Firebase Authentication with email/password. Custom claims are set via Cloud Functions and stored in the JWT token:

| Claim | Set By | Purpose |
|---|---|---|
| `admin: true` | `setAdminRole` | Platform admin access |
| `role: 'platformAdmin'` | `setAdminRole` | Role identifier |
| `role: 'coach'` | `activateCoachInvite` | Coach role |
| `coachId: <uid>` | `activateCoachInvite` | Tenant identifier |
| `role: 'member'` | `claimMemberAccount` | Member role |
| `coachId: <coach-uid>` | `claimMemberAccount` | Coach association |

### 12.2 Firestore Security Rules

Rules enforce tenant isolation with a bootstrap fallback pattern:

**Coaches** can read/write documents where `resource.data.coachId == request.auth.token.coachId` OR `resource.data.coachId == request.auth.uid` (bootstrap fallback for new coaches whose claims haven't propagated yet).

**Members** can read their own member document and their own plan, sessions, and notifications. They cannot read other members' data or any coach-level data.

**Platform Admins** can read all documents. Write access is restricted to specific admin operations.

### 12.3 Cloud Functions Security

Callable functions check `context.auth` for authentication and `context.auth.token` for role-based authorization. Admin-only functions verify `token.admin === true`. Coach functions verify `token.role === 'coach'` or `token.admin === true`. HTTP webhook functions verify signatures (Stripe signature verification, Zoom verification token).

---

## 13. Business Logic: Billing, Pricing, and Financial Rules

### 13.1 Pricing Engine

The plan pricing engine computes monthly cost based on:

```
Monthly Price = Σ (sessions per week × 4.33 × session hours × hourly rate × guidance factor)
              + check-in call hours × hourly rate
              + program build hours × hourly rate (amortized)
              + admin technology fee
              + nutrition add-on (if selected)
              + CTS discount (if opted in)
```

**Guidance factors** reduce the effective rate as members progress through phases. Fully Guided sessions use the full hourly rate. Shared Guidance sessions use a reduced rate based on the live coaching window. Self-Reliant sessions use a minimal rate (coach time is 3-5 minutes per session for check-in).

**Pay-in-full discount:** 10% off the total contract value when paid upfront. Creates a one-time Stripe payment instead of a subscription, with a deferred continuation subscription that activates after the contract ends.

### 13.2 Tier System

| Tier | Active Members | Coach Split | Platform Split |
|---|---|---|---|
| Tier 1 | 1-3 | 60% | 40% |
| Tier 2 | 4-6 | 65% | 35% |
| Tier 3 | 7+ | 70% | 30% |

Tier is calculated from `activeMemberCount` on the `coach_brands` document. The `application_fee_percent` on Stripe transactions is set to the platform's split percentage.

### 13.3 Earnings Cap

Coaches have a $40,000/year earnings cap, prorated for mid-year joins. Tracked in the `earnings_caps` collection. The billing page displays progress toward the cap.

### 13.4 Profit Share

Multi-level profit sharing based on coach recruiting:

| Generation | Share |
|---|---|
| First generation (coaches you recruited) | 5% of their net revenue |
| Second generation (coaches they recruited) | 3% of their net revenue |

Profit share is capped at the recruiting coach's annual earnings cap.

### 13.5 Referral Programs

**Inter-Coach Referral:** When a coach refers a member to another coach, the referring coach receives 7% of net revenue from that member for the first year.

**Client Referral:** Members who refer 3 new members receive a full annual fee refund. GoArrive covers 33% of the refund cost.

### 13.6 Commit to Save (CTS)

CTS is an opt-in behavioral incentive:

**How it works:** Members who commit to attending all scheduled sessions receive a monthly discount. If a member misses a session (no-show), they are charged an accountability fee.

**Make-up window:** 48 hours to attend a make-up session before the fee is charged.

**Emergency waiver:** Admins can waive fees for legitimate emergencies via `waiveCtsAccountabilityFee`.

**Re-entry:** Members who lose CTS status can re-enroll after a waiting period.

**Enforcement:** The `enforceCtsAccountability` scheduled function runs every hour, checks for confirmed no-shows past the make-up window, and charges fees via Stripe.

### 13.7 Contract and Continuation

Plans have a defined contract period (configurable months). After the contract ends, members transition to month-to-month continuation at the Self-Reliant phase rate. For pay-in-full members, a deferred subscription is created at checkout with `trial_end` set to the contract end date, so billing resumes automatically.


---

## 14. Component Library

All components live in `/apps/goarrive/components/`. Components are categorized by function and connection status.

### 14.1 Layout and Navigation

| Component | Lines | Status | Purpose |
|---|---|---|---|
| AppHeader | ~120 | **Live** | Top bar with GoArrive logo and avatar/AccountPanel trigger |
| AccountPanel | ~200 | **Live** | Slide-in drawer with profile, settings links, sign out |
| TabBar | ~180 | **Live** | Bottom tab bar with role-based tab visibility |

### 14.2 Member Management

| Component | Lines | Status | Purpose |
|---|---|---|---|
| MemberDetail | ~1,400 | **Live** | Full-screen member hub with 14 action tiles |
| QuickAddMember | ~250 | **Live** | Multi-step modal for manually adding members |
| MemberCard | ~100 | **Live** | Member row in the members list |

### 14.3 Plan System

| Component | Lines | Status | Purpose |
|---|---|---|---|
| PlanView | ~800 | **Live** | Shared plan renderer (used by coach and member) |
| PlanEditor | ~600 | **Live** | Coach-side plan editing controls |
| CtsOptInModal | ~150 | **Live** | Commit to Save opt-in explanation and toggle |
| GoalPicker | ~120 | **Live** | Multi-select goal picker with emoji and color |

### 14.4 Scheduling

| Component | Lines | Status | Purpose |
|---|---|---|---|
| ScheduleModal | ~350 | **Live** | Recurring slot creation/management |
| SessionCard | ~180 | **Live** | Session instance display card |
| CalendarView | ~250 | **Live** | Week grid calendar visualization |
| CheckInCard | ~100 | **Live** | Daily coach check-in card |

### 14.5 Workout System (Partially Orphaned)

| Component | Lines | Status | Purpose |
|---|---|---|---|
| WorkoutPlayer | ~500 | **Orphaned** | Full-screen workout playback with timer and movement cycling |
| WorkoutForm | ~350 | **Orphaned** | Workout creation/editing form |
| WorkoutDetail | ~200 | **Orphaned** | Workout detail view |
| MovementForm | ~280 | **Orphaned** | Movement creation/editing form |
| MovementDetail | ~150 | **Orphaned** | Movement detail view |
| AssignWorkoutModal | ~250 | **Live** | Modal for assigning a workout to a member (connected via MemberDetail tile) |
| AssignedWorkoutsList | ~194 | **Orphaned** | List of workouts assigned to a member |

**Total orphaned workout code: 1,674 lines.** These components are built but not imported by any page route. They represent significant development investment that needs to be connected to the Workouts and Movements pages (currently "Coming Soon" placeholders).

### 14.6 Shared UI

| Component | Lines | Status | Purpose |
|---|---|---|---|
| LoadingSkeleton | ~80 | **Live** | Skeleton loading states for perceived performance |
| ErrorBoundary | ~60 | **Live** | Crash resilience wrapper |
| FloatingDropdown | ~120 | **Live** | Portal-based dropdown for ScrollView contexts |

---

## 15. Design System

### 15.1 Color Palette

| Token | Hex | Usage |
|---|---|---|
| `background` | `#0F1117` | App background, dark theme base |
| `surface` | `#1A1D27` | Cards, modals, elevated surfaces |
| `surfaceLight` | `#242836` | Hover states, secondary surfaces |
| `primary` | `#7BA05B` | CTAs, success states, sage green |
| `secondary` | `#7BA7D4` | Links, active states, steel blue |
| `accent` | `#F5A623` | Highlights, badges, gold |
| `text` | `#E8EAF0` | Primary text |
| `textMuted` | `#7A7F94` | Secondary text, labels |
| `error` | `#E74C3C` | Error states, destructive actions |
| `border` | `#2A2E3A` | Subtle borders, dividers |

### 15.2 Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| Headings | Inter | 24-32px | 700 (Bold) |
| Subheadings | Inter | 18-20px | 600 (SemiBold) |
| Body | Inter | 14-16px | 400 (Regular) |
| Labels | Inter | 12-13px | 500 (Medium) |
| Badges | Inter | 10-11px | 600 (SemiBold) |

### 15.3 Spacing and Layout

The design system uses an 8px base grid. Common spacing values: 4px (tight), 8px (default), 12px (comfortable), 16px (section gap), 24px (card padding), 32px (section padding). Cards use 12px border-radius. Buttons use 8px border-radius. The bottom tab bar height is 64px plus safe area inset.

### 15.4 Design Principles

**Dark-first.** The entire app uses a dark theme. All design decisions assume dark backgrounds.

**Mobile-first.** Every layout is designed for mobile viewport first, then adapted for web. Form fields must not trigger zoom on mobile. Bottom navigation must have sufficient tap targets.

**One component, one truth.** When coach and member see the same data (e.g., the plan), they use the same component with a role flag. This prevents drift between views.

**Progressive disclosure.** Show what matters now. Reveal complexity on demand. The dashboard should not be a wall of metrics.

---

## 16. Feature Inventory and Status

This is the authoritative list of all planned and built features. Status definitions: **Built** (live and functional), **Partial** (components exist but not fully wired), **Missing** (not yet started), **Abandoned** (was planned but should not be built).

### 16.1 Core Platform

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-01 | Member Intake (8-step wizard) | **Built** | Custom-built, replaced JotForm |
| F-02 | Coach Invite and Onboarding | **Built** | Admin invite flow with token validation |
| F-03 | Role-Based Access Control | **Built** | Three roles with Firebase custom claims |
| F-04 | Admin Coach Impersonation | **Built** | With gold banner and event logging |
| F-05 | Multi-Tenant Data Isolation | **Built** | coachId-based with Firestore rules |

### 16.2 Plan System

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-06 | Plan Builder (3-phase, pricing engine) | **Built** | Most complex page in the app |
| F-07 | Plan Presentation and Notification | **Built** | Status transitions with push notification |
| F-08 | Plan Acceptance and Checkout | **Built** | Stripe Checkout integration |
| F-09 | Shared Plan Viewer (public URL) | **Built** | HTTP function, no auth required |
| F-10 | Plan Phase Auto-Transition | **Built** | Daily cron at 3:00 AM ET |

### 16.3 Scheduling and Sessions

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-11 | Recurring Slot Management | **Built** | Create, update, delete with conflict checking |
| F-12 | Session Instance Generation | **Built** | Daily cron, 14-day lookahead |
| F-13 | Zoom Room Allocation | **Built** | Personal + shared pool, auto-allocation every 15 min |
| F-14 | Session Reminders | **Built** | Email, SMS, push (mock providers for SMS/push) |
| F-15 | No-Show Detection | **Built** | Every 30 min with configurable grace period |
| F-16 | Skip Request Flow | **Built** | Member request → coach approval/auto-approval |
| F-17 | Single-Instance Reschedule | **Built** | Via rescheduleInstance callable |
| F-18 | Calendar View (week grid) | **Built** | Coach scheduling page |

### 16.4 Billing and Payments

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-19 | Stripe Connect Onboarding | **Built** | Standard mode with full status tracking |
| F-20 | Monthly Subscription Billing | **Built** | Via Stripe Checkout Sessions |
| F-21 | Pay-in-Full with Deferred Continuation | **Built** | 10% discount, auto-continuation subscription |
| F-22 | Tier-Based Revenue Split | **Built** | 60/40, 65/35, 70/30 based on active members |
| F-23 | CTS Accountability Enforcement | **Built** | Hourly cron with make-up window and waiver |
| F-24 | Billing Dashboard (coach view) | **Built** | Tier, revenue, cap, profit share, referrals, ledger |
| F-25 | Earnings Cap Tracking | **Partial** | Collection exists, UI displays, but no automated enforcement at cap |
| F-26 | Profit Share Computation | **Partial** | Collection and UI exist, but no automated monthly close process |
| F-27 | Inter-Coach Referral Tracking | **Partial** | Collection and UI exist, but no automated computation |
| F-28 | Client Referral Program | **Partial** | Collection exists, no automated refund logic |

### 16.5 Workout and Movement System

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-29 | Movement Library (coach CRUD) | **Partial** | MovementForm and MovementDetail components built (430 lines) but Movements page is a placeholder |
| F-30 | Workout Builder (coach CRUD) | **Partial** | WorkoutForm and WorkoutDetail components built (550 lines) but Workouts page is a placeholder |
| F-31 | Workout Assignment | **Partial** | AssignWorkoutModal is live (connected via MemberDetail tile), but AssignedWorkoutsList is orphaned |
| F-32 | Workout Player (member) | **Partial** | WorkoutPlayer component built (500 lines) but not connected to any member route |
| F-33 | Member Workout Page | **Missing** | No `/(member)/workouts` route exists |
| F-34 | "Today's Workout" Card on Member Home | **Missing** | Member home has no workout awareness |
| F-35 | Movement Media Delivery | **Missing** | No media upload, storage, or playback pipeline |
| F-36 | Workout Session Logging | **Missing** | No session_logs collection or completion tracking |

### 16.6 Coach-Member Interaction

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-37 | In-App Messaging | **Missing** | No message_threads or direct messaging system |
| F-38 | Journal (Glow and Grow) | **Missing** | Tile exists in MemberDetail but no journal collection or UI |
| F-39 | Coach Review and Reaction | **Missing** | No coach feedback loop after workout completion |
| F-40 | Check-in Call (Zoom) | **Missing** | Tile exists but no dedicated check-in flow |
| F-41 | Progress Photos and Measurements | **Missing** | Tile exists but no implementation |
| F-42 | Coach Notes | **Missing** | Tile exists but no notes collection or UI |

### 16.7 Notifications

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-43 | Email Notifications | **Built** | Live via Resend when API key is set |
| F-44 | SMS Notifications | **Partial** | Twilio configured but mock-only in production |
| F-45 | Push Notifications (FCM) | **Partial** | Client token registration works; server-side sending is mock-only |
| F-46 | In-App Notification Feed | **Built** | notifications collection with read/unread |

### 16.8 Admin Operations

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-47 | Provider Health Dashboard | **Built** | Zoom, Email, SMS, Push status monitoring |
| F-48 | Dead Letter Queue | **Built** | Failed job tracking with retry and resolve |
| F-49 | Session Event Log | **Built** | Filterable audit trail |
| F-50 | Recording Status Dashboard | **Built** | Ready, processing, missing, failed |
| F-51 | CTS Billing Admin | **Built** | Fee tracking and waiver management |
| F-52 | Coach Management and Invites | **Built** | List, invite, view members, impersonate |

### 16.9 Abandoned Features

| ID | Feature | Status | Reason |
|---|---|---|---|
| F-53 | CoachAssistant Role | **Abandoned** | Three-role model is sufficient; adds unnecessary complexity |
| F-54 | Encourager Role | **Abandoned** | Not needed at current stage |
| F-55 | Zoom Embedded SDK | **Abandoned** | External join links are simpler and more reliable |
| F-56 | JotForm Integration | **Abandoned** | Replaced by custom intake wizard |
| F-57 | Calendly Integration | **Abandoned** | Replaced by custom scheduling system |
| F-58 | Otter.ai Transcription | **Abandoned** | Not needed until check-in calls are built |
| F-59 | White-Label / Custom Domains | **Abandoned** | Premature; focus on core product loop first |
| F-60 | MySQL/TiDB/Drizzle Backend | **Abandoned** | Firebase stack is correct for this product |

---

## 17. Build Priority Roadmap

Priorities are ordered by impact on the core product loop. Each tier must be substantially complete before moving to the next.

### Tier 1: Complete the Core Product Loop (Highest Priority)

The single most important gap. The app organizes coaching but does not yet deliver workouts.

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 1.1 | Wire Movements page to MovementForm/MovementDetail components | Nothing | Small — components exist, need page integration |
| 1.2 | Wire Workouts page to WorkoutForm/WorkoutDetail components | 1.1 | Small — components exist, need page integration |
| 1.3 | Wire AssignedWorkoutsList into member detail and member home | 1.2 | Small — component exists |
| 1.4 | Create `/(member)/workouts` route with "Today's Workout" card | 1.3 | Medium — new member page |
| 1.5 | Wire WorkoutPlayer to member workout page | 1.4 | Medium — component exists, needs route and data flow |
| 1.6 | Build movement media upload and storage pipeline | 1.1 | Medium — Firebase Storage or S3, upload UI, media processing |
| 1.7 | Build workout session logging (session_logs collection) | 1.5 | Medium — new collection, completion tracking |

### Tier 2: Close the Feedback Loop

Once members can play workouts, the coach needs to see it and respond.

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 2.1 | Build Journal system (Glow and Grow prompts) | Tier 1 | Medium — new collection, member UI, coach view |
| 2.2 | Build Coach Review and Reaction (emoji/comment on completions) | 2.1 | Medium — new UI, push notification |
| 2.3 | Add workout completion badges to member cards in coach view | Tier 1 | Small — UI update to MemberCard |
| 2.4 | Implement live push notifications (FCM server-side) | Nothing | Medium — replace mock provider with real FCM |
| 2.5 | Implement live SMS notifications (Twilio) | Nothing | Small — replace mock provider with real Twilio |

### Tier 3: Coach Command Center Refinement

Make the coach dashboard a true command center.

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 3.1 | "Members at Risk" widget (missed sessions, low streak, no journal) | Tier 2 | Medium |
| 3.2 | "Today's Schedule" widget with live presence indicators | Nothing | Medium |
| 3.3 | Sessions and Stats tile in MemberDetail | Tier 1 | Medium |
| 3.4 | Coach Notes tile in MemberDetail | Nothing | Small |
| 3.5 | Check-in Call tile (dedicated Zoom flow) | Nothing | Medium |

### Tier 4: Financial Automation

Currently the billing collections exist and the UI displays them, but automated computation is missing.

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 4.1 | Monthly close process (automated profit share computation) | Nothing | Large |
| 4.2 | Earnings cap enforcement (pause payouts at cap) | 4.1 | Medium |
| 4.3 | Inter-coach referral automated computation | 4.1 | Medium |
| 4.4 | Client referral automated refund logic | Nothing | Medium |

### Tier 5: Communication

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 5.1 | In-app messaging (message_threads collection, real-time) | Nothing | Large |
| 5.2 | Progress photos and measurements | Nothing | Medium |
| 5.3 | Coach Videos sharing | Nothing | Medium |

### Tier 6: Secondary Expansions

| Priority | What to Build | Depends On | Estimated Scope |
|---|---|---|---|
| 6.1 | Group workouts | Tier 1 | Large |
| 6.2 | Deeper analytics (platform-wide and per-coach) | Tier 2 | Large |
| 6.3 | Password Reset tile (send reset link to member) | Nothing | Small |
| 6.4 | Referrals tile in MemberDetail | Tier 4 | Small |

---

## 18. Non-Functional Requirements

These requirements apply to all features, current and future.

| Category | Requirement | Target |
|---|---|---|
| Timer Accuracy | Workout player timer drift | Less than or equal to 50ms per minute |
| API Latency | Cloud Function response time (p95) | Less than 300ms for callable functions |
| Media Delivery | Movement clip load time on 4G | Less than 2 seconds to first frame |
| Media Delivery | Movement clip load time on gym Wi-Fi | Less than 4 seconds to first frame |
| Offline Tolerance | Workout player behavior on connection loss | Continue current movement, queue completion log |
| Push Delivery | Notification delivery latency | Less than 30 seconds from trigger |
| Availability | Platform uptime | 99.5% monthly (Firebase SLA) |
| Data Consistency | Stripe webhook idempotency | All events deduplicated via billingEvents collection |
| Security | Auth token refresh | Automatic via Firebase SDK |
| Performance | Member home first meaningful paint | Less than 1.5 seconds on 4G |
| Performance | Plan builder load time | Less than 2 seconds for plans with 3 phases |
| Scalability | Concurrent Zoom sessions per shared room | Configurable via maxConcurrentMeetings |
| Scalability | Session instance generation lookahead | 14 days (configurable) |

---

## 19. Do-Not-Build List

These items were in the original vision document (OG Blueprint v1.0) but should NOT be implemented. Each entry includes the reasoning.

### 19.1 CoachAssistant Role

**OG Blueprint said:** A fourth role for assistant coaches who help manage a coach's practice with limited permissions.

**Why not:** The three-role model (admin, coach, member) is clean, well-tested, and covers all current use cases. Adding a fourth role would require changes to every Firestore security rule, every route guard, every Cloud Function authorization check, and every UI component that checks roles. The complexity cost far exceeds the benefit at this stage. If assistant functionality is needed later, it should be implemented as a permission layer within the existing coach role, not as a new role.

### 19.2 Encourager Role

**OG Blueprint said:** A supporter role for friends/family who can see limited member progress and send encouragement.

**Why not:** Same architectural cost as CoachAssistant. The concept is valuable but premature. If implemented later, it should be a lightweight read-only view with a share token, not a full RBAC role.

### 19.3 MySQL / TiDB / Drizzle ORM Backend

**OG Blueprint said:** The data layer should use MySQL (TiDB) with Drizzle ORM and a Fastify API server.

**Why not:** The entire application was built on Firebase (Firestore + Cloud Functions) and this was the correct decision. Firestore's real-time listeners, security rules, and serverless functions are a better fit for this product's needs. There is zero MySQL, TiDB, Drizzle, or Fastify code in the project. Migrating would be a full rewrite with no user-facing benefit.

### 19.4 S3 for Media Storage

**OG Blueprint said:** Use AWS S3 for storing movement media and user uploads.

**Why not:** Firebase Storage is the natural choice for a Firebase-native app. It integrates with Firebase Security Rules, provides CDN delivery, and requires no additional infrastructure. When the media pipeline is built (Tier 1.6), use Firebase Storage unless a specific S3 advantage is identified.

### 19.5 Zoom Embedded SDK (Split-Screen / Picture-in-Picture)

**OG Blueprint said:** Embed Zoom directly in the app using the Zoom Video SDK for a split-screen experience where the member sees the workout player and the coach simultaneously.

**Why not:** The Zoom Video SDK adds massive bundle size, platform-specific complexity (different SDKs for web, iOS, Android), and ongoing maintenance burden. External Zoom join links work reliably across all platforms. The member can use split-screen or picture-in-picture at the OS level if they want both views. Build the workout player first; if embedded Zoom becomes a clear user need later, evaluate then.

### 19.6 JotForm Integration

**OG Blueprint said:** Use JotForm for member intake forms.

**Why not:** Already replaced by a custom 8-step intake wizard that is fully integrated with Firebase Auth and Firestore. The custom solution is better because it creates the member account on the final step, writes directly to the correct collections, and provides a branded experience.

### 19.7 Calendly Integration

**OG Blueprint said:** Use Calendly for session scheduling.

**Why not:** Already replaced by a full custom scheduling engine with 10+ Cloud Functions, recurring slots, session instances, Zoom allocation, Google Calendar sync, and conflict checking. The custom solution is better because it supports the three-phase guidance model, CTS accountability, and platform-level Zoom room management.

### 19.8 White-Label / Custom Domains

**OG Blueprint said:** Allow coaches to use their own branding and custom domains.

**Why not:** Premature optimization. The `coach_brands` collection exists with a `canvaDesignId` field, suggesting some branding was considered. But full white-labeling (custom domains, custom logos, custom color schemes) is a significant infrastructure project that should not be attempted until the core product loop is complete and coaches are actively requesting it.

---

## 20. Open Questions

These questions from the original vision document remain unresolved. They should be answered as the relevant features are built.

### 20.1 Resolved Questions

| Question | Resolution |
|---|---|
| Which database? MySQL or Firestore? | **Firestore.** Decision made and implemented. |
| Which scheduling tool? Calendly or custom? | **Custom.** Full scheduling engine built. |
| Which intake tool? JotForm or custom? | **Custom.** 8-step wizard built. |
| Which payment processor? | **Stripe Connect (Standard mode).** Implemented. |
| Which video platform? | **Zoom API with external join links.** Implemented. |

### 20.2 Still Open Questions

| Question | Context | When to Decide |
|---|---|---|
| Firebase Storage or S3 for movement media? | Firebase Storage is the natural choice, but S3 may offer better CDN/transcoding options | When building Tier 1.6 (media pipeline) |
| Should the workout player support offline mode? | Gym Wi-Fi is unreliable; offline would require local caching of movement media | When building Tier 1.5 (workout player wiring) |
| What is the make-up session UX for CTS? | The 48-hour window is enforced server-side, but there is no member-facing UI for scheduling a make-up | When refining CTS experience |
| Should coaches be able to set their own hourly rate, or is it platform-controlled? | Currently configurable per plan; unclear if there should be a minimum or maximum | Business decision |
| What happens when a coach hits the $40K earnings cap mid-year? | Collection tracks it, UI displays it, but no automated enforcement (pause payouts, notify, etc.) | When building Tier 4.1 (monthly close) |
| Should the journal be required or optional after workouts? | Research suggests optional but encouraged; forced journaling increases abandonment | When building Tier 2.1 (journal system) |
| How should group workouts work? | Multiple members in the same Zoom room with synchronized workout player? Or independent players with shared accountability? | When building Tier 6.1 (group workouts) |
| What is the Encourager role's actual scope? | The OG Blueprint mentioned it but never defined permissions or UI | Deferred until core loop is complete |
