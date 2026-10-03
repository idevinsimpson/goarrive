# Atlas Batch C — the challenge, and the door

**TARGET / CONCEPT — NOT IMPLEMENTED.** Nothing here has been built. No route
changed. These are destination targets drawn in real React Native against the
real kit and captured from the gated preview route
`/design-target/challenge-home`.

| | |
| --- | --- |
| Routes | 2 |
| States | 17 |
| Phone classes | 3 — 390×844, 390×640, 430×932 |
| Frames | 66 target frames + 1 contact sheet |
| Source | `apps/westayfit/src/ui/designTarget/ChallengeHomeTargets.tsx` |
| Preview route | `apps/westayfit/app/design-target/challenge-home.tsx` |
| Capture | `apps/westayfit/tests-e2e/design-target-challenge-home-capture.spec.ts` |

| | Route | States | What it is |
| --- | --- | --- | --- |
| **C1** | `/community/[groupId]/challenge` | 10 | The challenge a room full of people is looking at |
| **C2** | `/` | 7 | The home resolver — the door everything else opens from |

## Why these two share a batch

They are the two ends of the same minute. `/` is where the app opens and, for
almost everyone almost always, is a screen nobody sees — it resolves and
replaces. The challenge is the opposite: it is what a hundred people are
holding while an emcee says "everyone do this now". One has to disappear well;
the other has to hold a room. Drawing them together is what keeps the first
from being decorated and the second from being quiet.

## The one place this product counts people

`18 members moving` is not a liberty taken here. `wsfListChallenge` returns
`totals.participantCount` as a server-side aggregate and the route prints
`${participantCount} members moving`. It is a count of memberships that checked
in — never a list, never a name, never an order. The server file says so
directly: *"no leaderboard, no body data"*, *"no member identity under any
pulse input"*.

So the rule this product actually holds is not "never count people". It is
**never invent a number, and never turn a count into a comparison**. A count
the server computed, shown without names and without rank, is the honest form
of "you are not doing this alone" — which is the entire reason a room full of
people looks up at a screen.

The community cards on `/` carry a member count for the same reason:
`memberCountLabel(item.memberCount)` renders what `wsfMyCommunities` returned.

## Corrections to the batch brief

**There is no completed-challenge screen, and the route cannot render one.**
`wsfListChallenge` queries `status == 'active'` and returns `challenge: null`
for anything else. The route renders that as "No active challenge". So a
finished challenge and a community that never had one are the same screen —
which is why its copy may not say "not yet": for half the people who see it, it
already happened. A "challenge complete!" retrospective would be a surface the
query makes unreachable.

**"Reached" is a state of the number, not of the screen.** A challenge whose
`completedCount` passes its `goalTarget` is still `active` and still accepting
check-ins. The target marks it in the hero and changes nothing else — every
move stays tappable. Locking them at the target would refuse a member who did
the thing, for the crime of arriving after the number moved.

**No fill without a target.** `goalTarget` is nullable and admin-set. When it
is null the route prints the count with no "of N", so the instrument is absent
too rather than drawn full or drawn empty. A bar with no denominator is a
picture of a ratio nobody chose. See `TARGET-challenge-open-ended-*`.

## Member lifecycle: the states that have no screen, by design

The brief asked for "missing member lifecycle states". Read against the
callables, most of them have no member-facing surface and should not get one:

| Lifecycle event | What a member sees | Where |
| --- | --- | --- |
| Leaving | Confirm → leaving → done, plus the only-Champion refusal | `/community/[groupId]` — **Page 1, already implemented and accepted** |
| Last Champion tries to leave | `failed-precondition`: *"You are this community's only Champion. Designate another Champion before you leave."* | Same page, same control |
| **Removed**, then opens an invite link | The ordinary "This link is not valid" — **byte-identical to an unknown code** | Batch B, `TARGET-join-not-valid-*` |
| **Departed**, then opens a valid link | Nothing special: the membership is reactivated and they land on Community Home | No screen exists or should |
| Already an active member, opens the link | Nothing special: `alreadyMember: true` and the route replaces through | No screen exists or should |

`wsfJoinCommunity` is explicit about the removed case: *"a general link never
reactivates a removed membership… the response is the same notFound() an
unknown code gets, so it discloses nothing about the community's current state,
its name, or even that this person was once a member."* A "you were removed"
screen would undo exactly that. And *"voluntarily departed — not banned"*, so
there is no welcome-back surface either; leaving is not a thing to be forgiven.

**So Batch C adds no lifecycle frames, and that is the finding, not an
omission.** The one lifecycle surface that exists is on an accepted page and
this batch does not redraw it.

## The move-card state strip

`TARGET-challenge-move-states-*` is a reference frame, not a screen the product
renders: all six states of a move card in one column so the set can be reviewed
as a set. The brief asked for state strips rather than a hundred and forty
isolated screens, and this is what that means for the one component on this
page with real states.

| State | Button | Why |
| --- | --- | --- |
| Fresh | "I did this", green | The obvious tap |
| Needs a code | off | The server refuses an empty code; a refusal after a tap is worse than a button that waits |
| Code entered | live | |
| Counting | "Counting…", card does not move | One round trip; nothing reflows |
| Counted | "Already counted", settles into the card | Not hidden — a card that vanishes reads as a card that failed |
| Refused | reason under the button, button still live | Check-in is idempotent by deterministic document id, so retrying is safe and the target does not warn against it |

## `/` is drawn only in the states where the resolve did not happen

Home replaces into the member's community the moment the real list lands, and
`resolveCurrentCommunity` returns `null` rather than picking the first of
several — so no row in `TARGET-home-choose-*` is marked current. Nobody has
chosen. Every frame in C2 is a case the redirect does not cover: signed out, no
membership, several with none chosen, still loading, or failed. A rich
dashboard on `/` would be a screen designed for a case the router removes.

`TARGET-home-opening-*` is the frame that should barely exist. It is drawn
anyway, because on a slow connection it does, and because what it must never do
is look like a destination — nothing to start reading and then have pulled away.

`TARGET-home-my-error-*` keeps both working controls exactly where they were: a
failed list read must not also take away the ways in.

`TARGET-home-code-rejected-*` is shape, not existence. That message fires
before anything is sent — the text does not match `JOIN_CODE_SHAPE`, so it
cannot be a code. It deliberately does not say whether any community has it;
that question is answered, identically for every cause, on the invitation
screen itself.

## Frame names

```
CONTACT-SHEET-batch-c.png
TARGET-<state>-<class>.png            the screen on arrival
TARGET-<state>-<class>-end.png        the same screen scrolled to its end
```

An `-end` frame exists only where the screen actually overflows the phone —
15 of the 51.

## Device coverage

390×844, 390×640, 430×932. The three larger classes — 800×1280, 1280×800 and
1920×1080 — are Batches E and F. Neither route in Batch C is served to any of
them.

## Regenerating

```
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
WSF_CAPTURE_FRAMES=1 WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- tests-e2e/design-target-challenge-home-capture.spec.ts
```
