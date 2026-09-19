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
| `queue-call-by-name/` | **the turn, end to end, on both surfaces at once** — see below | `tests-e2e/queue-call-by-name.spec.ts` |

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


## `queue-call-by-name/` — the turn, on both screens at the same moment

Added in a second round, after the turn contract and the shared follow-along
player landed. Thirteen files, each pair captured at the same instant so the
hall screen and the phone in somebody's hand can be read against each other
rather than one at a time.

**The phone is captured at 390x844 and the station at 1280x720.** That is worth
saying because it was wrong: the member's browser context was the default
1280-wide desktop, so every "phone" capture in the first round was taken at a
width no phone has. Two copy defects were invisible until it was fixed.

| file | the moment |
|---|---|
| `00-phone-waiting`, `00-station-waiting` | in the line, nobody called. The phone leads with the POSITION — "You're next." — not with "You're in the line" |
| `01-station-assigned`, `02-phone-assigned` | called: the chosen name and a short duplicate-safe code, on both |
| `03-phone-lease-running` | the 45 seconds, on screen rather than only in a live region |
| `03b-station-ready`, `03c-phone-ready` | they have said they are coming; the station's one control is now live |
| `04-station-active-player`, `05-phone-active-player` | **the same player, on both surfaces.** Navy on cream on the phone, green on navy in the hall, one component and one session |
| `06-station-round-running` | the round, mid count-in |
| `07-station-result`, `08-phone-receipt` | the ten anonymous seconds in the hall; the private receipt on the phone |
| `09-station-cleared` | the screen afterwards: no name, no number, nobody |

While a turn is running the hall drops its attract content — the goal's
progress and the two attendee join codes — and the movement takes the room.
The venue canvas is a fixed height that does not scroll, and the first attempt
at this printed text over other text and pushed the count box off the bottom
edge. Both come back the instant the turn ends (`09-station-cleared`).

Produced in a run where the whole browser battery — **185 tests — passed with
zero failures**, on the commit this file is committed in.

Still missing, and not claimed: 360 and 430 widths, the short-height phone, and
the combined multi-activity journey. Those are required before visual
acceptance and are not in this set.
