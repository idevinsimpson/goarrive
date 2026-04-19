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
