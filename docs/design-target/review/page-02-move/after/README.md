# Page 2 — ACTUAL IMPLEMENTATION AFTER

Real screenshots of the running product with `/move` and `/contribute/[goalId]`
implemented against the reviewed target. **Nothing here is drawn**, and no
frame carries a concept banner — that is what makes these AFTERs rather than
targets.

| State | 390×844 | 390×640 | 430×932 |
| --- | --- | --- | --- |
| MOVE, several goals open | `AFTER-move-choose-390x844.png` | `AFTER-move-choose-390x640.png` | `AFTER-move-choose-430x932.png` |
| MOVE, nothing running | `AFTER-move-nogoal-390x844.png` | `AFTER-move-nogoal-390x640.png` | `AFTER-move-nogoal-430x932.png` |
| Ready to move | `AFTER-contribute-move-390x844.png` | `AFTER-contribute-move-390x640.png` | `AFTER-contribute-move-430x932.png` |
| Amount entry | `AFTER-contribute-entry-390x844.png` | `AFTER-contribute-entry-390x640.png` | `AFTER-contribute-entry-430x932.png` |
| Review | `AFTER-contribute-review-390x844.png` | `AFTER-contribute-review-390x640.png` | `AFTER-contribute-review-430x932.png` |
| Confirmed | `AFTER-contribute-confirmed-390x844.png` | `AFTER-contribute-confirmed-390x640.png` | `AFTER-contribute-confirmed-430x932.png` |

## Where the AFTER differs from the TARGET, and why

Three differences, each declared rather than hidden.

**1 · MOVE entry is a screen, not a sheet over the dimmed Home.** The target
draws a sheet rising over Home. Doing that truthfully needs a
transparent-modal presentation so the real Home stays mounted underneath — a
router and shell change outside this slice — and a sheet floating above a tab
bar that is still visible would be incoherent. The implementation composes the
same content in the same language: a navy field carrying the question and the
community, then the open goals on cream, each with a track at the ratio the
Living WE fills by. The sheet remains an approved idea with a router change
owing.

**2 · There is no movement chooser on the contribution.** The target drew a
pair of "Counted in" tiles. A goal on this route has exactly **one** configured
unit — there is no activity list here and nothing to choose between — so the
screen names what the contribution counts toward and moves on. Drawing a
chooser would have taught the member a control the product does not offer. The
several-activity case belongs to the combined goal, a different route and not
in this slice.

**3 · The unknown outcome carries no goal anchor.** The target put the anchor
on every screen in the family including this one. That was wrong: the anchor
paints the shared total, and on an unknown outcome the product deliberately
withholds it — the member's effort may or may not be inside it, and the poll is
switched off for the whole unknown period on purpose. `ui-contribute-torture-2`
asserts the absence and caught the regression.

## What the implementation adds beyond the target

- **The `/move` no-goal state exists now.** MOVE used to redirect silently to
  the community, which is a truthful destination but makes the one action in
  the chrome look like a button that did nothing. It says why, and offers the
  way on.
- **`ButtonLink` takes an `accessibilityLabel`.** Three rows each carrying a
  button that reads "Move" is clear beside its own title and three identical
  announcements to somebody who cannot see which row it is in.
- **The primary action is the ACTION green.** It was the confirmed-progress
  green, which is the colour that means "effort that is confirmed" rather than
  "a thing you press" — the separation the kit exists to keep.

## Not captured here

The **unknown outcome** and the **definitive refusal** need fault injection to
reach (a held-open write, a refused callable). They are exercised and asserted
by `ui-contribute.spec.ts` and `ui-contribute-torture-2.spec.ts` rather than
re-shot here, and both pass at this head.

## Two truth defects the implementation found

**A false zero on every chooser row.** `/move` printed
`totalOfTargetLabel(g.sharedTotal ?? 0, …)`, and `wsfListGoals` returns
`sharedTotal` **only under `includeHistory`**. The resolver asked without it,
so every row said "0 of 5,000 squats" for a goal that actually stood at 1,847.
The request now asks for what it is going to show — an existing flag on an
existing callable, no new backend behaviour — and the fallback no longer
invents a number: a row with no total given says what the goal is FOR
(`Target 5,000 squats`) rather than where it stands.

**A fixed-size decoration at 195px.** The anchor's glow was a 260px circle
inside a card with `overflow: hidden`. A clipped child still REPORTS its full
box, so `ui-a11y` R1 and `ui-qa` saw an element past the right edge — and they
were right to, because they cannot know the paint is clipped. Home's top light
learned this first. Both glows are now bound `left: 0, right: 0`, so the
decoration can never be wider than what contains it at any width. The anchor
also stacks to a column below 260px, and the mark is sized from the width
actually available rather than fixed at 88px.
