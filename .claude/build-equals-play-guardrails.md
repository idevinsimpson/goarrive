# Build = Play: Guardrails & Implementation Rules

> **Governing Principle:** What the coach builds is exactly what the member sees. Nothing more, nothing less. The player is a 1:1 rendering of the workout block structure. If a block or setting is not explicitly in the build, it does not appear in the player.

This document is the single source of truth for the Build-to-Player alignment project. Maia must read this before touching any file in the workout pipeline.

---

## 1. Current State Audit (April 2026)

### 1A. Builder (WorkoutForm.tsx) — What Exists Today

**Exercise Block Types (contain movements):**

| Block Type | resolveBlockType() | Timing Fields | Notes |
|---|---|---|---|
| Warm-Up | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear sequence |
| Circuit | `circuit` | rounds, restBetweenRoundsSec, restBetweenMovementsSec, firstMovementPrepSec | Movements cycle through rounds |
| Superset | `superset` | rounds, restBetweenRoundsSec, restBetweenMovementsSec, firstMovementPrepSec | Same as circuit but with superset labels (A1, A2) |
| Interval | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear |
| Strength | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear |
| Timed | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear |
| AMRAP | `circuit` | rounds, restBetweenRoundsSec, restBetweenMovementsSec, firstMovementPrepSec | Treated as circuit |
| EMOM | `circuit` | rounds, restBetweenRoundsSec, restBetweenMovementsSec, firstMovementPrepSec | Treated as circuit (should be reviewed) |
| Cool-Down | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear |
| Rest | `linear` | rounds, restBetweenRoundsSec, firstMovementPrepSec | Treated as linear |

**Special Block Types (no movements):**

| Block Type | Player Phase | Editable Fields | Notes |
|---|---|---|---|
| Intro | `intro` | durationSec (default 10), label | Also synthesized from `workout.introVideoUrl` if no explicit block |
| Outro | `outro` | durationSec (default 10), label | Also synthesized from `workout.outroVideoUrl` if no explicit block |
| Demo | `demo` | durationSec, instructionText | Flatten pipeline auto-populates `demoMovements[]` from next exercise block |
| Transition | `transition` | durationSec, instructionText | Equipment/location change instruction |
| Water Break | `waterBreak` | durationSec | Hydration pause |

**Per-Movement Fields in Builder:**

| Field | Type | Default | Where Used |
|---|---|---|---|
| `movementId` | string | — | Links to movements collection |
| `movementName` | string | — | Display name |
| `sets` | number | 1 | Multiplier for linear blocks |
| `reps` | string | — | If present, movement is rep-based (no timer) |
| `durationSec` | number | 40 | Work timer countdown |
| `restSec` | number | 20 | Rest after this movement |
| `notes` | string | — | Coaching cues |
| `thumbnailUrl` | string | — | From movement library |

**Per-Block Fields in Builder:**

| Field | Type | Default | Where Used |
|---|---|---|---|
| `type` | string | — | Block type from ALL_BLOCK_TYPES |
| `label` | string | auto-generated | Display name (editable) |
| `rounds` | number | 3 | Number of rounds for exercise blocks |
| `restBetweenRoundsSec` | number | 0 | Rest between rounds of a circuit/superset |
| `restBetweenMovementsSec` | number | 0 | Transition rest between movements (circuit/superset only) |
| `firstMovementPrepSec` | number | 0 | Extra prep time before first movement of block |
| `durationSec` | number | 10 | Duration for special blocks |
| `instructionText` | string | — | For Transition and Demo blocks |

**Global Timing Overrides (header button):**

| Override | Default | Scope |
|---|---|---|
| `globalWorkSec` | 40 | Applied to all movements when "Apply" is pressed |
| `globalRestSec` | 20 | Applied to all movements when "Apply" is pressed |
| `globalRounds` | 3 | Applied to all exercise blocks when "Apply" is pressed |
| `globalPrepSec` | 0 | Applied to all exercise blocks when "Apply" is pressed |

### 1B. Flatten Pipeline (useWorkoutFlatten.ts) — What Exists Today

The flatten pipeline converts the block structure into a linear `FlatMovement[]` array. Key behaviors:

