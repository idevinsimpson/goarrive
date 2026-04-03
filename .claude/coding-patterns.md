# GoArrive Coding Patterns & Guidelines

## Core Principles
GoArrive is a unified app with a single codebase across web, iOS, and Android platforms. This strategy simplifies development and maintenance, and it should be strictly adhered to unless a platform-specific enhancement is absolutely necessary. Unnecessary architectural fragmentation must be avoided at all costs.

The product's primary goal is to reduce friction in the user journey. Every feature must aim to reduce the steps from opening the app to starting a workout, and from finishing a workout to the coach acknowledging it.

## Key Architecture Patterns

The application architecture relies on several foundational patterns to ensure scalability, performance, and security.

| Pattern | Description | Implementation Details |
|---|---|---|
| **Admin Impersonation** | Allows Platform Admins to view the dashboard as another coach. | Managed by `AuthContext.tsx` via the `adminCoachOverride` state. The `effectiveClaims` and `effectiveUid` are calculated to reflect the impersonated coach. |
| **Firestore Listeners** | Real-time updates for dashboards, lists, and logs. | The app heavily utilizes `onSnapshot` listeners. Client-side sorting and filtering use `useMemo` for performance, especially for lists under a few hundred items. |
| **Virtualization** | Efficient rendering of large lists. | `FlatList` and `react-native-draggable-flatlist` are used for lists exceeding 500 items, such as the movement and workout libraries. |
| **Cloud Functions** | Backend logic and integrations. | All heavy lifting, third-party integrations (Stripe, Zoom, ElevenLabs), and admin operations are handled by Firebase Cloud Functions Gen 2. |

When querying Firestore or triggering Cloud Functions, it is critical to always use `effectiveUid` or `claims.coachId` from the `useAuth()` hook, rather than `user.uid`. This practice guarantees that admin impersonation functions correctly across the entire application.

Business rules, especially those related to payments and billing, must be runtime-driven and auditable. Hardcoding evolving financial rules is strictly prohibited; they must reside in configuration or approved business-rule documents. Webhook-first and ledger-first patterns are mandatory for any money-moving behavior to preserve rule versioning, snapshots, and immutable financial records.

## Component & UI Guidelines

The user interface is designed around the concept of a unified creative workspace for coaches and a frictionless experience for members.

The "Build" tab replaces the previously separate Workouts and Movements tabs. Everything within this tab must feel visual and browsable, utilizing icons, folders, and assets. Movements maintain a 4:5 aspect ratio by default, while workouts are visually larger but share the same design language. Crucially, workout creation must not begin with a massive metadata form; instead, it starts with a blank build canvas where blocks are added, and details are edited later.

For media playback, preloading videos is prioritized over using GIFs as fallbacks. GIFs should only be displayed when video download speeds are insufficient, due to their high memory consumption at scale. Lightweight thumbnails (`thumbnailUrl`) are used for initial loads, swapping to full MP4 or WebM videos (`videoUrl`) only when necessary or focused. When generating audio cues, such as those from ElevenLabs, appropriate pauses must be included for a natural flow (e.g., "3, 2, 1, GO!"). The player UI must feature a centrally located pause/play button, and pausing the timer must simultaneously pause the associated video.

The Coach Command Center is designed to surface immediate action items: what needs attention today, who requires follow-up, what is coming next, and what is at risk. It employs progressive disclosure, presenting high-signal information first and allowing for drill-down second, avoiding overwhelming coaches with backend mechanics. Conversely, the member experience is streamlined so they always know what to do next and when to do it, avoiding invasive UX, minimizing data entry, and never exposing backend jargon.

## Business Logic Guardrails
Coaches must be able to access the same payment pages as members to effectively guide them through the process. The system must not force users to sign in before completing a payment. Furthermore, the application must accurately document and update all payment-related statuses, including sign-ups, cancellations, refunds, paused plans, and failed payments, ensuring a reliable financial ledger.

## Naming Conventions
The codebase and user interface must adhere to strict naming conventions to maintain brand consistency and code clarity.

| Category | Convention | Examples |
|---|---|---|
| **Product Language** | Brand-aligned terminology | Use "coach" (not trainer), "member" (not client), "movement" (not exercise), "Command Center". |
| **Code Structure** | `camelCase` | Used for Firestore documents, TypeScript interfaces, props, and state. |
| **Collections** | Preserve live names | Do not silently refactor data shapes or collection names without a migration plan. |

## Common Pitfalls
Developers must be vigilant against several common pitfalls that can degrade the user experience or break core functionality. Ignoring admin impersonation by failing to use `effectiveUid` or `claims.coachId` will break the admin's ability to view coach data accurately. Defaulting to form-heavy creation flows for workouts contradicts the block builder philosophy. Over-fetching media, such as loading 500 GIFs simultaneously instead of utilizing thumbnails and virtualization, will cause significant performance issues. Finally, exposing backend jargon in the UI, like displaying "stripe_account_pending" instead of a user-friendly message like "Action Required: Complete Payment Setup", degrades the professional feel of the platform.
