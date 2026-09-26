# APP-FEEL-PARITY-1 checkpoint 1: MOVE's one-goal flow as a sheet; Home's loading composition

- **Packet:** L0 #477 `5834095137`, from Director #365 `5834082617` §A. Director source review: #482 `5834554381`.
- **Worker:** W9. **ACK:** #477 `5834278781`.
- **Base:** development `502b1e8d`.
- **Product head:** `fe155375`, the F2 successor (`4c55be43` + `fe155375`). The original frames below were captured at `b497ce4c`; F2 changes focus only, so they carry, and the F2 frames are captured at `fe155375`.
- **Reference:** Lovable `e15b9fa0…` at frozen product `a15a610e`. Read at that ref only: `src/demo/shell.tsx`, `move.tsx`, `overlays.tsx`, `ui.tsx` and `src/styles.css`.

**Nothing here is accepted.**
- MIGRATED frames show the base `502b1e8d` as it ships.
- CANDIDATE frames show `b497ce4c`.
- Neither is an AFTER. Every frame carries its stage, the served build's commit and "NOT ACCEPTED" in a strip inside the image, and the producer asserts all three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-app-feel-parity-capture.spec.ts` |
| Stage | `WSF_APP_FEEL_STAGE=MIGRATED` or `CANDIDATE` |
| Write gate | `WSF_CAPTURE_FRAMES=1`. Set it for this file only. |
| Devices | 390×640 and 390×844 |

## States

All data is synthetic, seeded on the local emulator (`demo-wsf-local`): "Alpharetta Morning Movers", with "October Squat Challenge" at 1,847 of 5,000 squats; one viewer, "Alex Rivera".

| File | Journey | MIGRATED (`502b1e8d`) | CANDIDATE (`b497ce4c`) |
|---|---|---|---|
| `move-one-goal` | Home → MOVE, one open goal | An opaque page: wordmark and Back; Home is `display:none` | A sheet over Home, which stays mounted, dimmed and inert; the title "Start moving" and Close |
| `move-count` | The same flow, at the count | The page | The sheet |
| `move-receipt` | The same flow, after Confirm | The page | The cream panel over Home, with the white receipt card and its navy shared-total block; the outcome exit "Back to community" is kept |
| `home-loading` | Community Home, its first read held (a labelled delay) and the top bar up | `FormShell`: a second wordmark and a "Your community" block under the top bar | The ready composition's geometry: eyebrow, name and presence placeholders, and the hero's navy shape with a polite "Loading your community…" |

### F2 focus states (CANDIDATE `fe155375` only; keyboard-driven)

| File | What the producer asserts before the shutter |
|---|---|
| `f2-focus-on-open` | MOVE pressed by Enter; focus is on the panel's visible, named **Close** (its focus ring shows), not on the scrim |
| `f2-focus-after-step` | "Skip timer" pressed by Enter, so the step it was on is replaced; focus is on the new step's `h1`. It draws no ring, as the reference's `.flow-step h3 { outline: none }` |

The scrims render `tabindex="-1"` and `aria-hidden`. Tab and Shift+Tab stay in the topmost panel, including a goal opened over the chooser. Focus the member placed on a live control is never moved. Measured in `sprint-w9-app-feel-parity-1.spec.ts` (F2 cases).

### Timeline (CANDIDATE only; the base has no sheet motion on web)

**Entry,** after the resolver hands off to the flow: `timeline-entry-{000,060,120,240}ms`.
- The sheet's own animations are paused and set to each time.
- Keyframes: `translateY(28px)` and opacity 0 → rest, 240 ms `cubic-bezier(.22,1,.36,1)`.

**Exit,** on Close: `timeline-exit-{000,090,170}ms`.
- Keyframes: → `translateY(28px)` and opacity 0, 180 ms `cubic-bezier(.4,0,1,1)`.
- The sheet navigates when its own 180 ms timer fires, which a screenshot outlasts. The producer therefore holds timers of exactly 180 ms inside the stage (labelled instrumentation), photographs the exit, then releases them. It asserts that exactly one exit was pending and that the sheet then leaves.

**Measured unpaused** (`sprint-w9-app-feel-parity-1.spec.ts`, per animation frame):
- entry: 28 px / opacity 0 at 75 ms after the press, down to 3.4 px / 0.88 by 174 ms, then at rest;
- exit: 0 → 24.7 px / 0.12 by 163 ms;
- reduced motion: 0 px and opacity 1 from the first sample.

## Discrepancies against the reference (`a15a610e`), none waived

1. **Panel surface.** This checkpoint keeps the accepted MOVE sheet's shape rather than the reference's `Sheet`:
   - the reference is a white `demo-surface` inset 12 px from the viewport, max 430 wide, radius 18/18/8/8, with a 73 px header (kicker plus a 22 px h2, and Close with an X icon);
   - here it is a cream full-width panel, radius 28 on top, a grabber, an 18/800 title, and a text-only Close.
2. **Card-in-sheet.** The flow's accepted surfaces (the goal anchor, the step cards, the RECOVERY-PORT-1 surfaces) render inside the panel as cards. The reference's steps are flat `flow-step` blocks on the sheet.
3. **Mid-entry translucency.** The panel fades in as the reference's does, so for about 100 ms Home's text shows through the panel itself (`timeline-entry-060ms`). It is faithful to the reference's keyframes, and visible.
4. **How much of the tab shows.** At 390×844 the panel's content fills up to 92 % of the height, so only the tab's top band stays visible behind it. The reference caps the sheet at `100dvh - 24px`, which has the same effect for long content.
5. **Scrim.** Here `rgba(11,31,53,.42)`, the same as the resolver's, so the hand-off is one dim. The reference uses `navy-deep` at 55 %.
6. **No per-step motion.** The reference's directional step animation (±18 px, 200 ms) is not implemented.
7. **Focus on step change** (F2, corrected in `4c55be43`). The reference focuses each step's heading on every step. Here focus goes to the new step's heading only when the step change took the member's focus away, which is every replaced step in this flow, and focus a member placed on a live control is left where it is.
8. **Outcome exits.** "Back to community" / "Back to home" navigate immediately, without the 180 ms exit. The reference plays the exit and then acts.
9. **Scope left for later checkpoints.** The Activity icon on MOVE and movement-specific instructions are checkpoint 4. The chooser (several goals) keeps its accepted sheet with motion added.
10. **Unmeasured.** Native (the stack's own `slide_from_bottom` is kept), Safari, and real assistive technology. Everything here is Chromium on the emulators. No timing here is a device-speed claim.
