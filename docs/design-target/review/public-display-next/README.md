# Public display — responsive target checkpoint

**PROPOSED TARGET · NOT IMPLEMENTED**, beside the actual build. Returned for
creative review **before** any product implementation.

W2's packet from the Director's Board 10 verdict on PR #422
([`5786952407`](https://github.com/idevinsimpson/goarrive/pull/422#issuecomment-5786952407)):
turn the completed 00–11 reference into an implementation-ready surface for two
classes, rather than repeat board production. This is **not Board 12**, and no
part of the atlas was regenerated.

| | |
|---|---|
| App source | `a193b43` — the head of `claude/wsf-app-shell` when this was cut |
| Classes | **800×1280** portrait · **1920×1080** collective. Nothing else. |
| Treatments | confirmed progress · stale · refused |
| Producer | `apps/westayfit/tests-e2e/sprint-w2-public-display-next-capture.spec.ts` |
| Preview | `apps/westayfit/app/design-target/public-display-next.tsx` (gated) |
| Component | `apps/westayfit/src/ui/designTarget/PublicDisplayNextTargets.tsx` |
| Write gate | `WSF_CAPTURE_FRAMES=1`; the ordinary run asserts every state and writes nothing |
| Runs | ordinary: 4 tests, 3 passed + 1 skipped, 0 files. Capture: 4 passed, 14 frames |

**The source delta from the existing captures is nil.** Between the Board 10
capture SHA `7fbc45d` and `a193b43`, `git log` over `app/display/**`,
`LivingWeProgress.tsx`, `progressFormat.ts`, `displayPulse.ts`,
`displayTypeScale.ts` and `relativeTime.ts` returns no commits, and the
diffstat of `app/display/[goalId].tsx` across that range is empty. The display
surface has not moved.

## What is here

```
before/   BEFORE-progress-800x1280            BEFORE-progress-1920x1080
          BEFORE-stale-INJECTED-NETWORK-…     (both classes)
          BEFORE-refused-800x1280             BEFORE-refused-1920x1080
target/   TARGET-progress|stale|refused-800x1280
          TARGET-progress|stale|refused-1920x1080
COMPARISON-portrait-800x1280.png
COMPARISON-collective-1920x1080.png
```

**Both halves of every pair come from one run, one seeded fixture and one
commit.** The BEFOREs are the real `/display/[goalId]`; the TARGETs are the
gated preview. They are re-shot here rather than copied from
`review/sprint-w2-board10/after/` — those frames remain valid, since the route
has not moved — because a comparison assembled across two runs invites the
reader to attribute an incidental difference to the proposal. The one thing
that still differs incidentally is the clock: the actual capture carries the
run's real receipt time and the proposal carries a fixture string.

## What the proposal changes

Three changes, against the three gaps the verdict named for the public display.

1. **800×1280 gets its own tier.** The shipped breakpoint is
   `windowWidth >= 900` (`app/display/[goalId].tsx:74`), so a picture frame
   takes the phone composition and the phone mark cap —
   `min(320, width − 84)` — which is **320px on 800px of glass**. The portrait
   tier is a single column at frame scale, the words and the recent strip
   above, the mark and the number given the middle, the seam at the foot.

2. **The type and the status scale with the room.** The shipped wide build
   renders the booth's sizes on a 1920, and `weWidth = min(640, 0.42 × width)`
   caps so the instrument falls from 42% of the glass to 33%. The freshness
   row has **no wide variant at all**, so today the one element telling a room
   its number is old is the least legible thing on the wall. Both scale here.

3. **The collective refusal is centred.** `canvasWide` is `space-between` and
   the refusal branch renders two children, so on a booth or a wall the
   message is pinned to the top edge with two thirds of the glass empty below
   it.

**Correction to how this was first framed, kept rather than quietly fixed:**
change 3 is a *collective* change only. At 800×1280 the current build already
centres the refusal, because 800 is below the breakpoint and it takes the
phone layout, which is `justifyContent: 'center'`. For portrait the delta is
scale, not placement, and the comparison sheet shows exactly that.

## What the proposal refuses to change

- **No new data.** Amount, unit and age, and no count of how many people the
  recent lines represent — five lines may be five people or one.
- **No member chrome.** No tab bar, no MOVE, no identity, no control a viewer
  could press except the refusal's own `Check again`. Asserted by locator
  count on every frame, both halves.
- **The percentage stays.** Batch F's drawing omits it and leads on "N to go";
  the shipped route shows both. Dropping a confirmed value from a proposal is
  a product decision this checkpoint has no mandate to take, so both are here
  at distance-readable size.
- **The QR is a seam.** Drawn as a labelled placeholder with no encoded code,
  and carrying `INTENDED SEAM · NOT WIRED` wherever it appears. It is absent
  from the refusal entirely: there is nothing there to join.
- **The phone composition is untouched** and is not in this checkpoint.
- **No runtime change.** No polling, auth or backend behaviour; no product
  route.

## The one place this departs from Batch F's tiers, and why

The portrait and collective type scales are Batch F's `portrait` and `wall`
tiers, reused rather than re-opened. **The mark sizes are not.** Batch F draws
the wall mark at 580px, which is *smaller* than the 640px the shipped route
already gives a 1920 — a proposal arguing that the instrument must grow with
the room cannot hand the room a smaller one. So portrait is **440** against the
shipped 320, and collective is **760** against the shipped 640, and the
producer asserts both exceed what ships rather than leaving it to the eye.

## Two defects in this package's own first draft

Both were found by opening the pixels after a green run, and both are now
asserted so they cannot return silently.

1. **A draft of the collective target came in at 580px** — under the 640px the
   shipped route already gives a 1920. The producer now fails if the proposed
   mark does not exceed the shipped width for its class.
2. **The portrait frames came back with a blank band at the foot**, which
   looked exactly like a clipped seam block and was not one. Measuring the DOM
   put the seam 44px inside the frame; the real cause was the producer's
   viewport being 1200 tall while the portrait frame is 1280, so Playwright's
   element screenshot returned the overflow unpainted. The viewport is now
   taller than any frame and the precondition is asserted. Containment of the
   mark, the list and the seam inside the fixed canvas is asserted too.

## Reproducing

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w2-public-display-next-capture.spec.ts --workers=1
```

`--workers=1` matters: the comparison sheets are assembled from the frames the
earlier tests in the same file write.

The preview route renders only when the build carries
`EXPO_PUBLIC_WSF_USE_EMULATORS`, which `scripts/westayfit/build-staging.sh`
refuses. **No deployed artifact can serve it.**

## Fixtures

Maple Street Movers · Squats together this week · 241 of 500 squats · the five
recent lines — synthetic, and identical on both sides of every pair. Each
seeded goal carries a member with credit (`7331`) precisely so a leak would
have something to leak, and every ready state asserts that no uid, join code,
member total or group type appears anywhere in the document.

## Status

**PROPOSED — self-checked, not accepted.** This is returned for creative
review; the Director retains the visual verdict and L0 coordinates. Nothing
here authorises implementation, hardware, a QR, a privacy or production
release, or a deploy.