1. **Reorders blocks:** Intro blocks go first, Outro blocks go last, everything else stays in order.
2. **Synthesizes Intro/Outro:** If no explicit Intro/Outro block exists but `workout.introVideoUrl`/`workout.outroVideoUrl` is set, a synthetic block is created.
3. **Special blocks** become single `FlatMovement` entries with `stepType` matching the block type.
4. **Demo blocks** auto-populate `demoMovements[]` by looking ahead to the next exercise block's movements.
5. **Exercise blocks** expand movements × rounds. For circuit/superset, all movements play per round. For linear, each movement plays all its sets sequentially.
6. **`firstMovementPrepSec`** inserts a `transition` step before the block if > 0.
7. **Rest calculation:**
   - If coach set `restSec` on the movement → use it directly.
   - Otherwise → `calculateAdjustedRest()` auto-calculates based on block type, movement name (compound vs isolation), and workout difficulty.
   - For circuit/superset: `restBetweenMovementsSec` is used between movements within a round; `restBetweenRoundsSec` is used at the end of each round.
   - Last movement in the last round of a block gets `restAfter = 0`.

### 1C. Timer State Machine (useWorkoutTimer.ts) — What Exists Today

**Phases:** `ready → [special or countdown] → work → [rest/swap] → next → ... → complete`

| Phase | Trigger | Duration Source | Next Phase |
|---|---|---|---|
| `ready` | Initial state | — | First step's phase (on Start press) |
| `countdown` | Before each exercise step | 3 seconds (hardcoded) | `work` |
| `work` | After countdown | `current.duration` (from flatten) | `swap` (if swapSides + side L), `rest` (if restAfter > 0), or `advanceToNext` |
| `swap` | After work if swapSides and side L | 5 seconds (hardcoded) | `work` (side R) |
| `rest` | After work (or after swap side R) | `current.restAfter` (from flatten) | `advanceToNext` |
| `intro` | Special block | `current.duration` | `advanceToNext` |
| `outro` | Special block | `current.duration` | `advanceToNext` |
| `demo` | Special block | `current.duration` | `advanceToNext` |
| `transition` | Special block | `current.duration` | `advanceToNext` |
| `waterBreak` | Special block | `current.duration` | `advanceToNext` |
| `complete` | After last step | — | Terminal |

### 1D. Player (WorkoutPlayer.tsx) — What Exists Today

**Screens rendered per phase:**

| Phase | Screen | Key Elements |
|---|---|---|
| `ready` | Start screen | Logo, workout name, movement count, block count, Start button |
| `intro` | Split-screen cinematic | Left: video panel, Right: logo + block label + gold timer + Skip |
| `outro` | Cinematic completion | Video background + logo + "WORKOUT" text + gold timer + Skip |
| `demo` | Movement preview grid | Logo + block title + gold timer + thumbnail grid + Skip |
| `transition` | Instruction card | Arrow icon + "TRANSITION" + instruction text + gold timer + Skip + Next Up |
| `waterBreak` | Hydration screen | "WATER BREAK" label + gold timer + video area with blue tint + Skip |
| `countdown` | Get Ready | "GET READY" + countdown number + upcoming movement name |
| `work` | Active exercise | Logo + movement name + gold timer + video area + controls overlay + Next Up (last 4s) |
| `rest` | Rest with preview | "REST" label + white timer + next movement name + next movement video + Skip Rest |
| `swap` | Side switch | "SWITCH SIDES" + "RIGHT SIDE" badge + countdown + movement name |
| `complete` | Workout complete | Check icon + "Workout Complete!" + movement count + Continue button |

### 1E. Pre-Workout Screen (WorkoutPreview.tsx) — What Exists Today

Shows before the player launches. Displays:
- Workout name and description
- Stats row: estimated duration, total movements, block count
- Equipment checklist (pulled from `movement.equipment` field)
- Block breakdown: each block with its movements listed

**Currently shows ALL movements from ALL blocks.** There is no toggle to hide specific movements from this screen.

---

## 2. Gaps & Disconnects Between Builder and Player

### 2A. Things the Player Does That the Builder Doesn't Control

| Player Behavior | Source | Problem |
|---|---|---|
| **Auto-calculated rest times** | `calculateAdjustedRest()` in `useRestAutoAdjust.ts` | If coach doesn't set `restSec`, the system invents rest times based on heuristics (block type, compound detection, difficulty). Coach never sees these calculated values. |
| **3-second countdown before every exercise** | Hardcoded `COUNTDOWN_SECONDS = 3` in `useWorkoutTimer.ts` | Coach cannot control or disable this. It fires before every single exercise step, even within a circuit round. |
| **Synthesized Intro/Outro from video URLs** | Lines 107-112 in `useWorkoutFlatten.ts` | If `workout.introVideoUrl` exists but no Intro block, a synthetic block is created. Coach may not realize this will play. |
| **Demo block auto-populates movements** | Flatten pipeline lookahead | Coach places a Demo block but doesn't choose which movements appear — the pipeline grabs the next exercise block's movements automatically. This is correct behavior but not visible to the coach. |

