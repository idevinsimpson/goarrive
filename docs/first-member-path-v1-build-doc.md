# First Member Path — v1 Build Doc

*Status:* Approved scope, pre-code (do not implement until coding green-light)
*Filed:* 2026-05-02 (Maia, follow-up to First Member Path pre-code audit)
*Owner:* Maia (code) → Manus (staging smoke test)
*PR title (proposed):* `feat(assignments): optional assignment note + first-member-path nudge`

---

## Phase 0 — User story

> *As a coach,* when I assign a workout to a single member, I can attach a short personal note (optional, ≤200 chars).
>
> *As a member,* I see that note on my upcoming-workout card and again inside the WorkoutPreview screen before I start the workout.
>
> *As a new coach,* once I've built my first workout but haven't added a member yet, the existing onboarding checklist surfaces a contextual nudge to share my intake link.
>
> *As a coach with no review backlog,* the empty review queue offers a one-tap "Assign a workout" CTA so the empty state becomes a next-action prompt.

---

## Phase 1 — Data shape

Add ONE optional field to `workout_assignments` documents.

```
workout_assignments/{assignmentId}
  ...existing fields (memberId, coachId, workoutId, workoutName,
                      scheduledFor, status, workoutSnapshot, createdAt,
                      tenantId)
  assignmentNote?: string   // optional, trimmed, max 200 chars
```

Rules:
- Field is omitted entirely when empty (do not write `''` or `null`).
- Trim whitespace before write. Hard cap at 200 chars in the UI; defensive `.slice(0, 200)` at the write site.
- No migration. Existing docs render fine without it.

---

## Phase 2 — Files to touch

*Single-assignment write path (4 callers of AssignWorkoutModal):*
- `apps/goarrive/components/AssignWorkoutModal.tsx` — add note input on the schedule step; extend `onAssign` signature with `assignmentNote?: string`.
- `apps/goarrive/components/MemberDetail.tsx` (~line 374 `addDoc(...workout_assignments...)`) — accept note from callback, write `...(assignmentNote ? { assignmentNote } : {})`.
- `apps/goarrive/components/WorkoutDetail.tsx` (~line 110 `addDoc(...workout_assignments...)`) — same pattern.
- `apps/goarrive/app/(app)/members.tsx` — same pattern.
- `apps/goarrive/app/(app)/dashboard.tsx` — same pattern.

*Member-side display:*
- `apps/goarrive/app/(member)/workouts.tsx` — extend local `Assignment` interface (~line 68) with `assignmentNote?: string`; map field from doc data; render in card.
- `apps/goarrive/components/WorkoutPreview.tsx` — accept `assignmentNote?: string` prop; render "Note from your coach" card above movement list when present.

*Empty-review CTA:*
- `apps/goarrive/components/CoachReviewQueue.tsx` — empty state at line 431-441; add `onAssignClick?: () => void` prop; render secondary button only when callback provided.
- `apps/goarrive/components/MemberDetail.tsx` — when mounting `<CoachReviewQueue>`, pass `onAssignClick` that closes review queue and opens `AssignWorkoutModal` with current `memberId` preselected.

*Onboarding nudge:*
- `apps/goarrive/components/OnboardingChecklist.tsx` — add a small inline contextual hint row when `steps[1].done && !steps[2].done` (workout built, no member yet). On press, open the existing Share Intake Form flow on the Members screen.

*Total file count: 9 (no new files, no Cloud Functions, no Firestore rules). `MemberDetail.tsx` appears twice — once for the single-assign write path, once for mounting `<CoachReviewQueue>` with `onAssignClick` — but is a single file edit.*

*Acceptance grep:* before merge, run `rg "workout_assignments" apps/goarrive` and `rg "addDoc\\(.*workout_assignments|addDoc\\(workoutAssignments|collection\\(.*workout_assignments" apps/goarrive` and verify every write path either (a) threads `assignmentNote` through, or (b) is intentionally out of scope (e.g. `BatchAssignModal`, deferred to v2). Out-of-scope sites must be enumerated in the PR description.

---

## Phase 3 — UI copy (locked, copy-paste ready)

*AssignWorkoutModal — note input (schedule step):*
- Field label: `Note for {memberName} (optional)`
- Placeholder: `Quick reminder, encouragement, or focus point…`
- Counter: `{count} / 200`
- No error state for empty (optional).

