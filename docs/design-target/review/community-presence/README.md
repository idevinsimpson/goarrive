# Community presence — W8

**Status: target + architecture PASSED at `862b2f5` (Director verdict
`5788288648`); implementation released with two corrections and delivered.
NOTHING IS DEPLOYED — the composite index declaration in particular is declared
and not rolled out.**

Sections 1–7 are checkpoint 1, kept as written so the proposal can be read
against what shipped. **Section 8 records the implementation and the matched
AFTERs.**

Target + truth inventory + architecture contract for the social/community lane,
on the owner's decision of 2026-09-22 ~22:23 ET relayed in #365 comment
[`5787909127`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5787909127).

**Two kinds of image live here and they must never be confused.**
`PROPOSED-*.png` at the top level are **drawings**; each carries a
`PROPOSED — NOT ACCEPTED` strip inside the image, in amber rather than the
accepted producers' green. `after/AFTER-*.png` are **real screenshots of the
running product** — nothing drawn, no banner, every value on them produced by
the real callables against the emulator.

## Start record

| Fact | Value |
| --- | --- |
| Start SHA | `c8f38e37b6286297d1f401834cd9500a675a2923` (verified with `git rev-parse HEAD`) |
| Base branch | `claude/wsf-app-shell` |
| This branch | `claude/wsf-social-community` · PR #441 |
| Predecessor | **#390 (`claude/wsf-community-visibility` @ `670edab`) — SUPERSEDED AS-IS, source material only** |

---

# 1 · What the product can truthfully show today

Read off the code on this branch, not inferred from concept art. Every claim
below cites the callable or collection it comes from.

## BUILT — shipped and reachable by a member right now

| Fact | Source | Note |
| --- | --- | --- |
| Active member count, per community | `wsfMyCommunities.memberCount` | A `.count()` over `wsfMemberships` where `groupId == g` and `membershipStatus == 'active'`. **Counts every active member, including any who are private.** Already rendered on Home as `N members · moving together this week`. |
| Community name, type, join policy, the caller's own role | `wsfMyCommunities` | |
| Confirmed shared total, target, unit, percentage | `wsfGoalPulse` + `progressFormat` | The Living WE's ratio. |
| The member's own credit | `wsfMyContribution.ownCredit` | Private to them. |
| Recent movement as **amount + minute-level time, anonymous** | `wsfGoalRecentAdditions` | `invoker: 'public'`. The stored document is `{ amount, at }` and **nothing else** — no uid, no name, the attempt id is the document's *name* rather than a field. This lane does not widen it. |
| Goals running and finished | `wsfListGoals` | |
| The caller's **own** display name | `wsfMemberProfiles/{uid}` | `firestore.rules`: owner-only read. |

## AVAILABLE-BUT-NOT-RELEASED — the data exists server-side; no member-facing read returns it

| Fact | Where it lives | What is missing |
| --- | --- | --- |
| **Another member's display name** | `wsfMemberProfiles/{uid}.displayName` | No callable returns it; rules deny a cross-member read. #390 wrote the first one (`wsfCommunityMembers`) and is unmerged. |
| **Individual contribution records** | `wsfContributions/{goalId}_{uid}_{attemptId}` | Stores `goalId`, `attemptId`, `userId`, `count`, `shardIndex`, `unit`, `communityGroupId`, `crossedTarget`, `createdAt` (server timestamp). Returned by **no** callable, and `firestore.rules` has no match block for it, so it falls to the catch-all `allow read, write: if false`. |
| Per-member goal totals | `wsfGoalMemberTotals/{goalId}_{uid}` | Own-only, via `wsfMyContribution`. |
| A per-community visibility preference | — | **The field does not exist on this branch at all.** It exists only on #390. |

**This is the finding that makes the lane buildable.** `wsfContributions` is a
real ledger with a member id, a community id, an amount, a unit and a server
timestamp on every row. A member-only "recent momentum" feed does not need a
new write path, a denormalised counter or an identity snapshot — it needs a
bounded read of records the product already writes on every contribution.

## SEAM — would need work or a decision, and is named rather than drawn around

