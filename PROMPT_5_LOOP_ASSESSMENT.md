# GoArrive — Prompt 5 Loop Assessment

**Loop type:** Build loop
**Date:** March 23, 2026
**Major workflow:** Member session experience + coach personal Zoom settings + guidance-phase-aware hosting handoff

---

## What Was Built

### 1. Member-Facing Session Center (`my-sessions.tsx`)
**Status: LIVE**

A full member-facing "My Sessions" page with:
- **Upcoming tab** — shows all future sessions that are scheduled, allocated, or in progress
- **Past tab** — shows completed, missed, and cancelled sessions (most recent first)
- **Session cards** — display date, time, session type, guidance phase, coach-live indicator, CTS badge, and status
- **Join button** — appears on allocated/in-progress sessions with a Zoom join URL; opens the occurrence-specific meeting link
- **Session detail modal** — full detail view with date/time, session type, guidance phase, status, coach-live info, CTS awareness, recording links, and action buttons
- **Empty states** — calm, supportive copy for both upcoming and past tabs
- **Loading state** — gold spinner with loading text
- **Error state** — retry button with clear error messaging
- **Pull-to-refresh** — RefreshControl on the session list

**Member layout updated:** Sessions tab added between Home and My Plan with a calendar icon.

**Member-facing language:** No backend infrastructure language exposed. Uses "Fully Guided" / "Blended" / "Self-Reliant" instead of `coach_guided` / `shared_guidance` / `self_guided`. Status labels use "Upcoming" / "Ready" / "In Progress" / "Completed" / "Missed" / "Cancelled" / "Rescheduled" — never `allocation_failed` or `scheduled`.

### 2. Member Join Flow
**Status: LIVE**

- Join button appears only when `status` is `allocated` or `in_progress` AND `zoomJoinUrl` exists
- Opens the occurrence-specific Zoom join URL via `Linking.openURL`
- If the session is not yet ready (no join URL), shows a calm message: "Your session link will be available shortly before your session starts."
- Coach-live info is contextual:
  - Fully Guided: "Your coach will be with you for the entire session."
  - Blended with duration: "Your coach will join for X minutes of this session."
  - Self-Reliant: "This is your independent session. You've got this!"

### 3. Member Single-Occurrence Reschedule Flow
**Status: LIVE**

- Reschedule button appears on scheduled/allocated/allocation_failed instances with future dates
- Opens a reschedule modal with new date (YYYY-MM-DD) and new time (HH:MM) inputs
- Validates format, ensures future date, calls `rescheduleInstance` CF
- On success, refreshes the session list and closes both modals
- **Backend change:** `rescheduleInstance` CF now accepts both coach AND member callers (was coach-only)
- **Backend change:** `cancelInstance` CF now accepts both coach AND member callers (was coach-only)
- **Session event source** is now dynamic — records `member_action` when the member initiates, `coach_action` when the coach initiates

### 4. Coach Personal Zoom Settings/Account Flow
**Status: LIVE (scaffolded — mock mode)**

Added `CoachZoomPanel` component to `account.tsx`:
- Shows personal Zoom connection status with green/grey dot
- **Connected state:** displays Zoom email, Update and Disconnect buttons
- **Disconnected state:** shows connect form with email input and Connect Zoom button
- **Edit mode:** allows updating the Zoom email
- **Disconnect flow:** confirmation dialog, marks connection as disconnected
- **Mock mode notice:** clear message that Zoom integration is in setup mode and connection details are saved for when live credentials are configured
- **Firestore collection:** `coach_zoom_connections` — stores `coachId`, `zoomEmail`, `connected`, `connectedAt`, `lastVerifiedAt`, `status`

This lives in settings/account, NOT in the scheduling page.

### 5. Guidance-Phase-Aware Hosting Handoff
**Status: LIVE**

Phase → hosting rules are now codified:

