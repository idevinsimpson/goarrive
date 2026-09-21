# Visual checkpoint — Page 2, the MOVE family

MOVE is the raised action in the middle of the member tab bar. It is not one
route, it is a short journey, and this checkpoint covers the whole of it:

| Step | Route today |
| --- | --- |
| MOVE entry — what am I moving toward? | `/move` (the resolver added in the shell slice) |
| The unified movement picker | inside goal creation, `/goal/new` |
| The contribution | `/contribute/[goalId]` |
| The confirmed moment | `/contribute/[goalId]` after a write |

## The frames

| File | What it is |
| --- | --- |
| `before/BEFORE-move-choose-390x844.png` | **ACTUAL CURRENT BEFORE.** The product as it renders now. Not a drawing. |
| `before/BEFORE-move-choose-390x640.png` | Baseline, short phone. |
| `before/BEFORE-contribute-move-390x{844,640}.png` | Baseline, the contribution reached from MOVE. |
| `before/BEFORE-contribute-entry-390x{844,640}.png` | Baseline, the contribution's amount entry. |
| `before/BEFORE-contribute-review-390x{844,640}.png` | Baseline, the review step. |
| `before/BEFORE-contribute-confirmed-390x{844,640}.png` | Baseline, the confirmed moment. |
| `before/BEFORE-goal-new-390x{844,640}.png` | Baseline, goal creation, where the movement picker lives. |
| `TARGET-move-choose-390x844.png` | **TARGET / CONCEPT — NOT IMPLEMENTED.** MOVE entry, several goals open. |
| `TARGET-move-choose-390x640.png` | Target, short phone — where the `Move` buttons are at risk. |
| `TARGET-move-nogoal-390x844.png` | Target, MOVE entry with nothing running. |
| `TARGET-picker-one-390x844.png` | Target, the picker with one movement chosen. |
| `TARGET-picker-many-390x844.png` | Target, the picker with several chosen. |
| `TARGET-contribute-390x844.png` | Target, the contribution entry. |
| `TARGET-contribute-390x640.png` | Target, entry on a short phone — where the primary action is at risk. |
| `TARGET-review-390x844.png` | Target, the review step, before anything is written. |
| `TARGET-review-390x640.png` | Target, review on a short phone. |
| `TARGET-confirmed-390x844.png` | Target, confirmed — `ordinary`. |
| `TARGET-confirmed-390x640.png` | Target, confirmed `ordinary`, short phone. |
| `TARGET-confirmed-reached-390x844.png` | Target, confirmed — `reached`, the goal met and still open. |
| `TARGET-confirmed-reached-390x640.png` | Target, `reached`, short phone. |
| `TARGET-confirmed-posttarget-390x844.png` | Target, confirmed — `postTarget`, the goal was already past its target. |
| `TARGET-pending-390x844.png` | Target, the outcome nobody knows yet. |
| `TARGET-pending-390x640.png` | Target, unknown outcome, short phone. |
| `TARGET-refused-390x844.png` | Target, the definitive refusal. |
| `TARGET-closed-390x844.png` | Target, arriving at a goal that has closed. |
| `TARGET-closed-390x640.png` | Target, closed goal, short phone. |

Every TARGET frame carries `TARGET / CONCEPT — NOT IMPLEMENTED` burnt into the
image itself, inside the frame, so the label travels with the picture. The
strip is added to the frame's height, so the device area under it is exactly
the device class the filename names. **None of these is an AFTER.** There is no
AFTER for page 2, because page 2 is not implemented.

## How they were made

Real React Native against the real kit — not HTML, not a drawing — rendered
through a preview route that only exists in an emulator build:

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_PLAYWRIGHT_CHROMIUM=... WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  ./node_modules/.bin/playwright test --config=playwright.config.ts \
  tests-e2e/design-target-before-capture.spec.ts tests-e2e/design-target-capture.spec.ts
