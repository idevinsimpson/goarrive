# GoArrive Workout Player — Data-Driven Specification

**Reference Video:** https://www.loom.com/share/a7fca59f1bb245bcbb1bcd07d74bb3e0
**Source of Truth:** The member experience must be **identical** to watching this video. Every detail below was extracted frame-by-frame from the reference and cross-referenced against the codebase.

---

## 0. Core Principle: The Coach Build Drives Everything

Nothing in the player is hardcoded. Every screen the member sees is a direct output of what the coach configured in the workout builder:

| Coach Build Decision | What the Member Sees |
|---|---|
| Adds an **Intro** block | Section header screen (split-screen with video + branding) |
| Adds an **Outro** block | Completion screen (logo + "WORKOUT" text) |
| Adds a **Demo** block before a circuit | Circuit preview screen (thumbnail grid of upcoming movements) |
| Adds a **Water Break** block | Blue-tinted water break media screen with countdown |
| Adds a **Transition** block | Instruction screen with voice audio ("grab 20 lb dumbbells") |
| Sets block type to Circuit/Superset | Movements cycle through rounds per block config |
| Sets `rounds` on a block | "3 Round Circuit" / "2 Round Circuit" label on demo screen |
| Sets `durationSec` on a movement | Timer countdown for that movement |
| Sets `restBetweenRoundsSec` | Rest screen between circuit rounds |
| Sets `restBetweenMovementsSec` | Brief rest between movements within a block |
| Toggles `swapSides` on a movement | "SPLIT \| 5 sec ⇄" label + auto side-switch |
| Uploads movement video | Looping demo video during the work phase |
| Sets `cropScale` / `cropTranslateX/Y` | Video framing/zoom in the player |
| Generates `voiceUrl` (ElevenLabs TTS) | Voice announcement of movement name |

---

## 1. Viewport & Layout Constraints

### Portrait-Only Design
The player is designed for a **vertical phone** held in portrait orientation. This is non-negotiable.

- **Target aspect ratio:** 9:16 (standard phone portrait)
- **On wide screens (tablet, desktop, landscape):** The player must render in a centered **portrait column** with black bars on the sides. Content must NOT stretch horizontally to fill widescreen. Max width should be capped at ~430px (iPhone Pro Max width).
- **Safe areas:** Respect iOS notch/Dynamic Island and Android status bar insets via `Platform.select` for top padding.

### Dark Immersive Theme
- Background: `#0E1117` (near-black)
- All text is white (`#FFFFFF` or `#F0F4F8`) or gold (`#F5A623`)
- No light backgrounds, no cards, no borders. This is a cinematic fitness video experience, not a web app.

---

## 2. Screen Types — Mapped to Block Types

### 2A. Intro Screen (block.type === 'Intro')

**What the coach configured:** An Intro block with `durationSec` (default 10s), optional `label` (e.g., "WARM-UP & STRETCH").

