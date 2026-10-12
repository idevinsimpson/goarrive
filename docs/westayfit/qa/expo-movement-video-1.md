# EXPO-MOVEMENT-VIDEO-1: movement demo in the existing media slot

Packet: queue #365 5971264707, release 5971282758, ACK #497 5971344397. Owner W9.

Base: development `0d3598d4`. Branch: `claude/wsf-w9-movement-video-1`.

**Status: delivered only.** This is not reviewed, accepted, integrated or staged.

**Checklist item 4 stays PARTIAL.** No approved production clip exists, so no real movement plays a video yet.

## What changed (reserved paths only)

| File | Change |
|---|---|
| `src/movementDemoMedia.ts` | New. The explicit approved catalog (`APPROVED_DEMO_MEDIA`), which is **empty**, plus the asset-gap statement, the address and variant rules, the emulator-only test catalog and the pure playback rules. |
| `src/followAlongSession.ts` | The plan's existing `media` seam is filled with `demoMediaFor(unit)`. With no approved clip it is `{kind:'none'}`, exactly as before. |
| `src/ui/FollowAlongCard.tsx` | Only the media slot changes. Poster plus clip render `MovementDemoMedia`; poster-only and the drawn guide are unchanged. Composition, copy, tone, controls, timer and test IDs are unchanged. |
| `src/ui/MovementDemoMedia.web.tsx` | New. The web, phone-browser and kiosk clip. |
| `src/ui/MovementDemoMedia.tsx` | New. Native: the poster, still (compile-safe; no native video dependency). |
| `tests/movement-demo-media.test.ts` | New. 23 unit tests. |
| `tests-e2e/movement-demo-media.spec.ts` | New. 9 behaviour tests plus a gated capture producer. |

## Behaviour (web, phone browser, station)

- **Poster first.** The poster shows over the clip until the clip is actually playing.
- **Plays only while the round runs.**
  - Muted, inline, looping, no autoplay and no controls.
  - A paused round holds the clip on its frame.
  - At ready or finished, the clip rewinds behind the poster.
  - A hidden page pauses it.
  - On unmount, and when it falls back, it is paused and its source dropped.
- **Bounded retry.** A rejected `play()` or a load error is retried 2 times, 400 ms apart. After that the slot shows the poster for good, or the drawn guide if the poster also fails. A cold or offline first load lands on bundled guidance. No service worker and no media backend were added, and no permanent offline playback is claimed.
- **Reduced motion:** the poster only; the clip is never played.
- **Exact variants only.** A clip is keyed by the movement's own unit, normalized only for case and spacing. A "squat" entry does not play for "squats". There is no alias table.
- **Addresses.**
  - Approved entries must be same-origin paths under `/media/movements/`, versioned and release-packaged (for example `squats@v1.webm`).
  - The following are all refused: other origins, `data:`, `blob:`, `..`, queries, GoArrive storage, and member- or goal-supplied URLs.
- **No side effects.**
  - The media gets the round's state (`demoPlaybackFor(phase, running)`) and gives nothing back: no callback.
  - The only video event it handles is `error`.
  - `ended`, `timeupdate`, a loop and `pause` cannot start a round, mint an attempt, count, record, or touch timing, the queue or identity.
- **The visible instructions are preserved:** "Movement guide", "Demonstration only — count your own reps.", the self-count line, and the 60-second station round.
- **Native** remains the poster or the drawn guide until a native player is separately implemented and device-proven.

## The test-only fixture

No approved clip exists, so playback is proven with a clip **generated in the browser at test time**: a moving square under "TEST FIXTURE / not a movement demonstration" on every frame.

- It is served through a Playwright route and registered in a test catalog. That catalog is read only by an emulator build served from loopback, and never by a staging or production page.
- It is never committed, never shipped, and is not a demonstration of any exercise.

## Proof

- **Fail-before on base `0d3598d4`:**
  - unit: the file fails (`movementDemoMedia` does not exist);
  - e2e: **7 failed, 3 passed**. The no-clip and exact-variant guards pass on base by design, and the capture producer ran.
- **Pass-after** at head `a0e1cfef` (web marker `a0e1cfef`, emulators `demo-wsf-local`):
  - unit **23/23**;
  - e2e **10/10** (9 behaviour tests plus the capture).
- **Found and fixed during the work:** the first pass-after showed a recorded station turn left the clip's `src` attached. React detaches the ref before effect cleanups run, so the cleanup found nothing. The release now happens on ref detach (commit `a0e1cfef`).
- **Regressions:**
  - vitest **1083/1083**; `tsc` clean;
  - e2e **61 passed, 1 skipped** across move-follow-along, movement pills, the expo attendee journey, station enrollment, ui-kiosk, queue-call-by-name, event activity choice, combined goal and ui-a11y.
- **Evidence integrity:** frozen BEFORE 9 and accepted TARGET/AFTER 20 are intact. Run artifacts were removed.

## Frames (inspected; same fixtures; AFTER shows the labelled TEST FIXTURE)

BEFORE (base) shows the drawn movement guide. AFTER shows the fixture poster, then the looping fixture clip, in the same slot at the same size. Everything else is identical: copy, badge, note, timer, controls, panel and station layout.

The frames are not committed: the evidence-folder scope delta (#497 5971355649) had not been answered at delivery. To reproduce them:

    WSF_MOVEMENT_MEDIA_LABEL=before|after npx playwright test tests-e2e/movement-demo-media.spec.ts

sha256:

    fd6234c26a5b4d2e71e43cc7ba5bf2b10fd1437058d2c2fe9e667952ee6b5fe3  before-move-ready-390x640.png
    66b6a9d32508246c117ab057858fda0a96a5d2962705fdda23ce31df202d718b  before-move-ready-390x844.png
    736303d0ac7b791d6be663c82799ee9be6d8afdcdd81c0d0af3f1dc7f717b127  before-move-round-390x640.png
    8c3e39eb8dd2d478b45e3622b2ec8171bef84579805af7cee44aea97f136fe0f  before-move-round-390x844.png
    d932c1d7f43820e016e7e5d6513c734fc8f2c224d2a19d7e9ad58416dcd80ffc  before-station-turn-ready-1280x720.png
    a0a608484c4ff2e758ebc003fbca08619c31fe1b0e923487d8493651749cc1b8  before-station-turn-round-1280x720.png
    7e81b7da5f14b25d44459fa177d983af93d36c6392e8c66be99094a52c855a98  after-move-ready-390x640.png
    832765addfdd5fceca0adcb639e2a6d3e8e97610238e39d8e39dad0cac5b5c42  after-move-ready-390x844.png
    5310f77c55264c492c7d5286db4bfb699be38cbdffa7ecb9f83019ce171ebcbe  after-move-round-390x640.png
    9313f7fa3d38629ac576922577b19975956693a2afab2ea283d4b29e1bf8f94a  after-move-round-390x844.png
    7bd9ef949401dc082d2f381827205e769be5b24f0e45599cf789d25ef63c3d91  after-station-turn-ready-1280x720.png
    45b066e1274d8b95010872ca867cfe8c0bef5bf3b00815f318ba5a1c8275bd53  after-station-turn-round-1280x720.png

## Not claimed

- Real production clips: none exist. This is the asset dependency, and item 4 stays partial.
- Native or device playback.
- Hosted, staging or Safari/iOS behaviour.
- Owner acceptance.
