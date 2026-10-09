# Page 2 — the contribution route on a short phone (W5-M1)

Real screenshots of the running product. **Nothing here is drawn**, nothing is a
target, and no frame carries a concept banner. `before/` is the product at
`claude/wsf-app-shell` `e609c57`; `after/` is the same fixture, viewport and
state on the fix branch. Both sets are shot by the same spec,
`apps/westayfit/tests-e2e/ui-contribute-short-phone.spec.ts`, which runs in the
ordinary suite as a regression test and writes frames only when asked
(`WSF_CAPTURE_FRAMES=1`, and `WSF_SHORT_PHONE_SET=before` for the frozen set).

## What was wrong

W5's independent QA (PR #395, `sprint-w5-qa-report.md`, finding W5-M1): on
/move at 390×664 the secondary control "Skip timer and enter squats" rendered,
passed `toBeVisible`, and handed a tap at its own centre to the shell's raised
MOVE circle. At 390×640 the same control peeked from under the circle. At
390×844 it was clear.

Measured cause, not assumed: the app shell lays the tab bar out **after** the
screen in one column, so the screen's scroll view ends exactly at the bar's top
edge at every height (564 at 640, 588 at 664, 768 at 844). The raised action
rises 24px above that edge — into the scroll view — at every scroll position.
The route's end-of-content padding (88px "bar footprint" + 16) cleared the bar
only once the member had scrolled to the very end; it did nothing for the first
screenful, which is where the member arrives, and it reserved room for a bar
body that never overlaps the screen at all.

One correction to the finding: "the screen does not scroll" was read from the
document element, which never scrolls here. The screen's own scroll view
scrolls (850px of content in a 564px viewport at 640). The occlusion was real
either way.

## What changed

The scroll view now stops above the raised action while the shell bar is
rendered (`marginBottom: MEMBER_TAB_MOVE_OVERHANG` on the scroll view, inside a
wrapper painted in the screen's own tone so the receipt stays navy to the
bar's edge). The band the circle covers is never scrollable content, at rest or
after any scroll. The content keeps its ordinary 48px end padding; the phantom
88px reservation is gone. No shared shell file changed.

## The frames

| Frame | before (`e609c57`) | after (fix) |
| --- | --- | --- |
| MOVE step at rest, 390×640 | `before/contribute-move-390x640.png` — "Skip timer" peeks from under the circle | `after/contribute-move-390x640.png` — the scroll view ends at the circle's top; "Skip timer" is below the fold, not under the circle |
| MOVE step at rest, 390×664 | `before/contribute-move-390x664.png` — the label is fully visible; its centre hits MOVE | `after/contribute-move-390x664.png` |
| MOVE step at rest, 390×844 | `before/contribute-move-390x844.png` (already clear; the allocation still ran under the circle) | `after/contribute-move-390x844.png` |
| Amount entry, 390×640 | `before/contribute-entry-390x640.png` | `after/contribute-entry-390x640.png` |
| Review, 390×640 | — | `after/contribute-review-390x640.png` |
| Confirmed, 390×640 | — | `after/contribute-confirmed-390x640.png` |
| Unknown outcome, 390×640 | — | `after/contribute-pending-390x640.png` |
| Definitive refusal, 390×640 | — | `after/contribute-refused-390x640.png` |

The BEFORE run is the failing run: the spec's first assertion (the scroll view's
bottom edge is at or above the circle's top) fails at every height on
`e609c57`, so only the frames shot before that assertion exist for the old
build. That is why the state rows have no BEFORE.

What the spec asserts, on every run, at 390×640, 390×664 and 390×844:

1. the scroll view's bottom edge is at or above the raised action's top edge;
2. the primary action is completely clear on arrival (the accepted Page 2 rule);
3. walking the scroll view through its whole range in 8px steps, a tap at the
   centre of each control never resolves to the shell (`elementFromPoint`);
4. "I'm done" and "Skip timer" each take a real, un-forced tap and reach the
   entry step;
5. entry, review, confirmed, unknown and refused pass 1–3 over every interactive
   control the screen owns (390×640 and 390×664);
6. `/move/[goalId]` renders no tab bar and does not scroll sideways.

Status: **SELF-CHECKED · independent review pending** (W5). The accepted
`../after/` frames are untouched; `AFTER-contribute-move-390x640.png` there
still shows the pre-fix band and is re-shot only when a review asks.
