# AGENTS.md

This file is the universal instruction set for all AI coding agents working on the GoArrive repository.

## 1. Staging-First Protocol (CRITICAL)
- **Never deploy to `goarrive.fit` (production) without explicit approval.**
- Always deploy to the staging environment first:
  `cd apps/goarrive && npm run deploy:staging`
- Notify the user with the staging URL (`https://goarrive--staging.web.app`) and wait for approval.
- Once approved, deploy to production:
  `cd apps/goarrive && npm run deploy`

## 2. Architecture & Tech Stack
- **Stack:** React Native + Expo + Expo Router + Firebase (Firestore, Auth, Cloud Functions Gen 2, Hosting) + Stripe Connect + Zoom + Google Calendar.
- **Banned Tech:** NO MySQL, TiDB, Drizzle, Fastify, S3, JotForm, Calendly, or Zoom Embedded SDK.
- **Roles:** Only `platformAdmin`, `coach`, and `member`. Do not create a fourth role (e.g., no CoachAssistant).

## 3. Coding Rules
- **Authentication:** Always use `effectiveUid` or `claims.coachId` from `useAuth()`. Never use `user.uid` directly (it breaks admin impersonation).
- **Queries:** Every coach-scoped Firestore query MUST include `where('coachId', '==', coachId)`.
- **Naming:** Use `camelCase` for Firestore documents, TypeScript interfaces, props, and state.
- **Product Language:** Use "coach" (not trainer), "member" (not client), "movement" (not exercise), and "Command Center" (for coach dashboards).
- **Performance:** Use `FlatList` or `react-native-draggable-flatlist` for lists over 500 items. Use `thumbnailUrl` for initial media loads.

## 4. Current Build Priorities
The biggest gap is the workout delivery experience.
1. Wire disconnected components (`WorkoutPlayer.tsx`, `AssignedWorkoutsList.tsx`, `PostWorkoutJournal.tsx`, `CoachReviewQueue.tsx`).
2. Build member workout page.
3. Improve workout player quality.

*Note: Workout creation starts on a blank block canvas, NOT a metadata form.*

## 5. Testing
- **Logic (Vitest):** `cd apps/goarrive && npm run test:vitest`
- **UI Flows (Playwright):** `npm run test:e2e`

## 6. Deep Knowledge
For detailed documentation on specific areas (data models, billing rules, design system, etc.), read the markdown files in the `.claude/` directory.