*Member workouts.tsx — assignment card:*
- Render under workout name as a subtle italic line, prefixed with a quote-style icon:
  - `“{assignmentNote}”` (single line, truncate at 2 lines with ellipsis)

*WorkoutPreview.tsx — note card above movements:*
- Section label: `Note from your coach`
- Body: `{assignmentNote}` (full text, no truncation)
- Visually distinct (left border accent in brand orange `#F5A623`).

*CoachReviewQueue.tsx — empty-state CTA:*
- Existing copy unchanged (`All Caught Up!` / `No pending workout reviews. Great job staying on top of it!`)
- New secondary button below: `Assign a workout`

*OnboardingChecklist.tsx — contextual hint (workout built, no member):*
- Hint label: `You've got a workout — invite your first member.`
- Button: `Share intake link`

---

## Phase 4 — Trigger logic for the onboarding/dashboard nudge

- *Surface:* existing `OnboardingChecklist` component (no new dashboard widget).
- *Trigger condition:* `steps[1].done === true && steps[2].done === false` (workout exists, member does not).
- *Persistence:* none. Re-uses the component's existing in-memory `dismissed` state. If the coach dismisses the checklist, the hint goes with it.
- *Why no Firestore flag:* the hint disappears naturally once the member step completes (next `checkSteps()` run). Adding a persistent dismiss flag for a contextual hint is over-engineering for v1.
- *On press:* navigate to `members.tsx` and trigger the existing Share Intake Form modal. (Either via Expo Router `router.push('/members?openShare=1')` and a small param-read in members.tsx, or a shared event bus — pick whichever is least invasive at code time.)

---

## Phase 5 — Empty-review CTA feasibility (explicit assessment)

*Verdict: feasible without expanding scope.*

Evidence:
- `CoachReviewQueue` already receives `coachId` as a prop (line 62, 75).
- The component is currently used only inside `MemberDetail.tsx` (single-grep confirmed). MemberDetail always has a current `memberId` in scope.
- `AssignWorkoutModal` already accepts an optional `memberId` prop (empty = show member picker), so preselecting the member from MemberDetail is a one-line callback.

Implementation pattern keeps `CoachReviewQueue` dumb:
- New optional prop `onAssignClick?: () => void` on `CoachReviewQueue`.
- Empty-state renders the button only when the prop is provided.
- `MemberDetail` owns the modal stacking: `onAssignClick` closes the review queue and opens `AssignWorkoutModal` with `memberId` preselected.

No new context, no new auth surface, no member-impersonation work. Avoids modal-on-modal stacking issues.

---

## Phase 6 — In scope

- Optional `assignmentNote` (≤200 chars) on `workout_assignments`.
- Note input in `AssignWorkoutModal` (single-assignment path only).
- Note display in member assignment card (`app/(member)/workouts.tsx`).
- Note display in `WorkoutPreview` (above movements).
- Empty-review-queue CTA wired through `MemberDetail`.
- Contextual onboarding hint inside existing `OnboardingChecklist`.

## Phase 7 — Out of scope (locked, do not touch)

- Cloud Functions of any kind.
- Firestore rules.
- WorkoutPlayer core (player.tsx, audio cues, countdown logic).
- Audio queue / Voicemaker.
- Plan Builder pricing.
- Stripe / Stripe Connect / earnings caps / CTS.
- Zoom (S2S, RTMS, Meeting SDK).
- `BatchAssignModal` note support — *deferred to v2.*
- Member-preview impersonation (`adminMemberOverride`) — *deferred to v2.*
- `PostWorkoutJournal` note carry-through — *deferred.*
- Required-note behavior — *deferred; revisit after measuring v1 adoption.*
- New onboarding rebuild / new dashboard widget / new Firestore dismiss flag.

---

## Phase 8 — Risks

- *Low:* Adding an optional Firestore field. No migration, no rule change, existing docs unaffected.
- *Low:* New empty-state CTA — purely additive UI inside an existing modal.
- *Low:* Onboarding hint reuses an existing component and existing share flow.
- *Low–medium:* Threading the note through 4 caller sites — mechanical but easy to miss one. Mitigation: grep-verify all `addDoc(...workout_assignments...)` sites before merge.
- *Medium (if mishandled):* Long notes wrapping awkwardly on small screens. Mitigation: 2-line truncation in card, full text only in WorkoutPreview.
- *None* to: Stripe, Zoom, WorkoutPlayer, audio queue, Voicemaker, billing, rules.

