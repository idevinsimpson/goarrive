# Page 5 · You — BEFORE, TARGET and AFTER

**Implemented.** The target was reviewed and accepted, and `/you` is now built
to it. The gate is ACTUAL BEFORE → reviewed TARGET → ACTUAL AFTER → visual
acceptance; this package now carries the first three and **stops for the
fourth**. Nothing beyond Page 5 was begun.

**The route is `/you`.** There is no `/profile`; `/profile-setup` is a step on
the way to having an account, not a place to return to.

- `after/` — `/you` as it renders **now**, after implementation. Each frame is
  the running product against the emulators, at the same three device classes.
  No `TARGET` strip: these are not targets.
- `before/` — the product as it rendered before this change. **Frozen**: the capture spec is
  opt-in (`WSF_CAPTURE_BEFORE=1`) and `npm run check:evidence` fails if a
  routine run changes a byte.
- `TARGET-*.png` — real React Native from the real kit, through the gated
  preview route `/design-target/you`. Every frame carries its
  `TARGET / CONCEPT — NOT IMPLEMENTED` strip **inside** the captured element,
  and the capture asserts the strip, the frame's exact device class, the
  wordmark's position under the strip and the presence of the member tab bar.

## Second revision — 2026-09-21

The first target was reviewed and **not accepted**: *"the page still repeats a
community card, two own-part cards and two history cards on cream; the progress
instrument is small and the account actions arrive below the first viewport. It
remains too close to the rejected card-stack grammar."*

That was a fair reading. What changed:

| Was | Now |
| --- | --- |
| A community card, two own-part cards and two history cards, all cream | Identity, belonging and account are **one navy composition**; goals are **compact rows** with a rule between them |
| A hairline progress track | The **real `LivingWeProgress`** at 150px on the open goal |
| Account actions below the first viewport | The account row is **in the field**, so it is above the fold at every class |
| The letters "WE STAY FIT" drawn as text | The **real `WsfWordmark`**, which `/you` already renders |
| "Yours alone, and never compared" on the page | Moved into this truth table. It told the member nothing they could act on and read as the product reassuring itself. |
| `member` at three classes, other states at one or two | **Every state at every class** — 5 × 3. A state that exists at one width and not another is a state somebody loses by turning their phone. |

Two further fixes found by looking at the frame rather than trusting it: the
lead goal was drawn **twice** (once as the spotlight, once as the first row),
and the last section sat under the tab bar at rest. The list now carries only
the goals the spotlight does not, and the sheet clears the bar by the shell's
own `6 + 48 + 10` body plus the raised control's 24px overhang.

The member tab bar was missing from the rewrite and is restored: **You is a
shell tab**, and a target that omits the bar is a target of a screen the
product never renders.

### The strip, settled

Every one of the fifteen state frames carries the green
`TARGET / CONCEPT — NOT IMPLEMENTED` strip. That is now **asserted** rather
than argued: immediately before each shutter the capture requires the label to
be visible, to say those exact words, to span the frame, to compute to
`rgb(34, 197, 94)`, and to sit wholly inside the frame on all four edges — at
every state and every class.

The one file in this package with no strip is `TARGET-contact-sheet.png`, which
is a full-page screenshot of the preview route rather than a captured frame, so
its top band is the page ground.

### The capture assertion was passing on the wrong thing

It looked for the literal text `WE STAY FIT`, which only ever passed because
the target drew those letters itself. `WsfWordmark` is an `Image` with
`accessibilityLabel="We Stay Fit"`, so the assertion now follows the component.
A check that can only pass against a hand-lettered stand-in is a check that
would have gone green on the wrong thing.

### Still refused, and still true

No photo, no quote, no streak, no dated activity, no per-week count, no
personal score, no rank, no comparison, no share control, no leave control, and
no `you moved us from X to Y` — that last one is not a missing callable but
arithmetic over a window containing everybody who wrote in it. Exact own credit
and current shared state are shown, separately labelled, with no causal claim
joining them.

**One account action, because there is one.** `/you` offers Sign out. A control
with no capability behind it is the thing this atlas refuses everywhere else.

## The AFTER, and two things it is honest about

### The BEFORE covers two states, not six

`before/` holds six PNGs: `identity` and `signed-out`, each at the three
classes. That is not an omission in the capture — **it is the whole of what
the old page could show.** The previous `/you` was 74 lines: signed in, it
rendered an email and a Sign out button; signed out, it rendered a Sign in
button. It had no community read, no goal read, no loading state and no
failure state, so there was nothing else to photograph.

