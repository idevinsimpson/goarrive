# Page 3 · Community — BEFORE, TARGET and AFTER

**`/community` is implemented and accepted** (2026-09-21, at `a8f2ecf`). The
gate ran in full: ACTUAL BEFORE → reviewed TARGET → ACTUAL AFTER → visual
acceptance.

`PROPOSAL-detail-*` is the one thing here that is **not** implemented and is
not to be: it is exploration of a per-community surface, and the IA decision
below ruled it out. Home is untouched.

## Read this first: Community is one route, not two

`/community/[groupId]` **is Home.** `app/index.tsx:377` does
`router.replace('/community/<groupId>')`, the shell's Home tab matches
`p === '/' || p.startsWith('/community/')`, and `page-01-home/README.md`
records the same thing: *"Route: `/community/[groupId]`, which is where `/`
lands a member who has a community."* It is Page 1 — already targeted,
already accepted, already implemented.

Community's own route is **`/community`, the list** — the only path the
Community tab matches (`match: p === '/community'`).

So this package splits in two, and the split is in the filenames, not only in
this README:

| Folder / prefix | What it is |
| --- | --- |
| `before/BEFORE-index-*` | **Community's real BEFORE.** `/community` as it renders today, captured at `dd608a8`. Frozen evidence. |
| `TARGET-list-*` | **Community's target.** The reviewed design for `/community`. |
| `context-home-route/BEFORE-detail-*` | `/community/[groupId]` as it renders today — i.e. **Page 1's accepted AFTER**, captured here only for context. *Not* Community's BEFORE. |
| `PROPOSAL-detail-*` | A **proposal that would change the accepted Page 1 Home surface.** Not a Community target, and not approved by anything. |

Filing a page's accepted AFTER as another page's BEFORE is precisely the
mislabelled evidence that destroyed the Page 2 comparison, so the two are kept
apart by name.

### The decision — made 2026-09-21

**Community remains `/community`: the membership, identity and switching
surface. Home remains `/community/[groupId]`: the current community's command
centre.** That keeps the five-tab IA honest — Home is *act in the current
community*, Community is *understand and switch who the WE is*.

So `PROPOSAL-detail-*` is **exploration only**. It is not to be implemented,
and the accepted Page 1 Home is not revised. The frames are kept, clearly
labelled, because the choice was made against pixels rather than prose.

## Correction pass — 2026-09-21

The first `TARGET-list-*` draft was the right base but did not clear the gate.
Six corrections, each with the reason it mattered:

1. **Added the "several memberships, none chosen yet" state.**
   `resolveCurrentCommunity()` returns **null** when several memberships exist
   and none is remembered — it does not fall back to the first. The first draft
   assumed a CURRENT always exists, so it would have marked a row CURRENT by
   convenience: a screen inventing a fact the product does not have. The state
   now asks explicitly, and every row carries a `Choose` cue.
2. **Removed the false "One goal at a time" claim.** The product supports
   several open goals — Page 1 and MOVE both render them, and `wsfListGoals`
   says so in its own comments. Replaced with "Count what you choose", which
   states the opposite plainly.
3. **Removed "YOU ARE THE WE".** The standing-slogan system was removed from
   Home on direction; this screen does not get to reintroduce one. The zero
   state leads with the heading `Join a community`.
4. **Replaced the naked underlined Join / Start links** with compact pill
   actions. The BEFORE critique was that the existing naked link reads like a
   website; ending the target with two more of them was the same defect in a
   new place.

   **Then superseded entirely.** There is no tappable Join **anywhere, on any
   state** — not a primary action in the zero state, not a pill beside Start
   on a populated one. `/join/[joinCode]` takes the code from the route and
   nothing in the product accepts a typed one, so every Join control would
   have gone nowhere. `Start a community` is the only creation action, and
   `community-list.spec.ts` asserts the absence of any Join link or button by
   role and name, in both the empty state and a populated one.
5. **Fixed the sparse compositions.** Join / Start now sit directly under the
   content instead of pinned to the bottom; loading skeletons the *real* final
   structure (current-community panel, then rows) beneath the stable app
   header; failure keeps the page's identity, and offers a retry plus real
   exits rather than a card stranded over blank cream. Tall phones spend their
   height on rhythm and on a fuller panel.
6. **Made row behaviour visible.** Tapping a row switches the current community
   and opens its Home. A `Pressable` with an accessibility label says that to a
   screen reader and to nobody else, so each row carries a `Switch` / `Choose`
   cue.

### A seam this pass found: Join has no screen

There is **no join-by-code route in the product**. `/join/[joinCode]` reads the
code from the route params, and nothing anywhere accepts a typed one — the only
way in is opening an invite link or QR someone sends. `/start-community` is the
only navigable join-adjacent screen.