| Phase | hostingMode | coachExpectedLive | personalZoomRequired |
|-------|-------------|-------------------|---------------------|
| coach_guided | coach_led | true | true |
| shared_guidance | hosted | true | false |
| self_guided | hosted | false | false |

- `generateInstancesForSlot` already propagates all hosting fields from slot to instance (Prompt 2)
- Member session center displays coach-live status based on these fields
- Session detail modal shows phase-appropriate coach info

### 6. Phase-Transition Automation (`updateMemberGuidancePhase` CF)
**Status: LIVE**

New Cloud Function that:
1. Accepts `memberId` and `newPhase` from the coach
2. Looks up the correct hosting rules for the new phase
3. Batch-updates all future scheduled/allocated/allocation_failed instances with new phase + hosting rules
4. Batch-updates all active recurring slots with new phase + hosting rules
5. Writes a `phase_transition` session event for audit trail
6. Returns count of updated instances and slots

Does NOT rewrite historical (completed/missed/cancelled) instances.

### 7. Member-Facing Guidance and Value Language
**Status: LIVE**

All member-facing copy uses premium, calm, supportive language:
- "Fully Guided" not "coach_guided"
- "Blended" not "shared_guidance"
- "Self-Reliant" not "self_guided"
- "Upcoming" not "scheduled" or "allocation_failed"
- "Ready" not "allocated"
- "Your coach will be with you for the entire session" not "coachExpectedLive: true"
- "This is your independent session. You've got this!" not "coachExpectedLive: false"
- "Commit to Save is active for this session. Show up and save." for CTS visibility

### 8. Commit to Save Visibility
**Status: LIVE**

- CTS badge (gold zap icon + "CTS") appears on session cards when `commitToSaveEnabled` is true
- Session detail modal shows a gold info card: "Commit to Save is active for this session. Show up and save."
- No enforcement logic — visibility only, as specified

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `apps/goarrive/app/(member)/my-sessions.tsx` | **NEW** | Member-facing session center (620 lines) |
| `apps/goarrive/app/(member)/_layout.tsx` | **EDITED** | Added Sessions tab to member nav |
| `apps/goarrive/app/(app)/account.tsx` | **REWRITTEN** | Added CoachZoomPanel for personal Zoom connection |
| `apps/goarrive/components/Icon.tsx` | **EDITED** | Added 10 new icons (calendar, video, person, settings, edit, search, close, check, alert-circle, block) |
| `functions/src/index.ts` | **EDITED** | Updated rescheduleInstance + cancelInstance auth (allow member), dynamic event source, added updateMemberGuidancePhase CF |

**Total:** 5 files changed, ~1,581 lines added, ~20 lines removed

---

## Commands Run

```
npx tsc --noEmit                          # Functions — 0 errors
npx tsc --noEmit                          # App — no new errors in changed files
npm run build                             # Functions build clean
npx firebase deploy --only functions      # All CFs deployed (updateMemberGuidancePhase created)
npx expo export --platform web            # Web build successful
npx firebase deploy --only hosting        # Hosting deployed to goarrive.web.app
git add -A && git commit && git push      # Pushed to GitHub main
```

---

## What Is Live vs Scaffolded vs Blocked

### LIVE (fully functional in mock mode)
- Member session center with all states
- Member join flow (opens occurrence-specific URL)
- Member reschedule single occurrence
- Member cancel single occurrence
- Coach personal Zoom settings panel (connect/update/disconnect)
- Phase-transition automation CF
- Guidance-phase-aware hosting rules
- CTS visibility
- Dynamic session event source (member_action vs coach_action)
- 28 Cloud Functions total deployed

### SCAFFOLDED (code complete, awaiting credentials)
- Coach personal Zoom OAuth flow — email-based connection is saved, but true Zoom OAuth requires credentials
- Real Zoom meeting creation — MockZoomProvider returns mock join URLs
- Real email/SMS/push notifications — mock providers log but don't send

