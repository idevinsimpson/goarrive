# GoArrive Development Guidelines

Welcome to the GoArrive repository. This document serves as the central hub for AI agents (like Claude Code) to understand the project's architecture, rules, and institutional knowledge.

## Project Overview
GoArrive (G➲A) is an online fitness coaching platform and coach operating system. It provides a business-in-a-box for independent coaches and a premium, personalized experience for their members. The platform uses a multi-tenant, role-based architecture.

## Core Rules & Guardrails

### 1. Architecture & Tech Stack
The platform is built on a single codebase using React Native and Expo for web, iOS, and Android, utilizing Expo Router for navigation. Developers must not introduce platform-specific fragmentation unless strictly necessary. The backend relies entirely on the Firebase suite, including Firestore, Authentication, Cloud Functions Gen 2, and Hosting.

Crucially, there is NO MySQL, TiDB, Drizzle, Fastify, or S3 in this project. All development must stick exclusively to the established Firebase stack.

### 2. Role System & Authentication
The system enforces a strict three-role model consisting of `platformAdmin`, `coach`, and `member`. Roles such as "CoachAssistant" or "Encourager" do not exist and should not be built.

Platform Admins possess the capability to impersonate coaches. To support this, developers must always use `effectiveUid` or `claims.coachId` from the `useAuth()` hook when querying Firestore or triggering Cloud Functions. Using `user.uid` directly for data fetching will break the impersonation functionality.

### 3. Data Model & Security
Data isolation is paramount. Almost all queries initiated by a coach must include `where('coachId', '==', coachId)` to ensure tenant isolation. Furthermore, all privacy enforcement happens at the Firestore Rules layer, not just within the application logic.

The codebase mandates `camelCase` for Firestore documents, TypeScript interfaces, props, and state. Live collection names must be preserved unless a formal migration plan is executed.

### 4. Product Philosophy
Every feature developed must support the core product loop: the coach builds a workout, the member plays the workout, the member reflects or journals, and the coach reviews and responds.

Development efforts must focus on reducing friction. This means minimizing the steps from opening the app to starting a workout, and from finishing a workout to receiving coach acknowledgment.

Consistent product language is required across all interfaces. Use "coach" instead of trainer, "member" instead of client, "movement" instead of exercise, and "Command Center" for coach-facing dashboards.

### 5. UI & Component Guidelines
The "Build" tab serves as a unified visual workspace, replacing the formerly separate Workouts and Movements tabs. Workout creation must utilize the block-based canvas approach rather than massive metadata forms.

For performance, `FlatList` or `react-native-draggable-flatlist` must be used for rendering large lists exceeding 500 items. When handling media, prioritize preloading videos over GIFs, and use lightweight thumbnails (`thumbnailUrl`) for initial loads to conserve memory.

## Knowledge Base
For deep dives into specific areas, consult the files in the `.claude/` directory:

| Document | Description |
|---|---|
| `.claude/product-identity.md` | Details the brand identity, role definitions, and the core product loop. |
| `.claude/architecture-and-stack.md` | Covers tech stack specifics, routing configurations, and media delivery rules. |
| `.claude/data-model.md` | Outlines the Firestore schema, essential query patterns, and security constraints. |
| `.claude/coding-patterns.md` | Explains admin impersonation, virtualization techniques, UI guidelines, and common pitfalls. |
| `.claude/file-map.md` | Complete map of all page routes, components, hooks, utilities, and backend files. |
| `.claude/cloud-functions-reference.md` | Reference for all 52+ Cloud Functions organized by category. |
| `.claude/build-system-vision.md` | The Build tab vision including workout creation, playbooks, and member playback. |
| `.claude/billing-and-business-rules.md` | Stripe Connect, earnings caps, CTS, and financial guardrails. |
| `.claude/scheduling-and-integrations.md` | Scheduling system, Zoom, Google Calendar, notifications, and AI/voice integrations. |
| `.claude/design-system.md` | Brand colors, typography, layout conventions, and UX principles. |
| `.claude/deployment-and-build.md` | Build process, deployment workflow, and Firebase Hosting configuration. |
| `.claude/current-state-and-roadmap.md` | What is built, what is missing, and the build priority order. |
| `.claude/do-not-build.md` | Features and technologies explicitly rejected from the roadmap. |
| `.claude/known-issues-and-lessons.md` | Resolved bugs, performance risks, and architectural decisions to preserve. |
| `.claude/testing-and-quality.md` | Testing infrastructure, quality checklist, and deployment verification. |
| `.claude/existing-docs-index.md` | Index of all existing documentation files with relevance ratings. |

## Recent Context
Recent development has focused heavily on enhancing the coach and admin experience. Key updates include fixing admin impersonation for lazy-loaded components and implementing prorated earnings caps with yearly admin configuration. The team also built a bulk movement upload feature utilizing AI auto-analysis and enhanced the workout thumbnail grid with dynamic scaling (4:5 aspect ratio). Additionally, sorting logic across all libraries was updated to prioritize the most recently edited items.

When working on new features, developers should prioritize improvements to the workout and movement system, the quality of the workout player, and the efficiency of coach review loops.
