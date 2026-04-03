# GoArrive — GitHub Copilot Instructions

## Project
GoArrive is an online fitness coaching platform built with React Native + Expo + Firebase. Single codebase for web, iOS, and Android. Multi-tenant architecture with three roles: platformAdmin, coach, member.

## Tech Stack
React Native, Expo, Expo Router, TypeScript (strict), Cloud Firestore, Firebase Auth, Firebase Cloud Functions Gen 2, Firebase Hosting, Stripe Connect, Zoom API, Google Calendar API.

No MySQL, TiDB, Drizzle, Fastify, or S3 — ever.

## Authentication Rules
- Always use `effectiveUid` or `claims.coachId` from `useAuth()` hook — never `user.uid` directly.
- This is critical for admin impersonation to work. Platform admins can impersonate coaches.
- All coach-scoped Firestore queries must include `where('coachId', '==', coachId)`.

## Code Conventions
- `camelCase` for Firestore documents, TypeScript interfaces, props, and state.
- Product terminology: "coach" not trainer, "member" not client, "movement" not exercise, "Command Center" not dashboard.
- Use `FlatList` for lists over 500 items.
- Use `thumbnailUrl` for initial media loads, not full video.
- Workout creation starts on a blank block canvas, never a metadata form.

## Three Roles Only
- `platformAdmin`, `coach`, `member` — no fourth role.
- Roles set via Firebase Custom Claims (Admin SDK only).

## File Structure
- `apps/goarrive/` — Main Expo app (frontend)
- `apps/goarrive/app/(app)/` — Coach/admin routes
- `apps/goarrive/app/(member)/` — Member routes
- `apps/goarrive/lib/AuthContext.tsx` — Auth context with admin impersonation
- `functions/src/` — Firebase Cloud Functions (backend)
- `.claude/` — Detailed knowledge base documents

## Do Not Introduce
- Any relational database (MySQL, TiDB, Drizzle)
- AWS services (S3, etc.)
- Fastify, JotForm, Calendly, Zoom Embedded SDK
- Additional user roles beyond the three defined
- Form-heavy workout creation flows
