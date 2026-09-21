# Page 3 · Community — BEFORE and TARGET

**Target only. Nothing here is implemented.** No product code changed in this
pass. The gate is ACTUAL BEFORE → reviewed TARGET → ACTUAL AFTER → visual
acceptance; this package is the first two.

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

### The decision this puts to the review

The brief asks Community to carry identity, "what we're doing" / "what we've
done", and active / no-goal / past-goal states. Today all of that lives on
`/community/[groupId]`, which is Home. Two ways forward, and it is a product
decision, not a drawing decision:

1. **Community is the list only.** `TARGET-list-*` is the whole package; the
   goal states stay on Home where they already are and were already accepted.
   Nothing in `PROPOSAL-*` is built.
2. **Community identity becomes its own surface,** separate from Home for a
   community. `PROPOSAL-*` is what that would look like — and adopting it means
   deliberately revising an accepted page.

`TARGET-list-*` stands either way. `PROPOSAL-*` is shown so the choice can be
made against pixels rather than prose.

## Evidence

- `before/` — frozen. The capture spec is opt-in (`WSF_CAPTURE_BEFORE=1`) and
  `npm run check:before-frozen` fails if a routine run changes a byte of it.
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
| Several memberships | ✓ | ✓ | ✓ |
| One membership | ✓ | | |
| No memberships | ✓ | | |
| Loading | ✓ | | |
| Could not be loaded | ✓ | | |
| **Per-community surface — the proposal** | | | |
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
- No implementation, no Progress, no You, no auth, no kiosk/event
  administration, no staging, no merge and no release work is part of this
  package.
