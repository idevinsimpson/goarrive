# GoArrive Cloud Functions Reference

## Overview
GoArrive uses Firebase Cloud Functions Gen 2 for all backend logic, third-party integrations, and administrative operations. The primary source file is `functions/src/index.ts`, which contains over 50 exported functions. Supporting modules include `notifications.ts`, `reminders.ts`, `templates.ts`, `zoom.ts`, and `notificationUtils.ts`.

## Function Categories
The functions are organized into several logical categories, each serving a distinct part of the platform.

### Stripe & Billing

| Function | Trigger | Purpose |
|---|---|---|
| `createStripeConnectLink` | `onCall` | Generates a Stripe Connect onboarding link for a coach. |
| `refreshStripeAccountStatus` | `onCall` | Refreshes the status of a coach's Stripe Connect account. |
| `disconnectStripeAccount` | `onCall` | Disconnects a coach's Stripe account. |
| `createCheckoutSession` | `onCall` | Creates a Stripe Checkout session for member payment. |
| `stripeWebhook` | `onRequest` | Handles incoming Stripe webhook events (subscriptions, payments, disputes). |
| `activateCtsOptIn` | `onCall` | Activates a Commit-to-Save opt-in for a member. |
| `reconcileConnectedAccountPayments` | `onCall` | Reconciles payments from connected Stripe accounts. |
| `getConnectedAccountData` | `onCall` | Retrieves detailed data from a connected Stripe account. |
| `createMissingLedgerEntry` | `onCall` | Creates a ledger entry for a missing payment record. |
| `enforceCtsAccountability` | `onSchedule` | Scheduled function to enforce CTS accountability fees. |
| `waiveCtsFee` | `onCall` | Waives a CTS accountability fee for a member. |

### Coach & Admin Management

| Function | Trigger | Purpose |
|---|---|---|
| `addCoach` | `onCall` | Adds a new coach to the platform (admin only). |
| `inviteCoach` | `onCall` | Sends a coach invitation. |
| `activateCoachInvite` | `onCall` | Activates a coach invitation. |
| `setAdminRole` | `onCall` | Sets admin role for a user. |
| `adminGetCoachData` | `onCall` | Retrieves coach data for admin view. |
| `seedMissingCoachDocs` | `onCall` | Seeds missing coach documents. |
| `setProfitShareStartDate` | `onCall` | Sets the profit share start date for a coach. |
| `setYearlyEarningsCap` | `onCall` | Sets the yearly earnings cap for a coach (admin only). |

### Scheduling & Sessions

| Function | Trigger | Purpose |
|---|---|---|
| `createRecurringSlot` | `onCall` | Creates a recurring scheduling slot. |
| `updateRecurringSlot` | `onCall` | Updates an existing recurring slot. |
| `generateUpcomingInstances` | `onSchedule` | Generates upcoming session instances from recurring slots. |
| `allocateSessionInstance` | `onCall` | Allocates a Zoom room to a session instance. |
| `allocateAllPendingInstances` | `onCall` | Allocates all pending session instances. |
| `rescheduleInstance` | `onCall` | Reschedules a session instance. |
| `cancelInstance` | `onCall` | Cancels a session instance. |
| `batchPhaseTransition` | `onSchedule` | Handles batch phase transitions for sessions. |
| `syncSlotDuration` | `onDocumentUpdated` | Syncs slot duration changes to instances. |
| `detectNoShows` | `onSchedule` | Detects no-show sessions. |
| `requestSkipInstance` | `onCall` | Handles member skip requests. |
| `checkSlotConflicts` | `onCall` | Checks for scheduling conflicts. |

### Zoom Integration

| Function | Trigger | Purpose |
|---|---|---|
| `manageZoomRoom` | `onCall` | Manages Zoom room allocation and configuration. |
| `zoomWebhook` | `onRequest` | Handles incoming Zoom webhook events. |
| `refreshRecordingUrl` | `onCall` | Refreshes a Zoom recording URL. |

### Google Calendar Integration