The frozen BEFOREs are therefore **not recaptured to match the AFTER's state
list**, and `npm run check:evidence` still fails if a routine run changes a
byte of them. Where the AFTER has a state the BEFORE has none of, the
comparison is `new state` — not a frame pair — and saying so is the honest
report. The matched pairs are `identity` → `member` and `signed-out` →
`signedout`.

### There are six states, not the five the target named

The accepted target drew five. Building it turned up a sixth, and it was a
bug in the first draft rather than a flourish: `resolveCurrentCommunity`
returns `null` **both** for a member who belongs to nothing and for a member
who belongs to several with none remembered. The draft folded both into
`noCommunity`, which told the second person *"You're not in a community
yet."* That sentence is false about them.

`pickCommunity` is now its own state — *"Which community? You are in N
communities."* — and `you-page.spec.ts` asserts that the person in two
communities is never shown the sentence about being in none, and that no
community is chosen for them behind their back.

### What the AFTER frames assert before the shutter fires

Four of the six states are signed in, and each of those runs the full chrome
assertion: the wordmark, the heading, the member tab bar and the raised MOVE
control are all **visible and wholly inside the viewport** at scroll zero, in
that vertical order, and no control outside the shell can be left permanently
trapped under it.

`signedout` is the one state that is exempt, and the exemption is the shell's
rule rather than this page's: `MemberTabBar` returns `null` when `signedIn` is
false, so a visitor has no member navigation to be visible. Rather than drop
the assertion there, it is **inverted** — that frame asserts the bar and the
raised MOVE are absent, and that no name or email is on the page. A shell that
began rendering for signed-out visitors would break a test instead of quietly
changing the evidence.

### Behaviour is asserted separately, and on every run

`tests-e2e/you-page.spec.ts` is not gated on `WSF_CAPTURE_FRAMES`. It proves,
against the running product: identity survives a failed goal read; retry
recovers in place without a reload; a goal with no recorded own part is never
listed; the lead is the open goal **ending soonest**, not the first one back,
shown in its own unit; a member of several communities is told that; a member
of none is told that and offered a way in; a failed own-part read is admitted
rather than hidden; and a signed-out visitor gets no member navigation.

The capture spec writes PNGs into `docs/` and is evidence generation. These
assertions are cheap and belong in every run.

## Truth table

`safe to render?` means: reachable by this client today, with no new backend
surface and no new rule.

| Desired element | Authoritative source today | Safe to render? | Exact limitation / seam |
| --- | --- | :---: | --- |
| Display name | `wsfMemberProfiles/{uid}.displayName` — **owner-readable**: `allow read: if request.auth.uid == uid` | **Yes** | None. The product stores it and the member typed it; today's screen shows a raw email instead. |
| Email | Firebase Auth `user.email`, on the device | **Yes** | It is the credential, not a profile. Kept, quietly. |
| Member since | `wsfMemberProfiles/{uid}.createdAt` (server timestamp, same owner-read rule) | **Yes** | Month + year only. A join date is identity, not activity. |
| Current community, role, member count | `wsfMyCommunities` + `resolveCurrentCommunity()` | **Yes** | `null` when several memberships exist and none is remembered — then the screen must ask, not pick. |
| The community's current goal + shared total | `wsfListGoals({ includeHistory: true })` | **Yes** | `sharedTotal` only arrives under `includeHistory`. |
| Your part, per goal | `wsfMyContribution({ goalId })` → `ownCredit`, `unit` | **Yes** | Per goal only. **Never summed across units.** |
| Finished goals you were part of | `wsfListGoals` (`status`, `reachedAt`) + `wsfMyContribution` | **Yes** | Bounded at `GOAL_HISTORY_LIMIT` (50 most recent closed). |
| Change your name | `wsfSaveProfile` | **Yes** | Requires a verified email; re-accepts the current terms/privacy versions. |
| Sign out | Firebase `signOut` | **Yes** | Needs no read — so it must work even on the failure state. |
| Member photo / avatar | — | **No** | Nothing in the product stores an image for a member. |
| Member quote / bio | — | **No** | No field exists. |
| "N squats **this week**" | `wsfContributions.createdAt` exists, **not returned by any callable**; `firestore.rules` denies the client a direct read | **No** | The private-history seam. See `../page-04-progress/PRIVATE-HISTORY-CONTRACT.md`. |
| "N contributions this week" | `wsfGoalMemberTotals.contributionCount` — stored, **not returned** | **No** | Same seam, and "this week" also needs a day boundary and a zone. |
| Day streak | — | **No** | Same seam. A day needs a zone before it needs a count. |
| "You moved the community from X to Y" | — | **No** | **Not a missing callable — arithmetic.** X→Y is the community's movement and contains everyone who wrote in that window. Attributing it to one member is false however the data arrives. Exact own credit + current shared state are shown instead. |
| Recent own contributions, dated | — | **No** | The private-history seam again. |
| Share your profile | `shareGoalDisplay` shares a **goal's** public display link | **No** | Nothing shares a profile, and no route would receive it. No control is drawn. |
| Delete account | — | **No** | No callable deletes a member. Drawing it would promise a path that does not exist. |
| Notification settings | — | **No** | There are no notifications. |
| Leave a community | `wsfLeaveCommunity` | **Yes, but not here** | It exists and works, but it belongs to the community surface, which already carries it. Duplicating a destructive action on two screens is how one gets pressed by accident. |

