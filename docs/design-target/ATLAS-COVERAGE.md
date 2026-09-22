# Atlas coverage — every state, and the frames that back it

**Generated.** `node scripts/westayfit/route-target-coverage.mjs --write`.
Read from the PNGs on disk. Do not hand-edit.

A route count cannot prove atlas completion: a route with one frame and a
route with thirty both count as "covered". This file is the answer to that
— every state by name, the device classes it is drawn at, and whether it
carries an end-of-scroll companion.

`end` means the state overflows its frame and a second frame was captured
scrolled to the bottom. Batches E and F have none by design: a kiosk, a
station and a public display are fixed canvases with no scroll.

## Batch A — Identity and onboarding

`review/batch-a-identity/` · `/signin` `/signup` `/verify-email` `/reset-password` `/profile-setup` · implemented · **awaiting visual/functional review**

Contact sheet / other: `CONTACT-SHEET-batch-a.png`

Evidence: `before/` 24 frozen · `after/` 42

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `error` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `profile` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `profile-carrying` | 390x640 · 390x844 · 430x932 |  | 3 |
| `reset` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `reset-sent` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `reset-unconfigured` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `return-event` | 390x640 · 390x844 · 430x932 |  | 3 |
| `return-join` | 390x640 · 390x844 · 430x932 |  | 3 |
| `return-kiosk` | 390x640 · 390x844 · 430x932 |  | 3 |
| `signin` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `signup` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `verify` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `verify-already` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `verify-carrying` | 390x640 · 390x844 · 430x932 |  | 3 |
| `verify-failed` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `verify-sending` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `verify-unconfigured` | 390x640 · 390x844 · 430x932 | yes | 4 |

## Batch B — The invitation, and what a Champion starts

`review/batch-b-join-and-setup/` · `/join/[joinCode]` `/start-community` `/goals/new` `/combined/[setupId]` · **reviewed & accepted** as target reference · `/join/[joinCode]` implemented · the other three NOT implemented

Contact sheet / other: `CONTACT-SHEET-batch-b.png`

Evidence: `before/` 30 frozen · `after/` 30

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `combined-closed` | 390x640 · 390x844 · 430x932 |  | 3 |
| `combined-live` | 390x640 · 390x844 · 430x932 |  | 3 |
| `combined-nothing` | 390x640 · 390x844 · 430x932 |  | 3 |
| `combined-setup-failed` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `combined-setup-ready` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `combined-setup-short` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `combined-setup-working` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `combined-stale` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `combined-unreachable` | 390x640 · 390x844 · 430x932 |  | 3 |
| `goal-custom-window` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `goal-errors` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `goal-failed` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `goal-form` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `goal-live` | 390x640 · 390x844 · 430x932 |  | 3 |
| `goal-no-community` | 390x640 · 390x844 · 430x932 |  | 3 |
| `goal-unavailable` | 390x640 · 390x844 · 430x932 |  | 3 |
| `goal-working` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `join-device-choice` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `join-device-shared` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `join-failed` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `join-invite-in` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `join-invite-out` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `join-load-failed` | 390x640 · 390x844 · 430x932 |  | 3 |
| `join-loading` | 390x640 · 390x844 · 430x932 |  | 3 |
| `join-not-valid` | 390x640 · 390x844 · 430x932 |  | 3 |
| `join-too-many` | 390x640 · 390x844 · 430x932 |  | 3 |
| `join-working` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `start-failed` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `start-form` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `start-form-other` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `start-name-missing` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `start-signin` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `start-verify` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `start-working` | 390x640 · 390x844 · 430x932 | yes | 6 |

## Batch C — The challenge, and the door

`review/batch-c-challenge-and-door/` · `/community/[groupId]/challenge` `/` · **reviewed & accepted** as target reference · NOT implemented

