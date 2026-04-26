# GoArrive Scheduling & Integrations

## Scheduling System
The scheduling system is built around two core concepts: recurring slots and session instances. Recurring slots define the pattern (e.g., "Every Monday at 9 AM for 60 minutes"), while session instances are the concrete events generated from those patterns.

### Guidance Phases
Guidance phases drive hosting behavior and coach expectations. They determine how much direct coach involvement a session requires.

| Phase | Description | Calendar Impact |
|---|---|---|
| **Fully Guided** | Coach-led experience. The coach is present for the entire session. | Full session duration appears on coach's calendar. |
| **Shared Guidance** | Hosted on shared infrastructure with a defined live coaching window. | Only the coaching window portion appears on the coach's calendar. |
| **Self-Reliant** | Hosted on shared infrastructure without full live coach presence. | Minimal or no calendar impact for the coach. |

Scheduling must stay member-centered and coach-operational, not backend-centered. Member-facing and coach-facing copy should describe coaching context, not infrastructure. Terms like "round robin pool" must never be exposed to coaches or members.

### Session Lifecycle
The session lifecycle is managed through several Cloud Functions. `generateUpcomingInstances` runs on a schedule to create future session instances from recurring slots. `allocateSessionInstance` assigns a Zoom room to a specific session. `detectNoShows` runs on a schedule to identify sessions where the member did not attend. `batchPhaseTransition` handles transitions between guidance phases.

## Zoom Integration
GoArrive integrates with Zoom for video sessions. The integration supports both personal Zoom rooms (linked to individual coaches) and a shared pool of Zoom rooms managed by the platform.

The `manageZoomRoom` Cloud Function handles room allocation and configuration. The `zoomWebhook` function processes incoming Zoom events, such as meeting starts, ends, and recording completions. The `refreshRecordingUrl` function refreshes recording URLs that may have expired.

Coaches can connect their personal Zoom accounts through the `coach_zoom_connections` collection. The platform also maintains a pool of shared Zoom rooms in the `zoom_rooms` collection for coaches who do not have personal accounts.

## Google Calendar Integration
The platform offers two types of Google Calendar integration: session posting and conflict checking.

### Session Posting
Coaches can sync their sessions to Google Calendar. The `initGoogleCalendarAuth` function initiates the OAuth2 flow, and `googleCalendarCallback` handles the callback. Once connected, `syncToGoogleCalendar` posts session instances as calendar events. The `disconnectGoogleCalendar` function removes the integration.

### Conflict Checking
A separate Google Calendar integration allows coaches to check for scheduling conflicts across multiple calendars. This uses a different OAuth2 flow (`initGcalConflictAuth` and `gcalConflictCallback`) and supports linking multiple calendar accounts. The `checkGcalConflicts` function checks for conflicts when creating or modifying recurring slots.

## iCal Feed
Coaches can subscribe to an iCal feed of their schedule using any calendar application. The `coachIcalFeed` function generates the feed as an HTTP endpoint, and `regenerateIcalToken` allows coaches to regenerate their feed token for security.

## Notification System
The notification system uses a provider abstraction that supports multiple channels.

| Channel | Status | Implementation |
|---|---|---|
| **Push (FCM)** | Mock-only on server | Client-side registration exists (`notifications.ts`), but server-side sending is not live. |
| **Email (Resend)** | Conditional | Live when API key is present. Templates are defined in `templates.ts`. |
| **SMS (Twilio)** | Conditional | Live when credentials are present. |

The `processReminders` scheduled function handles sending reminders through the appropriate channels. The `cleanupNotificationCooldowns` function prevents notification spam by enforcing cooldown periods.

## AI Integration (OpenAI)
The `analyzeMovement` Cloud Function uses OpenAI's GPT-4.1-mini model to analyze uploaded movement media. When a coach uploads a video or GIF of a movement, the function analyzes the media and returns structured metadata including the movement name, category, equipment used, muscle groups targeted, difficulty level, and coaching cues. This powers the bulk movement upload feature in the `BulkMovementUpload.tsx` component.

## Voice Generation (OpenAI TTS)
The `generateMovementVoice.ts` utility generates voice audio for movement names using OpenAI's TTS API (`tts-1`, voice: `onyx`) via the `generateVoice` Cloud Function. Text is normalized through `normalizeTtsText` before generation so abbreviations like "DB" or "lbs" are spoken as "dumbbell" / "pounds". The cache key is the movement ID plus a hash of the normalized text, so renaming a movement produces a fresh storage path and the player never speaks the old name. Audio cues must incorporate appropriate pauses for natural timing (e.g., "3, 2, 1, GO!") and maintain a consistent, genuine tone.

## Linear Integration (Issue Tracking)

GoArrive uses Linear for engineering issue tracking. The workspace is at `linear.app/goarrive` under the **Goa** team.

### API Keys
- **Maia's key** is stored as Firebase secret `MAIA_LINEAR_API_KEY` (created April 2026, key name "Maia").
- **Marco's key** is stored as Firebase secret `LINEAR_API_KEY` (created April 2026, key name "Marco").
- Both keys belong to the same GoArrive Linear workspace and Goa team.
- Linear team ID: `ee4ab0b9-5cac-466f-ab41-8e5bbf283a72`

### Maia's Usage Guidelines
When Maia starts work on a feature or bug fix, she should:
1. Create a Linear issue via the GraphQL API using `MAIA_LINEAR_API_KEY`.
2. Move the issue to "In Progress" when she begins.
3. Move the issue to "Done" when the work is deployed and verified.

### GraphQL API
Linear uses a GraphQL API at `https://api.linear.app/graphql`. Authenticate with:
```
Authorization: <api_key>
```

Example — create an issue:
```graphql
mutation IssueCreate($title: String!, $teamId: String!) {
  issueCreate(input: { title: $title, teamId: $teamId }) {
    success
    issue { id identifier title url }
  }
}
```

### Marco's Usage
Marco can create, list, and update Linear issues from Slack via `@Marco` commands. See `cloud-functions-reference.md` for the `slackEvents` function details.

---

## Sentry Integration (Error Monitoring)

GoArrive uses a self-hosted Sentry instance for crash reporting and error monitoring.

### DSN
```
https://962d173a894df4e4c23c744f8c39d6f3@sentry.butterflyotel.online/9
```
Stored as:
- Firebase secret `SENTRY_DSN` (for Marco / Cloud Functions)
- `EXPO_PUBLIC_SENTRY_DSN` in `apps/goarrive/.env.local` (for the mobile app)

### Mobile App Setup
The Sentry SDK (`@sentry/react-native`) is initialized in `apps/goarrive/lib/sentry.ts` and called from `apps/goarrive/app/_layout.tsx` on app startup. The `AuthContext` automatically sets the Sentry user context (`setSentryUser`) on login and clears it (`clearSentryUser`) on logout.

**Usage in code:**
```typescript
import { captureException, captureMessage } from '../lib/sentry';

// In a catch block:
captureException(error, { context: 'some additional info' });

// For non-error events:
captureMessage('Stripe webhook received', 'info');
```

### EAS Build / Production
For production builds, set `EXPO_PUBLIC_SENTRY_DSN` as an EAS secret:
```
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>"
```

### Marco's Usage
Marco can query Sentry for recent errors from Slack via `@Marco show recent Sentry errors`. This calls the Sentry REST API using the DSN key for authentication.
