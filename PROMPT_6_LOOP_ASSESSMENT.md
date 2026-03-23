# Prompt 6 — Scheduling Track Hardening: Loop Assessment

**Date:** March 23, 2026
**Loop Type:** Hardening / Final Verification
**Status:** Complete — deployed, pushed, verified

---

## What Was Built

### 1. Firestore Security Rules — 5 New Collection Rules

All scheduling-track collections that were previously caught by the catch-all deny rule now have explicit, role-appropriate security rules:

| Collection | Read | Write | Notes |
|---|---|---|---|
| `session_events` | Coach reads own events; admin reads all | Deny (CF-only writes) | Event log is append-only from CFs |
| `reminder_jobs` | Admin only | Deny (CF-only writes) | Reminder lifecycle managed by CFs |
| `dead_letter` | Admin only | Deny (CF-only writes) | Dead-letter queue is admin-visible |
| `notification_log` | Admin only | Deny (CF-only writes) | Notification audit trail |
| `coach_zoom_connections` | Coach reads own doc | Coach writes own doc | Personal Zoom connection data |

Additionally, the overly-broad `list` rule on `session_instances` (which allowed all authenticated users to list all instances) was removed. Members can now only read instances where `memberId == uid`, and coaches can only read instances where `coachId == uid`.

### 2. Coach-Facing Guidance Phase Transition Control

Added a minimal, inline phase transition control to `MemberDetail.tsx`:

- **Location:** Below the current phase indicator, above the CTS indicator
- **UI:** Three radio-style buttons (Fully Guided / Blended / Self-Reliant) with the current phase pre-selected
- **Behavior:** Coach selects a new phase → taps "Transition" → calls `updateMemberGuidancePhase` CF → success toast with count of updated instances
- **Guard:** Button is disabled if the selected phase matches the current phase
- **Error handling:** Alert on failure with error message
- **Premium language:** Uses member-facing labels (Fully Guided, Blended, Self-Reliant), not backend constants

### 3. Hardened `updateMemberGuidancePhase` CF

The CF was hardened with three critical improvements:

- **Batch chunking:** Firestore batches are limited to 500 operations. The CF now chunks updates into batches of 490 (with safety margin) and commits each batch sequentially. This prevents failures for members with many future instances.
- **Coach authorization:** Added explicit auth check — caller must be the member's coach (via `members` collection lookup) or a platform admin (`role === 'admin'` or `platformAdmin === true` in custom claims). Unauthorized callers get `permission-denied`.
- **Idempotency guard:** If the member's current phase already matches the requested phase, the CF returns early with `{ alreadyCurrent: true }` instead of performing unnecessary writes.

### 4. Coach Personal Zoom No-Op Guard

Added a guard to `handleConnect()` in the `CoachZoomPanel`: if the coach's Zoom email is already connected and the email input hasn't changed, the save is skipped entirely (no unnecessary Firestore write). The editing state simply closes.

### 5. Member Reschedule/Cancel — Already Hardened (Prompt 5)

Verified that `rescheduleInstance` and `cancelInstance` CFs already have:
- Dual auth (coach or member callers allowed)
- Dynamic event source tracking (`member_action` vs `coach_action`)
- Zoom meeting cleanup
- Reminder cancellation
- Status guards preventing action on completed/cancelled sessions
- Audit log entries

No additional changes were needed.

### 6. Admin Provider Readiness — Already Comprehensive (Prompt 4)

Verified that the admin Operations Center already shows:
- All 4 providers (Zoom, Email, SMS, Push) with MOCK/LIVE mode badges
- Zoom API reachability indicator
- Credential audit (per-key present/missing)
- ME Items callout with specific secrets needed
- Reminder & notification stats

No additional changes were needed.

---

## Files Changed

| File | Change |
|---|---|
| `firestore.rules` | +5 collection rules, tightened `session_instances` list |
| `functions/src/index.ts` | Hardened `updateMemberGuidancePhase` (chunking, auth, idempotency) |
| `components/MemberDetail.tsx` | Added phase transition control UI |
| `components/Icon.tsx` | Added calendar, video, person, settings, edit, search, close, check, alert-circle, block icons (from Prompt 5, carried forward) |
| `app/(app)/account.tsx` | Added no-op guard to CoachZoomPanel handleConnect |
| `app/(member)/my-sessions.tsx` | Member session center (from Prompt 5, carried forward) |

