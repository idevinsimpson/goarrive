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
| Unknown outcome | `AFTER-contribute-pending-390x844.png` | — | — |
| Definitive refusal | `AFTER-contribute-refused-390x844.png` | — | — |

## The evidence is deterministic, and says so honestly

**One isolated fixture per device class.** The first cut seeded once and ran
the flow three times against the same goal, so 390×844 showed `0 → 20`,
390×640 showed `20 → 40`, and the shared total drifted with them. Three frames
of three different states cannot be read as three sizes of one screen. Each
class now gets its own community and goal: all three start at **1,847** and end
at **1,867**, and the only difference between the frames is the thing under
review.

**Every frame is captured from the top, and the capture proves it.**
`window.scrollTo(0, 0)` was not enough — the scroll that moves when the amount
field is filled belongs to the React Native `ScrollView`'s own element, not the
window, so the short phone was captured mid-page while this file claimed
otherwise. The helper now resets every scrollable element and then **asserts
that no scroll offset remains** before the shutter. An earlier attempt asserted
that the wordmark sat above y=24; it sits at y=27 when the page *is* at the
top, because of the container's padding and the chrome row's own centring. A
threshold picked by eye tests the threshold, not the thing.

**Both forced outcomes are the real ones.** The unknown outcome drops the
callable's response; the refusal closes the goal between Record and the
server's read, so the refusal comes from the real `wsfContribute`, not a mock.
The first refusal frame came back `notMember` rather than `closed`, because the
shared `firestoreWrite` helper PATCHes with no `updateMask` and therefore
**replaces** the document — the goal lost its `communityGroupId`. That frame was
a real refusal of the wrong kind, which is worse than no frame: it would have
been filed as evidence of a state it does not show. The capture now sends a
masked PATCH.

## Where the AFTER differs from the TARGET

**MOVE entry is a screen, not a sheet over the dimmed Home.** Doing the sheet
truthfully needs a transparent-modal presentation so the real Home stays
mounted underneath — a router and shell change outside this slice — and a sheet
floating above a tab bar that is still visible would be incoherent. The
implementation composes the same content in the same language.

**There is no movement chooser on the contribution.** A goal on this route has
exactly **one** configured unit, so the screen names what the contribution
counts toward and moves on. Drawing a chooser would teach the member a control
the product does not offer. The several-activity case belongs to the combined
goal — a different route, and an **explicit remaining gap**: this single-unit
slice does not complete the multi-movement member experience.

**The unknown outcome carries no goal anchor.** The anchor paints the shared
total, and on an unknown outcome the product deliberately withholds it — the
member's effort may or may not be inside it, and the poll is switched off for
the whole unknown period on purpose. `ui-contribute-torture-2` asserts the
absence and caught the regression.

## What the implementation adds beyond the target

- **The confirmed receipt owns the screen.** It was a navy card on a cream
  page, visually close to the BEFORE. The whole page is navy now, opening on
  the exact amount recorded (`+20`, the server's own `addedCount`), then the
  Living WE and the authoritative shared result. On a 390×640 the rhythm gives
  — the mark shrinks and the air between things goes — so the way onward stays
  visible; the moment itself does not shrink away.
- **The `/move` no-goal state exists.** MOVE used to redirect silently to the
  community, which made the one action in the chrome look like a button that
  did nothing.
- **`ButtonLink` takes an `accessibilityLabel`.** Three rows each carrying a
  button that reads "Move" is clear beside its own title and three identical
  announcements to somebody who cannot see which row it is in.
- **The primary action is the ACTION green**, not the confirmed-progress green
  — the separation the kit exists to keep.

## Two truth defects the implementation found

**A false zero on every chooser row.** `/move` printed
`totalOfTargetLabel(g.sharedTotal ?? 0, …)`, and `wsfListGoals` returns
`sharedTotal` **only under `includeHistory`**. The resolver asked without it, so
every row said "0 of 5,000 squats" for a goal that actually stood at 1,847. The
request now asks for what it is going to show — an existing flag on an existing
callable, no new backend behaviour — and the fallback no longer invents a
number: a row with no total given says what the goal is FOR.

**A fixed-size decoration at 195px.** The anchor's glow was a 260px circle
inside a card with `overflow: hidden`. A clipped child still REPORTS its full
box, so `ui-a11y` R1 and `ui-qa` saw an element past the right edge — and they
were right to, because they cannot know the paint is clipped. Home's top light
learned this first. Both glows are now bound `left: 0, right: 0`; the anchor
stacks to a column below 260px, and its mark is sized from the width actually
available.