| Want | The seam |
| --- | --- |
| Ordered community activity | Needs a composite index on `wsfContributions (communityGroupId ASC, createdAt DESC)`. **`firestore.indexes.json` contains zero `wsf*` indexes today**, so this would be the first. Included on this branch as an exact diff with tests; **not deployed** — index rollout is a separate release action. |
| `X people moved today` | A distinct-`userId` count over a time window. No counter exists and none is proposed. It is derivable from the bounded activity read, but is **provable only when that read demonstrably covers the whole window** — see the contract below. Where it is not provable the product says nothing. |
| Member photos / avatars | **No WSF photo or avatar field exists anywhere.** Not invented here. Names plus initials only; photos are a separate follow-up needing their own data-model and privacy review. |
| Dated private history, streaks | Already a recorded seam (`review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md`). Untouched, and streaks are forbidden regardless. |

---

# 2 · The BEFORE, and why the owner is right

The accepted, shipped Community Home (`review/page-01-home/AFTER-home-390x844.png`
— an accepted AFTER, reused here rather than re-captured, since this lane has
changed no product code) carries **exactly one social signal**:

> `1 member · moving together this week`

It is a count, in grey, under the community name. Nothing else on the screen
indicates that another human being exists: the navy hero is the goal, the
actions are the member's own, and `YOUR PART` is explicitly private. A member
can use this product daily and never see evidence of anyone else. That is the
"too private and solitary" in the owner's words, and it is a property of the
composition rather than of the data — as section 1 shows, the evidence of other
people is already in Firestore and simply has no read path.

---

# 3 · The proposal

Eleven frames, at 390×844 and 390×640.

| Frame | What it shows |
| --- | --- |
| `PROPOSED-community-inhabited-390x844` · `-390x640` | The ordinary case: presence row, truthful counts, proven contributor line, named + anonymous momentum, Members path. |
| `PROPOSED-community-quiettoday-390x844` | Members visible, nobody has moved yet. **No contributor count at all** — the state the product must not paper over. |
| `PROPOSED-community-allprivate-390x844` | Every member private. Presence row absent, momentum fully anonymous, member count and shared total unchanged. |
| `PROPOSED-community-small-390x640` | Three members. Presence must not look broken at small numbers. |
| `PROPOSED-members-people-390x844` · `-390x640` | People, not an admin directory. |
| `PROPOSED-members-allprivate-390x844` | Nobody listed by name, said warmly and without a number. |
| `PROPOSED-settings-privacy-390x844` · `-390x640` | Per-community controls, subordinate to the community. |
| `PROPOSED-you-settings-entry-390x844` | The quiet gear on You. Not a sixth tab. |

## Community — presence before administration

Presence sits **inside the identity block, above the navy hero**. The owner's
complaint is about how the app feels on open, and presence that appears only
after a scroll does not change that. The accepted composition is otherwise
kept: same eyebrow, same headline, same navy hero, same Living WE at the true
confirmed ratio, same `#91CB7D` progress green, same action.

Three truthful elements are added:

1. **A presence row** — overlapping initials, Champion in progress green. Renders
   nothing when nobody is visible; a row of empty grey circles would be a
   drawing of absence.
2. **An honest count line** — `24 members · some choose not to be listed`. The
   member count is the whole community, private members included, exactly as
   today. The second clause states **that** some are unlisted and never **how
   many**.
3. **Recent momentum** — real contribution rows, named where the member is
   visible and `A member` where they are not, under a contributor line that
   appears only when it can be proven.

## Members — people, not a table

Navy panel, because the board uses navy for the important object on a screen
and here the important object is the people. Role is shown **only for the
Champion** — it is who to ask; `Member` repeated down every other row is what an
admin table looks like. `Show more people` carries **no count**. The member's
own control is one unweighted row with no border, fill or heading — the
discipline #390 arrived at after three drafts in which privacy climbed the
hierarchy until it was the page.

## Settings — the community is the heading

Reached by a quiet gear from You, plus a spelled-out `Settings` row, because a
gear alone is discoverable only to people who already expect it. Each community
is a heading with its two controls beneath it; inverting that — two global
toggles each containing a list of communities — is what makes a settings screen
feel like a policy console. The A=OFF / B=ON state is drawn, not described, and
its note says exactly what the feed will show in the feed's own words.

## Honest limits of these frames

- **At 390×640 the Community frame's second momentum row and the Members link
  fall below the fold.** Presence, the count line, the hero, the action and the
  contributor line with the first momentum row are all above it. Stated rather
  than smoothed over.
- The frames use placeholder community and member names to draw layout. They
  are **not** claims about real people or real activity, and no frame is
  captured from a real account.
