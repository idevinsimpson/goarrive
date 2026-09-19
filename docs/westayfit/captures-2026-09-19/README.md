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

Twenty-four files. Each pair is captured at the same instant, so the hall
screen and the phone in somebody's hand can be read against each other rather
than one at a time.

**The first version of this set was not trustworthy, and that is worth saying
here rather than quietly fixing.** Three of its thirteen files were
byte-identical to another file in the same set: the "lease running" shot was
the assigned shot, the "receipt" shot was the active-player shot, and the
"cleared" shot was the result shot. Each had been taken BEFORE the state it was
named for had arrived, so the file recorded the previous state under the new
state's name. That is evidence quietly claiming something untrue, which is
worse than no evidence.

Two things changed. Every capture now happens AFTER an assertion that proves
the state is on the screen; and `shot()` hashes each image and **fails the test**
if two captures are byte-identical. A duplicate is now a red test, not a file
nobody compared.

That guard immediately found a fourth problem: `assigned` and `lease running`
were never two states. The 45 seconds are part of being called, not a moment
that follows it. So there is one file, `02-phone-assigned-with-lease`, named for
what it actually shows.

**Phone at 390x844, station at 1280x720**, plus 360, 430 and a short 390x640 for
the four phone states. The member's browser context used to be the default
1280-wide desktop, so every "phone" capture before this round was taken at a
width no phone has.

| file | the moment |
|---|---|
| `00-phone-waiting`, `00-station-waiting` | in the line. The phone leads with the POSITION — "You're next." |
| `01-station-assigned` | called, in the hall: the chosen name and a short duplicate-safe code |
| `02-phone-assigned-with-lease` | called, on the phone, with the 45 seconds visible on screen |
| `03b-station-ready`, `03c-phone-ready` | they have said they are coming; the station's one control is live |
| `04-station-active-player`, `05-phone-active-player` | **the same player on both surfaces.** Navy on cream on the phone, green on navy in the hall |
| `06-station-round-running` | the round, mid count-in |
| `07-station-result` | the ten anonymous seconds — **beside a total that already agrees with it** |
| `08-phone-receipt` | the private receipt, on the phone that earned it |
| `09-station-cleared` | after the ten seconds: nobody called, nobody waiting, the total standing |

Suffixed files (`-360`, `-430`, `-short-390x640`) are the same state at the
other phone sizes. The short one is the one that finds what a tall viewport
hides: a control below the fold is a control nobody uses.

### What the composition does during a turn

The hall drops its attract content — the goal's progress and the "already a
member" code — and gives the movement the room. **One public join code stays up
in a reserved right rail**, because somebody who walks up mid-round still needs
a way in; it is the same public URL the attract screen prints and carries no
station credential. The movement and the turn's controls stand side by side,
because stacked they were a narrow strip down the middle with the width unused
either side, and still too tall for a canvas that does not scroll. Everything
comes back the instant the turn ends (`07`, `09`).

On the phone the figure and the clock also stand side by side, which is what
brings **Start above the fold** in the first 844px — it used to sit under a very
tall illustration.

`07-station-result` answers a specific objection: a screen reading "30 squats
recorded" beside "0 of 5,000" tells a room two different things. It now reads
**30 of 5,000, 0.6% complete**, because the pulse cache is dropped the moment a
contribution commits.

Produced in a run where the affected cycle passed with zero failures, on the
commit this file is committed in.

Still missing, and not claimed: the combined multi-activity journey end to end.