## What the owner board draws here, and what of it is true

Board panel 5 is **"PROFILE / PERSONAL IMPACT"** — the reference for this
page. Most of it cannot be built today, and the reasons are worth keeping
beside the drawing:

| Board element | Verdict |
| --- | --- |
| Member photo, member quote | Nothing stores either. A placeholder face, on the one screen that is about this person, is the most personal lie the product could tell. |
| `45 Squats This week`, `3 Contributions This week` | Private-history seam. |
| `6 Day streak` | Private-history seam. |
| `You helped move the community from 216 to 261 squats` | **Arithmetic, not access.** That window holds everyone who wrote in it. |
| `Recent Activity — Added 20 squats 2h ago` | Private-history seam. |
| Tabs `Workouts`, `Friends` | Neither exists. The shell is Home · Community · MOVE · Progress · You, and the target keeps it. |
| Name, community, role, own part, finished goals | **True, and the target is built on these.** |

## What the BEFORE does, and what the target undoes

| BEFORE | Why it is a problem | What the target does |
| --- | --- | --- |
| The identity is a **raw email address**. | The product stores a display name, the member typed it during profile setup, and this screen — the one about them — does not show it. | The name leads, large, on a navy masthead, with the email kept quietly beneath it as the credential it is. |
| Nothing about the community. | The one screen about belonging says nothing about who the member belongs to. | **Where you move**: the community, its member count, the member's role, and the community's current goal with the Living WE at its real shared total. |
| Nothing about what the member has put in. | "My contribution matters here" is the emotional target, and the screen carries no contribution at all. | **Your part**: exact own credit per goal, separately labelled in its own unit, never summed — and, on a tall phone, the finished goals they were part of. |
| Roughly 65% of the screen is empty. | A page with two elements on it reads as unfinished. | The height goes to real content; the sparse states (signed out, failure) place their panel at the top and their true supporting fact at the foot. |

## The state matrix

**Generated, not hand-kept.** See `docs/design-target/ATLAS-COVERAGE.md` —
every state by name, the classes it is drawn at, and whether it carries an
end-of-scroll companion, read from the PNGs on disk.

> A hand table used to sit here. After the 5 × 3 recapture its blank cells
> said `loading` and `failed` existed at one class when all five states exist
> at all three, and it contradicted the generated coverage beside it. A table
> a person maintains next to a table a script generates is a table that will
> disagree with it; this one is deleted rather than re-typed.

## Boundaries held

No personal health or fitness score. No ranking, no comparison with another
member, no other member's figure. No body or health data, no location trail,
no coaching upsell. No forced sharing — and no share control at all, because
no share path for a profile exists. No invented achievement, streak or badge.
**Sign out works on every state, including failure**, because it needs no read
and it is the one action a member may urgently want here.

## Open, and explicitly not claimed

- The private-history callable remains a documented seam, not authorized and
  not built. It is what would make "this week", a contribution count and a
  consistency view truthful.
- Page 5 is implemented; **nothing else is**. No auth change, no kiosk or event
  administration, no multi-movement expansion, no new backend or data
  collection, no staging, no deploy, no merge and no release work is part of
  this package, and no accepted page is redesigned by it.
- This package stops at **actual Before → After visual acceptance**. Atlas
  acceptance authorized Page 5 and nothing further.
