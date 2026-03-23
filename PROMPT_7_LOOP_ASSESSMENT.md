# Prompt 7 — Loop Assessment: Live Provider Activation & Production Readiness

**Date:** March 23, 2026
**Loop type:** Build loop
**Status:** Complete — deployed and pushed

---

## What Was Built

### 1. Live Provider Secret Wiring (defineSecret)

All external service credentials are now declared via Firebase Functions Gen2 `defineSecret()` and wired into every CF that needs them:

| Secret | Variable | CFs That Use It |
|--------|----------|-----------------|
| `ZOOM_ACCOUNT_ID` | `zoomAccountId` | allocateSessionInstance, allocateAllPendingInstances, rescheduleInstance, cancelInstance, getSystemHealth, processReminders, updateMemberGuidancePhase |
| `ZOOM_CLIENT_ID` | `zoomClientId` | Same as above |
| `ZOOM_CLIENT_SECRET` | `zoomClientSecret` | Same as above |
| `ZOOM_WEBHOOK_SECRET` | `ZOOM_WEBHOOK_SECRET` | zoomWebhook |
| `EMAIL_API_KEY` | `emailApiKey` | getSystemHealth, processReminders |
| `TWILIO_ACCOUNT_SID` | `twilioAccountSid` | getSystemHealth, processReminders |
| `TWILIO_AUTH_TOKEN` | `twilioAuthToken` | getSystemHealth, processReminders |
| `TWILIO_FROM_NUMBER` | `twilioFromNumber` | getSystemHealth, processReminders |
| `STRIPE_SECRET_KEY` | `stripeSecretKey` | createCheckoutSession, stripeWebhook, createStripeConnectLink, etc. |
| `STRIPE_WEBHOOK_SECRET` | `stripeWebhookSecret` | stripeWebhook |

**Safe mock fallback:** When any secret is empty or unset, the corresponding provider factory returns a `MockProvider` that logs actions without making real API calls. No crashes, no data loss.

### 2. Zoom Provider Live Path

The `getZoomProvider()` factory now receives explicit secret values from the CF scope:

```typescript
getZoomProvider({
  accountId: zoomAccountId.value(),
  clientId: zoomClientId.value(),
  clientSecret: zoomClientSecret.value(),
})
```

When all three Zoom S2S credentials are present, `RealZoomProvider` activates with:
- OAuth2 token acquisition via `https://zoom.us/oauth/token` (account_credentials grant)
- Token caching with 55-minute expiry
- Meeting CRUD via Zoom REST API v2
- Automatic fallback to mock if any credential is missing

### 3. Notification Provider Live Path

The `getEmailProvider()` and `getSmsProvider()` factories read from `process.env`, which Firebase Gen2 populates from `defineSecret` declarations:

