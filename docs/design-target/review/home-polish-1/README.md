# HOME-POLISH-1 — the ordinary member's community Home, before and after the recomposition

Packet: Director #365 `5817775726` (assigned by L0 on #458 `5817809373`). Worker: W9. PR #472.

**Nothing here is accepted.** MIGRATED frames are the route as it ships on the development base;
CANDIDATE frames are the recomposed route. Neither is an AFTER. Every frame carries its stage, the
served build's commit and "NOT ACCEPTED" in a strip inside the image, and the producer asserts all
three before it writes.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w9-home-polish-capture.spec.ts` |
| Stage | `WSF_HOME_POLISH_STAGE=MIGRATED` or `CANDIDATE` |
| Build check | the producer reads the served commit on `/health`: MIGRATED must be `018cd29` (the base), CANDIDATE must not be |
| Write gate | `WSF_CAPTURE_FRAMES=1` (via `helpers/capture`) |
| Ordinary run | runs every check, writes nothing |
| Frames | 9 per stage: 4 states × 390×844 and 390×640, plus one scrolled populated frame |
| Reference | Lovable revision `544a385e` / evidence head `872c32fc`, seven PNGs, sha256-matched to their manifest (composition only) |

## States

All data is synthetic, seeded on the local emulator (`demo-wsf-local`), one viewer in one community.

| State | What is seeded | What the producer asserts before the shutter |
|---|---|---|
| `populated` | six members, all visible; five contributed today, the viewer 20 squats with its exact own total (`wsfGoalMemberTotals`) | "5 people moved today"; the momentum section; "Your part" says 20 squats |
| `quiet` | the same community; the only movement is before the goal's own day began | "0 people moved today" — a zero the server proves |
| `privacy` | the viewer and Priya chose not to be named here; Tom chose not to show activity | an "Anonymous member" row; no Tom, no Priya, no viewer name in the feed; the shared total unchanged |
| `stale-INJECTED-PULSE-FAILURE` | `wsfGoalPulse` answered with a 500 in the browser (injected; the server holds the total) | no total printed; the retry present |

On every frame, on both stages: one top bar, and the primary action (the retry, when progress is
unavailable) ends above the tab bar.

## Reproducing

```sh
# emulators from the repo root
METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local
# the build you mean to photograph, emulator-flagged (its commit is what the strip will say)
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm --prefix apps/westayfit run build:web
# frames
WSF_HOME_POLISH_STAGE=CANDIDATE WSF_CAPTURE_FRAMES=1 \
  WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npx --prefix apps/westayfit playwright test tests-e2e/sprint-w9-home-polish-capture.spec.ts --workers=1
```

MIGRATED needs the base build served: build `018cd297` in a separate worktree and serve its `dist`.

## What the stale frames are, and are not

The product has one progress failure state: a read that never returned shows "Progress couldn't be
loaded just now." and no number. That is what these frames show. The route has no recorded *stale*
state: when a later re-read fails, the figure already on screen stays, labelled only by
"Confirmed h:mm". Labelling that as stale needs a small flag in W8's freshness paths (no new call).
That is outside this packet's reservation and is reported on the PR as a seam, not built.
