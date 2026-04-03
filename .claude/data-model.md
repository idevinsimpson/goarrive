# GoArrive Data Model & Firestore Schema

## Core Principles
GoArrive relies on Cloud Firestore as its primary database, managing over 40 distinct collections. The schema is fundamentally designed to support multi-tenant, role-based access, ensuring data isolation and security.

Crucially, all privacy enforcement is handled at the Firestore Rules layer rather than solely at the application layer. This robust approach prevents unauthorized access even if client-side checks fail. The codebase strictly adheres to `camelCase` naming conventions for Firestore documents, fields, and TypeScript interfaces to maintain consistency.

## Key Collections & Access Patterns

The platform organizes its data across several critical collections, each serving a specific role in the coaching and platform management ecosystem.

| Collection | Primary Purpose | Key Fields | Access Control |
|---|---|---|---|
| `users` | Base profile information | `displayName`, `phone`, `photoURL`, `fcmToken` | Cloud Functions manage custom claims (`role`, `coachId`, `tenantId`). Users can update safe profile fields, but roles are Admin SDK only. |
| `coaches` | Coach configuration and tenant info | `role`, `coachId`, `stripeAccountId`, `profitShareStartDate` | Written by Cloud Functions via Admin SDK during onboarding. Coaches can read their own data. |
| `members` | Member profiles and plan status | `coachId`, `role`, `planId`, `status` | Scoped strictly to the `coachId`. |
| `movements` | Core library of exercises (Build System) | `name`, `category`, `equipment`, `videoUrl`, `thumbnailUrl`, `isGlobal`, `isArchived` | Coaches read their own and global movements. Admins read all. |
| `workouts` | Workout structures composed of blocks | `name`, `description`, `coachId`, `blocks` (array), `isTemplate`, `isArchived` | Coaches manage their own workouts. Admins read all. |
| `workout_assignments` | Links a member to a scheduled workout | `memberId`, `coachId`, `workoutId`, `scheduledFor`, `status`, `completedAt` | Coaches manage assignments for their members. Members read their own. |
| `workout_logs` | Completed workout results and reflections | `memberId`, `coachId`, `workoutId`, `completedAt`, `glowText`, `growText`, `coachReviewed` | Members create logs; they are immutable post-creation. Coaches update review fields. |
| `member_plans` | Billing structure and service level | `memberId`, `coachId`, `price`, `interval`, `status` | Managed by billing logic and Stripe webhooks. |
| `session_instances` | Concrete scheduled events | `slotId`, `coachId`, `startTime`, `endTime`, `zoomUrl` | Generated from `recurring_slots`. |
| `recurring_slots` | Scheduling patterns | `coachId`, `dayOfWeek`, `startTime`, `durationMin` | Defines the pattern for generating session instances. |

## Query Patterns
Queries in GoArrive are heavily reliant on proper scoping to maintain multi-tenancy and security.

Almost all queries initiated by a coach must include `where('coachId', '==', coachId)` to ensure they only retrieve data within their tenant. For global assets, such as movements available to all coaches, queries use `where('coachId', 'in', [coachId, ''])`.

The platform employs soft deletes extensively. When querying libraries like movements or workouts, the condition `where('isArchived', '==', false)` must be included to filter out deleted items.

## Security Rules Constraints
The platform strictly forbids app-layer-only masking for sensitive data. Security rules in Firestore are the ultimate authority on data access.

During the onboarding phase, before Cloud Functions have assigned custom claims, the `isCoachOrBootstrap(coachId)` function in Firestore rules handles access. This bootstrap fallback allows a user whose UID matches the `coachId` field to act as a coach, ensuring the app functions smoothly during the transition.

When querying data, especially in components that might be accessed by a Platform Admin impersonating a coach, the `effectiveUid` from `AuthContext` must be used. This ensures that the admin views the data precisely as the impersonated coach would, maintaining the integrity of the admin override feature.
