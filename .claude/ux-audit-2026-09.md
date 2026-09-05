# GoArrive UX Audit — September 2026

**Date:** 2026-09-05
**Auditor:** Maia (Phase 1 read-only pass)
**Branch:** docs/ux-audit-2026-09

## Scope

Five surfaces audited via static source reading:
1. Open app → start a workout (member path)
2. Finish workout → coach acknowledgment (member + coach)
3. Coach daily loop (Command Center / dashboard)
4. Coach builds a workout (Build tab + WorkoutFolderPage)
5. Coach builds/presents a plan (member-plan, my-plan, shared-plan)

Deferred (out of scope): coach-launch, coach-setup, admin, billing, scheduling, account, my-page, profile, my-sessions, onboarding/funnel routes.

## Methodology

Each surface was approached by asking: what is the user trying to do, what is the shortest clear path, and what obstructs it? UX laws are cited as the reason an obstruction hurts, not as an organizing principle. WorkoutPlayer findings are flagged paint-only (timer/phase/audio logic is off-limits). Findings that could not be connected to a concrete user experience were dropped. Cap of 40 findings honored; 35 findings filed plus 4 genuine bugs.

---

## Summary Counts

| Severity | Count |
|---|---|
| Blocker | 3 |
| High | 12 |
| Med | 12 |
| Low | 8 |
| Total | 35 |

| Surface | Findings |
|---|---|
| S1: Member starts a workout | 7 |
| S2: Finish workout to coach ack | 6 |
| S3: Coach daily loop | 8 |
| S4: Coach builds a workout | 8 |
| S5: Coach builds/presents a plan | 6 |

---

## Surface 1 -- Open App to Start a Workout (Member)

User goal: A member opens the app and starts their assigned workout for today.

Tap count from home screen:
1. Tap Workouts tab
2. See today's workout card -- tap "Start Workout"
3. WorkoutPreview screen appears -- tap "Start" button
4. WorkoutPlayer starts

Minimum 3 taps. If the member lands on the Workouts tab (not Home), it's 2 taps. Either way, the Home screen -- which is the landing surface -- offers zero path to today's workout.

---

