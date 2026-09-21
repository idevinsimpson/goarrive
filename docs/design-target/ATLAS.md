# The Visual North Star Atlas

**Every user-facing route in `apps/westayfit/app` has a destination target.**
Every number below is generated from the frames on disk — `npm run
check:route-index` fails if any of them drifts.

<!-- BEGIN GENERATED SUMMARY -->

| | |
| --- | ---: |
| User-facing routes | **23** |
| Routes with a target | **23** |
| Routes with no target | **0** |
| States drawn | **167** |
| Frames on disk | **544** |
| Packages | **13** |

<!-- END GENERATED SUMMARY -->

> **A route count is not proof of completion**, and this file does not ask to
> be read as one. A route with one frame and a route with thirty both count as
> "covered". `ATLAS-COVERAGE.md` is the answer to that: every state by name,
> the device classes it is drawn at, and whether it has an end-of-scroll
> companion — all generated from the PNGs on disk.
>
> **Target existence is not visual acceptance.** Nothing here is approved.

```
npm run wsf:route-coverage          # the report
npm run check:route-index           # fails if ROUTE-TARGET-INDEX.md has drifted
```

> **REVIEWED AND ACCEPTED AS TARGET REFERENCE — NOT IMPLEMENTED.**
> On 2026-09-21 the atlas content and product direction were accepted, which
> clears the atlas-first gate. **Accepted does not mean built.** Every batch
> here is still a drawing: no route in them changed and nothing in them was
> implemented. The two states stay separate and must not be collapsed — a
> target that is *reviewed* is not a route that *exists*. Pages 1–4 are
> separate: those are implemented against accepted targets, and the atlas does
> not redraw them.

## Where everything is

| Batch | What | Route(s) | States | Frames | Package |
| --- | --- | --- | --- | --- | --- |
| **A** | Identity and onboarding | `/signin` `/signup` `/verify-email` `/reset-password` `/profile-setup` | 17 | 64 | `review/batch-a-identity/` |
| **B** | The invitation, and what a Champion starts | `/join/[joinCode]` `/start-community` `/goals/new` `/combined/[setupId]` | 30 | 130 | `review/batch-b-join-and-setup/` |
| **C** | The challenge, and the door | `/community/[groupId]/challenge` `/` | 17 | 67 | `review/batch-c-challenge-and-door/` |
| **D** | The event and the line, on your own phone | `/event/[goalId]` `/queue/[goalId]` | 24 | 93 | `review/batch-d-event-and-line/` |
| **E** | The screens in the room | `/kiosk/[goalId]` `/contribute/[goalId]?kiosk=1` `/station/[goalId]` | 28 | 29 | `review/batch-e-room-screens/` |
| **F** | The public display | `/display/[goalId]` | 10 × 4 boards | 41 | `review/batch-f-public-display/` |
| **G** | The follow-along | `/move/[goalId]` | 7 × 2 layouts | 16 | `review/batch-g-follow-along/` |

Plus one board that is not any single route's destination:

| Board | What | Package |
| --- | --- | --- |
| **FLOW** | The physical product, end to end — two stations, entry, the turn, the count, the reset, and the collective display beside it. Every step marked BUILT / PROOF NEEDED / TARGET ONLY / SEAM. | `review/physical-flow/` |

Plus the five page packages, which are **accepted work**, not atlas drawings:

| Page | Route | State | Package |
| --- | --- | --- | --- |
| 1 | `/community/[groupId]` (this is Home) | implemented, accepted | `review/page-01-home/` |
| 2 | `/move` `/contribute/[goalId]` | implemented, accepted | `review/page-02-move/` |
| 3 | `/community` | implemented, accepted | `review/page-03-community/` |
| 4 | `/activity` | implemented (Phase A), accepted | `review/page-04-progress/` |
| 5 | `/you` | **target only — not implemented** | `review/page-05-you/` |

Every batch package opens
with its own contact sheet or matrix; start there.

## Start here, in this order

