# COMMUNITY-SETTINGS-PARITY-1: checkpoints 1 and 2

- **Packet:** Director #365 `5840568296` / `5840666502`; #489 `5841202778`, `5841270180`, `5841279872`, `5841078939`, `5840935594`, `5841405625`.
- **Worker:** W9. PR #497. ACK #489 `5841611043`.
- **Base:** immutable PERF successor `889e9775` (#494), plus merge `01407213` carrying parked cp3 `e7ea3432` forward.
- **Product SHAs:**
  - checkpoint 1 `aa22c723`: Settings holds the privacy controls; a failed save stays said; C-F9.
  - checkpoint 2 **`e7dc36ee`**: the Community tab in the reference's order.
- **Reference:** frozen Lovable `d4f606244ba3995080fb0bcd471cbebf4cbbc56a`, `src/demo/screens/community.tsx`, `src/demo/ui.tsx`, `src/styles.css`; the Settings interaction contract #489 `5841078939`.
- **Pass-after:** W7 Check 45 `sprint-w7-community-settings-baseline.spec.ts` at `18d8caca`, run unchanged; Check 43 `sprint-w7-privacy-toggle-verify.spec.ts` at `8e5d5955` carried. Neither is committed here.

**Nothing here is accepted.** Chromium, local emulators (`demo-wsf-local`), synthetic accounts and names.

## W7 Check 45 (unchanged), first runs

| Row | `aa22c723` (cp1) | **`e7dc36ee` (cp2)** |
|---|---|---|
| C-F1 banner leads (name above the switcher and any page title) | fail | **pass** |
| C-F2 facts in order: Members / Your role / Goals | fail | **pass** |
| C-F3 chips for both communities plus Join and Start | fail | **pass** |
| C-F4 "This period" with the current goal | fail | **pass** |
| C-F5 "Goal history" / "What we’ve done together" with the closed goals | fail | **pass** |
| C-F6 the roster ("3 people") after history | fail | **pass** |
| C-F7 390×844 first screen: banner, facts, This period | fail | **pass** |
| C-F8 390×640 first screen: This period and the goal title | fail | **pass** |
| C-F9 unknown total: no Living WE, no "0 of 500" | pass | **pass** |
| S-F1 – S-F6 Settings panel: dialog over You, ≥ 4 switches, Close first, Escape, scrim, Tab contained | pass | **pass** |
| **FAIL-BEFORE total** | 7 / 15 | **15 / 15** |
| **PRESERVE** C-P1 – C-P10, S-P1 – S-P3 | 13 / 13 | **13 / 13** |

Raw: `RAW-w7-check45-e7dc36ee.log`.

**W7 Check 43 (unchanged) on `e7dc36ee`: 7 / 7.** Raw: `RAW-w7-check43-e7dc36ee.log`.

## Other checks

| Check | Result |
|---|---|
| Changed-dependency e2e, cp1 `aa22c723` (10 files: social privacy, parity 1–3, community address, focus return, Home return, PERF, shell, You) | **79 / 79**, first run. Raw: `RAW-dependency-aa22c723.log` |
| Changed-dependency e2e, cp2 `e7dc36ee` (11 files: community list, parity 1–3, community URL seam, current-shell-before, focus return, shell production, shell, a11y, social privacy) | **92 / 92**, first run. Raw: `RAW-dependency-e7dc36ee.log` |
| vitest (app) / tsc | 909 / 909 / clean |

## Frames

Producer: `apps/westayfit/tests-e2e/sprint-w9-community-settings-parity-1-capture.spec.ts` (writes only with `WSF_CAPTURE_FRAMES=1`). Each frame carries its stage, the served build's commit and NOT ACCEPTED. BEFORE is `889e9775`, the lane's base product (its Community tab is the one on development `0b460ce3`; Settings there is a page with a Privacy row).

| State | BEFORE `889e9775` | CANDIDATE `e7dc36ee` |
|---|---|---|
| `community` (settled) | 390×640, 390×844 | 390×640, 390×844 |
| `community-lower` (history and roster) | 390×640, 390×844 | 390×640, 390×844 |
| `switch-000ms`, `switch-050ms`, `switch-settled` (second community's chip) | — (no chips) | 390×640, 390×844 |
| `settings-open` (from You's Settings row) | 390×640, 390×844 | 390×640, 390×844 |
| `settings-entry-{000,120,240}ms`, `settings-exit-{000,090,170}ms` (paused) | — | 390×640, 390×844 |
| `settings-closed` | — | 390×640, 390×844 |
| `reduced-settings-open`, `reduced-settings-closed` | — | 390×640, 390×844 |

Receipts (`*-states-*`, `*-settings-timeline-*`, `*-reduced-motion-*` `.json`, with each frame's sha256):
- **Switching:** in the 0 ms, 50 ms and settled frames after the chip press, the heading and the This period title belong to one community (`Summit Walkers` / `Summit Steps`); the spec fails on any mixed pair.
- **Panel:** 2 animations held per paused frame (panel and scrim); exactly one exit pending and released; focus on open = **Close**; focus after Close = **You's Settings row** (`wsf-you-settings`), at both sizes.
- **Reduced motion:** 0 panel animations running on open; Close to panel gone in **7 ms** (no 180 ms wait); focus back on the Settings row.

Instrumentation, labelled: the paused frames pause the panel's own CSS animations at fixed times, and the exit's 180 ms navigation timer is held while the exit is photographed, then released.

## Discrepancies against the frozen reference

1. **Place and descriptor** (#489 `5840935594`): the eyebrow is the stored group type through the shared label ("Family and friends"), omitted for `custom`; the descriptor is the stored join policy in Community Home's words ("Joining: Anyone with the link"). Nothing is invented.
2. **Sample wording removed:** "Sample roster." and "in this sample community" are not carried.
3. **Roster:** no "(you)" suffix, because `wsfCommunityMembers` returns no uid and matching by name could name the wrong person. Avatars use the shared `InitialsAvatar` (Champion green) that Community Home draws. The "shown without a name" count appears only when the list is complete. A "See everyone ›" link keeps the full member destination (capability map).
4. **Numbers:** canonical `180 of 500 squats` and `320 to go` (shared `totalOfTargetParts` / `statusLine`), against the reference's `180 / 500 confirmed` and `320 squats to go`. The period line is the goal's window only; canonical goals carry a unit, not a movement list.
5. **Banner ring:** drawn as a quarter ring inside the banner's own bounds. The reference's circle sits outside the right edge, which `ui-a11y` R1 forbids.
6. **Chip glyphs:** "✓" and "+" as text in place of the lucide icons.
7. **Join** opens Home's "Join with a code" (`/?view=communities`), the one place a typed code is taken; there is no Join sheet. Its accessible name is "Join with a code". **Start** opens `/start-community`.
8. **Secondary capability after the core** (capability map): "Open another community" rows, then Recent movement on the light surface.
9. **Settings switch geometry:** the react-native-web `Switch` draws a 28 px teal thumb over a thinner track, not the contract's 48×28 track with a 20 px thumb at a 4 px inset, and has no focus ring of its own. **Corrected in checkpoint 3.**
10. **Not drawn:** the reference's ≥ 900 px two-column grid and its `max-height: 700px` tightening. These frames are phones.
11. **Reads:** the Community tab's first visit adds one `wsfCommunityMembers` read (the roster), in parallel with recent movement. Warm switches between tabs stay at 0 calls.
12. **A test premise, reported and not edited:** `community-list.spec.ts` says "there is no join-by-code route, so there must be no Join control at all" and asserts no control named "Join a community". It passes unchanged. The premise is stale: Home takes a typed code, and the Join chip goes there.

## Limits

- **No Lovable originals or overlays.** No render of frozen `d4f60624` exists in the repository, and the Lovable preview serves the project's latest head, which a packet must not chase. Frozen reference frames at matched states would allow the overlay pass.
- **Hosted:** the toggle is proved on the emulators only. The hosted privacy proof waits for L0's operator read-back and W3's harness (hardening addendum).
- Unmeasured: device speed, Safari, native, assistive technology.
