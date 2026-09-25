# APP-FEEL-PARITY-1 checkpoint 2: warm navigation

- **Packet:** L0 #477 `5834095137` item 2; ACK #477 `5837801189`. Director source checkpoint #487 `5838715119`.
- **Worker:** W9.
- **Base:** development `91392f9d`.
- **Product head:** `be21eab4`.
- **Reference:** Lovable `e15b9fa0…` at frozen product `a15a610e`, unchanged.

**Nothing here is accepted.**
- MIGRATED frames show the base `91392f9d` as it ships.
- CANDIDATE frames show `be21eab4`.
- Neither is an AFTER. Every frame carries its stage, the served build's commit and "NOT ACCEPTED" in a strip inside the image, and the producer asserts all three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-app-feel-parity-2-capture.spec.ts` |
| Stage | `WSF_APP_FEEL_STAGE=MIGRATED` or `CANDIDATE`. Set `WSF_CAPTURE_FRAMES=1` for this file only. |
| Devices | 390×640 and 390×844 |
| Digests | `MANIFEST.sha256` holds the SHA-256 of all 64 PNGs. Each journey's `<STAGE>-<journey>-<device>.json` receipt carries its frames' SHA-256 as well. |

All data is synthetic, seeded on the local emulator (`demo-wsf-local`). One member, "Alex Rivera", belongs to two communities:
- "Alpharetta Morning Movers", with "October Squat Challenge" at 1,847 of 5,000 squats;
- "Roswell Lunch Walkers", with no open goal.

## What a sequence is

The change is about what the member sees **between** a press and the settled screen, so each journey is taken as a sequence:
- frames at nominally 0, 150 and 400 ms after the press;
- a settled frame.

The times are real clock times. The actual shutter time of each frame is in that journey's JSON receipt: a screenshot itself takes time, so "000ms" was measured at 30–121 ms after the press. Nothing is paused.

Each receipt also records, read inside the app's document before the press and after it settles:
- the path;
- how many MOVE sheets are in the document;
- how many community screens;
- how many tab bars, which counts tab navigators;
- the scroll offset of the screen returned to;
- `loadingSeen`: every time the Community Home loading screen was painted from the press on, watched continuously rather than only at the shutters.

## Journeys and what they show

| journey | MIGRATED `91392f9d` | CANDIDATE `be21eab4` |
|---|---|---|
| `wordmark-home`: on the Community tab, the top bar's wordmark | The loading screen at 150 ms (visible in the frames). The receipt shows 2 community screens and `loadingSeen: [wsf-community-loading]`. | Home as it stands from the first frame. 1 community screen; nothing loading. |
| `community-first`: the Community tab, first visit after Home | The whole-page skeleton in the early frames. | The known rows from the first frame. The row whose goals were not yet read says "Reading progress…", then fills. |
| `move-nogoal-community`: MOVE on a community with no open goal, then "Go to your community" | After: **2 tab navigators, 2 community screens, the MOVE sheet still in the document**, and a loading pass seen. | After: 1 tab navigator, 1 community screen, the sheet gone, no loading. |
| `move-error-home`: MOVE whose goal read fails (labelled injection: `wsfListGoals` aborted), then "Go Home" | After: **2 tab navigators, 2 community screens, the sheet still in the document**, and a loading pass seen. Scroll 120 → 120 on the first copy. | After: 1 tab navigator, 1 community screen, the sheet gone, no loading. Scroll 120 → 120 on the same screen. |

**What the pixels do and do not show.** For the two MOVE exits, the base's second copy gets through its loading screen quickly on the emulators, so by the 150 ms frame the base and the candidate can look alike. The defect there is structural: a second tab navigator stacked over the first, and the sheet left in the history. **The receipts are the evidence for those two rows, not the pictures.** The wordmark and Community-tab rows differ visibly as well.

**Scroll.** "Roswell Lunch Walkers" has no goal, so its page is too short to scroll at either size (`scroll: null`); retention there is shown by it being the same screen. The Home path planted 120 px and returned 120 px.

## Discrepancies and limits (none waived)

1. **Progress is unchanged.** Its first visit still shows its skeleton: its figures need a fresh read of the member's own part per goal, and nothing honest can be shown before it. Recorded, not hidden.
2. **Stale CURRENT after a switch (checkpoint 3).** After the member switches community, the mounted Community tab still names the previous community as CURRENT and offers only the other row. This is measured on the base and on the candidate.
3. **No reference motion yet.** The reference's tab fade (140 ms) and the side-panel Settings (240 / 180 ms) are checkpoint 3. The Community tab here changes content without motion.
4. **A cold first entry still loads.** It shows cp1's loading composition; nothing is fetched ahead.
5. **No recall on a second screen.** Community Home does not keep a remembered state across a second screen of the same community. That idea was withdrawn once no measured journey needed it (#487 `5838678172`).
6. **Environment.** Everything is Chromium on the local emulators, and emulator latency is not device latency. No timing here is a speed claim for a phone. Native, Safari and real assistive technology are unmeasured.