### 2B. Things the Builder Controls That the Player Ignores or Mishandles

| Builder Field | Expected Player Behavior | Actual Player Behavior |
|---|---|---|
| `firstMovementPrepSec` | Should add prep time before the first movement of the block | Inserts a `transition` step with "Get Ready: [block name]" — works but the coach doesn't see this as a distinct screen in the builder |
| `restBetweenRoundsSec` | Rest between rounds of a circuit | Applied correctly as `restAfter` on the last movement of each round |
| `restBetweenMovementsSec` | Transition rest between movements in circuit/superset | Applied correctly when set, falls through to `calculateAdjustedRest()` when not set |

### 2C. Missing Builder Controls (Required for Build = Play)

| Missing Control | Where It Should Live | What It Controls |
|---|---|---|
| **Per-movement "Show on pre-workout screen" toggle** | Movement three-dot menu or toggle in builder | Whether this movement appears on the WorkoutPreview screen |
| **Circuit start rest override** | Circuit/Superset block settings (alongside rounds) | Override rest time for the first movement, first round only — a "get ready" buffer |
| **Grab Equipment block type** | New special block type in builder | Explicit equipment preparation screen — currently no block type for this |

---

## 3. Implementation Rules

### Rule 1: No Invented Screens
The player must not render any screen, countdown, or overlay that does not correspond to a block, movement, or setting in the workout data. If the coach didn't build it, the member doesn't see it.

**Specific implications:**
- The 3-second countdown before each exercise is acceptable because it's a universal player mechanic (like a video player buffering), not content.
- Auto-calculated rest times violate this rule when the coach has not set any rest value. However, removing auto-rest entirely would break existing workouts. **Resolution:** Keep auto-rest as a fallback but make the calculated value visible to the coach in the builder (show the computed rest in gray text next to the field).

### Rule 2: Timer Colors Are Semantic
- **Gold/yellow background box (`#F5A623`):** Work phase timer. The member is actively performing.
- **White text on dark background:** Rest phase timer. The member is recovering.
- This distinction must be consistent across ALL screens. No exceptions.

### Rule 3: Rest During Rest, Not During Work
During the rest phase, the player shows the **next** movement's video. The member is mentally preparing for what's coming. During the work phase, the player shows the **current** movement's video. The only exception is the final 3.5 seconds of work, where the video transitions to the next movement as the countdown audio plays.

### Rule 4: Circuit Start Rest Override (First Pass Only)
When a coach sets a "circuit start rest" value on a circuit/superset block:
- This value **overrides** the rest time for the **first movement of the circuit, on the first round only**.
- On all subsequent rounds, the first movement uses its own `restSec` value (or the auto-calculated fallback).
- Think of it as a "get ready for this circuit" buffer. It fires once, then the circuit runs at its normal pace.

**Implementation detail:** This is NOT the same as `firstMovementPrepSec`. The prep time inserts a separate transition step. The circuit start rest override modifies the `restAfter` value of the first movement in the first round only.

### Rule 5: Pre-Workout Screen Is Coach-Controlled
The WorkoutPreview screen must only show movements where the coach has toggled "Show on pre-workout screen" to true. If no toggles are set (legacy workouts), default to showing all movements (backward compatibility).

### Rule 6: Grab Equipment Is Explicit
Equipment preparation is a block the coach explicitly places, not something auto-generated from movement equipment fields. The Grab Equipment block:
- Is a new special block type (no movements)
- Has `durationSec` and `instructionText` fields (like Transition)
- Renders in the player as an equipment preparation screen
- The coach decides where to place it in the block sequence

### Rule 7: Demo Block Shows What the Coach Built
The Demo block's `demoMovements[]` are auto-populated from the next exercise block. This is correct and should remain. The coach controls this by:
- Placing a Demo block before the circuit they want to preview
- The eyeball icon toggle on the Demo block controls whether it renders in the player

### Rule 8: Water Break Is a Block, Not a Feature
Water breaks only appear if the coach placed a Water Break block. The player must not insert water breaks automatically based on workout duration or intensity.

### Rule 9: Anticipatory Display During Rest
During rest, the member sees the next movement's video playing. This is the "anticipatory display" — the member is getting mentally ready. At the end of rest, the countdown audio plays (3, 2, 1, Go) and the work phase begins.

