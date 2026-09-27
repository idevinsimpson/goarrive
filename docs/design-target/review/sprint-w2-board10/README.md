# Public display family — CURRENT-BUILD CAPTURES for Board 10

**Source SHA: `7fbc45d3e7565519b48fb04731b1c9967f9ccb6a`** (`claude/wsf-north-star-canonical`
head at capture time). The application tree under test is exactly that commit: the only
file added to the working tree was the producer spec below, which is test code and
changes nothing the browser loads.

Produced by W2 for Board 10, under the Director's release on PR #416 (`5785727716`).
**These are current-build captures — not a new page, not an acceptance, not hosted
proof.** Every frame is the real `/display/[goalId]` route, served from the real web
build against the local emulators with synthetic fixtures. No product file was edited
to produce any of it, and no route changed.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w2-board10-capture.spec.ts` |
| Frames | `after/` — 21 PNGs, all distinct |
| Write gate | `WSF_CAPTURE_FRAMES=1` (the repository's opt-in convention, via `helpers/capture`) |
| Ordinary run | asserts all 11 cases and **writes nothing** — verified: 11 passed, 0 files |
| Capture run | `WSF_CAPTURE_FRAMES=1 … test:e2e -- sprint-w2-board10-capture.spec.ts` → 11 passed, 21 frames |

Every shot is preceded by an assertion of the named state, including the identity, the
confirmed numbers, the phase copy, `data-layout`, that exactly one Living WE is present,
and that no member tab bar or MOVE control exists. A screenshot of the wrong state is
worse than none, because it looks like proof.

## Why this set had to be produced

Checked across every tracked PNG in the repository before writing a line of it:

- `review/batch-f-public-display/` is **40 TARGET frames** at all four locked sizes,
  captured from the gated preview route `/design-target/display-boards` rendering
  `DisplayBoardTargets.tsx`. A drawing of a redesign, not the route.
- `tests-e2e/artifacts/e5-display-authorization/` is **28 committed frames of the real
  route**, but at 1280×720 @1×, and they are authorization-propagation evidence rather
  than display compositions.
- `ui-display.spec.ts` shoots the real route at 390×844 @2 and **1440×900** @1, and its
  artifacts directory is not committed.

Nothing anywhere was a current-build capture of the real route at the locked
390×844 / 1280×800 / 1920×1080 viewports.

## What is injected, and where it is said

| Marker | Meaning |
|---|---|
| `INJECTED-NETWORK` | a callable aborted at the network layer (`route.abort`) |
| `INJECTED-DELAY` | a callable held open, released after the shot |

Nowhere is an injected failure presented as an organic one.

## State map

### Phone preview, 390×844 @2 — the personal read

| Frame | State | Asserted before the shot |
|---|---|---|
| `display-building-390x844.png` | ordinary progress | `241 of 500 squats` · `48.2% complete` · `259 to go` |
| `display-zero-390x844.png` | nothing yet | `0 of 500 squats` · `0% complete` · `See what WE can do.` |
| `display-near-390x844.png` | near goal | `450 of 500 squats` · `90% complete` · `Only 50 to go` |
| `display-reached-390x844.png` | reached, still open | `515 of 500 squats` · `100% complete` · `15 beyond our goal · still open` · `WE did it.` |
| `display-closedreached-390x844.png` | closed, reached | `515 squats completed together.` · `Goal: 500 squats` · `Look what WE did.` · CLOSED |
| `display-closedshort-390x844.png` | closed, unfinished | `312 of 500 push-ups` · `Closed at 62.4%` · CLOSED |
| `display-recent-390x844.png` | recent additions | `Recent`, exactly 5 lines, each matching amount-and-age only |
| `display-stale-INJECTED-NETWORK-390x844.png` | a later poll failed | `Connection interrupted` + `Last confirmed …`, the total and the mark retained, `data-stale="true"` |
| `display-unreachable-INJECTED-NETWORK-390x844.png` | never confirmed | `Nothing has been confirmed yet.` and **no total, no mark** |
| `display-not-available-390x844.png` | unknown / unauthorized / revoked | `Nothing to show here`, and community, title, total, mark and list all absent |
| `display-loading-INJECTED-DELAY-390x844.png` | first poll in flight | `Loading display…`, no total |

### Portrait picture frame, 800×1280 @1 — evidence of a negative

| Frame | State |
|---|---|
| `display-building-800x1280.png` | `data-layout="phone"` asserted — see finding 1 |

### Booth display, 1280×800 @1 — the wide build

| Frame | State |
|---|---|
| `display-building-1280x800.png` | two columns, `data-layout="wide"`, with the recent list |
| `display-reached-1280x800.png` | reached, still open |
| `display-closedreached-1280x800.png` | closed, reached |
| `display-stale-INJECTED-NETWORK-1280x800.png` | stale, wide |
| `display-not-available-1280x800.png` | the one generic refusal, wide |
| `display-recent-failure-INJECTED-NETWORK-1280x800.png` | the list goes, the pulse-confirmed total and mark stay, and the screen does **not** become stale |

### Collective display, 1920×1080 @1 — hall scale

| Frame | State |
|---|---|
| `display-building-1920x1080.png` | two columns with the recent list |
| `display-reached-1920x1080.png` | reached, still open |
| `display-stale-INJECTED-NETWORK-1920x1080.png` | stale at hall scale |

## Observed differences from the lock — reported, not built around

Per the packet: report what the build actually does rather than change the product to
match the board. Each of these is read out of `app/display/[goalId].tsx` at this SHA, not
inferred from a frame alone.

1. **Below 900px the current build takes the phone layout.** `line 74`:
   `const wide = hydrated && windowWidth >= 900`. A 800×1280 picture frame therefore gets
   the phone composition, and the mark is capped by the phone path —
   `Math.max(96, Math.min(320, windowWidth - 2*20 - 2*22))` — so it is **320px on an
   800px frame (40% of the width) against 306px on a 390px phone (78%)**. A frame twice
   as wide gets a mark 14px larger. This is exactly why the lock records the portrait
   composition as a TARGET rather than claiming it is wired.
2. **The instrument shrinks relative to the glass as the room grows.** Wide path:
   `weWidth = Math.min(640, Math.round(windowWidth * 0.42))`. At 1280 that is 538px, 42%
   of the screen; at 1920 the cap binds at 640px, **33%**. The 1920 is a bigger screen
   showing a proportionally smaller mark.
3. **The freshness row has no wide variant at all.** `freshness` and `freshnessText`
   carry no `wide ? …` branch, so the `Connection interrupted` pill and the
   `Last confirmed …` line render at phone size on a 1920×1080 wall — the one element
   that tells a room the number is old is the least legible thing on the screen.
4. **The wide refusal is pinned to the top edge.** `canvasWide` sets
   `justifyContent: 'space-between'` and the non-ready branch renders only the generic
   block and the test note, so the two are pushed to the extremes and the lower two
   thirds of a booth screen is empty navy. The phone refusal is centred
   (`canvasPhone` uses `justifyContent: 'center'`), so the two do not read as the same
   screen at two sizes.
5. **`SAMPLE DATA` is an emulator-only element and it is in every frame.** It renders
   when `wsfUsingEmulators` is true, so it would never appear in production. On the navy
   canvases it is legible; on the cream phone page it is `rgba(247,245,240,0.78)` on
   `#F7F5F0` — cream on cream, effectively invisible. Noted so nobody reads its absence
   from a phone frame as the banner not being there.

## Reproducing

```
npm --prefix functions-westayfit ci
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w2-board10-capture.spec.ts
```

## Fixtures

"Maple Street Movers" — the accepted display fixture's community, kept so the family
reads as one set — "Squats together this week", "August push-ups", every total, date and
recent line are synthetic. No real community, person or contribution appears. Each goal
seeds a member with credit (`7331`) precisely so a leak would have something to leak, and
every ready state asserts that no uid, join code, member total or group type is anywhere
in the document.

Nothing else in the repository was touched: no product file, no shared renderer, no
manifest, no `.github`, no accepted or frozen frame, and no existing spec.
