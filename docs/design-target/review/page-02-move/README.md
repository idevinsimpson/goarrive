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
| `TARGET-contribute-390x844.png` | Target, the contribution. |
| `TARGET-contribute-390x640.png` | Target, the contribution on a short phone — where `Record` is at risk. |
| `TARGET-confirmed-390x844.png` | Target, the confirmed moment. |
| `TARGET-confirmed-390x640.png` | Target, confirmed on a short phone. |

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
