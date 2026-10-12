# Atlas Batch E — the screens in the room

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing here has been built. No route
changed. Captured from the gated preview route `/design-target/room-screens`.

| | |
| --- | --- |
| Routes | 3 |
| States | 28 |
| Device classes | 2 — 800×1280 portrait, 1280×800 landscape |
| Frames | 28 target frames + 1 contact sheet |
| Source | `apps/westayfit/src/ui/designTarget/RoomScreenTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/room-screens.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-room-screens-capture.spec.ts` |

| | Route | Device | States |
| --- | --- | --- | --- |
| **E1** | `/kiosk/[goalId]` | 800×1280 portrait | 6 |
| **E2** | `/contribute/[goalId]?kiosk=1` | 800×1280 portrait | 7 |
| **E3** | `/station/[goalId]` | 1280×800 landscape | 15 |

Each screen is drawn at the **one device class this design targets for it**.
These are target classes, not installed hardware — nothing here asserts what is
standing in a room. A kiosk surface is targeted portrait and a station surface
landscape because that is each one's intended orientation; drawing either at
the other's aspect would be designing for a shape this product is not aiming
at.

## These are not big phones

- **Nothing scrolls.** A venue screen has no thumb. Everything that matters is
  on the canvas at once or it does not exist. This is why the station's running
  turn is two columns and not a column: stacked, its count box sat below the
  bottom edge of a canvas that cannot be scrolled to. There are **no `-end`
  frames in this batch**, and the absence is the point — if one of these
  overflowed there would be content nobody in the room could ever reach.
- **The type is sized for three metres.** The called name, the code and the
  total are the three things a room reads, and they are the three largest
  things on the canvas.
- **The background is navy edge to edge.** A cream page with a navy card is a
  document; these are signage, and the brand field *is* the screen.
- **There is no back.** No chrome link, no "back to home". A device bolted to a
  table has nowhere to go back to, and a control that navigates off the screen
  is how a kiosk ends up showing somebody's inbox.
- **The action sits low on the kiosk**, with air above it. That gap is
  deliberate: a person stands at a kiosk and reaches its lower half.

## Corrections to the batch brief

The brief listed nine kiosk states: *idle, choose movement, QR/sign-in,
contribution, confirmation, Finish/reset, clean next visitor, timeout,
offline/unavailable*. Read against the route:

**`/kiosk/[goalId]` is a display with one button.** It does not choose a
movement, does not show a QR, does not run a contribution and has no
confirmation, no reset and no timeout. Its only control does
`router.push('/contribute/<goalId>?kiosk=1')`.

**So "choose movement" does not exist at the kiosk at all** — a goal's unit is
fixed when the Champion opens it, and the kiosk shows one goal.

**"QR/sign-in" is two different things and only one is here.** The QR codes are
on the *station* (E3), which has two of them and labels them by what they do.
The kiosk's sign-in is the product's **ordinary** sign-in, drawn in E2. That is
a design constraint, not an implementation detail: a shared device asking for a
password in its own chrome is the shape of every credential harvest there has
ever been.

**Contribution, confirmation, Finish, clean-next-visitor and timeout are all
one route** — `/contribute/[goalId]?kiosk=1` — and they are E2. `/contribute`
is implemented and accepted, but it was accepted as a **phone** surface; its
kiosk mode at 800×1280 had no target and now does.

## What a shared screen may never do, and how the frames show it

**No name survives a turn.** Three frames exist to be compared, in this order:

| Frame | Name on screen? | What is on it |
| --- | --- | --- |
| `TARGET-station-called-1280x800` | **Yes**, largest thing on the canvas | Sam · H 4 K · "you're up" |
| `TARGET-station-recorded-1280x800` | **No** | `H 4 K · 30 push-ups recorded.` |
| `TARGET-station-cleared-1280x800` | **No** | "Nobody is being called." |

The moment a turn is recorded, every name on the screen is gone; ten seconds
later so is the code and the number. This is the brief's *"proof prior
participant identity is gone after clear"*, and it is checkable from the frames
rather than asserted in prose.

**The waiting are a number, not a list.** Not a list truncated to four either.
The room does not need to read anybody's name but the one person who is up.

**The kiosk witnesses nothing.** "Contribute here" — not "check in", not
"verify". What follows is the visitor's own sign-in and their own self-counted
entry, and the two captions claim nothing more.

**Finish signs out and returns the device**, clearing a settled draft and the
kiosk's own keys — but it does **not** erase an unresolved attempt.
`TARGET-kiosk-unresolved-800x1280` keeps its notice for that reason: the stored
record is the only thing that lets the person who made it replay the same
attempt id and get the original receipt instead of booking a second
contribution. Deleting it to make the kiosk look clean would destroy the one
artefact that keeps their effort reconcilable.

**An idle terminal screen finishes itself** after 90 seconds — long enough to
read a receipt twice, short enough that the next person does not find the
previous person's result waiting. "Stay" sits beside the countdown for someone
who is still reading.

**The refusal is byte-identical across kiosk, station and public display.**
Unknown goal, unauthorized goal and revoked permission are the same two
sentences on all three, so no room screen can become an oracle.

## No enrolment code and no working QR is in this evidence

The station's pairing frames draw the **shape** of a code with a fixed
placeholder (`••• •••`). Nothing in the source is a real enrolment code and the
capture spec never renders one.

The two QR blocks on the attract screen draw the **place** a QR goes, as a
plain square. A real code rendered into committed evidence is a working link
into somebody's community, sitting in a public repository.

## The Living WE is the real component

`LivingWeProgress` — the same one `/kiosk` and `/station` already render, with
`surface="dark"` as those routes pass, sized for the room. Its fill is
`completed / target`, both confirmed server values. A rectangle standing in for
it would have been the exact mistake this atlas keeps catching elsewhere: a
target showing the product's instrument as something simpler than it is.

## Device coverage

800×1280 and 1280×800 — the two classes the atlas asks for here, and the two
this design targets for these routes. 1920×1080 collective display is Batch F.

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-room-screens-capture.spec.ts
```
