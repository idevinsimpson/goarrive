# Atlas Batch F — the public display

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing here has been built. No route
changed. Captured from the gated preview route `/design-target/display-boards`.

| | |
| --- | --- |
| Route | `/display/[goalId]` |
| States | 10 |
| Boards | 4 |
| Frames | 40 target frames + 1 matrix sheet |
| Source | `apps/westayfit/src/ui/designTarget/DisplayBoardTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/display-boards.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-display-boards-capture.spec.ts` |

Start with `MATRIX-batch-f.png` — every state on every board at a third scale,
so a board can be judged as a set before any single frame is opened.

| Board | Size | What it is |
| --- | --- | --- |
| phone | 390×844 | a preview in somebody's hand |
| portrait | 800×1280 | a picture frame on a wall |
| landscape | 1280×800 | a booth screen |
| wall | 1920×1080 | a collective display across a room |

## One screen, four rooms

The display is the only surface in this product whose **viewing distance is a
variable**. The same goal has to read at arm's length on a phone, across a
hallway on a picture frame, and across a hall on a 1920.

What changes between boards is **not the content**. Every board shows the same
confirmed values, because a display that hides a number at one size is lying at
that size. What changes is the composition:

| Board | Composition |
| --- | --- |
| phone | one unscrollable card; the words, then the mark and the number |
| portrait | the same column, breathing, at frame scale |
| landscape | two columns — the mark left, the words right, on one axis |
| wall | the same two columns at hall scale, with the recent strip given room |

A single centred column on a 1920 leaves two thirds of the glass unused and
makes the number smaller than the room needs, which is why the wide boards are
two columns.

**The display cannot scroll, on any board.** The wide canvas is a fixed
two-column page and the narrow one is a single unscrollable card, so anything
that does not fit is clipped rather than reachable. There are **no `-end`
frames in this batch** and the absence is the point: a frame *is* the whole
screen.

## Correction to the brief: nine states, but not those nine

The brief listed: *zero, ordinary progress, near goal, reached/open,
closed/reached, closed unfinished, stale, unavailable, unauthorized/refused.*

**"Unavailable" and "unauthorized/refused" are one state, not two.** The route
renders the same two sentences — byte-identical to the kiosk's and the
station's — for an unknown goal, a goal this viewer may not see, and a goal
whose display permission was revoked mid-poll. Splitting them into two screens
would make the display an oracle for which goals exist.

**Two states the brief omitted are real and separate surfaces:** `loading`, and
`unreachable` (a transient failure **before anything was ever confirmed** —
nothing to keep on screen and nothing to invent). `unreachable` is not `stale`:
stale has a confirmed number and says it is old; unreachable never had one.

So: ten states, and the six progress phases are the route's own
(`progressPhase`), not a set invented for this batch —
`openAtZero · building · nearGoal · reachedOpen · closedReached · closedUnreached`.

## The headlines are the route's own, and there are only three

| Phase | Headline |
| --- | --- |
| openAtZero | See what WE can do. |
| reachedOpen | WE did it. |
| closedReached | Look what WE did. |

Every other phase has none and the target invents none. A screen with a slogan
on it at every moment is a screen nobody reads by the third day.

The **together line** (`6,420 push-ups completed together.`) is built only when
the goal has closed, and is suppressed on `closedReached` where the headline
already says it. Two celebrations of one fact is one too many.

**Closed short is stated, not softened.** `Closed at 64%` is the route's own
sentence. What follows it is the together line, which is the true and generous
thing to say about six thousand push-ups nobody had to do.

## What this batch refuses

**The recent strip carries an amount and an age, and nothing else.**
`wsfGoalRecentAdditions` publishes `{amount, unit, at}` with uid and name
stripped server-side. So no name, no photo, no ordinal, and in particular **no
count of how many people those lines represent** — five lines may be five
people or one, and a display implying otherwise would be inventing a crowd.

**An empty recent list renders nothing at all.** No empty heading, no "no
activity yet" placeholder standing in for an answer this screen does not have.
`TARGET-zero-*` shows this.

**A stale screen keeps its number and says it is old.** Across a room, a total
that vanishes when a poll fails reads as a total that went away. The confirmed
values and their receipt time stay exactly as they were; the screen stops
presenting itself as current, with the pill beside the receipt time rather than
over the number.

**No predicted total, no ranking, no comparison, no individual identity.**

## Defects found and fixed during this pass

`of 10,000 push-ups` was drawn inline after the figure and **broke mid-word**
on the wide boards — "push-" on one line with "ups" orphaned below. A
hyphenated unit at hall scale in a column sized for a number will always find a
width where that happens, so the denominator now has its own line with
`numberOfLines={1}` and `adjustsFontSizeToFit`. The 1920 and 1280 boards were
also under-scaled on the first pass and left the glass half empty; both tiers
were raised.

## Why these frames are captured at scale 1

Every other batch captures at device scale 2, because a phone frame is small on
a reviewer's monitor. These are already room-scale canvases: a 1920×1080 board
at scale 2 is a 3840×2160 PNG per state, forty of which is a repository nobody
wants to clone. 1:1 is the board's own resolution and what it will actually be
driven at. The whole batch is 3.7 MB.

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-display-boards-capture.spec.ts
```