**What the member sees (from video at 0:05):**
- **Layout:** Split-screen. Left half shows a relevant exercise video (the first movement's video or a generic warm-up clip). Right half shows GoArrive branding on dark background.
- **Right panel content:**
  - GoArrive logo (green G➲A arrow)
  - Block label in large white text with green accent (e.g., "WARM-UP & STRETCH")
- **Timer:** Countdown in gold, auto-advances when it hits 0.
- **Skip:** Available via skip button.

**Current code gap:** The code renders a centered logo + "LET'S GO" text. Must be changed to the split-screen layout from the video.

**Data mapping:**
```
block.label || block.name → section title text
block.durationSec || 10 → countdown duration
Next exercise block's first movement videoUrl → left-side video
```

### 2B. Active Movement Screen (stepType === 'exercise', phase === 'work')

**What the coach configured:** A movement within an exercise block, with `durationSec`, `videoUrl`, `thumbnailUrl`, `swapSides`, `cropScale`, `voiceUrl`, etc.

**What the member sees (from video at 0:32, 1:06, 2:05, 3:06, 4:09):**

**Layout (top to bottom, strict vertical stack):**

1. **GoArrive Logo** — centered at top, always visible. Width ~260px, height ~72px. This is the persistent brand anchor.

2. **Name + Timer Row** — single row, space-between:
   - **Left:** Movement name in bold white text, ~26px. Wraps naturally if long (e.g., "Bent-Over Ski to Forward Arm Raise" wraps to 2 lines). Below the name: coaching cues in muted gray if present.
   - **Right:** Countdown timer. **CRITICAL VISUAL:** In the video, the timer appears as large bold gold/yellow numbers inside a gold/yellow background box (not just plain text). The current code renders plain white text at 80px. Must be changed to: gold background box (`#F5A623` or `#FFD700`) with dark/black numbers inside, slightly rounded corners.

3. **SPLIT Label** (only if `swapSides === true`):
   - Renders below the movement name, inline: `SPLIT | 5 sec ⇄`
   - "SPLIT" in gold, "|" separator, "5 sec" (the swap duration), "⇄" arrows icon
   - This replaces the current separate "LEFT SIDE" / "RIGHT SIDE" badge
   - The label stays visible throughout both sides of the movement

4. **Video Area** — fills remaining vertical space:
   - Looping MP4 via `expo-av` Video component
   - `ResizeMode.COVER` to fill the area
   - Video is muted (movement demos have no audio)
   - `cropScale` / `cropTranslateX` / `cropTranslateY` applied as transform styles to zoom/pan the video per coach configuration
   - Thumbnail fallback while video loads
   - **Tap behavior:** Single tap toggles controls overlay (play/pause, skip, swap movement, playback speed). Controls auto-hide after 3 seconds.

5. **Next Up Bar** — pinned to bottom:
   - Shows the NEXT movement's thumbnail + name + block name + duration
   - **CRITICAL TIMING:** In the video, the "next up" information appears approximately **3.5 seconds before the current movement ends**, not permanently. The next movement's name visually transitions in. Current code shows it always — must be changed to appear only in the final ~3.5 seconds of the current movement's timer.

**Data mapping:**
```
current.name → movement name text
current.duration → timer countdown
current.videoUrl → looping demo video
current.thumbnailUrl → fallback while video loads
current.swapSides → show SPLIT label, trigger side-switch flow
current.cropScale/cropTranslateX/cropTranslateY → video transform
current.coachingCues → gray text below movement name
current.supersetLabel → "A1", "A2" label above movement name
current.voiceUrl → TTS announcement of movement name
next.name, next.thumbnailUrl → Next Up bar content
```

### 2C. Circuit / Block Preview Screen (stepType === 'demo', phase === 'demo')

**What the coach configured:** A Demo block placed before a circuit/superset block. The flatten pipeline automatically looks ahead to find the next exercise block's movements and populates `demoMovements[]`.

**What the member sees (from video at 2:38, 13:06):**

**Layout:**
1. **GoArrive Logo** — centered at top
2. **Block title + Timer Row:**
   - Left: Block descriptor in white text (e.g., "3 Round Circuit", "2 Round Circuit"). The round count comes from the next exercise block's `rounds` field.
   - Right: Gold countdown timer (same box style as movement timer)
3. **Thumbnail Grid** — the main content area:
   - **4 movements:** 2×2 grid
   - **6 movements:** 3×2 grid
   - **Other counts:** Adapt grid (e.g., 3 movements = 3×1, 5 = 3+2 layout)
   - Each cell shows the movement's thumbnail image, cropped to fill
   - No text labels on the thumbnails — just the visual preview
4. **Auto-advance** when timer hits 0

**Current code gap:** The code renders a scrollable vertical list with numbered items. Must be changed to the thumbnail grid layout from the video.

**Data mapping:**
```
current.name → "3 Round Circuit" (from block label or generated from next block's rounds + type)
current.demoMovements[].thumbnailUrl → grid cell images
current.demoMovements[].name → (not shown on grid, but available)
current.duration → countdown timer
```

### 2D. Water Break Screen (stepType === 'waterBreak', phase === 'waterBreak')

**What the coach configured:** A Water Break block with `durationSec` (default 30-60s).

**What the member sees (from video at 12:04):**

**Layout:**
1. **GoArrive Logo** — at top
2. **Timer** — gold box in upper area (same style as movement timer)
3. **Main visual:** Full-screen blue-tinted background video/image of someone drinking water. This is a **media asset**, not just an icon. The coach may upload a custom water break video, or a default GoArrive water break clip is used.
4. **Text overlay:** "WATER BREAK" in large stylized text at the bottom, repeated in a decorative pattern with red/yellow gradient treatment
5. **Auto-advance** when timer hits 0

**Current code gap:** The code renders a droplet icon + "Stay Hydrated" text + timer ring. Must be changed to the full media experience from the video.

**Data mapping:**
```
current.duration → countdown timer
block.videoUrl or default water break asset → background media
current.name → "Water Break" text
```

### 2E. Transition Screen (stepType === 'transition', phase === 'transition')

**What the coach configured:** A Transition block with `instructionText` (e.g., "Grab 20 pound dumbbells and go to a bench") and `durationSec`. May also have a `voiceUrl` for audio instruction.

**What the member sees:**
- Not explicitly shown in the reference video (this workout didn't include one), but the coach can add them
- The transition block plays the equipment/location video as a loop (e.g., video of dumbbells on a rack)
- Audio plays the coach's instruction ("grab 20 pound dumbbells and go to a bench") via `voiceUrl` or TTS
- Timer counts down
- Instruction text displayed on screen

**Current code:** Renders an arrow icon + "TRANSITION" + instruction text + timer ring. This is acceptable as a baseline but should incorporate the video/audio when available.

**Data mapping:**
```
current.instructionText → instruction text on screen
current.duration → countdown timer
current.voiceUrl → audio instruction playback
block.videoUrl → looping equipment/location video (if coach provided one)
```

### 2F. Outro Screen (block.type === 'Outro')

**What the coach configured:** An Outro block with `durationSec` (default 10s).

**What the member sees (from video at 25:16):**
- GoArrive logo large and centered, gold/yellow
- "WORKOUT" in large white text below the logo
- Background: darkened fitness imagery (slightly blurred)
- Timer counts down, then transitions to the Complete phase

**Current code gap:** The code renders a check-circle icon + "YOU DID IT!" text. Must be changed to match the video's cinematic outro with the large logo and "WORKOUT" text.

**Data mapping:**
```
block.durationSec || 10 → countdown duration
GoArrive logo asset → centered logo
"WORKOUT" → static text (or block.label if coach customized it)
```

---

## 3. Timer Visual Treatment

**CRITICAL:** The timer in the video is NOT plain text. It is:

- Large bold numbers (black or very dark)
- Inside a **gold/yellow background box** (`#F5A623` or `#FFD700`)
- Slightly rounded corners (~8px border radius)
- Positioned to the right of the movement name
- Consistent across ALL screen types (movement, demo preview, water break, intro)

The current code uses plain white text at 80px font size. This must be replaced with the gold box treatment.

```
Style: {
  backgroundColor: '#F5A623',
  color: '#0E1117',
  fontWeight: '700',
  fontSize: 48-80 (scales with screen),
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderRadius: 8,
}
```

---

## 4. Next Up Bar — Timing Behavior

**From the video:** The "next up" information does NOT display permanently during the entire movement. It appears approximately **3.5 seconds before the current movement's timer reaches 0**.

**Implementation:**
- Track `timeLeft` in the work phase
- When `timeLeft <= 3.5` (or `timeLeft <= 4` for integer comparison), render the Next Up bar with a fade-in animation
- The Next Up bar shows: thumbnail of next movement + movement name
- When the timer hits 0 and transitions to the next movement, the bar disappears and the new movement takes over

**Current code gap:** The `renderNextUp()` function is called unconditionally during the work phase. Must be wrapped in a `timeLeft <= 4` conditional.

---

## 5. Side-Switch (Swap) Flow for Split Movements

**From the video (4:57, 5:17):**

When `swapSides === true` on a movement:

1. **Side A plays:** Movement screen shows normally with "SPLIT | 5 sec ⇄" label below the name. Timer counts down the full duration.
2. **Side switch:** When Side A timer hits 0, a brief transition (currently 3 seconds in code, video shows ~5 seconds) displays "SWITCH SIDES" with the side indicator.
3. **Side B plays:** Same movement screen, same video, timer resets to full duration. The "SPLIT | 5 sec ⇄" label remains visible.

**Key detail from video:** The SPLIT label format is `SPLIT | {swapDuration} sec ⇄` — it shows the transition duration, not the side name. The current code shows "LEFT SIDE" / "RIGHT SIDE" as a separate badge. Must be changed to the inline SPLIT label format.

**Data mapping:**
```
current.swapSides === true → show SPLIT label, enable side-switch flow
Swap duration: 3s (from useWorkoutTimer SWAP phase) or 5s (from video) — align to video's 5s
swapSide state ('L' | 'R') → internal tracking only, not shown as "LEFT/RIGHT" text
```

---

## 6. Audio System

The player has a multi-layer audio system driven by coach configuration:

| Audio Type | Source | When It Plays |
|---|---|---|
| Movement name announcement | `voiceUrl` (ElevenLabs) | At the start of each movement (during countdown or first second of work) |
| Countdown beeps | `audioCues.ts` | 3, 2, 1 before work starts; 3, 2, 1 before rest ends |
| "Rest... next up, [name]" | TTS via `useWorkoutTTS` | When entering rest phase |
| "3, 2, 1, go" | `audioCues.ts` | End of countdown phase |
| Transition instruction | `voiceUrl` on transition block | During transition phase |
| Haptic feedback | `haptics.ts` | Light at countdown ticks, medium at phase changes, heavy at start |

---

## 7. Existing Architecture (Do Not Rebuild)

The following hooks and pipeline are already built and working. The spec changes above are **rendering-only** — the data flow and state machine are correct:

- **`useWorkoutFlatten`** — Converts blocks → flat step sequence. Handles Intro/Outro reordering, Demo lookahead, circuit/superset round expansion, swap sides carry-through. ✅ Correct.
- **`useWorkoutTimer`** — State machine: ready → [special or countdown] → work → [rest/swap] → next. ✅ Correct.
- **`useWorkoutTTS`** — Voice coaching with ElevenLabs. ✅ Correct.
- **`useMediaPrefetch`** — Prefetches next 1-3 movement videos. ✅ Correct.
- **`useMovementHydrate`** — Enriches flat steps with movement library data. ✅ Correct.
- **`useMovementSwap`** — Lets members swap a movement for an alternative. ✅ Correct.
- **`usePlaybackSpeed`** — 0.5x / 1x / 1.5x / 2x video speed. ✅ Correct.

**What needs to change:** Only `WorkoutPlayer.tsx` rendering and styles. The hooks are the engine — the player component is the skin.

---

## 8. Implementation Checklist for Maia

Priority order (highest impact first):

1. **Timer gold box** — Replace plain white text timer with gold background box + dark text. Applies to ALL screen types.
2. **Intro split-screen** — Replace centered logo + "LET'S GO" with split-screen layout (video left, branding right).
3. **Demo thumbnail grid** — Replace scrollable list with 2×2 / 3×2 thumbnail grid.
4. **SPLIT label** — Replace "LEFT SIDE" / "RIGHT SIDE" badge with inline `SPLIT | 5 sec ⇄` below movement name.
5. **Next Up timing** — Show Next Up bar only in the final ~3.5 seconds of each movement, not permanently.
6. **Water Break media** — Replace icon + text with full-screen blue-tinted media background + stylized text overlay.
7. **Outro cinematic** — Replace check-circle + "YOU DID IT!" with large centered logo + "WORKOUT" text.
8. **Portrait lock** — Cap max width at ~430px on wide screens, center with black bars.
9. **Swap duration** — Change swap phase from 3 seconds to 5 seconds to match the video.

---

## 9. Coach Preview Mode

The coach must be able to preview the workout exactly as a member would see it. This already exists via the `isPreview` prop on `WorkoutPlayer`. The preview:

- Shows a "COACH PREVIEW" badge on the ready and complete screens
- Uses "Start Preview" / "End Preview" button text
- Calls `onClose` instead of `onComplete` when finished
- Does NOT log workout completion to Firestore
- Does NOT trigger post-workout journal flow

The preview button should be accessible from the workout builder (WorkoutForm) — a "Preview" button that opens the WorkoutPlayer modal with `isPreview={true}` and passes the current workout data.
