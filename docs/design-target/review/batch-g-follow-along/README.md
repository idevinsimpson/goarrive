# Atlas Batch G — the follow-along

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing here has been built. No route
changed. Captured from the gated preview route `/design-target/follow-along`.

| | |
| --- | --- |
| Route | `/move/[goalId]` |
| States | 7 |
| Layouts | 2 — 390×844 phone, 1280×800 station |
| Frames | 15 target frames + 1 contact sheet |
| Source | `apps/westayfit/src/ui/designTarget/FollowAlongTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/follow-along.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-follow-along-capture.spec.ts` |

**This is the last uncovered route.** With it, the atlas is at 23 of 23.

## Why it needed its own batch

The player *component* already appears inside Batch D's running-turn frame and
Batch E's station, because the queue and the station host it. Its own route was
never drawn, and it is **not the same screen**: here there is no turn, no
queue, and nobody has been called. It is a timer anybody can start, beside a
way to enter what they counted.

## The one thing this route must not imply

**The player counts nothing.** It runs a clock and shows a movement. It does
not watch anybody, does not count repetitions, and sends nothing anywhere.

The only way off this screen with a number is **Enter my reps**, which opens
the ordinary contribution page and asks the person to sign in as themselves.
Both the finished round **and** the not-yet-started state offer that same
address, and neither sends anything — so the target gives it the same words and
the same destination in both, and never dresses the finished round as though
something had been recorded. Offering it before the round is deliberate:
somebody who already did the movement should not have to sit through a timer to
record it.

### A product finding: the QR is not gated by layout

`qrUri` in `app/move/[goalId].tsx` is gated on `handoffUrl` alone and **not**
on `station`, even though the constant that builds it is commented *"the
station panel's QR"*. So on a phone the product renders a code captioned
*"Scan to enter your own count on your own phone"* — on that same phone.

The first revision of this target reproduced it faithfully. A target is the
destination, not a transcript of today's wiring, so it is drawn correctly now:

| Layout | Panel offers |
| --- | --- |
| station | the QR — somebody across the room needs a way in |
| phone | **Enter my reps** directly — the person holding it already has one |

`/move/[goalId]` is untouched; this is a finding, and the fix is a one-line
gate on `station`.

### The station joins the navy room family

The 1280 layout read as an enlarged cream web page. It now wears the same navy
canvas as the kiosk, the station screen and the public display, with the player
lifted on a translucent surface so it does not disappear into the ground.

**The QR is a handoff, not a login.** *"Scan to enter your own count on your own
phone. It opens the entry page for this goal and asks you to sign in as
yourself."* A screen in a room must never be the thing that takes a password,
and the panel says what the scan does before anybody scans it. The frames draw
the **place** a QR goes, as a plain square — a working code committed here
would be a live link into somebody's community sitting in a repository.

**Nobody in these frames is a person.** The movement is a figure and a cue, not
a video and not a photograph. A stock body on a screen in a church hall is a
promise about who this is for that the product does not make.

## Two layouts, one session

`station` is decided by **width** (`>= STATION_MIN_WIDTH`), not by a flag
anybody sets, so the same URL is both. On a station the panel stands beside the
player for the whole session — the person at the screen can always see where
they are and always has something to scan. On a phone the same panel stacks
underneath, because there is no second column to stand in.

The target draws **the same seven states on both**, rather than a rich station
and a reduced phone. The session is the same session, and a state that existed
at one width and not the other would be a state somebody loses by turning their
phone.

The length chips appear only in the not-started state, because changing the
length abandons a round in progress — so it is only offered where there is
nothing to abandon.

## Two defects found by looking at the frames, and fixed

**The station layout overflowed its canvas.** The first pass gave it a 260px
figure and a 132px clock; together with the controls that column was ~700px
tall inside ~680px of usable height, so the player card rode up over the goal
title and the Stop button fell off the bottom edge. The tier was resized to fit.

**The target was drawn as a fixed canvas, and the route is not.**
`/move/[goalId]` renders inside a `ScrollView` at **both** widths — unlike the
kiosk, the station screen and the public display, whose canvases are fixed
`View`s. A fixed-canvas target clipped its own panel off the bottom on a 390
phone and called it a layout, which is a defect in the drawing rather than a
fact about the product. The target is a `ScrollView` now, and the capture takes
an `-end` frame wherever a state overflows: exactly one does
(`TARGET-ready-390x844-end.png`).

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-follow-along-capture.spec.ts
```
