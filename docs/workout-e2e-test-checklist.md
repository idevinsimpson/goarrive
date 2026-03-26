# GoArrive Workout System — E2E Test Checklist

> **Purpose:** Manual end-to-end verification of the full workout loop.
> Run through every scenario below before each release that touches the workout system.
> Mark each item ✅ or ❌ and note the date/tester.

---

## Pre-requisites

| # | Item | Status |
|---|------|--------|
| 0.1 | Firebase project has all composite indexes deployed (`firebase deploy --only firestore:indexes`) | ☐ |
| 0.2 | Firebase security rules are deployed (`firebase deploy --only firestore:rules`) | ☐ |
| 0.3 | Firebase Storage rules are deployed (`firebase deploy --only storage`) | ☐ |
| 0.4 | Cloud Functions are deployed (`firebase deploy --only functions`) | ☐ |
| 0.5 | Test coach account exists with `role: coach` custom claim | ☐ |
| 0.6 | Test member account exists with `role: member` custom claim, assigned to test coach | ☐ |
| 0.7 | Test admin account exists with `role: admin` custom claim | ☐ |

---

## 1. Movement Library (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 1.1 | Create movement with all fields (name, category, equipment, difficulty, muscle groups, description, work/rest/countdown, swap sides) | Movement appears in library list | ☐ |
| 1.2 | Upload media via file picker in MovementForm | Progress bar shows, thumbnail appears, videoUrl saved to Firestore | ☐ |
| 1.3 | Enter manual video URL instead of uploading | videoUrl field saved, "Video attached" indicator shown | ☐ |
| 1.4 | Add regression and progression text | Fields saved to Firestore, displayed in MovementDetail under "Alternatives" | ☐ |
| 1.5 | Edit existing movement | All fields pre-populated, changes saved correctly | ☐ |
| 1.6 | Archive movement | Movement disappears from default list, appears when "Show Archived" toggled | ☐ |
| 1.7 | Unarchive movement | Movement returns to default list | ☐ |
| 1.8 | Filter by category | Only matching movements shown | ☐ |
| 1.9 | Search by name | Real-time filtering works | ☐ |
| 1.10 | Admin: Mark movement as Global | Confirmation dialog shown, isGlobal set to true, "GLOBAL" badge appears | ☐ |
| 1.11 | Admin: Remove Global from movement | isGlobal set to false, badge removed | ☐ |
| 1.12 | Non-admin coach: Global toggle button NOT visible | Button hidden for non-admin users | ☐ |

---

## 2. Workout Builder (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 2.1 | Create workout with name, description, category | Workout appears in list | ☐ |
| 2.2 | Add blocks with movements (drag to reorder) | Block order persists after save | ☐ |
| 2.3 | Mark workout as template | `isTemplate: true` saved, "TEMPLATE" badge shown | ☐ |
| 2.4 | Admin: Mark template as shared | `isShared: true` saved, "SHARED" badge shown | ☐ |
| 2.5 | Admin: Unshare template | `isShared: false` saved, badge removed | ☐ |
| 2.6 | Non-admin coach: Share button NOT visible | Button hidden for non-admin users | ☐ |
| 2.7 | Archive workout | Workout hidden from default list | ☐ |
| 2.8 | Filter by template / all | Toggle works correctly | ☐ |

---

## 3. Template Marketplace (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 3.1 | Open marketplace from workouts page | Modal opens, shared templates load | ☐ |
| 3.2 | Search templates by name | Filtered results shown | ☐ |
| 3.3 | Filter by category | Only matching templates shown | ☐ |
| 3.4 | Preview template (tap card) | Preview modal shows blocks and movements | ☐ |
| 3.5 | Clone template | New workout created in coach's library with `(Copy)` suffix | ☐ |
| 3.6 | Own templates NOT shown in marketplace | Templates owned by current coach excluded | ☐ |
| 3.7 | Empty state when no shared templates exist | "No shared templates" message shown | ☐ |

---

## 4. Workout Assignment (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 4.1 | Assign workout from MemberDetail | AssignWorkoutModal opens, workout picker + date picker shown | ☐ |
| 4.2 | Assign workout from WorkoutDetail | AssignWorkoutModal opens with pre-selected workout | ☐ |
| 4.3 | Select date and confirm | `workout_assignments` doc created with correct fields | ☐ |
| 4.4 | Verify workoutSnapshot is saved | Assignment doc includes full workout snapshot for versioning | ☐ |
| 4.5 | Assignment appears in member's workout list | Member sees scheduled workout on correct date | ☐ |

---

