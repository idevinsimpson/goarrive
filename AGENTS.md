# GoArrive — Agent Instructions

## Project Overview
GoArrive (G->A) is an online fitness coaching platform and coach operating system. Single codebase across web, iOS, and Android using React Native + Expo + Expo Router + Firebase. Multi-tenant, role-based architecture with three roles: platformAdmin, coach, member.

## Tech Stack
- Frontend: React Native + Expo (web, iOS, Android)
- Routing: Expo Router (file-based, role-based route groups)
- Language: TypeScript (strict mode)
- Database: Cloud Firestore (NoSQL, 40+ collections)
- Auth: Firebase Authentication (email/password + custom claims)
- Backend: Firebase Cloud Functions Gen 2 (52+ functions)
- Hosting: Firebase Hosting
- Payments: Stripe Connect (Standard mode)
- Video: Zoom API
- Calendar: Google Calendar API (OAuth2)

**There is NO MySQL, TiDB, Drizzle, Fastify, or S3 in this project.**

## Build & Test
```bash
# Install dependencies
cd apps/goarrive && npm install

# Run unit/integration tests (Vitest)
cd apps/goarrive && npm run test:vitest

# Run E2E tests (Playwright)
npm run test:e2e

# Deploy to staging (always do this before production)
cd apps/goarrive && npm run deploy:staging

# Deploy to production (requires explicit approval)
cd apps/goarrive && npm run deploy
```

## Critical Rules

### Authentication & Data Access
- Always use `effectiveUid` or `claims.coachId` from `useAuth()` — never `user.uid` directly. This breaks admin impersonation.
- All coach-scoped Firestore queries MUST include `where('coachId', '==', coachId)`.
- Privacy enforcement happens at Firestore Rules layer, not just app logic.

### Role System
- Three roles only: `platformAdmin`, `coach`, `member`. No fourth role (no CoachAssistant, no Encourager).
- Roles are set via Firebase Custom Claims through Admin SDK only.

### Code Style
- `camelCase` everywhere: Firestore documents, TypeScript interfaces, props, state.
- Product language: "coach" (not trainer), "member" (not client), "movement" (not exercise), "Command Center" (not dashboard).
- Use `FlatList` or `react-native-draggable-flatlist` for lists over 500 items.
- Use `thumbnailUrl` for initial media loads — never full video on first render.

### Build Tab & Workouts
- Workout creation starts on a blank block canvas, NOT a metadata form.
- The Build tab is a unified creative workspace replacing separate Workouts and Movements tabs.
- Movements use 4:5 aspect ratio.

### Agent Commands
- `/setup`: Run this first to verify your GitHub and Firebase credentials.
- `/ship`: Run this to automatically type-check, test, build, deploy to staging, and open a PR.

### Deployment
- Always use the `/ship` command to deploy to staging (`goarrive--staging.web.app`).
- Never deploy to production (`goarrive.fit`) without explicit approval.

### Do Not Build
- MySQL, TiDB, Drizzle, S3, Fastify, JotForm, Calendly, Zoom Embedded SDK
- CoachAssistant or Encourager roles
- White-label / custom domains

## Project Structure
```
apps/goarrive/          # Main Expo/React Native app
  app/(app)/            # Coach/admin routes
  app/(member)/         # Member routes
  app/(auth)/           # Auth routes
  components/           # Shared components
  hooks/                # Custom hooks
  lib/                  # Auth context, Firebase init, types
  utils/                # Utilities
functions/src/          # Firebase Cloud Functions backend
scripts/                # Build/deploy helper scripts
.claude/                # Detailed knowledge base (17 files)
```

## Knowledge Base
For deep dives, see the `.claude/` directory:
- `product-identity.md` — Brand identity, roles, core product loop
- `architecture-and-stack.md` — Full tech stack and routing
- `data-model.md` — Firestore schema and query patterns
- `coding-patterns.md` — Admin impersonation, virtualization, pitfalls
- `file-map.md` — Complete map of all routes, components, hooks, utilities
- `cloud-functions-reference.md` — All 52+ Cloud Functions by category
- `build-system-vision.md` — Build tab, workout creation, playbooks
- `billing-and-business-rules.md` — Stripe Connect, earnings caps, CTS
- `design-system.md` — Colors, typography, layout conventions
- `current-state-and-roadmap.md` — What's built, what's missing, priorities
- `do-not-build.md` — Rejected features and technologies
- `known-issues-and-lessons.md` — Resolved bugs and architectural decisions
- `testing-policy.md` — Testing strategy and execution
- `deployment-and-build.md` — Build process and Firebase Hosting config
- `multi-agent-workflow-guide.md` — Staging-first protocol and agent coordination
- `agent-task-routing.md` — **Mandatory.** Official workflow split between @maia (Slack/code) and Manus (browser/dashboard)