1. `review/batch-b-join-and-setup/CONTACT-SHEET-batch-b.png`
2. `review/batch-c-challenge-and-door/CONTACT-SHEET-batch-c.png`
3. `review/batch-d-event-and-line/CONTACT-SHEET-batch-d.png`
4. `review/batch-e-room-screens/CONTACT-SHEET-batch-e.png`
5. `review/batch-f-public-display/MATRIX-batch-f.png`
6. `review/batch-g-follow-along/CONTACT-SHEET-batch-g.png`

Each package's `README.md` says what it refuses and why, with the callable or
route file that settles it.

## Device coverage

| Class | Where it is drawn |
| --- | --- |
| 390×844 | Batches A, B, C, D, F, G; pages 1–5 |
| 390×640 | Batches A, B, C, D |
| 430×932 | Batches A, B, C, D |
| 800×1280 | Batch E (kiosk, kiosk contribution), Batch F |
| 1280×800 | Batch E (station), Batch F, Batch G |
| 1920×1080 | Batch F |

**430×932 is now drawn everywhere a phone surface is.** Batch A originally had
only the two narrower phones — the atlas's last open device gap — and it was
reopened and recaptured at all three.

Each screen is drawn at the classes **this design targets for it**, not at all
six. These are target device classes, not hardware anyone has bought or
installed — nothing here asserts what is standing in a room. A kiosk surface is
targeted portrait and a station surface landscape because that is the intended
orientation of each; drawing either at the other's aspect would be designing
for a shape this product is not aiming at.

## Where a frame does not show the whole screen

Screens that scroll get a second frame, `TARGET-<state>-<class>-end.png`, taken
at the end of the scroll: same element, same size, different offset. Arrival is
what a design has to get right first, but a review that only ever saw the top
of the goal form would be reviewing a third of it.

**Batches E and F have no `-end` frames, and the absence is the point.** A
kiosk, a station and a public display are fixed canvases with no scroll — if
one overflowed there would be content nobody in the room could ever reach, so a
frame *is* the whole screen. `/move/[goalId]` is the opposite case and it
caught a real defect: the route is a `ScrollView` at **both** widths, and a
fixed-canvas target clipped its own panel off a 390 phone and called it a
layout.

## Where the brief and the product disagreed

Every batch was drawn from the route file and the callable, not from the brief.
Where they disagreed, the code won and the package records it. The substantive
ones:

| Brief said | The product says | Where |
| --- | --- | --- |
| The invitation has a profile-required gate | It routes to `/signup`; the profile step is its own route and Batch A's target | B |
| "Joined" and "community created" success screens | Both `router.replace` into Community Home — Page 1, already accepted | B |
| "Private/refused" is its own state | Same `not-found` as an unknown code, **and** as a removed member. Three causes, one state, so the page cannot become an oracle | B |
| `/goals/new` has a movement catalog with one-vs-many selection | A goal is a title, a whole number and a unit the Champion types. No catalog exists on that route | B |
| `/combined/[setupId]` is a setup flow with progress and success | Read-only live view, polling every 2s, with no control a Champion can operate | B |
| Challenge has a reached/completed screen | `wsfListChallenge` queries `status == 'active'`; a finished challenge and one that never existed are the same screen | C |
| "Missing member lifecycle states" | Most have no member-facing surface and should not: a removed member gets the ordinary not-valid screen, a departed one is simply rejoined | C |
| Kiosk chooses a movement, shows a QR, runs a contribution | It is a display with one button. The QRs are the station's; the contribution is `?kiosk=1`, a separate target | E |
| Display has "unavailable" and "unauthorized/refused" | One state. Two the brief omitted — `loading` and `unreachable` — are real and separate | F |

## The rules this atlas held to, across every batch

- **Nothing is drawn that a callable does not return.** No member count on the
  invitation, no goal list, no progress — `wsfPreviewCommunity` returns a name,
  a type and a policy.
- **A count of people is allowed only where the server computed one**, without
  names and without rank: `totals.participantCount` on the challenge,
  `memberCount` on a community card. The rule is not "never count people", it
  is *never invent a number and never turn a count into a comparison*.
- **One fillable instrument, and only where there is a confirmed ratio.** The
  real `LivingWeProgress`, never a rectangle standing in for it, and absent
  entirely where `goalTarget` is null — a bar with no denominator is a picture
  of a ratio nobody chose.
- **No streak, no ranking, no comparison, no health or body data, no location,
  no coaching upsell, no forced sharing.**