---

## Phase 9 — Firestore rules

*No changes required.*

`firestore.rules:336-349` for `workout_assignments` validates which users may read/write but does not whitelist field names. Adding an optional string field is allowed under existing create/update rules. Confirmed via re-read of the rules block.

---

## Phase 10 — Protected systems not touched

Confirmed by file list: this PR does not modify `WorkoutPlayer.tsx`, any audio/Voicemaker module, `functions/src/**`, `firestore.rules`, Stripe/Connect/CTS code, Zoom config, or Plan Builder pricing. The Cloud Function `onWorkoutCompleted` notification path is untouched and continues firing unchanged.

---

## Phase 11 — Staging test plan (for Manus)

*Pre-flight:*
- Confirm staging deploy hash matches the merged commit.
- Sign in as a test coach with at least one member and one workout.

*Coach-side:*
1. Open a member, click *Assign Workout*. Verify the new note input appears on the schedule step with placeholder + counter.
2. Type a 50-char note → counter updates → assign. Open Firestore console; confirm `assignmentNote` field exists on the new doc.
3. Repeat with empty note → confirm doc is written *without* the field (not `''`).
4. Repeat assign-flow from each entry point: member detail, members list, dashboard quick-assign, workout detail. Confirm note persists in all four paths.
5. Try to type 220 chars → confirm hard cap at 200, no overflow allowed.
6. Open `BatchAssignModal` → confirm *no* note input appears (out of scope for v1).

*Member-side:*
7. Sign in as the assigned member. On the workouts list, confirm the note renders as italic subtext under the workout name, truncated at 2 lines for long notes.
8. Tap the workout → WorkoutPreview opens → confirm "Note from your coach" card renders above movements with full note text.
9. Confirm assignments without a note render normally with no empty card / no extra spacing.

*Empty-review CTA:*
10. Open a member with zero pending review logs → CoachReviewQueue empty state shows *Assign a workout* button.
11. Tap it → review queue closes, AssignWorkoutModal opens with that member preselected.

*Onboarding hint:*
12. Use a fresh test coach account with one workout but zero members → load dashboard → confirm contextual hint renders inside `OnboardingChecklist`.
13. Add a member → reload → confirm hint disappears.

*Regression:*
14. Confirm `WorkoutPlayer` still starts and runs unchanged for assignments with and without notes.
15. Confirm `OnboardingChecklist` dismiss button still works and the whole card disappears (hint included).
16. Confirm impersonation (`adminCoachOverride`) still works — assign a workout via impersonation, verify `coachId` on the doc is the impersonated coach, not the admin.

*Smoke:* page loads, no console errors, no rule-deny errors in Firestore audit.

---

## Phase 12 — V3.2 blueprint update

*Light update needed.*

- *Section:* Data Model → `workout_assignments` schema.
- *Edit:* Add one line documenting the optional `assignmentNote: string` field (≤200 chars, single-assign path only in v1).
- Mark deferred items inline: BatchAssignModal note support, required-note behavior, member-preview impersonation, PostWorkoutJournal carry-through.
- No changes to product-loop / role-system / architecture sections.

---

## Phase 13 — Operating Changelog entry plan

Entry written *after* staging smoke + ship decision (i.e. reflects tested/shipped truth, not planned work):

```
[YYYY-MM-DD] feat: optional assignmentNote on workout_assignments + first-member-path nudge
- PR: <link>
- Files: AssignWorkoutModal, MemberDetail, WorkoutDetail, members, dashboard,
  app/(member)/workouts, WorkoutPreview, CoachReviewQueue, OnboardingChecklist
- Data shape: workout_assignments.assignmentNote?: string (≤200, optional)
- UI surfaces: assign modal input, member card, WorkoutPreview, empty-review CTA,
  onboarding contextual hint
- Deferred: BatchAssign note, required-note, member-preview impersonation,
  PostWorkoutJournal carry-through
- Manus staging smoke: <link to results>
- V3.2: light update to workout_assignments schema section
```

---

## Phase 14 — Open items for coding-time judgement

These are intentionally *not* locked — small calls best made when the diff is in front of us:

- Whether to navigate-with-param vs. event-bus for opening Share Intake Form from the onboarding hint.
- Exact icon glyph for the member-card note line.
- Whether to suppress the note on the WorkoutPreview when the same note is already visible on the previous card (probably not — the preview is a moment-of-truth surface; redundancy is fine).