- `430×932` is not drawn. The packet was asked to be compact and the two phone
  classes carry the decision.

## One copy deviation, surfaced rather than smuggled

The direction's settings contract describes the anonymised row as
**`"Anonymous member"`**. The frames draw **`A member`** instead. The reasoning:
the whole point of the lane is that the app feels less cold, and *"Anonymous
member added 25 squats"* reads like a moderation log, while *"A member added 25
squats"* is equally identity-free and sounds like a person. This is a Director
call, not mine — if the literal wording is wanted, it is a one-line change with
no contract consequence.

---

# 4 · Architecture contract

Four callables. **No `firestore.rules` change of any kind**, and that is a
property rather than a preference: `wsfContributions`, `wsfMemberProfiles` and
`wsfMemberships` are already unreadable or owner-only to a client, so every
social read here is an Admin-SDK callable behind a membership gate and the
feature adds **no new client read surface at all**.

## The gate, ported from #390 unchanged in spirit

`requireOwnActiveMembership(db, groupId, uid)` runs **physically above** every
query: a caller who is not an active member is refused before any other
member's row is read into the function. It requires the row's `userId` and
`groupId` fields to agree with the token and the request — the document id is
never the authority — and refuses every negative case (no such community, never
joined, removed, departed, blank or missing status) with **one identical
`permission-denied`**, so the pair of refusals cannot be used to enumerate real
community ids. Neither social callable ever reads `wsfCommunityGroups`, because
that is where a distinguishable not-found would come from.

## Storage — two fields, two new names

On the membership row, `wsfMemberships/{groupId}_{uid}`:

| Field | Values |
| --- | --- |
| `communityNameVisibility` | `'visible'` \| `'private'` |
| `communityActivityVisibility` | `'visible'` \| `'private'` |

**String enums, not booleans** — #390's lesson, and it survives the reversal:
`Boolean(x)` is true for `1`, `'false'`, `'no'`, `{}` and `[]`, and a missing
boolean defaults somewhere. Two named values mean anything stored that is
neither can be recognised as neither.

**Deliberately NOT reusing #390's `visibility` field name.** Its stored meaning
is "may my name be shown", under the opposite default. Reusing the name would
make a row written by either generation of the code indistinguishable while
silently changing what it means. New names cost nothing and cannot collide.

## The default, and the Firestore trap it walks into

The owner's rule: **a missing preference resolves to VISIBLE inside the
community; an explicit privacy choice stays private.**

#390 implemented private-by-default as an *index filter* —
`.where('visibility', '==', 'visible')` — with no branch below it, so a row
missing the field could not match. Reversing that default **cannot** be done by
inverting the filter:

> A Firestore inequality (`!=`, `not-in`) **also fails to match documents that
> are missing the field.** `where('visibility', '!=', 'private')` would silently
> exclude exactly the legacy rows the owner's rule says must be visible — and
> today that is **every membership row in the product**, because the field does
> not exist on this branch at all.

So resolution moves out of the query and into code, where the safe side has
flipped with the default. It is a **three-way** normalisation, not a boolean:

| Stored value | Resolves to | Why |
| --- | --- | --- |
| `'private'` | **private** | An explicit choice. |
| `'visible'` | visible | An explicit choice. |
| absent / `undefined` / `null` | **visible** | The owner's rule. |
| anything else | **private** | An unrecognised value is not a decision to publish. The setter cannot write one, so this arises only from an import or a hand-edit — and those must not publish a name. |

The directory query therefore becomes equality-only —
`where('groupId','==',g).where('membershipStatus','==','active')` — which
Firestore serves by merging single-field indexes, so **the directory needs no
new index**.

### A consequence the owner should confirm explicitly

Because no membership row carries the field today, the rule "missing resolves
to visible" means that **at first release every existing active member's display
name becomes visible to the other authenticated members of their communities,
without any of them having been asked individually.** That is what "public by
default" plainly directs, and it is bounded to fellow signed-in members of the
same community — but it is a one-way first impression for the existing member
base, so it is named here rather than discovered afterwards.

The frames therefore do **not** propose a blocking arrival sheet (#390's, which
was non-blocking but heavy). The recommendation is a **one-time, dismissible
notice** on Community — "You are listed by name here · Change in Settings" —
so the default is discoverable at the moment it first applies. It is drawn on
the Members frame as the unweighted row and is a Director call.

## Endpoint 1 — `wsfCommunityMembers` (reworked from #390)

