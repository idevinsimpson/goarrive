# GoArrive Workout System Builder — Skill Demo

This document demonstrates how the `goarrive-workout-builder` skill changes Manus's behavior across six real-world scenarios. Each demo shows what a user might ask, what a **generic Manus session** (no skill) would likely produce, and what a **skill-guided session** produces instead.

---

## Demo 1: "Build me the movements page"

### What the user says:

> "Replace the Coming Soon placeholder on the movements page with a real working page."

### Without the skill (generic Manus):

A generic session would read `movements.tsx`, see it's a placeholder, and build a basic list page. It would likely:

- Create a new `MovementForm` from scratch (not knowing one already exists at 181 lines)
- Create a new detail view from scratch (not knowing `MovementDetail.tsx` exists at 349 lines)
- Invent a simple data model with maybe 4-5 fields (name, category, description, videoUrl)
- Miss the `isGlobal` / coach-scoped tenant pattern entirely
- Miss the `isArchived` soft-delete pattern
- Use generic styling instead of the GoArrive design system
- Possibly use a different font or color scheme

### With the skill:

The skill immediately tells Manus:

> *"Wire existing components before building new ones. The orphaned components represent 2,324 lines of tested code. Extend them, don't replace them."*

So Manus would:

1. **Import the existing `MovementDetail.tsx`** (349 lines, already styled) and wire it as the detail modal
2. **Import the existing `MovementForm.tsx`** (181 lines) and enhance it — adding the missing fields (muscleGroups, difficulty, workSec, restSec, countdownSec, swapSides, regressions, progressions, contraindications) that the `MovementDetailData` interface already defines
3. **Use the exact data model** from the skill's Phase 1 table — 22 fields, not 4
4. **Query correctly** using the coach-scoped + global pattern: `where('coachId', 'in', [coachId, ''])` combined with `where('isArchived', '==', false)`
5. **Include search and filter** (by category, equipment, muscle group) because the skill requires it
6. **Use the GoArrive design system** — `#0E1117` background, `#F5A623` gold accent, Space Grotesk headings, DM Sans body, `AppHeader` component
7. **Use `useAuth()` for claims** instead of inventing a new auth pattern

**Result:** A page that works with the existing codebase instead of creating parallel, conflicting code.

---

## Demo 2: "Build the workout player for members"

### What the user says:

> "I need a workout player that members can use to follow along with their assigned workouts."

### Without the skill (generic Manus):

A generic session would build a workout player from scratch. Common drift patterns:

- Build a basic timer component with start/stop
- Use a scrollable list of exercises (not full-screen)
- Include a nav bar at the top (breaking immersion)
- Embed YouTube videos with audio (autoplay blocked on iOS)
- Build it as a standalone page disconnected from the assignment system
- No journal flow after completion
- No workout log creation
- No connection to the coach review system

### With the skill:

The skill fires two critical guardrails immediately:

> *"The player is NOT just a timer. It is the member's coach-in-the-pocket."*

> *"Do not skip the player for a 'log-only' approach. The player IS the product."*

And it tells Manus that `WorkoutPlayer.tsx` (199 lines) already exists with beep sounds, haptic feedback, wake lock, block/movement traversal, and a countdown timer. So Manus would:

1. **Start from the existing `WorkoutPlayer.tsx`** — not rebuild from scratch
2. **Add the missing features** the skill explicitly lists: movement media display (muted MP4 loop), next-up preview panel, skip-back control, regression/progression swap UI, completion callback, workout log creation
3. **Follow the non-negotiable UX rules**: full-screen focus (no nav bar), one-handed operation, movement name always visible, timer clarity, next-up preview in last 5 seconds
4. **Follow the media delivery rules**: MP4/H.264 baseline, muted for autoplay, thumbnail poster first, prefetch next 1-3 clips, design for missing media (player works perfectly without video)
5. **Wire the completion callback** to trigger the Glow/Grow journal flow (Phase 5) — because the skill says "never build a phase without its connection to the next phase"
6. **Create a `workout_logs` document** on completion with the exact schema from the skill (18 fields including `blocksCompleted`, `skippedMovements`, `modifiedMovements`)

