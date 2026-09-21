# Atlas Batch B — the invitation, and what a Champion starts

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing in this package has been
built. No route in it changed. These are destination targets for four routes
that had none, drawn in real React Native against the real kit and captured
from the gated preview route `/design-target/join-setup`.

| | |
| --- | --- |
| Routes | 4 |
| States | 30 |
| Phone classes | 3 — 390×844, 390×640, 430×932 |
| Frames | 129 target frames + 1 contact sheet |
| Source | `apps/westayfit/src/ui/designTarget/JoinSetupTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/join-setup.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-join-setup-capture.spec.ts` |

Start with `CONTACT-SHEET-batch-b.png` — all thirty states at 390×844,
grouped by destination. Then the individual frames.

## The four destinations

| | Route | States | What it is |
| --- | --- | --- | --- |
| **B1** | `/join/[joinCode]` | 10 | The invitation someone opens from a link |
| **B2** | `/start-community` | 7 | Starting a community |
| **B3** | `/goals/new` | 8 | Opening a goal for that community |
| **B4** | `/combined/[setupId]` | 5 | Watching a combined goal, read-only |

## Frame names

```
CONTACT-SHEET-batch-b.png
TARGET-<state>-<class>.png            the screen on arrival
TARGET-<state>-<class>-end.png        the same screen scrolled to its end
```

An `-end` frame exists only where the screen actually overflows the phone —
39 of the 90. It is the same element at the same size with a different scroll
offset; nothing is stretched and no layout is faked. Arrival is what a design
has to get right first, but three of these destinations are genuinely longer
than a phone, and a review that only ever saw the top of the goal form would
be reviewing a third of it.

## Corrections to the batch brief, with the primary source for each

The Batch B brief listed states that do not exist on these routes, and omitted
states that do. Each correction below is from the route file, not from memory.

**`/join/[joinCode]` has no profile-required gate.** The signed-out invitation
routes to `/signup`; the profile step is its own route with its own Batch A
target. This batch does not redraw it.

**There is no "joined!" screen and no "community created!" screen.** A
successful join does `router.replace(destination)` and a successful create does
`router.replace('/community/<id>')`. The success *is* Community Home, which is
Page 1 and already accepted. A celebration screen between them would be a
surface the router never renders.

**"Private/refused" is not a separate state from "invalid".** The server
returns the same `functions/not-found` for an unknown code and for a group that
is not link-joinable, deliberately, so the page cannot become an oracle for
which communities exist. Drawing a distinct "this community is private" screen
would undo that at the last inch. One state, one wording —
`TARGET-join-not-valid-*`.

**Two states the brief omitted and the route has:** rate-limited
(`functions/resource-exhausted`, its own screen with its own wording), and the
event-path device question. The device pair lives on the join route, so it is
drawn here and is **excluded from Batch D** rather than counted twice.

**`/goals/new` has no movement catalog, and no one-vs-many selection.** A goal
is a title, a whole number and a unit the Champion types
(`FIELD_ORDER = title, target, unit, starts, ends, timezone`). Nothing in that
route picks an activity from a list. See the open decision below.

**`/goals/new` has no review step.** The summary is a live card on the same
page, recomputed as the fields change. The target keeps it a card — step 4 of
one page — rather than promoting it to a screen the route does not have.

**`/start-community` is one page, not a flow.** Three decisions and a name,
with a summary line above the button. That line is the whole review a
three-field form earns.

**`/combined/[setupId]` is not a setup wizard.** It is a read-only live view
that polls `wsfCombinedGoalPulse` every two seconds and renders no control a
Champion can operate. `setupId` names a stored combined-goal setup; it is not a
flow in progress. So there is no setup progress, no success, and no recovery
beyond "Check again". Its real states are live, reached-and-closed, last-
confirmed, connection-interrupted, and nothing-to-show.

## What this batch refuses, and why

**No member count, no goal list, no progress on the invitation.**
`wsfPreviewCommunity` returns `{ displayName, groupType, joinPolicy }` and
nothing else. A visitor who has not joined is not entitled to the community's
numbers, so the invitation may not show "14 members" or "3 goals open" — it
would be an invention, and an invention that leaks.

**One fillable instrument in the whole batch, on B4 only.** Batch A refused the
Living WE everywhere because none of its screens owns a progress value. B4 does:
`wsfCombinedGoalPulse` returns a confirmed `combinedTotal` against a `target`,
so the fill is a report. It appears nowhere else in the batch, because nowhere
else in the batch is there a confirmed number to report.

**No unit on the counted-toward line.** Units are never summed across goals,
and the activities show why: push-ups and movements cannot be added. A combined
goal is the one place the product does add across activities, and it may
because every activity enters as `countsAs: 'repetition'`. So the combined
total carries the combined goal's own unit, each activity keeps its own on its
own line, and the line bridging them names no unit at all. That is the shipped
behaviour — the route prints `<n> counted toward <title>` with no unit in it.

**No streak, no ranking, no names, no faces, no contributor counts** anywhere
in the batch, for the reason every other page has none: no callable returns
them.

**Nothing to show here** on B4 is one state for three causes — unknown setup,
a setup this viewer may not see, and one whose permission was revoked
mid-watch. The wording is shared from `src/kioskSession.ts` rather than written
again, so the combined screen, the kiosk and the public display cannot drift
into distinguishable refusals.

## One open decision for the owner

`review/page-02-move/` holds a **unit-shortcut proposal** for `/goals/new`: a
row of tiles built from the seven units the product has counting guidance for
(`ACTIVITY_GUIDES`), with the free-text field beside them. B3 here draws the
route as it exists — free text only.

The two targets disagree, and neither is wrong: B3 is the destination target
for the route today, and the move-flow tiles are a proposal to add shortcuts to
it. They compose — the tiles would sit above the Unit field in B3's step 1 —
but that is a product decision, not a drawing decision, so this package does
not quietly adopt it. **Which one ships is yours to say.**

## Device coverage

390×844, 390×640 and 430×932. Batch A drew only the first two; 430×932 is in
the atlas device list and every batch from here on carries it, so the widest
phone stops being a size we assume works.

The three larger classes — 800×1280 tablet portrait, 1280×800 tablet landscape
and 1920×1080 collective display — are Batches E and F and are **not** covered
here. No route in Batch B is served to any of them.

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-join-setup-capture.spec.ts
```

The capture spec is opt-in for the same reason every capture spec here is: it
asserts nothing about the product, and run in the ordinary suite it would
rewrite accepted evidence on every verification pass.

The preview route renders only when the build carries
`EXPO_PUBLIC_WSF_USE_EMULATORS`, which `scripts/westayfit/build-staging.sh`
refuses. No deployed artifact can serve it.