```
in  { groupId, cursor? }
out { members: [{ displayName, role }], nextCursor: string | null }
```

Ported unchanged from #390: **no `uid` in the response or the types** (a name
with no uid beside it is not a handle on anybody, and cannot be joined to a
contribution, a goal or a turn); no total, visible count, hidden count or
`hasMore`; no per-entry `visibility`; no timestamps. Rows whose id and `userId`
disagree are dropped. The profile fan-out is a `Map` keyed by uid and **never a
positional zip** — `getAll` returns a snapshot per ref including missing ones,
so zipping by index shifts every later name one place and publishes it beside
someone else's role. The safety valve **refuses rather than truncates**, because
a shortened list that looks complete is a lie and a refusal is not.

Pagination is an **integer offset in an opaque base64url token**, validated on
the way in (malformed, negative, fractional or out-of-range is
`invalid-argument`, never a silent restart at zero). Deliberately not a
Firestore cursor: `startAfter(lastDoc)` on this collection serialises
`{groupId}_{uid}` — a uid in plaintext, handed to the client and echoed back on
every page.

Changed from #390: the `visibility` index filter is removed and replaced by the
three-way resolution above, applied to `communityNameVisibility`.

## Endpoint 2 — `wsfCommunityActivity` (new)

```
in  { groupId, cursor? }
out { entries: [{ displayName: string | null, amount, unit, at }],
      contributorsToday: number | null,
      nextCursor: string | null }
```

Reads real `wsfContributions` rows —
`where('communityGroupId','==',g).orderBy('createdAt','desc')`, bounded — and
resolves each contributor's **current** preference in this group at read time.

**Two independent preferences, two different effects:**

| Preference | Effect on the row |
| --- | --- |
| `communityActivityVisibility == 'private'` | The row is **omitted entirely**. The member's effort still moves the shared total. |
| `communityNameVisibility == 'private'`, activity visible | The row **stays** with `displayName: null`. Dropping it would under-report the community's activity to make the feed tidier. |

**Evaluated at read time, never snapshotted.** No display name is ever written
into contribution history to render a feed. Turning a name off therefore removes
identity from **old** activity too, which is the retroactive property the
direction requires.

**The field whitelist is the type.** Never returned: `userId`, email,
`attemptId`, `shardIndex`, `crossedTarget`, member totals, tokens, private
profile fields, or second-level time — `at` is rounded to the minute with the
same `isoMinute` helper the recent-additions tail already uses.

### `contributorsToday`, and the one rule that keeps it honest

Distinct `userId` values among rows inside the current local day. It is returned
**only when the bounded read provably covered the whole window** — that is, when
the read came back short of its cap, or its oldest row is older than the window
start. Otherwise it is `null` and the UI renders nothing. It is never
approximated, never "at least N", and the row count never stands in for a
person count.

Members whose *activity* is private **are counted** in it. It is an aggregate,
like the shared total and the member count, and the settled rule is that private
members remain counted in aggregates with their identity hidden.

### The index, included and not deployed