### Rule 10: No Orphan Phases
Every phase transition in the timer state machine must trace back to a block or movement in the workout data. If a phase fires and there's no corresponding data, that's a bug.

---

## 4. Firestore Schema Changes Required

### 4A. WorkoutBlock — New Fields

```typescript
interface WorkoutBlock {
  // ... existing fields ...
  type: string;
  label: string;
  rounds?: number;
  restBetweenRoundsSec?: number;
  restBetweenMovementsSec?: number;
  durationSec?: number;
  instructionText?: string;
  firstMovementPrepSec?: number;
  movements: BlockMovement[];

  // NEW: Circuit start rest override (first round, first movement only)
  circuitStartRestSec?: number;
}
```

### 4B. BlockMovement — New Fields

```typescript
interface BlockMovement {
  // ... existing fields ...
  movementId: string;
  movementName: string;
  sets?: number;
  reps?: string;
  durationSec?: number;
  restSec?: number;
  notes?: string;
  thumbnailUrl?: string;

  // NEW: Controls visibility on pre-workout screen
  showOnPreview?: boolean; // default: true for backward compatibility
}
```

### 4C. New Block Type: Grab Equipment

Add `'Grab Equipment'` to:
- `EXERCISE_BLOCK_TYPES` → No. This is a special block.
- `SPECIAL_BLOCK_TYPES` → Yes: `['Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment']`
- `NO_MOVEMENT_BLOCKS` → Yes
- `BLOCK_COLORS` → Assign a color (suggested: `'#FB923C'` — warm orange)
- `QUICK_INSERT_TYPES` → Consider adding for quick insertion

The flatten pipeline must handle `'Grab Equipment'` as a special block with its own `stepType: 'grabEquipment'`.

The timer state machine must add a `'grabEquipment'` phase.

The player must render a Grab Equipment screen (similar to Transition but with equipment-focused iconography).

---

## 5. Phase Breakdown for Implementation

### Phase 1: Data Model & Builder UI
**Files to modify:** `WorkoutForm.tsx`
**Files to create:** None

Changes:
1. Add `circuitStartRestSec` field to the block settings panel (visible for Circuit, Superset, AMRAP, EMOM blocks — anything where `resolveBlockType()` returns `'circuit'`). Label it "Circuit Start Rest" with helper text "Rest before first movement, first round only."
2. Add `showOnPreview` toggle to each movement row (default: true). Use a small eye icon toggle.
3. Add `'Grab Equipment'` to `SPECIAL_BLOCK_TYPES`, `NO_MOVEMENT_BLOCKS`, `ALL_BLOCK_TYPES`, and `BLOCK_COLORS`.
4. Add Grab Equipment to the block type picker with appropriate icon and color.
5. Show computed rest values in the builder: when `restSec` is not set on a movement, display the auto-calculated value in gray italic text so the coach knows what the member will experience.

**Acceptance criteria:**
- Coach can set `circuitStartRestSec` on any circuit-type block
- Coach can toggle `showOnPreview` per movement
- Coach can add a Grab Equipment block with duration and instruction text
- Existing workouts load without errors (all new fields are optional with safe defaults)

### Phase 2: Flatten Pipeline & Timer
**Files to modify:** `useWorkoutFlatten.ts`, `useWorkoutTimer.ts`
**Files to create:** None

Changes:
1. In `useWorkoutFlatten.ts`: When processing circuit/superset blocks, check for `block.circuitStartRestSec`. If set and > 0, override the `restAfter` of the first movement in the first round (round === 0, mi === 0) with `block.circuitStartRestSec`.
2. In `useWorkoutFlatten.ts`: Add `'Grab Equipment'` to `SPECIAL_BLOCK_TYPES` set. Map it to `stepType: 'grabEquipment'` in `toStepType()`.
3. In `useWorkoutTimer.ts`: Add `'grabEquipment'` to the `Phase` type. Add it to `stepTypeToPhase()`. Add it to the `isSpecialPhase` check. Add it to the timer-hit-zero auto-advance logic.
4. In `useWorkoutFlatten.ts`: Carry `showOnPreview` through to `FlatMovement` so the preview screen can filter.

**Acceptance criteria:**
- Circuit start rest override fires on first movement, first round only
- Grab Equipment blocks flatten into steps with `stepType: 'grabEquipment'`
- Timer handles `grabEquipment` phase correctly (countdown + auto-advance)
- `showOnPreview` is available on flattened movements

### Phase 3: Player Rendering & Preview Screen
**Files to modify:** `WorkoutPlayer.tsx`, `WorkoutPreview.tsx`
**Files to create:** None