## 5. Workout Player (Member)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 5.1 | Tap "Start Workout" on today's assignment | Player opens in full-screen modal | ☐ |
| 5.2 | Ready screen shows workout name and movement count | Correct info displayed | ☐ |
| 5.3 | Countdown phase (3-2-1) with beeps and haptics | Audio beeps at 3, 2, 1; haptic at each tick | ☐ |
| 5.4 | Work phase shows movement name, timer, side indicator | All elements visible and correct | ☐ |
| 5.5 | Work phase shows movement video (if videoUrl exists) | Video loops silently in media area | ☐ |
| 5.6 | Work phase shows thumbnail (if thumbnailUrl but no videoUrl) | Image displayed in media area | ☐ |
| 5.7 | Work phase shows no media (if neither URL exists) | Media area hidden, no errors | ☐ |
| 5.8 | Next-up preview during WORK phase | Shows next movement name, thumbnail, block info | ☐ |
| 5.9 | Rest phase with timer and enhanced next-up preview | Timer counts down, next-up shows thumbnail + block + duration | ☐ |
| 5.10 | Skip rest button | Advances to next movement immediately | ☐ |
| 5.11 | Swap sides phase (for swapSides movements) | "SWITCH SIDES" shown, countdown, then right side work | ☐ |
| 5.12 | Pause/resume | Timer pauses and resumes correctly | ☐ |
| 5.13 | Skip movement | Advances to next movement or rest | ☐ |
| 5.14 | Complete screen | "Workout Complete!" with movement count, Continue button | ☐ |
| 5.15 | Screen stays awake during workout | Wake lock active, screen does not dim | ☐ |
| 5.16 | Progress bar updates | Fills proportionally as movements complete | ☐ |

---

## 6. Post-Workout Journal (Member)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 6.1 | Journal modal appears after player completion | Modal opens with Glow/Grow fields | ☐ |
| 6.2 | Fill in Glow, Grow, energy rating, mood rating | All fields accept input | ☐ |
| 6.3 | Submit journal | workout_log created with journal data, assignment status → completed | ☐ |
| 6.4 | Skip journal | workout_log created with journal: null, assignment status → completed | ☐ |
| 6.5 | Offline submission | Write queued in AsyncStorage, synced on next connectivity | ☐ |

---

## 7. Coach Review Queue (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 7.1 | Needs Review banner on dashboard | Gold banner shows count of unreviewed logs | ☐ |
| 7.2 | Open review queue from MemberDetail | Modal opens with pending logs | ☐ |
| 7.3 | Quick reaction on log card (emoji tap) | Reaction saved, log marked reviewed, card removed from pending | ☐ |
| 7.4 | Tap log card to open detail | Detail modal shows journal, duration, energy/mood | ☐ |
| 7.5 | Select reaction in detail modal | Reaction emoji highlighted | ☐ |
| 7.6 | Write coach note and submit | coachNote + coachReaction saved, reviewStatus → reviewed | ☐ |
| 7.7 | Already-reviewed logs show in "Reviewed" tab | Reviewed logs visible with reaction + note | ☐ |

---

## 8. Push Notifications

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 8.1 | Member receives push when workout assigned | Notification with workout name and date | ☐ |
| 8.2 | Member receives push when coach reviews log | Notification with coach reaction | ☐ |
| 8.3 | Push token saved to Firestore on login | `users/{uid}.expoPushToken` field populated | ☐ |
| 8.4 | No crash if push permissions denied | Graceful fallback, no token saved | ☐ |

---

## 9. Workout Analytics (Coach)

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 9.1 | Open analytics from MemberDetail | Modal opens with stats | ☐ |
| 9.2 | Completion rate calculated correctly | Total completed / total assigned | ☐ |
| 9.3 | Average energy and mood shown | Correct averages from journal data | ☐ |
| 9.4 | Weekly bar chart renders | Last 4 weeks of completion data | ☐ |
| 9.5 | Recent log timeline shows last 10 logs | Correct order, names, durations | ☐ |
| 9.6 | Empty state when no logs exist | "No workout data yet" message | ☐ |

---

## 10. Member Workout History

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 10.1 | Open history from member workouts header | Modal opens with past logs | ☐ |
| 10.2 | Logs sorted by completedAt descending | Most recent first | ☐ |
| 10.3 | Each log shows name, date, duration, journal excerpt | All fields displayed | ☐ |
| 10.4 | Coach reaction shown if present | Emoji displayed on log card | ☐ |
| 10.5 | Empty state when no history | "No completed workouts yet" message | ☐ |

---

## 11. Cross-Cutting Concerns

| # | Scenario | Expected Result | Status |
|---|----------|-----------------|--------|
| 11.1 | iOS: Full loop (assign → play → journal → review) | No crashes, all screens render | ☐ |
| 11.2 | Android: Full loop | No crashes, all screens render | ☐ |
| 11.3 | Web: Full loop | No crashes, all screens render (video may differ) | ☐ |
| 11.4 | Offline: Start workout while offline | Player works with cached data | ☐ |
| 11.5 | Offline: Complete workout while offline | Log queued, synced on reconnect | ☐ |
| 11.6 | Role isolation: Member cannot access coach routes | Redirect or 403 | ☐ |
| 11.7 | Role isolation: Coach cannot access admin features | Admin buttons hidden | ☐ |
| 11.8 | Firestore rules: Member cannot write to other member's logs | Permission denied | ☐ |
| 11.9 | Firestore rules: Coach can only read own members' logs | Permission denied for other coaches | ☐ |

---

## Sign-Off

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| Build/Commit | |
| Platform(s) Tested | |
| All Critical Paths Pass? | ☐ Yes / ☐ No |
| Notes | |
