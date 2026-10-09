# Atlas Batch D — the event and the line, on somebody's own phone

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing here has been built. No route
changed. Captured from the gated preview route `/design-target/event-queue`.

| | |
| --- | --- |
| Routes | 2 |
| States | 24 |
| Phone classes | 3 — 390×844, 390×640, 430×932 |
| Frames | 92 target frames + 1 contact sheet |
| Source | `apps/westayfit/src/ui/designTarget/EventQueueTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/event-queue.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-event-queue-capture.spec.ts` |

| | Route | States | What it is |
| --- | --- | --- | --- |
| **D1** | `/event/[goalId]` | 11 | Standing in the room, deciding |
| **D2** | `/queue/[goalId]` | 13 | Waiting, being called, finishing |

## Why this is a different design problem

The person holding this phone is standing up, half listening to someone at the
front, in a room with other people, and will look at the screen for two seconds
at a time. So three rules hold across the batch:

- **The one fact that matters is the biggest thing on screen, and it changes.**
  The place in line → the name being called → the seconds left → the number
  recorded. Nothing else competes for that slot at any moment.
- **Nothing reflows under a thumb.** Panels swap; the page does not rearrange
  around someone walking to a station.
- **Every state says what is true of *them*.** "3rd in line" is a fact about a
  person. "Polling" is not.

## The privacy design is the product here, and it is drawn

A queue puts someone's name on a screen in a room full of strangers. Every
refusal below is already in the route; the target's job is to make it legible
rather than quietly correct.

**The name is chosen by the person it is about, before anything is sent.** The
name panel is the feature's one real decision, not a formality. It says where
the name goes ("the screen in the room, where everybody can read it") and what
to pick ("whatever you are happy for strangers to see"). Initials are one tap
and not buried — `TARGET-event-name-panel-*`.

### A product finding: one clause of that promise is not kept

The shipped line ends *"…and it goes when your place does."* **That is not
true of storage**, and the target does not repeat it.

Leaving the line is `tx.update({status: 'left', leftAt: serverTimestamp()})`.
**Nothing deletes a `wsfTurnEntries` document anywhere in
`functions-westayfit/src/index.ts`, and there is no TTL policy on the
collection**, so `calledName` remains in Firestore after the turn ends. The
type's own comment — *"stored here and nowhere else in this system, and gone
when this entry is"* — is accurate about *where*, and conditional on a
deletion that never happens.

What **is** provable, and what the frames now say:

| Claim | Status |
| --- | --- |
| Lives in exactly one field of one document | ✅ `wsfTurnEntries/{entryId}.calledName` |
| Never joins the profile | ✅ nothing writes it to `wsfMemberProfiles` |
| Stops being shown the moment the turn ends | ✅ the station re-reads the entry on its next poll |
| Is deleted when you leave | ❌ **no delete, no TTL** |

So the target reads *"…it stops being shown the moment your turn ends"* — the
two clauses that hold, plus what actually happens, instead of a retention
promise the storage layer does not back. A privacy promise a drawing cannot
back is worse than a smaller one it can.

**This is a finding about shipped copy, not a change I made.** `/event/[goalId]`
is untouched. Resolving it is either a copy change (say what is true) or a
retention change (make it true) — a product decision, and neither is in this
batch's scope.

**Opening a control is not joining a line.** *"Opening either one puts nobody
in a line. You are in the line only once you confirm the name the screen will
call."* Both ways on are drawn as openers; the only control that writes is
inside the name panel.

**A scan decides nothing.** An activity arriving from a QR is offered as an
option like any other and is never pre-selected. It carries the shipped
sentence saying the scan is only how they got here.

**No join code on the not-member screen, and no control that asks for one.**
Who may be admitted is the community's decision, made on a Champion's own
surfaces. Standing next to a screen is not an admission.

**The receipt is their own part, said to be theirs.** *"Your own part, counted
once."* The shared total is **not** restated on the queue screens, where it
would be read as the same figure.

## The device question is drawn twice, on purpose

Batch B drew the **join** route's device pair, which carries `signupAhead` and
therefore promises an account is about to be made. This batch draws the
**event** route's pair, which does not: the person here may already be signed
in, and the question is only about the device. Same component, different
promise, so both are shown rather than one standing in for the other.

(The Batch B README says the device pair is "excluded from Batch D". That is
corrected here: what Batch B drew is the join route's variant, and the event
route's own variant is this batch's. Neither is a duplicate of the other.)

## Two states that are the same news by different routes

`TARGET-queue-recorded-*` is the ten-second receipt — the tap that just worked.
`TARGET-queue-receipt-*` is the recoverable one: what is still here when that
tap never came back, which is the whole reason it exists. They say so in
different words rather than one borrowing the other's:

| | Eyebrow | Scope line |
| --- | --- | --- |
| Fresh | Recorded | Your own part, counted once. Thank you. |
| Recoverable | Your last turn here | Your own part, counted once — whatever happened to the page that recorded it. |

Under both, "You're not in the line" drops to a quiet strip. It is the least
interesting true thing on the screen, and it used to be the headline while the
number people came back for sat in a card below it.

## Timing out is not a telling-off

`TARGET-queue-timed-out-*` leads with the recovery, not the miss: the screen
moved on **so nobody waits on an empty spot**, and getting back in line is one
tap. The shipped sentence already ends on that.

## The urgent state, and why it is green

`TARGET-queue-called-*` is the only screen in the product under a visible
clock. The field carries a green edge and a green lease pill rather than
turning red: this is a good thing happening, quickly. Red would tell somebody
walking towards a station that they are in trouble.

## Frame names

```
CONTACT-SHEET-batch-d.png
TARGET-<state>-<class>.png            the screen on arrival
TARGET-<state>-<class>-end.png        the same screen scrolled to its end
```

An `-end` frame exists only where the screen overflows the phone — 20 of the 72.

## Device coverage and what is NOT here

390×844, 390×640, 430×932. **This batch is the personal-phone half of the event
only.** The screens in the room — kiosk (800×1280 portrait) and station
(1280×800 landscape) — are Batch E, and the public display is Batch F. Nothing
here is drawn at a tablet size, because neither of these routes is served to
one.

`/move/[goalId]` — the follow-along player on its own route — is still
uncovered. The player *component* appears inside `TARGET-queue-active-*`
because the queue hosts it, but its standalone route has its own states and is
not claimed by this batch.

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-event-queue-capture.spec.ts
```