### UX-001
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/home.tsx:278-330
- what the user experiences: A member opens the app and lands on Home. They see a plan status card, a coach info card, and a "Quick Actions" section with "Upload Profile Photo" and "Edit My Information" -- but no button or link to start today's workout, even when one is scheduled. They have to navigate to the Workouts tab separately to find it.
- law(s): Law 18 (Parkinson's Law) -- every extra tap expands the task; Law 9 (Serial Position) -- the most important action should be first; Law 20 (Goal-Gradient) -- showing today's workout on Home makes the goal feel close.
- severity: blocker
- effort: M
- fix: When the member has a workout_assignments entry with scheduledFor === today && status === "scheduled", render a prominent "Start Today's Workout" card at the top of home.tsx above the plan status card. Reuse the gold-bordered todayCard style from workouts.tsx:944-951. The tap navigates to /(member)/workouts. A single Firestore query (where memberId==uid, where scheduledFor==today) is enough -- no need to store count in state.

---

### UX-002
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/workouts.tsx:767-794
- what the user experiences: After tapping "Start Workout," the member is taken to a full-screen WorkoutPreview modal before the player opens. They must tap "Start" a second time to actually begin. For a returning member who already knows the workout, this is a mandatory extra step every session.
- law(s): Law 18 (Parkinson's Law) -- unnecessary confirmation screen; Law 1 (Hick's Law) -- a returning member wants one tap, not a decision screen.
- severity: med
- effort: S
- fix: Make WorkoutPreview opt-in. Add an AsyncStorage key @goarrive_skip_preview that defaults to false. On the preview screen, add a "Don't show again" toggle. When set, WorkoutPreview immediately calls onStart(). For new members (first 3 sessions), always show the preview -- equipment checklist is genuinely useful.

---

### UX-003
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/home.tsx:74-145
- what the user experiences: Home screen loads with a spinner while three sequential Firestore reads happen: member doc, then coach doc, then three plan queries (planByUid, planByLegacy, plansQuery). The three plan reads are awaited one after another, adding latency on every home screen visit.
- law(s): Law 6 (Doherty Threshold) -- perceived slowness kills engagement; Law 20 (Goal-Gradient) -- a fast home screen makes the workout feel achievable.
- severity: med
- effort: S
- fix: Run all three plan reads in Promise.all([getDoc(planByUid), getDoc(planByLegacy), getDocs(plansQuery)]) instead of sequentially. Also switch to onSnapshot for the member document so the home screen reacts in real time to status changes.

---

### UX-004
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/workouts.tsx:619-654
- what the user experiences: If a member has missed workouts from earlier in the week, the Missed section appears between Today and Upcoming. A member who opens the app to start today's workout must scroll past guilt-inducing Missed cards to reach Upcoming. The red Missed section visually competes with the gold Today section.
- law(s): Law 9 (Serial Position) -- Today must come first, Missed must not interrupt it; Law 7 (Von Restorff) -- the red Missed section competes with gold Today.
- severity: high
- effort: S
- fix: Reorder sections: Today > Upcoming > Completed > Missed. Make Missed a collapsed accordion by default (tap to expand). This de-emphasizes past failures without hiding them.

---

### UX-005
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/workouts.tsx:596-609
- what the user experiences: Upcoming and Missed workout cards have a 40x40px icon-only play button (miniStartBtn) as the start action. There is no text label. A member who hasn't used the app before won't know this is tappable or what it does.
- law(s): Law 2 (Fitts's Law) -- 40x40px with no affordance; Law 3 (Jakob's Law) -- unlabeled icon-only action buttons violate expectations.
- severity: med
- effort: S
- fix: Make the entire assignmentCard row pressable for upcoming items (larger target). Or add a short "Start" text label below/beside the play icon in miniStartBtn.

---

### UX-006
- surface: S1 -- Member starts a workout
- file:line: apps/goarrive/app/(member)/workouts.tsx:741-744
- what the user experiences: WorkoutDifficultyTracker is rendered with coachId derived from assignments[0]?.workoutSnapshot?.coachId ?? ''. If assignments is empty (new member), coachId is '' and the tracker renders with a blank coach reference. May produce an empty or erroring widget.
- law(s): Law 14 (Postel's Law) -- handle empty/edge states gracefully.
- severity: low
- effort: S
- fix: Guard the render: {assignments.length > 0 && <WorkoutDifficultyTracker .../>}. This hides the tracker until there is a valid coachId.

---

### UX-007
- surface: S1 -- Member starts a workout (player)
- file:line: apps/goarrive/components/WorkoutPlayer.tsx (paint-only)
- what the user experiences: WorkoutPlayer renders the movement name and countdown timer on the same row above the video. On small phones, a long movement name can truncate or wrap into the timer area.
- law(s): Law 12 (Law of Praegnanz) -- cluttered overlaid text reads poorly.
- severity: low
- effort: S
- fix (paint-only): Enforce numberOfLines={1} with ellipsizeMode="tail" on the movement name and give it flex:1 bounded by the timer width. The timer (always 3-4 chars like "0:42") should have a fixed minWidth. Pure style change, no logic impact.

---

## Surface 2 -- Finish Workout to Coach Acknowledgment

User goal (member side): Complete the workout and log how it went so the coach can see it.
User goal (coach side): See which members finished their workout today and give them a quick acknowledgment.

Post-workout sequence (member):
1. WorkoutPlayer fires onComplete -> celebration animation
2. WorkoutCelebration onComplete -> WorkoutSessionSummary appears
3. WorkoutSessionSummary: tap "Continue to Journal" or "Skip Journal"
4. PostWorkoutJournal: fill Glow/Grow + ratings -> tap "Save Reflection" (or "Skip")
5. Journal submitted -> workout_log written, workout_assignment marked completed

Coach acknowledgment path:
1. Dashboard shows "N workout logs need review" banner (red, tappable)
2. Taps open WorkoutLogReview modal
3. Coach sees each log card with member name, journal preview, energy/mood chips
4. Can tap emoji reaction (one tap) to mark reviewed, or expand to add a note
5. Member sees reaction emoji on their completed assignment card

Member-to-coach path total: 4-5 taps + text entry. Coach-to-ack: 2 taps. The coach side is well-designed; the member side has friction.

---

### UX-008
- surface: S2 -- Post-workout flow
- file:line: apps/goarrive/app/(member)/workouts.tsx:825-849
- what the user experiences: After completing a workout, a member navigates through three full-screen UI states: (1) celebration animation, (2) WorkoutSessionSummary with a fork ("Continue to Journal" or "Skip Journal"), (3) PostWorkoutJournal. A tired member post-workout faces a multi-screen gauntlet before they're done.
- law(s): Law 18 (Parkinson's Law) -- three screens where one would do; Law 1 (Hick's Law) -- the "Continue or Skip" fork adds a decision.
- severity: high
- effort: M
- fix: Collapse the session summary into the PostWorkoutJournal screen as a compact header (workout name, duration, movement count). After the celebration animation completes, go directly to the journal screen with summary info at the top. Remove WorkoutSessionSummary as a separate modal. The journal already has a "Skip" button.

---

### UX-009
- surface: S2 -- Post-workout journal
- file:line: apps/goarrive/components/PostWorkoutJournal.tsx:187-195
- what the user experiences: The submit button label changes from "Save Reflection" (when anything is filled) to "Save Without Reflection" (when everything is blank). The "Skip" button also exists below. A member who didn't fill anything sees two ways to proceed that appear to mean the same thing -- they do different things in practice but call identical handlers.
- law(s): Law 15 (Postel's Law) -- ambiguous controls cause errors; Law 1 (Hick's Law) -- two buttons that appear to do the same thing.
- severity: high
- effort: S
- fix: Use one label on the submit button at all times: "Save." Remove "Save Without Reflection." Keep "Skip" as a clearly secondary option with its muted style. The distinction members need is "Submit what I wrote" vs "Skip and don't journal."

---

### UX-010
- surface: S2 -- Coach acknowledgment staleness
- file:line: apps/goarrive/components/CoachReviewQueue.tsx:96-141
- what the user experiences: The CoachReviewQueue listener only activates when visible === true. The dashboard "needs review" count is stale (from a one-shot getDocs on mount) until the coach manually refreshes. A coach who leaves the dashboard open sees an outdated count.
- law(s): Law 6 (Doherty Threshold) -- stale counts undermine trust; Law 11 (Zeigarnik) -- a stale "3 need review" that stays at 3 after reviewing one feels broken.
- severity: med
- effort: M
- fix: Replace the getDocs in fetchData() for needsReview with an onSnapshot listener tied to the dashboard lifecycle. Update stats.needsReview in real time. The review queue already uses onSnapshot when open -- the dashboard just needs the same live count.

---

### UX-011
- surface: S2 -- Coach acknowledgment
- file:line: apps/goarrive/components/CoachReviewQueue.tsx:248-352
- what the user experiences: Each log card shows member name, workout name, journal preview, and quick-reaction emoji row -- but no member photo. When a coach has 10+ members, "Sarah" completing "Upper Body A" gives no visual anchor. The coach must mentally map names to faces.
- law(s): Law 4 (Law of Proximity) -- faces + names grouped together accelerate recognition; Law 5 (Miller's Law) -- reducing cognitive load for name-to-member mapping.
- severity: low
- effort: M
- fix: Add a small member avatar (32x32px circle) using profilePhotoUrl from the members collection, or initials fallback. The avatar sits left of the member name in st.logCardInfo.

---

### UX-012
- surface: S2 -- Coach acknowledgment
- file:line: apps/goarrive/app/(member)/workouts.tsx:557-573
- what the user experiences: A member who completed a workout sees the coach's emoji reaction inline on their card, which is good. But the coachNote preview (italic gold text) is truncated to numberOfLines={1}. If the coach wrote a longer note, the member can only see the first line with no affordance to read the rest.
- law(s): Law 10 (Peak-End Rule) -- coach feedback is the emotional peak of the loop; truncating it undercuts that moment; Law 3 (Jakob's Law) -- tapping truncated text should expand it.
- severity: med
- effort: S
- fix: Make the completed assignment card tappable. On tap, open a bottom sheet or Alert showing the full coach note and reaction emoji. This closes the feedback loop meaningfully.

---

### UX-013
- surface: S2 -- Coach acknowledgment signal
- file:line: apps/goarrive/app/(app)/dashboard.tsx:329-342
- what the user experiences: The "N workout logs need review" banner is only visible on the dashboard. There is no push notification when a member completes a workout. A coach who doesn't open the app will miss members' completions. The platform has push notification infrastructure (lib/notifications.ts) but it's not wired to workout log creation.
- law(s): Law 11 (Zeigarnik) -- the coach needs to know incomplete reviews exist; Law 6 (Doherty Threshold) -- timely feedback enables faster acknowledgment.
- severity: high
- effort: L
- fix: Add a Cloud Function trigger on workout_logs onCreate that sends a push notification to the coach: "[Member name] completed [Workout name] -- tap to review." Wire the existing notification infrastructure to the log creation event.

---

## Surface 3 -- Coach Daily Loop (Command Center / Dashboard)

User goal: A coach opens the app and immediately understands what needs attention today -- which members need review, who is in session now, and what's coming up.

---

### UX-014
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:384
- what the user experiences: The "Workouts" stat card (showing the coach's total workout count) routes to /(app)/workouts -- the legacy Workouts page that is hidden from the tab bar and replaced by Build. Tapping this card goes to a dead/hidden route.
- law(s): Law 15 (Postel's Law) -- navigating to a deprecated page is a broken interaction; Law 3 (Jakob's Law) -- tapping a count should take you to the list it counts.
- severity: blocker
- effort: S
- fix: Change router.push('/(app)/workouts') to router.push('/(app)/build'). Optionally pass a query param to pre-select the Workouts tab: router.push('/(app)/build?type=Workouts') and read it via useLocalSearchParams in build.tsx to set activeType on mount.

---

### UX-015
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:395
- what the user experiences: The "Movements" stat card routes to /(app)/movements -- the same legacy page pattern as UX-014.
- law(s): Same as UX-014.
- severity: blocker
- effort: S
- fix: Change router.push('/(app)/movements') to router.push('/(app)/build?type=Movements').

---

### UX-016
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:319-327
- what the user experiences: The "N workouts scheduled for today" banner is a non-interactive View. A coach who sees "3 workouts scheduled for today" can't tap it to see which members or which workouts. The review banner directly below IS tappable -- two visually identical banners with inconsistent behavior.
- law(s): Law 16 (Law of Similarity) -- identical-looking banners with different interaction behavior breaks pattern consistency; Law 3 (Jakob's Law) -- banners with counts should be tappable.
- severity: high
- effort: S
- fix: Wrap todayBanner in a Pressable. On press, navigate to a filtered assignment view or open a modal listing today's assignments. At minimum, add tappability so the pattern is consistent with the review banner.

---

### UX-017
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:476-486
- what the user experiences: The "Recent Activity" section renders stats.recentCheckins.map(checkin => <CheckInCard key={checkin.id} />). CheckInCard takes no props and fetches today's check-in state independently. Every card in the list renders the same "today's check-in" widget -- not a history of checkins. See BUG-001.
- law(s): Law 12 (Praegnanz) -- repeated identical cards confuse rather than inform.
- severity: see BUG-001
- effort: N/A
- fix: see BUG-001

---

### UX-018
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:59-99
- what the user experiences: The "Your Coaching Tools" feature card list contains two entries for Members: "Member Plans" (goes to /members) and "Member List" (also goes to /members). Two cards with different titles pointing to the same route.
- law(s): Law 1 (Hick's Law) -- duplicate entries force a decision that shouldn't exist; Law 12 (Praegnanz) -- visual noise from redundant cards.
- severity: med
- effort: S
- fix: Merge into one "Members" card with combined description: "View your roster, track progress, and build personalized plans." Remove one entry from FEATURE_CARDS.

---

### UX-019
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:136-232
- what the user experiences: fetchData() uses getDocs (one-shot) on mount. Dashboard stats -- member count, workouts, movements, today's assignments, needs-review count -- are stale after the initial load. A coach who leaves the app running comes back to outdated counts without knowing it.
- law(s): Law 6 (Doherty Threshold) -- stale data erodes trust in the dashboard.
- severity: med
- effort: M
- fix: Convert the needsReview count to an onSnapshot listener (same as liveMemberCount already does at line 248). member/workout/movement counts change slowly and can remain as one-shot fetches.

---

### UX-020
- surface: S3 -- Coach daily loop
- file:line: apps/goarrive/app/(app)/dashboard.tsx:246-260
- what the user experiences: Live member count banner ("N members in session now") appears when liveMemberCount > 0. When it first appears (count transitions 0 to 1), there is no animation or pulse to draw attention -- it just materializes. A coach who has the dashboard open mid-scroll may not notice it.
- law(s): Law 7 (Von Restorff) -- a high-signal live-session event should visually stand out.
- severity: low
- effort: S
- fix (paint-only): Add a pulsing Animated.loop on liveDot opacity (0.4 to 1.0). Pure style change, no data logic.

---

### UX-021
- surface: S3 -- Coach daily loop (code quality / product language)
- file:line: apps/goarrive/app/(app)/dashboard.tsx:267-275
- what the user experiences: roleLabel includes a branch for role === 'coachAssistant' which renders 'Coach Assistant'. Per product-identity.md, this role does not exist and should not be built.
- law(s): Product language violation.
- severity: low
- effort: S
- fix: Remove the coachAssistant branch. Simplify to: const roleLabel = isAdmin ? 'Platform Admin' : 'Coach'.

---

## Surface 4 -- Coach Builds a Workout (Build Tab)

User goal: A coach creates a new workout and adds movements to it.

Tap count (new workout from Build tab):
1. Tap "+" button (top right)
2. Tap "Workout" from plus menu
3. WorkoutFolderPage opens for the new workout (pre-created in Firestore)
4. Coach adds movements

2 taps to reach the builder is good. The empty builder itself has no guidance on what to do next.

---

### UX-022
- surface: S4 -- Coach builds a workout (dead import)
- file:line: apps/goarrive/app/(app)/build.tsx:68
- what the user experiences: WorkoutForm is imported at line 68 but never rendered. Dead code. See BUG-004.
- law(s): N/A (engineering bug)
- severity: see BUG-004
- effort: N/A

---

### UX-023
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/app/(app)/build.tsx:584
- what the user experiences: The Build tab opens with "All" selected by default, showing a mixed grid of Plans, Movements, Workouts, Follow-Alongs, Playbooks, and Folders interleaved. A coach with a large library sees 30+ cards of different types with no visual grouping. A new coach trying to create their first workout must hunt through the mix.
- law(s): Law 1 (Hick's Law) -- "All" with no context is overwhelming; Law 12 (Praegnanz) -- mixed types without visual grouping create noise.
- severity: high
- effort: S
- fix: Change the default from 'All' to 'Workouts'. Add a small count badge on each tab ("Workouts (12)") to make "All" useful as an overview rather than the default.

---

### UX-024
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/app/(app)/build.tsx:94-95
- what the user experiences: The type tab row includes "Follow-Alongs" as a label -- 13 characters. On a 375px wide phone with 6 tabs (All, Plans, Movements, Workouts, Follow-Alongs, Playbooks), each tab gets roughly 57px. "Follow-Alongs" will truncate or wrap at that width.
- law(s): Law 12 (Praegnanz) -- truncated labels reduce scannability; Law 2 (Fitts's Law) -- small tap targets on a crowded tab row.
- severity: med
- effort: S
- fix: Rename "Follow-Alongs" to "Videos" in the UI (the underlying collection and type stay the same). "Videos" is 6 chars, renders cleanly on all phone widths, and is self-explanatory.

---

### UX-025
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/app/(app)/build.tsx:3726-3820
- what the user experiences: The plus menu items in the non-playbook context are: Plan, Movement, Bulk Upload Movements, Workout, [Folder/Playbook below]. A coach who wants to create a workout must skip past three items to reach Workout -- the most common creation target.
- law(s): Law 9 (Serial Position) -- most common items should be first; Law 1 (Hick's Law) -- 5+ items in a flat list.
- severity: med
- effort: S
- fix: Reorder plus menu: Workout first, then Movement, then Bulk Upload, then Plan, then Playbook/Folder at the bottom. Add a visual separator between "content" (Workout, Movement) and "organization" (Folder, Playbook, Plan).

---

### UX-026
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/app/(app)/build.tsx:261-286
- what the user experiences: The BuildErrorBoundary on retry resets to the component's initial state -- activeType returns to 'All', currentFolderId resets to null, currentPlaybook resets to null. A coach who was deep in a folder loses their place on any error.
- law(s): Law 15 (Postel's Law) -- errors should be recoverable without losing work context.
- severity: low
- effort: M
- fix: Persist activeType and currentFolderId to AsyncStorage (same pattern used for active workout sessions). On retry in the error boundary, read from AsyncStorage and restore position.

---

### UX-027
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/app/(app)/build.tsx:2310-2342
- what the user experiences: When inside a folder (currentFolderId is set), switching type tabs narrows the folder's contents by type instead of exiting the folder. A coach who accidentally enters a folder and then taps the Movements tab ends up with a confusing filtered-inside-folder view.
- law(s): Law 3 (Jakob's Law) -- tapping a top-level type tab while inside a sub-context should exit that context; Law 5 (Miller's Law) -- folder + type filter combined is double context.
- severity: med
- effort: M
- fix: When currentFolderId is set and the user taps a type tab, clear currentFolderId (exit the folder) and apply the type filter to the root view. Show a toast: "Exited [Folder Name] -- showing all [Type]."

---

### UX-028
- surface: S4 -- Coach builds a workout
- file:line: apps/goarrive/components/WorkoutFolderPage.tsx (inferred from build.tsx:3780-3802 default state)
- what the user experiences: A newly created workout opens in WorkoutFolderPage with a single empty Circuit block and no movements. There is no on-screen guidance about what to do next -- no "Add a movement to get started" prompt, no tooltip, no empty-state affordance inside the block.
- law(s): Law 13 (Hick's Law/Defaults) -- an empty canvas with no cues forces exploration; Law 20 (Goal-Gradient) -- making the next action obvious accelerates the coach's progress.
- severity: high
- effort: S
- fix: In WorkoutFolderPage.tsx, when a block has 0 movements, render an inline empty-state inside the block: a muted "Tap + to add a movement" label in the primary green color. One Text component, no logic changes needed.

---

## Surface 5 -- Coach Builds/Presents a Plan

User goal: A coach opens a member's plan, fills out pricing and schedule, creates pricing scenarios, and shares the plan link with the member to review.

Share flow:
1. Members tab > find member > tap Member Plan
2. (Intake tab by default) > tap "Fitness Plan" tab
3. Toggle is already in Coach mode
4. Fill plan fields, adjust scenarios via SCENARIOS strip
5. Tap settings gear > Plan Controls drawer (pricing)
6. Close drawer
7. Tap "Share Plan Link" -- link copied

---

### UX-029
- surface: S5 -- Coach presents a plan
- file:line: apps/goarrive/app/(app)/member-plan/[memberId].tsx:3720-3732
- what the user experiences: The SCENARIOS tab strip at the top of the plan screen is collapsible (toggle via the "SCENARIOS v" header). If collapsed by default, a coach on a sales call may not discover that multiple pricing scenarios exist. Even expanded, the label "SCENARIOS" doesn't communicate "here's where you offer different pricing options."
- law(s): Law 19 (Tesler's Law) -- complexity that can't be removed should be made discoverable; Law 3 (Jakob's Law) -- "SCENARIOS" as a section label doesn't self-explain during a call.
- severity: high
- effort: S
- fix: Default tabStripCollapsed to false (scenarios expanded on first load). Persist the preference to AsyncStorage after the coach collapses it once. Rename the section label from "SCENARIOS" to "PRICING OPTIONS."

---

### UX-030
- surface: S5 -- Coach presents a plan
- file:line: apps/goarrive/app/(app)/member-plan/[memberId].tsx:3686-3692
- what the user experiences: The settings gear icon (opens Plan Controls / pricing drawer) has no label or tooltip. During a live call, a coach who doesn't know this is where pricing lives may hunt through the plan looking for a "Pricing" section.
- law(s): Law 3 (Jakob's Law) -- a gear icon alone doesn't communicate "this is where you set pricing"; Law 7 (Von Restorff) -- pricing is a primary action but gets a generic icon.
- severity: med
- effort: S
- fix: Add a short text label next to the gear: "Pricing" or "Plan Settings." Or add a long-press tooltip. Ensure the gear is accessible from a sticky position so it doesn't scroll off.

---

### UX-031
- surface: S5 -- Coach presents a plan
- file:line: apps/goarrive/app/(app)/member-plan/[memberId].tsx:3743-3745
- what the user experiences: In the scenario tab strip, the base plan is labeled "Plan 1." Additional scenarios show as unlabeled pills until the coach explicitly renames them. A coach who creates two pricing scenarios (e.g., 3-month vs 6-month) can't tell them apart until both are renamed.
- law(s): Law 13 (Hick's Law/Defaults) -- auto-name new scenarios with something meaningful; Law 5 (Miller's Law) -- unlabeled scenarios add cognitive load during a call.
- severity: med
- effort: S
- fix: Auto-name new scenarios sequentially: "Option A," "Option B," "Option C" on creation. Add a one-time hint: "Long press to rename" on first scenario creation.

---

### UX-032
- surface: S5 -- Plan acceptance (shared plan)
- file:line: apps/goarrive/app/shared-plan/[memberId].tsx:104-107
- what the user experiences: When a non-authenticated member taps "Accept Plan" on a shared plan link, they are routed to /(auth)/sign-in. This route does not exist -- only /(auth)/login.tsx exists. The member hits a navigation error instead of the login screen. See BUG-002.
- law(s): N/A (engineering bug)
- severity: see BUG-002
- effort: N/A

---

### UX-033
- surface: S5 -- Coach presents a plan
- file:line: apps/goarrive/app/(app)/member-plan/[memberId].tsx:3696-3718
- what the user experiences: The Coach/Member View toggle persists its state. If a coach toggles to Member View on one plan, goes back, and opens another member's plan, they land in Member View again. They might think they're in Coach mode and miss that edits are disabled.
- law(s): Law 15 (Postel's Law) -- prevent errors by resetting state to a safe default on navigation; Law 14 (Postel's Law) -- the interface should not allow accidental mode confusion.
- severity: med
- effort: S
- fix: Reset isCoachMode to true whenever the component mounts with a new memberId. Add useEffect(() => { setIsCoachMode(true); }, [memberId]).

---

### UX-034
- surface: S5 -- Member plan empty state
- file:line: apps/goarrive/app/(member)/my-plan.tsx:303-317
- what the user experiences: When a member has no plan, the screen shows "No Plan Yet" and text: "Complete your intake to get started." If the member already submitted intake and is waiting for the coach to build the plan, this message implies they need to do something when they don't. It creates confusion.
- law(s): Law 10 (Peak-End Rule) -- the empty state is the member's first meaningful interaction with the plan surface; Law 15 (Postel's Law) -- the interface should accurately reflect the user's state.
- severity: high
- effort: S
- fix: Distinguish two states using intakeSubmissionId on the member document: (a) no intake submitted -> show "Complete your intake to get started" with a CTA. (b) intake submitted but no plan yet -> show "Your intake is complete! Your coach is building your plan. You'll be notified when it's ready."

---

### UX-035
- surface: S5 -- Plan day tile abbreviations
- file:line: apps/goarrive/app/(app)/member-plan/[memberId].tsx:208
- what the user experiences: Day tiles show abbreviations: STR (Strength), CARD (Cardio + Mobility), MIX (Mix), OFF (Rest). "CARD" is ambiguous -- could be cardio, card UI element, etc. "MIX" is also unclear to a member seeing their own plan for the first time.
- law(s): Law 3 (Jakob's Law) -- abbreviations that aren't universally obvious require learning; Law 5 (Miller's Law) -- decoding abbreviations is cognitive overhead.
- severity: low
- effort: S
- fix: Keep abbreviations on the tiny tile (space constraint is real) but add a one-line legend below the weekly schedule strip: "STR = Strength  CARD = Cardio  MIX = Mixed  OFF = Rest." One Text component below the day tile row.

---

## Already Good

These patterns work well and Phase 2 should preserve them:

1. Today's workout card prominence (workouts.tsx:490-531): The gold-bordered todayCard style with a full-width "Start Workout" button is visually unambiguous. Well-sized, well-labeled, well-placed. Assignment note from coach is surfaced inline. Keep this.

2. Coach quick-reaction on log cards (CoachReviewQueue.tsx:315-341): Emoji reaction row + "Mark Reviewed" one-tap from card list. The "10 seconds per review" goal is achievable with this UX. Keep it.

3. WorkoutPreview equipment checklist (WorkoutPreview.tsx:47-62): Tappable equipment checklist with checkbox state is a useful preparation tool. Fetches from Firestore and aggregates equipment per movement.

4. Crash-recovery session persistence (workouts.tsx:108-136): The @goarrive_active_workout_session AsyncStorage key that resumes an interrupted session is excellent resilience design. Members who crash mid-workout won't see a double-log.

5. Offline queue for workout logging (workouts.tsx:328-359): Using enqueueWrite for assignment updates and log creation means poor gym signal doesn't lose the completion record.

6. Plan live subscription on member side (my-plan.tsx:101-135): The member's plan screen uses onSnapshot so coach edits during a call land in real time. The scenario subscription (syncScenarioSubscription) is correctly idempotent. Keep this.

7. Portal-rendered dropdowns in plan editor (member-plan/[memberId].tsx:1-31): Using ReactDOM.createPortal for floating dropdowns correctly solves clipping in React Native Web's scroll containers. The inline DROPDOWN RULE comment is clear and should be enforced. Keep this pattern.

8. Dashboard "Needs Review" banner (dashboard.tsx:329-342): Red banner with count and chevron correctly surfaces the coach's most urgent action. Tappable, opens review queue directly, urgency color is appropriate.

9. Member streak and calendar strip (workouts.tsx:734-745): Showing the member's streak and calendar history provides concrete progress feedback. Serves Law 11 (Zeigarnik) and Law 20 (Goal-Gradient) well.

10. Build drag-and-drop tray (build.tsx): The bottom tray for drag-to-folder uses measured-layout (onLayout not async measure()) which avoids a race condition. Ghost image and tray slide animation are polished.

---

## Genuine Bugs (Not UX Issues)

These were found during the audit but are engineering bugs. Route separately from UX Phase 2.

### BUG-001
- file:line: apps/goarrive/app/(app)/dashboard.tsx:476-486
- description: stats.recentCheckins.map(checkin => <CheckInCard key={checkin.id} />) renders N identical CheckInCard components. CheckInCard takes no props and shows today's check-in state on its own. Every card in the list renders the same widget -- not a history of N recent checkins. The "Recent Activity" section is effectively broken.
- impact: Coach sees repeated identical cards in Recent Activity. Not a crash, but the feature does not work.
- fix: Either (a) pass checkin data as a prop to CheckInCard and render it as a historical record, or (b) replace the section with a recent workout logs feed (which would be more useful for the coach).

### BUG-002
- file:line: apps/goarrive/app/shared-plan/[memberId].tsx:107
- description: router.push('/(auth)/sign-in' as any) routes to a non-existent page. The auth directory only contains login.tsx (/(auth)/login). On web, this produces a 404. On native, Expo Router throws a navigation error.
- impact: Members who tap "Accept Plan" on a shared plan link get a navigation error instead of the login screen. Plan acceptance is broken for unauthenticated members.
- fix: Change '/(auth)/sign-in' to '/(auth)/login'.

### BUG-003
- file:line: apps/goarrive/app/(app)/dashboard.tsx:269
- description: roleLabel includes a branch for role === 'coachAssistant' which renders 'Coach Assistant'. Per product-identity.md, this role does not exist and should not be built. Dead code that exposes a non-existent concept.
- impact: Low -- role doesn't exist in practice. Dead branch may confuse engineers or mask a misconfigured auth claim.
- fix: Remove the coachAssistant branch. Simplify to: const roleLabel = isAdmin ? 'Platform Admin' : 'Coach'.

### BUG-004
- file:line: apps/goarrive/app/(app)/build.tsx:68
- description: import WorkoutForm from '../../components/WorkoutForm' -- WorkoutForm is imported but never rendered anywhere. The active builder is WorkoutFolderPage (setOpenWorkoutId triggers it). Dead import adds bundle overhead and misleads engineers about which component handles workout creation.
- impact: Minimal user-facing impact. Bundle size overhead.
- fix: Remove the WorkoutForm import from build.tsx. Do not delete WorkoutForm.tsx yet -- verify no other importers first.

---

## Top 10 Findings by User Impact

Ranked by "how much does fixing this help a real user complete the loop."

1. UX-001 (S1 blocker) -- Home screen has no "Start Today's Workout" CTA. Every member in the app's primary use case hits this every session.

2. UX-014 + UX-015 (S3 blocker x2) -- Dashboard Workouts and Movements stat cards route to dead legacy pages. Every coach who taps either hits a broken flow.

3. BUG-002 (S5) -- "Accept Plan" on shared plan routes to non-existent /(auth)/sign-in. Plan acceptance is broken for all unauthenticated members.

4. UX-034 (S5 high) -- "No Plan Yet" empty state tells post-intake members to complete intake they already finished. Actively misleading.

5. UX-013 (S2 high) -- No push notification when a member completes a workout. The coach acknowledgment loop only closes if the coach proactively opens the app. The "10-second review" goal is unreachable without push.

6. UX-004 (S1 high) -- Missed section appears between Today and Upcoming. Members scroll past guilt to reach today's workout.

7. UX-008 (S2 high) -- Three-screen post-workout gauntlet (celebration, summary, journal). Collapsing to one screen reduces abandonment for tired members.

8. UX-028 (S4 high) -- Empty workout builder has no "tap + to add a movement" affordance. New coaches stall immediately after creation.

9. UX-009 (S2 high) -- "Save Without Reflection" label on submit button confuses members with the "Skip" button below. Two controls that appear identical.

10. UX-029 (S5 high) -- Scenario tab strip may be collapsed by default. Coaches miss multi-pricing feature during sales calls.