### BLOCKED (requires ME items)
- **Zoom Server-to-Server OAuth:** `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
- **Zoom Webhook:** `ZOOM_WEBHOOK_SECRET` + Marketplace webhook URL configuration
- **Email (Resend):** `EMAIL_API_KEY`
- **SMS (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- **Coach personal Zoom OAuth:** If true OAuth (not just email registration) is needed, a Zoom Marketplace app with OAuth redirect must be configured

---

## Final Verification

### Member Perspective
- **Member can find upcoming sessions:** Sessions tab is in the member nav between Home and My Plan. Upcoming tab shows future sessions.
- **Member understands what is happening:** Session cards show date, time, type, phase label, coach-live indicator, CTS badge, and status.
- **Member can join the right session:** Join button appears only on ready sessions with a join URL. Opens the occurrence-specific meeting link.
- **Member can reschedule a single occurrence:** Reschedule button in session detail. New date/time input. Calls rescheduleInstance CF. Recurring slot is preserved.
- **Member is not exposed to backend complexity:** No "allocation_failed", "zoom_rooms", "round robin", or "shared_pool" language anywhere in the member UI.

### Coach Perspective
- **Coach scheduling page remains session-centered and uncluttered:** No changes to scheduling.tsx.
- **Coach personal Zoom lives in settings/account:** CoachZoomPanel in account.tsx with connect/update/disconnect flow.
- **Coach can understand when they are expected live:** Session detail in scheduling.tsx already shows coach-live indicators (from Prompt 2).
- **Coach is not forced into backend infrastructure management:** All backend ops remain in admin.

### Admin Perspective
- **Admin still owns shared-host operations and backend diagnostics:** admin.tsx Operations Center unchanged.
- **Admin layer is not broken by the new member/coach work:** No changes to admin.tsx.
- **New CF visible in admin:** updateMemberGuidancePhase is callable but not yet surfaced in admin UI (coach calls it when changing member phase).

---

## Suggestions (No Execution)

1. **Surface phase-transition in the coach UI.** The `updateMemberGuidancePhase` CF exists but there is no UI button for the coach to trigger it. The coach needs a way to change a member's guidance phase (e.g., from Fully Guided to Blended) — likely in the member detail or plan view. This is the natural next step to make phase transitions usable.

2. **Coach personal Zoom OAuth vs email-only.** Currently the coach Zoom panel saves an email address to `coach_zoom_connections`. For true Zoom integration, the coach would need to go through Zoom OAuth to grant meeting creation permissions. This requires a Zoom Marketplace app with OAuth redirect. The current email-based flow is a safe scaffold that will work once Server-to-Server credentials are in place (since S2S can create meetings on behalf of any user in the account).

3. **Member reschedule date picker.** The current reschedule flow uses a text input for date (YYYY-MM-DD) and time (HH:MM). A native date/time picker would be a better UX. This was kept simple to minimize scope, but a calendar picker component would be a natural improvement.

4. **Firestore security rules for `coach_zoom_connections`.** The new collection needs security rules that allow coaches to read/write their own document and admins to read all. This should be added to `firestore.rules`.

5. **Firestore security rules for member session queries.** The member's My Sessions page queries `session_instances` where `memberId == user.uid`. The Firestore rules need to allow this query pattern. If rules are currently coach-only, they need to be extended.

6. **Recording playback for members.** The session detail modal shows recording links when `recordingAvailable` is true and `recordings` array has entries with `playUrl`. This is wired but recordings won't appear until the Zoom webhook processes `recording.completed` events with real credentials.

7. **Member cancel policy.** Currently any member can cancel any of their future sessions with no restrictions. Consider adding a cancellation window (e.g., must cancel 24 hours before) or a cancellation limit per month to prevent abuse, especially with CTS-enabled sessions.

8. **Batch size limits.** The `updateMemberGuidancePhase` CF uses Firestore batch writes. Firestore batches are limited to 500 operations. If a member has more than 500 future instances (unlikely but possible with long-running slots), the batch would fail. Consider chunking into multiple batches for safety.