**Result:** A player that feels like a premium coaching experience, not a gym timer app, and that feeds data into the journal and coach review pipeline.

---

## Demo 3: "Add a journaling feature after workouts"

### What the user says:

> "I want members to be able to reflect after they finish a workout. Like a journal entry."

### Without the skill (generic Manus):

A generic session would likely over-engineer this:

- Build a full journaling platform with rich text editing
- Create a separate "Journal" tab in the member navigation
- Add categories, tags, mood tracking with sliders, progress graphs
- Build a history view with search and filter
- Create a standalone collection disconnected from workouts
- No connection to the coach review system

### With the skill:

The skill immediately constrains the scope:

> *"Do not over-engineer the journal. Two text prompts (Glow/Grow) plus optional ratings. Not a full journaling platform. Not a diary. Not a progress tracker with graphs."*

And it specifies the exact UX:

> *"Appears automatically when WorkoutPlayer reaches the end. Takes 20-30 seconds maximum — not a burden."*

So Manus would:

1. **Build a modal/overlay** that appears when the WorkoutPlayer fires its completion callback — not a separate page
2. **Include exactly two text prompts**: "Glow" (what went well) and "Grow" (what to improve)
3. **Include optional tap-based ratings**: mood (1-5) and effort/RPE (1-10) — taps, not sliders
4. **Always show a "Skip" button** — never force journaling
5. **End with a brief celebration moment** before returning to the member home screen
6. **Write to the `workout_logs` collection** (not a separate journal collection) — the journal IS the workout log. The fields `glowText`, `growText`, `moodRating`, and `effortRating` are embedded in the same document alongside `blocksCompleted`, `durationSec`, and `skippedMovements`
7. **Set `coachReviewed: false`** so the log appears in the coach's review queue

**Result:** A 30-second reflection flow that feeds the coach review loop, not a bloated journaling platform that nobody uses.

---

## Demo 4: "Let me add AI-generated workout suggestions"

### What the user says:

> "Can we add an AI feature that generates workout recommendations for members based on their history?"

### Without the skill (generic Manus):

A generic session would enthusiastically build this:

- Integrate OpenAI API for workout generation
- Build a recommendation engine based on past workout logs
- Create an "AI Coach" feature with chat interface
- Generate personalized workout plans automatically

### With the skill:

The skill immediately blocks this:

> *Anti-Drift Rule #4: "Do not build AI features into the workout system. No AI-generated workouts, no AI coaching, no AI movement suggestions. The coach is the intelligence. The system is the delivery mechanism."*

So Manus would:

1. **Surface the conflict** to the user instead of silently building it
2. **Explain the reasoning**: GoArrive is a coach-first platform. The coach's expertise and personal relationship with the member IS the product. AI-generated workouts undermine the coach's value proposition and the member's trust.
3. **Suggest an alternative** that serves the same intent without breaking the model: improve the template-plus-tweak workflow so coaches can create personalized workouts faster. Or build better filtering/search in the movement library so coaches can find the right movements quickly.

**Result:** The user gets a thoughtful pushback with an alternative, not a feature that undermines their own business model.

---

## Demo 5: "Build the workout assignment flow"

### What the user says:

> "I need coaches to be able to assign workouts to their members."

### Without the skill (generic Manus):

A generic session would build a new assignment system from scratch:

- Create a new modal or page for assignment
- Invent a new data model for assignments
- Possibly build batch assignment, recurring assignments, calendar sync
- Create a new collection with its own security rules
- No connection to the member's workout page (which doesn't exist yet)

### With the skill:

The skill knows that `AssignWorkoutModal.tsx` (743 lines) already exists and is already imported in `members.tsx`. It also knows the `workout_assignments` collection already exists with security rules. So Manus would:

1. **Recognize the assignment flow already works** — `AssignWorkoutModal` queries the coach's workouts, lets the coach pick one, pick a date, and writes to `workout_assignments`
2. **Focus on what's actually missing**: the member-side consumption. There is no `(member)/my-workouts.tsx` route. The assignment is written to Firestore but the member has no page to see it.
3. **Build Phase 3** (Member Workout Page) instead of rebuilding Phase 2's assignment flow
4. **Wire the member page** to read from `workout_assignments` where `memberId == currentUser.uid`, show "Today's Workout" prominently, and provide one-tap launch to the WorkoutPlayer
5. **Add the empty state**: "No workouts assigned yet — your coach will assign your first workout soon"

**Result:** Instead of rebuilding something that works, Manus fills the actual gap — the member's ability to see and play their assigned workouts.

---

## Demo 6: "Add a leaderboard so members can compete"

### What the user says:

> "Let's add a leaderboard where members can see how they rank against other members on workout completion."

### Without the skill (generic Manus):

A generic session would build this as requested:

- Create a leaderboard collection
- Aggregate workout completion counts per member
- Build a ranking page with member names and scores
- Add weekly/monthly/all-time filters
- Possibly add badges or achievements

### With the skill:

The skill blocks this immediately:

> *Anti-Drift Rule #5: "Do not build social/community features. No leaderboards, no member-to-member sharing, no group challenges. The relationship is coach-to-member, not member-to-member."*

And the core product identity reinforces it:

> *"The member experience must feel premium, clear, and supportive. Avoid invasive, shame-driven, or high-maintenance UX."*

So Manus would:

1. **Surface the conflict** — leaderboards are member-to-member comparison, which the product explicitly avoids
2. **Explain why**: GoArrive's model is 1:1 coaching. A leaderboard introduces comparison anxiety, exposes members to each other (privacy concern in a coaching relationship), and shifts the motivation model from intrinsic (coach-supported growth) to extrinsic (beating other people)
3. **Suggest alternatives** that serve the same "motivation" intent without breaking the model:
   - **Personal streak tracking** — "You've completed 12 workouts this month" (self-comparison, not peer comparison)
   - **Coach celebration** — coach can send a reaction or comment on the workout log (the review queue already supports this)
   - **Milestone moments** — "You just completed your 50th workout!" (celebration, not competition)

**Result:** The user gets a better feature idea that fits the product's DNA, instead of a feature that erodes trust.

---

## Summary: What the Skill Changes

| Behavior | Without Skill | With Skill |
|---|---|---|
| **Existing code** | Rebuilds from scratch | Wires in 2,324 lines of orphaned components |
| **Data model** | Invents a simple schema | Uses the exact 22-field movement schema, block structure, and workout_logs collection |
| **Auth pattern** | Invents new auth | Uses existing `useAuth()` + `coachId`-scoped tenant model |
| **Design system** | Generic styling | `#0E1117` bg, `#F5A623` gold, Space Grotesk / DM Sans |
| **Build order** | Builds whatever was asked | Follows coach-side → member-side → player → journal → review sequence |
| **Scope control** | Builds everything requested | Blocks AI features, social features, over-engineered journal, offline-first |
| **Loop awareness** | Builds isolated features | Every feature connects to the core loop: build → play → reflect → review |
| **Security rules** | Writes new rules | Extends existing `isCoachOrBootstrap`, `isOwnDoc` helpers |
| **Media handling** | Embeds YouTube with audio | MP4/H.264 muted loops, thumbnail-first, prefetch, missing-media tolerance |
| **Journal design** | Full journaling platform | 30-second Glow/Grow flow embedded in workout_logs |

The skill doesn't just tell Manus *what* to build — it tells Manus *what not to build*, *what already exists*, *what order to build in*, and *how every piece connects to the core product loop*.