```json
{
  "collectionGroup": "wsfContributions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "communityGroupId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**The emulator does not enforce indexes**, so this query will pass every local
test with or without it and would first fail in front of real people. That is
exactly why it is written down here and pinned by a test on the branch rather
than left to be discovered at deploy.

## Endpoint 3 — `wsfSetCommunityVisibility` (reworked from #390)

```
in  { groupId, name?: 'visible'|'private', activity?: 'visible'|'private' }
out { groupId, name, activity }
```

**There is no `targetUid`, and that absence is the enforcement.** The Champion
action family sits a few hundred lines above in the same file, shares
`{ groupId, targetUid }` and opens each handler with `requireChampion`; copying
one as a starting point would import both the parameter and a Champion override
in a single paste. Modelled on `wsfLeaveCommunity` instead — the file's one
existing callable that acts on the caller's own membership. Nothing writes a
`*ByUid` field: those exist only where the actor differs from the subject, and
here it never can.

**The literal, or nothing.** `true`, `1`, `'Visible'`, `' visible'`, `null`,
`{}` and `['visible']` are all refused, and refused *without writing*. The
response is the settled stored value, not an echo of the request.

## What changes in the existing reinstatement paths — by deletion

#390 added resets to `visibility` and deleted `visibilityPromptedAt` in
`wsfJoinCommunity` (rejoin) and `wsfReinstateMember` (Champion). Under the new
rule **those resets are not ported.** Both writes are `{ merge: true }`, which
preserves every field it does not name, so *doing nothing* is exactly the
required behaviour: a member who explicitly chose privacy, left, and came back
stays private, and a Champion reinstating them cannot republish their name by a
unilateral act. The no-Champion-override guarantee is preserved by removing
code, not by adding it.

## Endpoint 4 — `wsfMyCommunities`

Gains the caller's **own** two preferences per community, to render Settings.
Safe there precisely because that query is already `userId == caller`.

## Untouched, and pinned as untouched

- `wsfGoalRecentAdditions` — payload, storage and `invoker: 'public'` unchanged.
- Kiosk, station, public display and every unauthenticated path — unchanged and
  identity-free.
- `firestore.rules` — no diff.
- The public-invoker allowlist test — extended to pin that **neither** new
  callable is public. `invoker: 'public'` is a no-op in the emulator and
  enforced only at deploy, so a mistaken marker would pass every local test.

---

# 5 · Tests the contract is designed to make provable

Written as properties now so the implementation cannot quietly not have them.

| # | Property |
| --- | --- |
| 1 | Missing preference → member is community-visible. |
| 2 | Explicit name privacy → no name in payload or DOM; still counted in `memberCount`. |
| 3 | Explicit activity privacy → no individual row; the shared total still changes. |
| 4 | Name-private + activity-visible → anonymous row, no identity leak. |
| 5 | An unrecognised stored value resolves to **private**, not visible. |
| 6 | An active member can read the directory and the feed; a signed-out caller and a non-member cannot, with identical refusals. |
| 7 | Changing the preference retroactively changes identity on **old** feed rows. |
| 8 | Leave → rejoin preserves an explicit private choice. |
| 9 | Champion reinstatement cannot republish a private member. |
| 10 | An account switch carries no other person's visibility or rows. |
| 11 | Public display / kiosk / station / unauthenticated payloads stay identity-free. |
| 12 | `contributorsToday` is `null` whenever the window is not provably covered. |
| 13 | No uid, email, attempt id or second-level time appears in any member-facing payload or the serialised DOM. |
| 14 | No leaderboard, rank, score, streak or fabricated activity exists anywhere in the surface. |
| 15 | Contribution idempotency, concurrency and current shared totals are unchanged by any privacy change. |

---

# 6 · Reserved files

Mine on this branch: `app/community/[groupId]/index.tsx`;
`app/community/[groupId]/members.tsx` (new); `app/you.tsx` (the quiet Settings
entry only); `app/settings.tsx` / `app/settings/privacy.tsx` (new);
`app/design-target/community-presence.tsx` and
`src/ui/designTarget/CommunityPresenceTargets.tsx` (new, new frame ids, no
accepted frame or producer edited); `tests-e2e/sprint-w8-*`;
`tests/callable/sprint-w8-*` and the functions social/visibility tests;
`functions-westayfit/src/index.ts` for the four callables named above only;
`firestore.indexes.json` for the one index above (not deployed); this package;
`docs/westayfit/qa/sprint-w8-*.md`.

`app/index.tsx` is reserved only for the later Home presence preview — second,
and only after this checkpoint passes and L0 confirms W4 holds no open
reservation on it.

Not mine: the global kit, `WsfWordmark` / `LivingWeProgress` / `MemberTabBar` /
`_layout.tsx`, Start Community (W4), goal setup (W6), display (W2), kiosk
(W1B), `.github/**`, `firestore.rules`, `scripts/westayfit/check-evidence-intact.mjs`,
another worker's specs, and any frozen BEFORE or accepted TARGET/AFTER.

---

# 7 · How this was produced

`app/design-target/community-presence.tsx`, gated on
`EXPO_PUBLIC_WSF_USE_EMULATORS` exactly like the existing preview routes, and
captured by `tests-e2e/sprint-w8-community-presence-capture.spec.ts`, which
runs only under `WSF_CAPTURE_FRAMES=1`. The spec asserts, per frame, that the
box is the device class its id claims and that the `PROPOSED — NOT ACCEPTED`
strip exists, says those exact words, sits flush with the frame's top edge and
spans its full width — so a frame cannot be captured at the wrong size, or
without its label, and still be published.

An ordinary run writes **zero bytes**: measured by hashing this folder before
and after a run without `WSF_CAPTURE_FRAMES`, not asserted. Both hashes were
`b29c3ce473c0ccef7c050e273c106211c69fb537613bcf7f5de78afc4ed4f1d7`.

---

# 8 · Implementation — matched AFTERs

**Released by the Director's verdict `5788288648` (target + architecture PASS at
`862b2f5`), with both required corrections applied.**

`after/AFTER-*.png` are **real screenshots of the running product**. Nothing in
that folder is drawn and no frame carries a banner. Every name, count and
amount on them came out of the emulator through the real callables.

## The two corrections

1. **No gear or header treatment on You.** W9 owns the persistent header and
   hamburger, so a second utility affordance in that corner would either fight
   W9's or become dead. Settings is an ordinary working row inside You content,
   leading to real `/settings` and `/settings/privacy` routes — real on
   arrival, with nothing left to wire up when W9 exposes them.
2. **`contributorsToday` runs on the goal's own stored timezone and active
   window.** Never Cloud Functions host time, never accidental UTC, never the
   caller device's local day. The zone offset is measured twice, because a
   zone's offset at midnight can differ from its offset now — that is what a DST
   transition is, and getting it wrong moves the boundary by an hour on exactly
   the two days a year nobody would notice. It renders nothing where the zone
   cannot be resolved, where no goal is named, where the goal belongs to another
   community, or where the bounded scan did not provably reach past the window
   start.

## What the AFTERs prove, in one fixture

The capture seeds six members: three with **no visibility field at all** — the
real state of every membership in the product today — one Champion, one who
chose `name: 'private'`, and one who chose `activity: 'private'`. Four of them
contributed today.

- `AFTER-community-390x844` — the presence row names five and omits Priya, who
  chose name privacy. The line reads `6 members · some choose not to be listed`:
  the count is everyone, the clause says **that** somebody is unlisted and never
  **how many**.
- **`4 people moved today`** counts Tom, whose *activity* is private and who
  therefore has no row in the feed. That is the aggregate rule working: private
  members stay counted, with their identity hidden.
- `AFTER-members-390x844` — five named people, the Champion pill on the one
  Champion, `Your visibility here · Settings` as one unweighted row.
- `AFTER-settings-privacy-390x844` — the same member visible in one community
  and private in another, with the consequence stated in the feed's own words.
- `AFTER-you-390x844` — the Settings row, no gear.

## Honest limits of the implementation

- **At 390×844 the momentum card sits at the fold and is read by scrolling a
  little.** The presence row, the truthful member line, the hero and both
  actions are above it, and the card's eyebrow and contributor line peek above
  the tab bar. The proposal frames did not show this because they omitted page
  furniture the shipped screen has — the `Already moved?` action, the
  `Confirmed … Refresh` line and the tab bar. The order was left alone
  deliberately: moving momentum above the actions would push `Start moving`
  down, and the product loop outranks the feed.
- The `A member` wording from the proposal is what shipped. If the literal
  `Anonymous member` is wanted it is still a one-line change.
- `430×932` is not captured, as at checkpoint 1.

## Evidence on the implementation head

| Suite | Result |
| --- | --- |
| Callable (`test:callable`) | **453 / 453** — including 21 new W8 privacy assertions |
| Rules | **28 / 28** |
| Deploy-config | **17 / 17** — including the source-read invoker pin |
| e2e regression (`community-list`, `ui-app-shell`, `e35-home`, `batch-a-identity`) | **38 / 38** |
| e2e privacy (`sprint-w8-social-privacy`) | **4 / 4**, in the ordinary suite |
| `ts:check` | clean |
| `check-evidence-intact` | frozen 9 / accepted 20, no byte changed |

Two tests were **extended rather than weakened**, and both were the guard doing
its job: `wsf-my-communities` pins the item's exact key set and now names the
caller's own two preferences, safe there because that query is `userId ==
caller`; and the invoker pin had to be rewritten to read source, because
`__endpoint.callableTrigger` is `{}` even for the deliberately public
`wsfGoalRecentAdditions` — its positive control is what caught the first
version reporting every callable as private.

One real bug the instruments caught: the social effect first sat beside the
featured goal, which is **after four early returns**, so React saw one fewer
hook while loading than once ready and the page threw instead of painting. Four
authenticated specs timed out while a signed-out probe passed, because that
path returns early on every render and never changes the count. The hook now
sits above every early return, and the fix took the regression suite from
2.0 minutes with four timeouts to 48 seconds green.