---

## Deployment Verification

| Item | Status |
|---|---|
| Cloud Functions (28 total) | All deployed successfully |
| `updateMemberGuidancePhase` | Created (new) |
| Firestore rules | Deployed |
| Hosting (Expo web) | Deployed |
| GitHub push | `c20e765` on `main` |
| TypeScript errors | 0 in functions, 0 new in app |
| Live app loads | Confirmed at https://goarrive.web.app |

---

## Current State: Full Scheduling Track Inventory

### Cloud Functions (28 deployed)

| Function | Purpose | Prompt |
|---|---|---|
| `createRecurringSlot` | Create a recurring session slot | P1 |
| `updateRecurringSlot` | Update an existing slot | P1 |
| `generateUpcomingInstances` | Scheduled: generate 14-day lookahead instances | P1 |
| `allocateSessionInstance` | Allocate a Zoom room to an instance | P1 |
| `allocateAllPendingInstances` | Batch-allocate all pending instances | P1 |
| `cancelInstance` | Cancel a single occurrence (coach or member) | P1/P5 |
| `rescheduleInstance` | Reschedule a single occurrence (coach or member) | P1/P5 |
| `manageZoomRoom` | Add/update/remove shared Zoom rooms | P2 |
| `zoomWebhook` | Receive Zoom webhook events | P3 |
| `getSystemHealth` | Provider health check | P4 |
| `processReminders` | Scheduled: process due reminder jobs | P4 |
| `retryDeadLetter` | Retry dead-letter items | P4 |
| `getDeadLetterItems` | Read dead-letter queue | P4 |
| `getSessionEventLog` | Filterable session event log | P4 |
| `coachIcalFeed` | iCal/ICS feed for coach sessions | P4 |
| `updateMemberGuidancePhase` | Phase transition automation | P5/P6 |

### Frontend Pages

| Page | Role | Purpose | Prompt |
|---|---|---|---|
| `scheduling.tsx` | Coach | Session Command Center | P2 |
| `admin.tsx` | Admin | Operations Center (5 tabs) | P4 |
| `my-sessions.tsx` | Member | Session center with join/reschedule | P5 |
| `account.tsx` | Coach | Personal Zoom connection panel | P5 |
| `MemberDetail.tsx` | Coach | Phase transition control | P6 |

### Firestore Collections with Rules

All 37 collections now have explicit security rules. The catch-all deny at the bottom ensures no unprotected collections exist.

---

## Suggestions (No Execution)

### 1. Native Date/Time Picker for Member Reschedule

The member reschedule flow in `my-sessions.tsx` currently uses a text input for the new date/time. This works but is error-prone on mobile. A native date/time picker (via `@react-native-community/datetimepicker` or a web-compatible alternative) would significantly improve the UX. This is a small, self-contained change.

### 2. Phase Transition Confirmation Dialog

The phase transition control in `MemberDetail.tsx` currently transitions immediately on tap. Consider adding a confirmation dialog that explains the impact: "This will update X future sessions to [new hosting mode]. The member's session experience will change." This prevents accidental transitions and sets coach expectations.

### 3. Session Instance Composite Index for Member Queries

The member's `my-sessions.tsx` queries `session_instances` with `where('memberId', '==', uid)` and `orderBy('startTime')`. Firestore may require a composite index for this query. If the member session list fails to load in production, check the Firebase Console for index creation prompts. Consider pre-creating the index via `firestore.indexes.json`.

### 4. Zoom Room Capacity Monitoring

The allocator assigns instances to shared Zoom rooms but doesn't track or alert when rooms are at capacity. If multiple coaches are onboarded simultaneously, room contention could cause allocation failures. Consider adding a capacity warning to the admin Operations Center when room utilization exceeds a threshold (e.g., 80%).

### 5. Session Recording Access for Members

Session recordings are tracked on instances (`recordingStatus`, `recordingUrl`) and visible in the admin Operations Center, but members can't see their recordings yet. The `my-sessions.tsx` page could show a "Watch Recording" button on past sessions where `recordingStatus === 'available'`. This would complete the member session lifecycle.