- **Resend (email):** `RealEmailProvider` activates when `EMAIL_API_KEY` is set. Sends via `https://api.resend.com/emails`.
- **Twilio (SMS):** `RealSmsProvider` activates when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` are all set.
- **Push:** Remains mock — no push provider credentials defined yet.

Added `resetNotificationProviders()` export to clear cached provider instances, called in `getSystemHealth` for accurate health reporting.

### 4. Composite Firestore Indexes

10 composite indexes deployed for all scheduling-related queries:

| Collection | Fields | Purpose |
|-----------|--------|---------|
| `session_instances` | coachId + scheduledDate | Coach scheduling page queries |
| `session_instances` | memberId + scheduledDate | Member session center queries |
| `session_instances` | coachId + status + scheduledDate | Coach filtered session views |
| `session_instances` | memberId + status + scheduledDate | Member filtered session views |
| `session_instances` | recurringSlotId + scheduledDate | Instance generation dedup |
| `session_instances` | zoomRoomId + status + scheduledDate | Collision detection |
| `recurring_slots` | coachId + status | Active slot queries |
| `recurring_slots` | memberId + status | Member slot queries |
| `reminder_jobs` | status + scheduledSendAt | Reminder processing |
| `session_events` | instanceId + timestamp | Event log queries |

### 5. Dynamic Coach Zoom Panel

The `CoachZoomPanel` in `account.tsx` now:
- Checks the actual Zoom provider mode via `getSystemHealth` on mount
- Shows "setup mode" notice only when Zoom is in mock mode
- Hides the notice entirely when Zoom is live
- Shows "Checking..." during the health check

### 6. Coach Phase Transition Control (from Prompt 6, deployed here)

The `updateMemberGuidancePhase` CF was hardened and deployed with:
- Batch chunking (490 ops per batch, Firestore 500-op limit)
- Coach authorization (caller must be the member's coach or platform admin)
- Idempotency guard (skips if phase already matches)

---

## Verification Summary

| Check | Result |
|-------|--------|
| Cloud Functions typecheck | 0 errors |
| Cloud Functions build | Clean |
| Expo web build | Clean |
| Functions deployed | 28 CFs, all successful |
| Hosting deployed | https://goarrive.web.app — 200 OK |
| Firestore indexes deployed | 10 composite indexes |
| Git pushed | main branch, d931a17 |
| Live app loads | Confirmed |

---

## Current System State

| Component | Count | Status |
|-----------|-------|--------|
| Cloud Functions | 28 | All deployed |
| Firestore collections with rules | 39 | All explicit |
| Composite indexes | 10 | All deployed |
| defineSecret declarations | 10 | All wired |
| Backend modules | 5 | index.ts, zoom.ts, notifications.ts, reminders.ts, templates.ts |
| Frontend pages | 14 | All building |
| Member nav tabs | 4 | Home, Sessions, My Plan, Profile |

---

## ME Items Required for Live Activation

The system is fully wired and will activate automatically when these secrets are set via `firebase functions:secrets:set`:

| Secret | Service | How to Set |
|--------|---------|-----------|
| `ZOOM_ACCOUNT_ID` | Zoom S2S OAuth | `firebase functions:secrets:set ZOOM_ACCOUNT_ID` |
| `ZOOM_CLIENT_ID` | Zoom S2S OAuth | `firebase functions:secrets:set ZOOM_CLIENT_ID` |
| `ZOOM_CLIENT_SECRET` | Zoom S2S OAuth | `firebase functions:secrets:set ZOOM_CLIENT_SECRET` |
| `ZOOM_WEBHOOK_SECRET` | Zoom Webhooks | `firebase functions:secrets:set ZOOM_WEBHOOK_SECRET` |
| `EMAIL_API_KEY` | Resend | `firebase functions:secrets:set EMAIL_API_KEY` |
| `TWILIO_ACCOUNT_SID` | Twilio | `firebase functions:secrets:set TWILIO_ACCOUNT_SID` |
| `TWILIO_AUTH_TOKEN` | Twilio | `firebase functions:secrets:set TWILIO_AUTH_TOKEN` |
| `TWILIO_FROM_NUMBER` | Twilio | `firebase functions:secrets:set TWILIO_FROM_NUMBER` |

After setting secrets, redeploy functions: `npx firebase deploy --only functions`

---

## Suggestions (No Execution)

1. **Set Zoom S2S credentials and test a real meeting creation.** The Zoom Marketplace app needs to be created as a Server-to-Server OAuth app with `meeting:write:admin` and `meeting:read:admin` scopes. Once credentials are set, `getSystemHealth` will immediately report `mode: 'live'` for Zoom, and `allocateSessionInstance` will create real Zoom meetings.

2. **Set up the Zoom webhook URL.** The `zoomWebhook` CF is deployed at `https://zoomwebhook-otdnevmppa-uc.a.run.app`. This URL needs to be configured in the Zoom Marketplace app's Event Subscriptions with events: `meeting.started`, `meeting.ended`, `meeting.participant_joined`, `meeting.participant_left`, `recording.completed`.

3. **Set Resend API key and verify the sender domain.** Resend requires a verified sender domain (e.g., `noreply@goa.fit`). Once `EMAIL_API_KEY` is set, the `processReminders` CF will send real reminder emails using the GoArrive-branded templates.

4. **Add a production health dashboard widget.** The admin Operations Center calls `getSystemHealth` but could surface a persistent top-bar indicator showing provider modes (mock vs live) so the admin always knows the system state at a glance.

5. **Consider Stripe Payment Links instead of Checkout Sessions for coach-shareable URLs.** Stripe Checkout Sessions expire after 24 hours. If coaches are sharing payment links with members via text/email, a Stripe Payment Link (which doesn't expire) would be more reliable. This would require a small CF change to use `stripe.paymentLinks.create()` instead of `stripe.checkout.sessions.create()` for the coach-shareable flow.
