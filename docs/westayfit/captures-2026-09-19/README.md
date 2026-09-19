# Rendered captures, 19 September 2026

These are the actual PNGs, committed so they can be downloaded and looked at
rather than described. They were asked for because a claim about a screenshot
is not evidence of one.

Every file here was produced by a Playwright spec running against the Firebase
emulators, at the commit named below. **Nothing in any spec asserts on an
image**: a capture is evidence, never a reason a test passes.

Produced at `3ca7f9e1aec75d650af069e44cb1bb49c2a91c6c`, in a run where the
whole browser battery — all 46 specs, 184 tests — passed with zero failures.

| folder | what it shows | spec |
|---|---|---|
| `move-follow-along/` | the reworked player: ready, count in, round, finished, receipt, the station panel, the unreadable-goal state | `tests-e2e/move-follow-along.spec.ts` |
| `station-enrollment/` | the station pairing state, the enrolled venue screen with its QR panel, the Champion's screens card, the refusal state | `tests-e2e/station-enrollment.spec.ts` |
| `ui-device-choice/` | the safety question, the standing shared answer, the signed-out event signpost | `tests-e2e/ui-device-choice.spec.ts` |
| `ui-combined-goal/` | the Manage sheet after the creative pass, both halves of the Set up kiosk card | `tests-e2e/ui-combined-goal.spec.ts` |
| `ui-event-activity-choice/` | the activity step and the phone-or-queue choice | `tests-e2e/ui-event-activity-choice.spec.ts` |

Widths are 360, 390 and 430, plus a short 390x640 for content that only fits
on a tall phone, plus 1280x720 where a screen is a venue display and 390px is
not how anyone will meet it.

## Two things these captures found that reading the code did not

`station-enrollment/phone-390x640-enrolled.png` is the *fixed* version. Before
it, the station screen at that size drew the wordmark, the station label, the
total, the Call next button and the caption **on top of one another** — flex
children shrinking below their content inside a fixed surface with nowhere to
overflow. The venue surface is unchanged and still deliberately fixed; the
narrow one now scrolls.

`ui-combined-goal/phone-390-set-up-kiosk.png` is the Manage sheet after the
creative pass: it opens on the choice rather than below its own answers, and
each goal card has exactly one green action.

## What these do NOT show

No capture here is of the deployed channel. They are emulator renders of the
unstaged head. Staging serves `bd4bfec`, which is an older build.