- **No name, face, quote or reaction anywhere** — no callable returns them.
- **Units are never summed across goals.** The one place the product adds
  across activities is a combined goal, via `countsAs: 'repetition'`, and the
  line that bridges them names no unit at all.
- **No working QR and no real enrolment code is committed as evidence.** Every
  frame draws the *place* a code goes. A real one in a repository is a live
  link into somebody's community.
- **A refusal never becomes an oracle.** Kiosk, station, display and combined
  share byte-identical refusal copy, and the join route collapses three causes
  into one screen.

## How the frames are generated

Every batch has a gated preview route under `app/design-target/` that renders
only when the build carries `EXPO_PUBLIC_WSF_USE_EMULATORS` — which
`scripts/westayfit/build-staging.sh` refuses, so no deployed artifact can serve
one. Every frame carries `TARGET / CONCEPT — NOT IMPLEMENTED` on a strip
**inside** the captured element, and the strip's height is added to the frame
so the device area beneath it is exactly the class the filename names.

Capture specs are **opt-in** (`WSF_CAPTURE_FRAMES=1`). They assert nothing
about the product; run in the ordinary suite they would rewrite accepted
evidence on every verification pass. `npm run check:evidence` fails if a frozen
BEFORE or an accepted frame has changed by a byte.

## What is NOT in the atlas, and is not missing

- **Champion administration** — removing a member, reinstating one, managing
  screens, rotating an invite link. These are callables with no member-facing
  route today, so there is no screen to draw.
- **Private dated personal history and streak-style consistency.** Not
  reachable by any client: `wsfContributions` and `wsfGoalMemberTotals` are
  returned by no callable and `firestore.rules` denies them. Documented as a
  seam in `review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md`, not drawn.
- **`/design-target/*` and `/health`** — preview routes and an operational
  endpoint, excluded from the route count by the generator.

## One open decision for the owner

`review/page-02-move/` holds a **unit-shortcut proposal** for `/goals/new`:
tiles built from the seven units the product has counting guidance for
(`ACTIVITY_GUIDES`), with the free-text field beside them. Batch B draws the
route as it exists — free text only.

Neither is wrong. B3 is the destination target for the route today; the tiles
are a proposal to add shortcuts to it. They compose — the tiles would sit above
the Unit field in B3's step 1 — but which ships is a product decision, so the
atlas does not quietly adopt it.

A second, smaller one: `review/page-03-community/` removed a Join control on a
premise that turned out to be false (a typed join code **is** accepted, on `/`).
That package records the correction; whether `/community` should carry a Join
control is live again and is the owner's call.

## Corrections made after the first completion claim

The first version of this page said "complete" while Batch A still carried four
recorded debts and only two phone classes. A batch with known defects cannot be
counted toward a complete atlas. Reopened and fixed:

- **Batch A's four owed corrections are closed** — the 8-character rule stated
  where it is enforced, all five verify send outcomes drawn, reset's two real
  outcomes drawn, consent drawn **unchecked** with the shipped sentence and the
  primary disabled, and the pending destination shown surviving all three gates
  it actually survives. A fifth gap nobody had recorded — the **kiosk** return,
  the third destination kind `nextRouteAfterAuth` resolves — is drawn too.
- **A privacy promise that is not kept.** The queue name panel's shipped copy
  ends *"it goes when your place does."* Nothing deletes a `wsfTurnEntries`
  document and there is no TTL, so it does not. The target now claims only the
  provable scope; the shipped copy is recorded as a product finding.
- **The owner-board README's drift.** It flattened two greens into one, letting
  a value sampled off a JPEG stand in for the brand's `PROGRESS_GREEN`
  (`#91CB7D`) — `#22C55E` is `ACTION_GREEN`. Its "take it as drawn" line let an
  unlisted board element override newer decisions. Its streak substitute named
  a capability the product cannot reach.
- **The index's own prose had rotted underneath its generated tables**, still
  claiming "Batches B–F are not started" while six of them shipped. The batch,
  device and state tables are generated now too.

## Next

**Stop here for visual review.** Page 5 (`/you`) remains target only, and no
further page implementation begins until the atlas is accepted.