So a prominent **Join** *button* in the zero state would be a control that goes
nowhere, which is the thing these frames refuse. Join leads that panel by
heading and by copy that states the real mechanism — an invite link or QR from
someone already in the community — and the only button is the one that works.

An earlier revision kept a `Join a community` pill on the states where a member
already has communities, reasoning it would become a real destination later.
That was still a control with no destination today, and it is gone.

**If Join should be a control here, it needs a join-code entry route** — new
product surface, not a drawing change. Flagged rather than faked.

**Recorded as a product seam:** manual join-code entry. Until that route
exists, this screen explains joining in words and offers no control for it,
and the AFTER capture asserts that no Join link or button is rendered in
either the empty state or a populated one.

## Implemented — 2026-09-21

`/community` is implemented against the corrected target. `PROPOSAL-detail-*`
is **not** implemented and Home is untouched, per the IA decision above.

`after/` holds the ACTUAL AFTER: real screenshots of the running product
against the emulators. Nothing drawn, no banners.

### What the implementation does that a drawing cannot promise

- **The resolver decides, not the screen.** `resolveCurrentCommunity(uid,
  memberOf)` is called with the real membership list. When it returns `null` —
  several memberships, none remembered — the screen asks. Nothing is ever
  marked CURRENT by convenience, and `AFTER-several-nocurrent-*` is captured
  with an assertion that no current panel exists in that state.
- **Choosing remembers, then opens.** A row calls `rememberCurrentCommunity()`
  and then `router.replace('/community/<id>')`. The interaction test asserts
  the URL, the rendered community Home, *and* the stored value — then reloads
  `/community` and asserts the chosen one is now current and nothing is asked.
