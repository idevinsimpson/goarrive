# GoArrive Workout Player: Verbatim UI/UX Specification

This document provides the exact, verbatim specification for the GoArrive Member Workout Player based on the reference Loom video. The goal is to build the `WorkoutPlayer` component to match this experience frame-by-frame.

## 1. Global Visual Identity

The Workout Player operates in a strict, immersive "dark mode" that feels like a premium fitness video experience rather than a standard web app.

*   **Orientation:** Portrait/Vertical (optimized for mobile phones).
*   **Background:** Solid black (`#000000`) or very dark grey (`#111111`) across the entire viewport.
*   **Typography:** High-contrast white text for movement names, with specific colored accents (gold/yellow) for timers and branding.
*   **Branding:** The GoArrive logo (green G➲A arrow with white text) must remain persistently visible, centered at the top of the screen during all active movements.

## 2. Core Screen Types

The workout experience consists of several distinct screen states that the player transitions between.

### A. Section Headers (Intros & Outros)
These screens act as chapter markers (e.g., "Warm-Up & Stretch", "Cool Down", "Workout Complete").

*   **Layout:** Split-screen design.
*   **Left Side (or Top Half):** Background video/image relevant to the section (e.g., a person stretching).
*   **Right Side (or Bottom Half):** Dark background with the GoArrive logo.
*   **Typography:** Large, bold white text with green accents stating the section name (e.g., "WARM-UP & STRETCH").
*   **Duration:** Typically displayed for ~5-10 seconds before transitioning to the first movement.

### B. Active Movement Screen (The Core View)
This is the primary screen displayed while the member is performing an exercise.

*   **Top Bar:** GoArrive logo, centered.
*   **Header Area:**
    *   **Left:** Movement name in bold white text (e.g., "T-Spine Rotation"). The text wraps naturally if long.
    *   **Right:** A large, prominent countdown timer. The numbers are black, housed inside a bright gold/yellow (`#FFD700`) square or slightly rounded box.
*   **Main Stage:** The movement demonstration video.
    *   This video occupies the vast majority of the vertical space (roughly 60-70% of the screen).
    *   The video loops continuously while the timer counts down.
    *   *Technical Note:* Videos should be preloaded MP4s. If the timer pauses, the video must also pause.
*   **Bottom Bar:** Standard video controls (if applicable, though in a pure app experience, these might be replaced by "Pause Workout" or "Skip" buttons).

### C. Circuit / Block Preview Screen
Before a multi-movement block (like a circuit) begins, the player must show a preview of what's coming.

*   **Top Bar:** GoArrive logo, centered.
*   **Header Area:**
    *   **Left:** The block type and round count (e.g., "3 Round Circuit" or "2 Round Circuit") in white text.
    *   **Right:** The gold/yellow countdown timer (e.g., 15 seconds) ticking down until the circuit starts.
*   **Main Stage:** A grid of thumbnail images showing every movement in the upcoming circuit.
    *   For a 4-movement circuit: A 2x2 grid.
    *   For a 6-movement circuit: A 3x2 grid.
    *   These thumbnails must be extracted from the movement library's demo videos.

### D. Unilateral / Split Movements
When a movement requires switching sides (e.g., "Single-Arm Overhead Tricep Extension"), the UI must explicitly guide the member.

*   **Labeling:** Below the main movement name, a specific label must appear: `SPLIT | 5 sec ⇄`
*   **Meaning:** This tells the member they are doing one side, there will be a 5-second transition period, and then they will switch sides (`⇄`).
*   **Flow:** The player must handle the logic of running the timer for Side A, triggering a 5-second transition screen, and then running the timer for Side B, all while keeping the same movement video looping.

### E. Rest & Water Breaks
Dedicated rest periods between sections are treated as distinct media screens, not just blank countdowns.

*   **Example (Water Break):**
    *   **Visual:** A full-screen, blue-tinted background video or image of a person drinking water.
    *   **Typography:** The words "WATER BREAK" repeated multiple times in a stylized, gradient font at the bottom.
    *   **Timer:** The standard gold/yellow countdown box remains in the upper right.

## 3. Playback Logic & Transitions

*   **Auto-Advancement:** The player must automatically transition from one screen to the next when the timer hits zero. No manual "Next" button should be required during the active workout flow.
*   **Audio Cues:** While not explicitly visible in the UI frames, the system vision dictates anticipatory audio: "3, 2, 1, rest... next up, [Movement Name]... 3, 2, 1, go." The player logic must support triggering these audio files at specific timer intervals.
*   **Media Handling:** Short, looped MP4s are the standard. The player should attempt to prefetch the next 1-3 movement videos to ensure zero buffering between exercises.

## 4. Implementation Directives for Maia

When building the `WorkoutPlayer` component:

1.  **Strict Layout:** Adhere exactly to the spatial arrangement described above. The gold timer box next to the white movement name is non-negotiable.
2.  **State Machine:** The player is fundamentally a state machine (`Intro` -> `Preview` -> `Movement` -> `Rest` -> `Movement` -> `Outro`). Use a robust state management approach (like `useReducer`) to handle these transitions cleanly.
3.  **Data Structure Mapping:** Ensure the `MemberPlanData` and `WorkoutBlock` types from Firestore map cleanly to these screen states. For example, a block of type `circuit` must trigger the "Circuit Preview Screen" before iterating through its movements.
