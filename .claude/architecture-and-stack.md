# GoArrive Architecture & Tech Stack

## Technology Stack
GoArrive is a unified app with one codebase across web, iOS, and Android. The architecture is built around the following stack:

| Layer | Technology |
|---|---|
| **Frontend** | React Native + Expo (web, iOS, Android) |
| **Routing** | Expo Router (file-based, role-based route groups) |
| **Language** | TypeScript (strict mode) |
| **Database** | Cloud Firestore (NoSQL, 40+ collections) |
| **Auth** | Firebase Authentication (email/password + custom claims) |
| **Backend** | Firebase Cloud Functions Gen 2 (52+ functions) |
| **Hosting** | Firebase Hosting (immutable caching for hashed assets, no-cache for SPA) |
| **Payments** | Stripe Connect (Standard mode) |
| **Video** | Zoom API (personal rooms + shared pool) |
| **Calendar** | Google Calendar API (OAuth2, posting + conflict checking) |
| **Push** | Firebase Cloud Messaging (mock-only on server) |
| **Email** | Resend API |
| **SMS** | Twilio |

**Important Note:** There is NO MySQL, NO TiDB, NO Drizzle, NO Fastify, and NO S3 in this project. If any older document references these, it is describing an abandoned pre-code vision.

## Implementation Conventions
- Use `camelCase` in Firestore documents, TypeScript interfaces, props, and state.
- Preserve live collection names unless there is an explicit migration plan.
- Do not silently refactor data shape in unrelated work.
- Do not replace working patterns just because a theoretically cleaner model exists.
- Internal implementation names may remain technical, but product-facing language must stay clear and on-brand.

## App Layout & Routing
The application uses Expo Router's Stack navigator with route groups:
- `(auth)`: Login/signup screens (unauthenticated)
- `(app)`: Coach/admin dashboard (authenticated, coach/admin role)
- `(member)`: Member dashboard (authenticated, member role)
- `intake`: Public intake form (no auth required)

The `(app)` layout features a bottom tab navigation for coaches, with proper safe-area handling for PWA/iOS/Android.

## Authentication & Role System
Authentication is managed via `AuthContext.tsx`, which provides the current user, custom claims (`role`, `coachId`, `tenantId`), and loading state.

### Custom Claims Structure
- `role`: 'platformAdmin' | 'coach' | 'member'
- `coachId`: string (the coach's UID)
- `tenantId`: string (same as coachId for coaches; coachId for members)
- `admin`: boolean

### Admin Impersonation
Platform Admins can impersonate coaches to view their dashboard and data. This is handled in `AuthContext` via `effectiveClaims` and `effectiveUid`, which override the `coachId` when an admin is impersonating. This is a critical pattern to maintain.

## Performance Considerations
- **Virtualization**: Use `FlatList` with virtualization for performance with large lists (e.g., 500+ movements).
- **Media**: GIF memory consumption is a known risk at scale. The system uses lightweight thumbnails/posters, swapping to full media quickly.
- **Client-Side Processing**: Client-side sorting and filtering use `useMemo` for optimization.
- **Caching**: Firebase Hosting uses immutable caching for hashed assets (`/_expo/static/js/**/*.js`) and no-cache for SPA routes (`/index.html`).

## Media Delivery Rules
- For short looped movement demos, use MP4/H.264 as the baseline delivery format.
- Use WebM as an enhancement where supported.
- Use muted or silent looping media so autoplay is reliable.
- Prefetch the next 1–3 movement clips during a workout to reduce gym-network friction.
- Prioritize preloading videos to avoid displaying GIFs as a fallback. If a GIF must be used, ensure it's only when video download speeds are insufficient.