- **Bounded, parallel, isolated reads.** Goals are read per community through
  `mapWithLimit(items, 4, …)`: never serial (an N+1 chain whose latency grows
  with membership count), never unbounded (a burst of callables from a phone
  on a bad network). Each community's failure is its own — `AFTER-partial-
  failure-390x844` is a real forced failure of ONE community's `wsfListGoals`,
  and the screen keeps the rest, including the current community's progress.
- **Recent movement is merged on the real instant.** Two goals' tails
  interleave in time; stitching them end to end would present a false
  sequence. They are sorted by parsed `at` descending and capped.
- **The shell's footprint is measured.** `MEMBER_TAB_BAR_BODY +
  MEMBER_TAB_MOVE_OVERHANG + safeAreaInsets.bottom`. Every AFTER frame asserts
  that no interactive control is permanently trapped under the shell — the
  rule is reachability, because asserting nothing crosses the bar line *at
  rest* would fail every scrollable screen and teach us to ignore it.

### Two fixture defects the capture caught

1. **The movement strip was empty on the first run.** `seedActiveGoal` seeds
   counter shards but not the `recentAdditions` subcollection, which only
   `wsfContribute` writes. The product was being honest and the fixture was
   wrong. The tail is now seeded at the real path, with the real two fields
   and the real minute-truncated `at`; a tail seeded in any other shape would
   be evidence of a screen reading data the product never produces.
2. **Every community read "1 member".** True of the fixture and of nothing
   else. `memberCount` is an aggregate over `wsfMemberships`, so the fixture
   now seeds real membership documents and the counts on the frames are real
   counts of real rows.

### The in-frame label is asserted now, not assumed

A claim that the frames were labelled was checked by eye once. The capture now
asserts, for every frame, that the strip exists, says what it says, sits flush
with the frame's top inside its 1px border, and spans the frame's width. The
first version of that assertion measured the *text node* rather than the strip
and failed at 1px — the same mistake as the `y < 24` wordmark threshold on
Page 2, caught this time by the check itself rather than by a review round.

## Evidence

- `before/` — frozen. The capture spec is opt-in (`WSF_CAPTURE_BEFORE=1`) and
  `npm run check:evidence` fails if a routine run changes a byte of it — and
  now covers the accepted TARGET and AFTER frames too, not only the BEFOREs.
- `TARGET-*` / `PROPOSAL-*` — real React Native from the real kit, rendered
  through the gated preview route `/design-target/community`. Every frame
  carries its own `TARGET / CONCEPT — NOT IMPLEMENTED` strip **inside** the
  captured element, so a frame that circulates alone still says what it is.
  The capture asserts each frame's box against the device class in its own
  filename, so a frame cannot be labelled 390×844 and shot at another size.
- `TARGET-contact-sheet.png` — every frame in one image.

## What `/community` does today, and what the target undoes

| BEFORE | Why it is a problem | What the target does |
| --- | --- | --- |
| Three identical cream cards reading `1 member`, over a half-screen void, ending in a naked underlined link. | Nothing says which community I am in right now, what it is doing, or that anyone is there. It is an admin directory. | The current community is the subject: a navy identity panel carrying role, member count, what we're doing, and real recent movement. Other memberships are compact live rows beneath. |
| `You are not in a community yet.` in a quiet card, with one link. | The one screen that should explain what a community is for explains nothing, and offers no way to join. | An identity-led opening, `Join` promoted to the primary action beside `Start`, and three statements of fact about how the product works. |
| Every row is name + member count. | A count is not a state; nothing on the row says whether anything is happening. | Each row carries its live goal and progress, or says plainly that no goal is running. |

## The state matrix

| State | 390×844 | 390×640 | 430×932 |
| --- | :---: | :---: | :---: |
| **Community (`/community`) — the target** | | | |
| Several memberships, one current | ✓ | ✓ | ✓ |
| Several memberships, none chosen yet | ✓ | ✓ | |
| One membership | ✓ | ✓ | |
| No memberships | ✓ | ✓ | |
| Loading | ✓ | | |
| Could not be loaded | ✓ | | |
| **Per-community surface — exploration only, not to be built** | | | |
| Goals running | ✓ | ✓ | ✓ |
| Nothing running | ✓ | ✓ | ✓ |
| What we've done | ✓ | ✓ | ✓ |
| Switching community | ✓ | | |
| Loading | ✓ | | |
| Goals could not be loaded | ✓ | | |

Selection and switching are covered twice on purpose: the list's `CURRENT`
panel shows which community Home opens, and `PROPOSAL-detail-switch` shows the
act of changing it.

## Every fact on these frames is one the backend already serves

| Fact | Source |
| --- | --- |
| Community name, role, member count | `wsfMyCommunities` → `displayName`, `role`, `memberCount` |
| Open goal title, target, unit, shared total | `wsfListGoals({ includeHistory: true })` |
| Closed goals, final totals, when they ended, whether reached | same call → `status`, `sharedTotal`, `closedAt`, `reachedAt` |
| Recent movement (`+20 squats · 4m`) | `wsfGoalRecentAdditions` → `{ amount, unit, at }` and nothing else |

Words and numbers come from shipped formatters — `memberCountLabel`,
`roleCardLabel`, `totalOfTargetLabel`, `percentLabel`, `fillRatio`,
`formatCount` — so the target cannot drift from what the product would render.

### A correction this package makes

`app/community/index.tsx` records the recent-movement seam as available *"only
for a goal whose Champion has authorized public display"*, and therefore
unusable because it would appear for some communities and not others.

**That is wrong, and it under-sells the product.** `evaluateGoalAggregateAccess`
returns `allowed: asMember || asDisplay`, and the callable's own test fixes it:

```
test('ACTIVE MEMBER of an UNAUTHORIZED goal is allowed — membership is its own route')
```

`wsfMyCommunities` only ever returns communities the caller is an **active
member** of, so the member route is open for every row on this screen.
Anonymous movement is available for all of them, authorized or not. The
comment should be corrected when Community is implemented; it is left alone
here because this pass changes no product code.

## What these frames refuse, and why

- **No faces, no names, no reactions.** The momentum strip is amounts and
  minutes. The server strips the uid and the name before publishing, and a
  placeholder avatar on the one screen whose job is to be true about other
  people is a lie with a border-radius.
- **No count of people moving.** `memberCount` is a roll, not a presence: it
  says who belongs, never who is here. No surface counts contributors and none
  is invented.
- **No founded date.** The community document has `createdAt`, but
  `wsfMyCommunities` does not return it. A masthead fact that needs a new
  backend field is a target that lies, so the masthead does without it.
- **No streak, no ranking, no health claim, no encourage button.** There is no
  capability behind an encouragement control, and a button that does nothing is
  worse than no button.
- **Challenge participation is out of scope.** `challengeParticipationLabel`
  does produce `N moving · M check-ins` from real check-in records, but
  challenges are a different subsystem; mixing them into the community's goal
  record would blur what the numbers mean.
- **Exactly one Living WE per screen,** at a size where the fill is legible,
  beside a value it actually reports. Repeating the mark at bullet size on
  every row — which is what the product does in history today — is decoration
  wearing a number's clothes.

## Open, and explicitly not claimed

- Combined / multi-movement remains separate later scope.
- `/community` is implemented; `PROPOSAL-detail-*` is not, and Home is
  untouched.
- No Progress, no You, no auth, no kiosk/event administration, no staging, no
  merge and no release work is part of this package.