Changes:
1. In `WorkoutPlayer.tsx`: Add a `grabEquipment` phase rendering block. Layout: equipment icon + block label + instruction text + gold timer + Skip button. Similar to Transition screen but with distinct iconography.
2. In `WorkoutPlayer.tsx`: Ensure rest timer uses white text (not gold). Verify work timer uses gold box. Audit all screens for Rule 2 compliance.
3. In `WorkoutPreview.tsx`: Filter movements by `showOnPreview !== false` (default true for backward compatibility). Only show movements where the coach has not hidden them.
4. Strip any remaining hardcoded content from the player that doesn't trace back to workout data.

**Acceptance criteria:**
- Grab Equipment screen renders correctly in the player
- Timer colors follow Rule 2 (gold = work, white = rest) across all screens
- Pre-workout screen respects `showOnPreview` toggles
- No player screen exists that doesn't correspond to workout data

---

## 6. Files Inventory — What to Touch and What Not to Touch

### Safe to Modify

| File | Why |
|---|---|
| `components/WorkoutForm.tsx` | Builder UI — adding new fields and block type |
| `components/WorkoutPlayer.tsx` | Player rendering — adding Grab Equipment screen, auditing timer colors |
| `components/WorkoutPreview.tsx` | Pre-workout screen — adding showOnPreview filter |
| `hooks/useWorkoutFlatten.ts` | Flatten pipeline — circuit start rest override, Grab Equipment step type |
| `hooks/useWorkoutTimer.ts` | Timer state machine — adding grabEquipment phase |

### Do NOT Modify

| File | Why |
|---|---|
| `hooks/useRestAutoAdjust.ts` | Rest calculation logic is correct. The issue is visibility, not calculation. |
| `hooks/useMediaPrefetch.ts` | Working correctly. No changes needed. |
| `hooks/useWorkoutTTS.ts` | Working correctly. No changes needed. |
| `hooks/useMovementSwap.ts` | Working correctly. No changes needed. |
| `hooks/useMovementHydrate.ts` | Working correctly. No changes needed. |
| `hooks/usePlaybackSpeed.ts` | Working correctly. No changes needed. |
| `lib/audioCues.ts` | Working correctly. No changes needed. |
| `lib/haptics.ts` | Working correctly. No changes needed. |

### Do NOT Create

| Item | Why |
|---|---|
| New hooks for this feature | The existing hook architecture is correct. Changes go into existing hooks. |
| New components for player screens | Player screens are inline in WorkoutPlayer.tsx. Keep them there. |
| New Firestore collections | All changes are field additions to existing workout documents. |

---

## 7. Backward Compatibility Requirements

1. **`circuitStartRestSec`** — Optional field, defaults to `undefined`. When undefined, behavior is identical to current: no override, normal rest calculation applies.
2. **`showOnPreview`** — Optional field, defaults to `true` when undefined. All existing movements appear on the pre-workout screen by default.
3. **`'Grab Equipment'` block type** — New addition. Existing workouts have no Grab Equipment blocks, so no migration needed.
4. **No Firestore migration required.** All changes are additive optional fields.
5. **Existing tests** in `__tests__/hooks/useWorkoutFlatten.test.ts` and `__tests__/integration/workoutFlow.test.ts` must continue to pass without modification. New tests should be added for the new behaviors.

---

## 8. Test Requirements

Each phase must include tests before the PR is opened:

### Phase 1 Tests
- Builder renders `circuitStartRestSec` field for circuit-type blocks
- Builder does not render `circuitStartRestSec` for linear-type blocks
- Builder renders `showOnPreview` toggle on each movement
- Grab Equipment block can be added and configured
- Saving a workout with new fields succeeds
- Loading a legacy workout (without new fields) succeeds

### Phase 2 Tests
- `useWorkoutFlatten`: Circuit with `circuitStartRestSec = 15` → first movement, first round has `restAfter = 15`; same movement in round 2 has its normal rest
- `useWorkoutFlatten`: Circuit without `circuitStartRestSec` → behavior unchanged
- `useWorkoutFlatten`: Grab Equipment block → produces step with `stepType: 'grabEquipment'`
- `useWorkoutTimer`: `grabEquipment` phase counts down and auto-advances
- All existing flatten and timer tests pass unchanged

### Phase 3 Tests
- Player renders Grab Equipment screen when phase is `grabEquipment`
- Player rest timer is white, work timer is gold (visual regression test)
- WorkoutPreview filters out movements where `showOnPreview === false`
- WorkoutPreview shows all movements when `showOnPreview` is undefined (legacy)