Contact sheet / other: `CONTACT-SHEET-batch-c.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `challenge-all-counted` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `challenge-error` | 390x640 · 390x844 · 430x932 |  | 3 |
| `challenge-live` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `challenge-loading` | 390x640 · 390x844 · 430x932 |  | 3 |
| `challenge-move-states` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `challenge-none` | 390x640 · 390x844 · 430x932 |  | 3 |
| `challenge-not-member` | 390x640 · 390x844 · 430x932 |  | 3 |
| `challenge-open-ended` | 390x640 · 390x844 · 430x932 |  | 3 |
| `challenge-reached` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `challenge-signed-out` | 390x640 · 390x844 · 430x932 |  | 3 |
| `home-choose` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `home-code-rejected` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `home-empty` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `home-my-error` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `home-my-loading` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `home-opening` | 390x640 · 390x844 · 430x932 |  | 3 |
| `home-signed-out` | 390x640 · 390x844 · 430x932 |  | 3 |

## Batch D — The event and the line, on your own phone

`review/batch-d-event-and-line/` · `/event/[goalId]` `/queue/[goalId]` · **reviewed & accepted** as target reference · NOT implemented

Contact sheet / other: `CONTACT-SHEET-batch-d.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `event-choose-activity` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `event-chosen` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `event-device-choice` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `event-device-shared` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `event-error` | 390x640 · 390x844 · 430x932 |  | 3 |
| `event-joining` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `event-name-panel` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `event-no-activities` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `event-not-member` | 390x640 · 390x844 · 430x932 |  | 3 |
| `event-queue-error` | 390x640 · 390x844 · 430x932 | yes | 6 |
| `event-signed-out` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `queue-active` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `queue-called` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-error` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-loading` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-not-in-line` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-ready` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-receipt` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-record-error` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `queue-recorded` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-signed-out` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-telling` | 390x640 · 390x844 · 430x932 |  | 3 |
| `queue-timed-out` | 390x640 · 390x844 · 430x932 | yes | 4 |
| `queue-waiting` | 390x640 · 390x844 · 430x932 |  | 3 |

## Batch E — The screens in the room

`review/batch-e-room-screens/` · `/kiosk/[goalId]` `/contribute/[goalId]?kiosk=1` `/station/[goalId]` · **reviewed & accepted** as target reference · NOT implemented

Contact sheet / other: `CONTACT-SHEET-batch-e.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `kiosk-closed` | 800x1280 |  | 1 |
| `kiosk-confirmed` | 800x1280 |  | 1 |
| `kiosk-entry` | 800x1280 |  | 1 |
| `kiosk-finish-error` | 800x1280 |  | 1 |
| `kiosk-finishing` | 800x1280 |  | 1 |
| `kiosk-live` | 800x1280 |  | 1 |
| `kiosk-loading` | 800x1280 |  | 1 |
| `kiosk-not-available` | 800x1280 |  | 1 |
| `kiosk-refused` | 800x1280 |  | 1 |
| `kiosk-signin` | 800x1280 |  | 1 |
| `kiosk-stale` | 800x1280 |  | 1 |
| `kiosk-unreachable` | 800x1280 |  | 1 |
| `kiosk-unresolved` | 800x1280 |  | 1 |
| `station-attract` | 1280x800 |  | 1 |
| `station-called` | 1280x800 |  | 1 |
| `station-cleared` | 1280x800 |  | 1 |
| `station-loading` | 1280x800 |  | 1 |
| `station-not-available` | 1280x800 |  | 1 |
| `station-pairing-claiming` | 1280x800 |  | 1 |
| `station-pairing-expired` | 1280x800 |  | 1 |
| `station-pairing-failed` | 1280x800 |  | 1 |
| `station-pairing-requesting` | 1280x800 |  | 1 |
| `station-pairing-waiting` | 1280x800 |  | 1 |
| `station-queue-error` | 1280x800 |  | 1 |
| `station-recorded` | 1280x800 |  | 1 |
| `station-running` | 1280x800 |  | 1 |
| `station-stale` | 1280x800 |  | 1 |
| `station-unreachable` | 1280x800 |  | 1 |

## Batch F — The public display

`review/batch-f-public-display/` · `/display/[goalId]` · **reviewed & accepted** as target reference · NOT implemented

Contact sheet / other: `MATRIX-batch-f.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `building` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `closed-reached` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `closed-unreached` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `loading` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `near` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `not-available` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `reached-open` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `stale` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `unreachable` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |
| `zero` | 1280x800 · 1920x1080 · 390x844 · 800x1280 |  | 4 |

## Batch G — The follow-along

`review/batch-g-follow-along/` · `/move/[goalId]` · **reviewed & accepted** as target reference · NOT implemented