| Function | Trigger | Purpose |
|---|---|---|
| `initGoogleCalendarAuth` | `onCall` | Initiates Google Calendar OAuth2 flow. |
| `googleCalendarCallback` | `onRequest` | Handles Google Calendar OAuth2 callback. |
| `syncToGoogleCalendar` | `onCall` | Syncs sessions to Google Calendar. |
| `disconnectGoogleCalendar` | `onCall` | Disconnects Google Calendar integration. |
| `initGcalConflictAuth` | `onCall` | Initiates conflict-checking calendar auth. |
| `gcalConflictCallback` | `onRequest` | Handles conflict calendar OAuth2 callback. |
| `listGcalConflictCalendars` | `onCall` | Lists calendars for conflict checking. |
| `updateGcalConflictCalendars` | `onCall` | Updates conflict-checking calendar selection. |
| `removeGcalConflictAccount` | `onCall` | Removes a conflict-checking calendar account. |
| `checkGcalConflicts` | `onCall` | Checks for conflicts across linked calendars. |

### Workout System

| Function | Trigger | Purpose |
|---|---|---|
| `onWorkoutAssigned` | `onDocumentCreated` | Triggers when a workout is assigned to a member. |
| `onWorkoutLogReviewed` | `onDocumentUpdated` | Triggers when a coach reviews a workout log. |
| `onWorkoutCompleted` | `onDocumentCreated` | Triggers when a member completes a workout. |
| `continueRecurringAssignments` | `onSchedule` | Continues recurring workout assignments. |
| `analyzeMovement` | `onCall` | Uses OpenAI GPT-4.1-mini to analyze movement media and generate metadata. |

### Media Processing

| Function | Trigger | Purpose |
|---|---|---|
| `onMovementMediaUploaded` | `onObjectFinalized` | Triggers when movement media is uploaded to Firebase Storage. |
| `generateMovementGif` | `onDocumentUpdated` | Generates a GIF thumbnail from movement video. |
| `cleanupOldMovementThumbnails` | `onDocumentUpdated` | Cleans up old thumbnails when new ones are generated. |
| `retryFailedGifGeneration` | `onSchedule` | Retries failed GIF generation attempts. |

### Notifications & Reminders

| Function | Trigger | Purpose |
|---|---|---|
| `sendPlanSharedNotification` | `onDocumentCreated` | Sends notification when a plan is shared. |
| `cleanupReadNotifications` | `onSchedule` | Cleans up read notifications. |
| `processReminders` | `onSchedule` | Processes and sends scheduled reminders. |
| `cleanupNotificationCooldowns` | `onSchedule` | Cleans up notification cooldown records. |

### Member Management

| Function | Trigger | Purpose |
|---|---|---|
| `claimMemberAccount` | `onCall` | Claims a member account (links auth to member doc). |
| `updateMemberGuidancePhase` | `onCall` | Updates a member's guidance phase. |
| `getSharedPlan` | `onRequest` | Retrieves a shared plan for public viewing. |

### System & Admin

| Function | Trigger | Purpose |
|---|---|---|
| `getSystemHealth` | `onCall` | Retrieves system health metrics. |
| `retryDeadLetter` | `onCall` | Retries items in the dead letter queue. |
| `getDeadLetterItems` | `onCall` | Retrieves dead letter queue items. |
| `getSessionEventLog` | `onCall` | Retrieves session event log entries. |
| `coachIcalFeed` | `onRequest` | Generates an iCal feed for a coach's schedule. |
| `regenerateIcalToken` | `onCall` | Regenerates a coach's iCal token. |
| `migrateIcalTokens` | `onCall` | Migrates iCal tokens to new format. |

## AI Integration
The `analyzeMovement` function uses OpenAI's GPT-4.1-mini model to analyze uploaded movement media. It accepts a video or GIF URL and returns structured metadata including the movement name, category, equipment, muscle groups, difficulty level, and coaching cues. This function is called during the bulk movement upload flow via the `BulkMovementUpload.tsx` component.