```

`/design-target/move-flow` renders only when the build carries
`EXPO_PUBLIC_WSF_USE_EMULATORS`, and `scripts/westayfit/build-staging.sh`
refuses a build that sets it. No deployed artifact can serve this route.

## The second pass, and what the first one got wrong

The first package was refused. Four things changed:

**The contribution family now opens on a navy anchor.** Every screen in it —
entry, review, unknown, refusal — starts with the same panel: the community,
the goal, the Living WE at the **confirmed** total, and the shipped status
line. It is the community context the member is acting inside, so the number
they type is never a number in a form; it is the brand's mark doing work no
card can do; and it is real content at the top of the viewport, which is what
a tall phone needed instead of a spacer.

**The words are the product's.** Every headline, status line and refusal comes
from the shipped `resultCopy`, `refusalCopy`, `repeatNotice` and `statusLine`,
never from a sentence written for a picture. That is why the three confirmed
variants read differently: the target calls the same function the
implementation will.

**The dead space is gone, and not by shrinking a gap.** Each screen that had a
void now carries content that is true and useful there — the member's own part
previewed, what happens next on an unknown outcome, what is unchanged after a
refusal, what a closed goal leaves behind. Where the added content pushed the
primary action below the fold at 390×640, the short phone gives up the quick
chips and the tile pair, never the context, the number or the action.

**The picker got the same lift.** Its header is a navy setup anchor naming the
community whose goal is being made. It carries no Living WE, because the goal
being set up has no total yet and the mark belongs to screens that have a
number for it to fill.

## The design decisions in these frames, and why

**MOVE entry is a sheet, not a page.** MOVE is one tap in the middle of the tab
bar and what it opens is a short list. A full page for two rows leaves most of
a tall phone empty, and empty is the flat, website-like feeling the owner board
moves away from. The sheet is the size of the question it asks, and it is the
same size on every phone — nothing is inflated to fill a screen. The screen
behind it is the real page-1 Home target, dimmed, in the phase that matches the
sheet: the frame shows what a member actually sees at the moment they tap MOVE,
with one set of numbers across both.

**The goal rows carry the community's progress.** Each open goal shows its own
confirmed total and a track at that ratio, so choosing where to move is a
choice between two live communities of effort, not a menu.

**The tall phone's spare height goes into the content.** On a 390×844 the
amount, the stepper and the mark are larger than on a 390×640; the confirmed
receipt sits centred between the top of the screen and its actions. The primary
action stays anchored at the thumb on both.

**The preview is of the member's own part, and only that.** The owner board
previews the SHARED total a contribution would produce. It cannot — another
member may be writing in the same moment. What nobody else can change is this
member's own credit on this goal, so that is what is previewed: `120 → 140`,
with the community's confirmed total stated separately, as it is, above.

**The celebration is composition, not motion.** Scale, ground, glow and the
mark's own fill carry it. Nothing here has to be switched off for a member who
asked for reduced motion, and nothing computes a crossing: `crossed` — the one
sentence tying a member to the moment the target was met — is the server's to
grant, on a signal stored on the attempt, so the target does not draw it.

## What these targets refuse to take from the owner board

- **No predicted shared total.** The board's contribution screen promises the
  community total the member's update *would* produce. It cannot: another
  member may be writing in the same moment, and the only authority on the
  shared total is the receipt. The contribution shows the member's own amount
  and the total **as it is**; the new total appears on the confirmation, where
  it is confirmed.
- **No "combined", no parent/child, no setup or accounting language.** The
  picker is one catalog. One movement makes a goal of one movement; several
  make a goal of several. The member is never told how that is stored.
- **Selection is never colour alone.** Every selected tile carries a check mark
  and a heavier border as well as the tint, so the state survives greyscale and
  colour blindness.
- **No invented identity, no count of people, no health claim, no streak.**
  `23 members` on the dimmed Home behind is a count of MEMBERS, which the
  service knows, never a count of people who moved.

## What this checkpoint is asking for

Approval of the composition, hierarchy, density and emotional read of these
four screens — **before** any of the four routes is implemented against them.

## Correction, 2026-09-21 — three claims the target could not support

**"Your own movement is yours to keep… whether or not a goal was open."** Gone.
It promised a personal movement log this product does not have: WSF records
contributions **to goals**, inside their windows. The no-goal sheet now says
"Anything you already recorded toward past goals stays in Progress. New
contributions need an open goal," and the refusal says "Anything already
recorded toward this goal stays in Progress. This attempt was not added to it."

**"You can add or remove a movement later without starting the goal again."**
Gone, and not replaced. I looked for the behaviour before removing it:
`wsfAdjustGoal` corrects a **count**, and no callable in `functions-westayfit`
adds or removes a movement from a goal once it exists. A target that needs new
backend behaviour in order to be true is a target that lies.

**"Use a kiosk instead"** is off the ordinary contribution. Kiosk is event-mode
infrastructure, not a fallback the standard member flow should advertise. If an
event context genuinely offers it, it belongs in an event-specific state in
Batch D or E, not here.