Contact sheet / other: `CONTACT-SHEET-batch-g.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `countdown` | 1280x800 · 390x844 |  | 2 |
| `finished` | 1280x800 · 390x844 |  | 2 |
| `loading` | 1280x800 · 390x844 |  | 2 |
| `paused` | 1280x800 · 390x844 |  | 2 |
| `ready` | 1280x800 · 390x844 | yes | 3 |
| `round` | 1280x800 · 390x844 |  | 2 |
| `unavailable` | 1280x800 · 390x844 |  | 2 |

## Board — The physical product, end to end

`review/physical-flow/` · `(no single route — the whole journey)` · **reviewed & accepted** as target reference · NOT implemented

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `physical-flow` | 1920x1080 |  | 1 |

## Page 1 — Home

`review/page-01-home/` · `/community/[groupId]` · implemented, **accepted**

Contact sheet / other: `AFTER-home-390x640.png`, `AFTER-home-390x844.png`, `AFTER-home-430x932.png`, `BEFORE-home-390x640.png`, `BEFORE-home-390x844.png`, `BEFORE-home-430x932.png`

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `home` | 390x640 · 390x844 · 430x932 |  | 3 |

## Page 2 — MOVE and contribution

`review/page-02-move/` · `/move` `/contribute/[goalId]` · implemented, **accepted**

Evidence: `before/` 12 frozen · `after/` 20

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `closed` | 390x640 · 390x844 |  | 2 |
| `confirmed` | 390x640 · 390x844 |  | 2 |
| `confirmed-posttarget` | 390x844 |  | 1 |
| `confirmed-reached` | 390x640 · 390x844 |  | 2 |
| `contribute` | 390x640 · 390x844 |  | 2 |
| `move-choose` | 390x640 · 390x844 |  | 2 |
| `move-nogoal` | 390x844 |  | 1 |
| `pending` | 390x640 · 390x844 |  | 2 |
| `picker-many` | 390x844 |  | 1 |
| `picker-one` | 390x844 |  | 1 |
| `refused` | 390x844 |  | 1 |
| `review` | 390x640 · 390x844 |  | 2 |

## Page 3 — Community

`review/page-03-community/` · `/community` · implemented, **accepted**

Contact sheet / other: `PROPOSAL-detail-active-390x640.png`, `PROPOSAL-detail-active-390x844.png`, `PROPOSAL-detail-active-430x932.png`, `PROPOSAL-detail-failed-390x844.png`, `PROPOSAL-detail-history-390x640.png`, `PROPOSAL-detail-history-390x844.png`, `PROPOSAL-detail-history-430x932.png`, `PROPOSAL-detail-loading-390x844.png`, `PROPOSAL-detail-nogoal-390x640.png`, `PROPOSAL-detail-nogoal-390x844.png`, `PROPOSAL-detail-nogoal-430x932.png`, `PROPOSAL-detail-switch-390x844.png`

Evidence: `before/` 9 frozen · `after/` 15

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `list-failed` | 390x844 |  | 1 |
| `list-loading` | 390x844 |  | 1 |
| `list-none` | 390x640 · 390x844 |  | 2 |
| `list-one` | 390x640 · 390x844 |  | 2 |
| `list-several` | 390x640 · 390x844 · 430x932 |  | 3 |
| `list-severalnocurrent` | 390x640 · 390x844 |  | 2 |

## Page 4 — Progress

`review/page-04-progress/` · `/activity` · implemented (Phase A), **accepted**

Evidence: `before/` 8 frozen · `after/` 9

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `failed` | 390x844 |  | 1 |
| `loading` | 390x844 |  | 1 |
| `none` | 390x640 · 390x844 · 430x932 |  | 3 |
| `rows` | 390x640 · 390x844 · 430x932 |  | 3 |
| `runningonly` | 390x844 |  | 1 |

## Page 5 — You

`review/page-05-you/` · `/you` · implemented · **awaiting Before → After acceptance**

Evidence: `before/` 6 frozen · `after/` 18

| State | Classes | end | Files |
| --- | --- | :---: | ---: |
| `failed` | 390x640 · 390x844 · 430x932 |  | 3 |
| `loading` | 390x640 · 390x844 · 430x932 |  | 3 |
| `member` | 390x640 · 390x844 · 430x932 |  | 3 |
| `nocommunity` | 390x640 · 390x844 · 430x932 |  | 3 |
| `signedout` | 390x640 · 390x844 · 430x932 |  | 3 |

## Device → frames

| Class | Frames | Packages |
| --- | ---: | --- |
| 1280x800 | 32 | E · F · G |
| 1920x1080 | 11 | F · FLOW |
| 390x640 | 167 | A · B · C · D · P1 · P2 · P3 · P4 · P5 |
| 390x844 | 160 | A · B · C · D · F · G · P1 · P2 · P3 · P4 · P5 |
| 430x932 | 122 | A · B · C · D · P1 · P3 · P4 · P5 |
| 800x1280 | 23 | E · F |
