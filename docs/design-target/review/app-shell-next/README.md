# W9 — App shell + navigation UX (`app-shell-next`)

**Status: NOT ACCEPTED.** Nothing here has been through the Director.

The package now holds two different kinds of image and they must not be read
as one. `target/` is still a set of **prototype drawings** of a proposed
shell — PROPOSED / NOT ACCEPTED, taken from the gated prototype route.
`successor/` is a set of **captures of the shipping build** with the migration
in it — MIGRATED BUILD / NOT ACCEPTED. Neither is an accepted AFTER; each says
which it is inside the image, not only in this file.

## Start record

| Field | Value |
| --- | --- |
| Lane | W9 — app shell + navigation UX (the one writer of navigation architecture and member chrome until review) |
| Start SHA | `c8f38e37b6286297d1f401834cd9500a675a2923` on `claude/wsf-app-shell` |
| Branch | `claude/wsf-app-shell-nav` (cut from that exact SHA) |
| Base for the PR | `claude/wsf-app-shell` |
| Authority | Owner decision relayed by the Director in PR #365 comment `5788168334` |

`git rev-parse HEAD` in this checkout reported
`c8f38e37b6286297d1f401834cd9500a675a2923`, which matches the SHA named at
creation, so no divergence to report.

## Reservation for this packet

Mine, and nothing else. Any additional file is announced on the PR before it
is touched.

- `apps/westayfit/app/design-target/shell-next.tsx` and
  `apps/westayfit/app/design-target/shell-next/**` — the gated prototype route
  group.
- `apps/westayfit/src/ui/shellNext/**` — prototype top bar, tab bar and MOVE
  focus presentation. Prototype components only. They import the real
  `WsfWordmark` and the real `kit` tokens and edit neither.
- `apps/westayfit/tests-e2e/sprint-w9-*.spec.ts`
- `apps/westayfit/tests/sprint-w9-*.test.ts`
- `docs/design-target/review/app-shell-next/**`
- `docs/westayfit/qa/sprint-w9-*.md`

Explicitly NOT mine in this packet: `app/_layout.tsx`,
`src/ui/MemberTabBar.tsx`, `src/ui/WsfWordmark.tsx`, `src/ui/kit.ts`, every
production route under `app/`, `functions-westayfit/**`, `firestore.*`,
`.github/**`, any board or pre-existing producer,
`scripts/westayfit/check-evidence-intact.mjs`, another worker's specs, and
every frozen BEFORE or accepted TARGET/AFTER image.

## Contents

| Path | What it is |
| --- | --- |
| `ARCHITECTURE.md` | Deliverable (A). True Tabs vs the minimum-change shell, decided with code and measurements. §3.1's regression is **resolved in packet 2**. |
| `BACK-PATH-SPIKE.md` | Packet 2. The Back-path spike: all five Director properties measured together, the five navigation methods and all six `backBehavior` modes, and what the fix costs. |
| `CONFLICT-MAP.md` | Deliverable (E). The production files W9 *would* reserve, and every dependency on W8 / W4 / W6 / W2 / W1B. Nothing in it is reserved yet. |
| `before/` | Current-build frames and `chrome-geometry.json`, captured from the **real** member routes at this branch's start SHA — not reused from an accepted package, so there is no stale-blob question. **Do not re-run its producer casually** — see the note below. |
| `target/` | Deliverable (C). Proposed frames at 390×844 and 390×640 for Home → Community → Progress → You → MOVE open → MOVE close, plus a contact sheet. Each frame carries a PROPOSED / NOT ACCEPTED strip **inside** the image. |
| `successor/` | Packet 4. Twelve frames of the **migrated production shell** at 390×844 and 390×640 — Home, Community, Progress, You, MOVE focused-open and contributing focused — plus a contact sheet. Each frame carries a MIGRATED BUILD / NOT ACCEPTED strip **inside** the image. |

## The code and the checks

| Path | What it is |
| --- | --- |
| `apps/westayfit/app/design-target/shell-next/**` | Deliverable (B). A runnable prototype behind the existing `EXPO_PUBLIC_WSF_USE_EMULATORS` gate. |
| `apps/westayfit/src/ui/shellNext/**` | The prototype's top bar, tab bar, page scaffold, geometry contract and instrumentation. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-nav.spec.ts` | Deliverable (D) and the deep-link / history contract. Asserts, so it runs in the ordinary suite and writes nothing. |
| `apps/westayfit/tests-e2e/sprint-w9-current-shell-before.spec.ts` | Produces the frozen `before/` frames and `chrome-geometry.json`. Its live assertions were the owner's complaint as an inequality; with the shell landed they are the AFTER of the same measurements — one wordmark, one top-bar box on all four destinations, MOVE no longer wearing the bar. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-successor-capture.spec.ts` | Produces `successor/`, and asserts what each frame claims: one top bar on four tabs, MOVE open over a still-attached tab with the bar unreachable, and no member chrome on the contribution route. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-manage-action.spec.ts` | The relocation of Champion tools into the persistent menu: who is offered it, that it opens the sheet that did not move, the 220 px budget it buys back, and every way it is withdrawn. |
| `apps/westayfit/tests-e2e/sprint-w9-community-url-seam.spec.ts` | The community address from both entry points and across a cold load, with the ruled `?groupId=` seam asserted narrowly. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-production.spec.ts` | The shell's own promises on the routes that SHIP: the active tab as a no-op, four tabs that stay mounted with their scroll, and MOVE opening over the tab the member was on and closing back onto it. |
| `apps/westayfit/src/ui/memberShellActions.tsx` | The route-scoped action registry the shell provides and the focused screen writes to. Holds no sheet state. |
| `apps/westayfit/tests-e2e/helpers/memberShell.ts`, `helpers/communityUrl.ts` | Opening Champion tools where they now live, and the narrow community-address assertion. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-capture.spec.ts` | Produces `target/`, and asserts each frame's device size and its label. |
| `apps/westayfit/tests/sprint-w9-shell-geometry.test.ts` | The geometry contract and the shipping shell's own rules, as unit checks. |

## What the migration cost the rest of the suite, defect by defect

A full run of the 392-test e2e suite against the migrated build came back with
22 failures. Every one was read rather than counted, and they fall into seven
groups. Nothing here was made to pass by relaxing an assertion.

| Group | Tests | What it actually was | What was done |
|---|---|---|---|
| Top bar overflows at 200% text zoom | 7 | The bar's wordmark box carried no shrink, so at 195 px of usable width the menu button sat at x=230 and the document scrolled sideways — the R1 rule | **Fixed in the shell**: the wordmark shrinks, the 44 px control is pinned |
| An empty chrome row on Community Home | 1 | Release 2 removed the wordmark and left its row: 34 px plus a 14 px gap reserved for nothing, which pushed W8's first momentum row 43 px below the tab bar at 390×844 | **Fixed in the page**: the row renders only when it holds something |
| `boundingBox()` waiting for a bar that is not on show | 3 | MOVE opens over the shell and contributing lives outside it; the helper's "no shell here" branch asked for a box first, and `boundingBox()` waits for visibility with no timeout | **Fixed in the helper**: the branch asks `isVisible()` |
| Assertions on a page's own wordmark | 3 | Release 2 removed the per-page wordmarks the Director released; two live checks and this packet's own route-by-route measurement still named them | **Repointed** at `wsf-member-topbar-wordmark`, and the measurement now states the AFTER it measures |
| A redundant `?groupId=` on `/community/<id>` | 3 | An expo-router serialisation artifact of entering a tab-nested route from outside its tab — see below | **Reported, not patched** |
| A 43 px control on Community Home | 2 | `wsf-community-members-link` is 43 px tall, one short of the 44 px rule — **fails on the base build too**, measured — see below | **Reported, not patched** |
| The Champion's goal hero, out of budget | 1 | The shell's 52 px bar is pure addition above a Champion's own Manage row, and the 220 px budget now has no slack — measured 226 to 262, passing in some runs — see below | **Reported, not patched** |

The first four groups are 14 of the 22, and all 14 pass at this head. Two more
surfaced only after those were fixed, and are in the table above: W1B's
scroll-restore claim, re-made at a height where the page has a scroll, and the
Champion hero.

## The `?groupId=` seam — ACCEPTED by ruling, and guarded narrowly

Opening a community **from the Community tab** lands on
`/community/<id>?groupId=<id>` — the same id, twice, once as the path segment
and once as a redundant query. Opening the same community **from Home** lands
on `/community/<id>` with nothing after it. Three assertions across
`community-list` and `mu2-flow` name the bare form and fail on the first;
`community-list` was run against the base build and passes there, so this is
this branch's, not the base's.

It is not a call-site mistake and it is not a guess. The navigation state was
read live out of the running app at both entry points:

```
from Home        (tabs) → (home) [params: null] → community/[groupId]/index [params: {groupId}]
from Community   (tabs) → (home) [params: {groupId, screen, params}] → community/[groupId]/index [params: {groupId}]
```

Entering a tab-nested route from **outside that tab** leaves the navigate
payload on the TAB route, and expo-router's `getPathFromState` serialises the
leftover as a query string. Four call-site shapes were built and measured —
`router.replace('/community/<id>')`, the object form
`{ pathname: '/community/[groupId]', params }`, a tab switch followed by a
same-tab push, and an href carrying the group segments explicitly — and all
four produce it. `lazy: false` on the navigator removes it and is not usable:
every tab then mounts at once and one screen's surface covers the others.

What it does **not** affect: the path is unchanged, so deep links, shared
links, reloads and the alias/rewrite table are all exactly as before; the page
reads the same id either way.

Whichever tab owns the community detail, the other tab's entry crosses a
navigator, so moving the route does not remove this — it moves it.

**Clearing the leftover was tried, and it is worse.** A `screenListeners`
`state` handler on the navigator that cleared the payload keys off the tab
route the moment the state committed was built, shipped into a real build and
measured: the address became `/` and the member landed on the Home tab's index
instead of the community they had just chosen. Clearing the payload does not
only tidy the URL, it removes the navigator's record of where it was going.
That change was reverted, and it is the reason the remaining candidate is not
a quiet patch either: hoisting the detail out of the `(home)` stack into the
tab navigator itself changes what Back means and invalidates the packet-2
spike's measurements.

**The Director ruled on it** (`5795072805`): accept it as a known Expo Router
serialisation seam; do not hoist the detail, mutate browser history, or add a
second router to hide it; and keep a NARROW regression in place of the bare-URL
assertions.

That regression is `expectCommunityUrl`, and it is four claims rather than one:
the pathname is exactly `/community/<id>`; the only query parameter that may
appear at all is `groupId`; its value is the same id the path carries; and no
fragment is added. `sprint-w9-community-url-seam.spec.ts` carries the rest —
both entry points, one community rendered and named by the path, and the
address surviving a cold load both as produced and in its bare form. It
exercises the seam on purpose: the cross-tab entry goes first, because arriving
at a community detail before crossing produces no query at all, and a draft
that did so recorded "(no query)" and would have guarded nothing.

A bounded trade, not permission for query drift: a new parameter, a different
id, or a fragment all fail. If a later router version stops emitting the copy,
every claim still holds unchanged.

## `wsf-community-members-link` — not this branch's defect, fixed in this branch by ruling

`ui-a11y` R3 and `ui-a11y-fixes` (d) both report one control under the 44 px
minimum on Community Home and in the Manage sheet:

```
wsf-community-members-link[link] 350×43 "See everyone in this community›"
```

It arrived with W8's presence work (`3b7a8f5`) and it is not this branch's:
the base `740a763` was checked out, built and run, and **both tests fail there
too**. Its style block is byte-identical between the base and this head:

```ts
peopleLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
peopleLinkText: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
peopleLinkChevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },
```

The height is self-contained — 10 + 10 of padding around a chevron line box of
about 23 — and nothing the shell adds or removes touches it.

**The Director released the correction into this branch** (`5795101998`),
because the community-detail file is reserved to W9 while the migration is in
flight and handing the same file back mid-flight would be worse. `peopleLink`
gains `minHeight: 44` — a minimum, not a height, so the row still sizes to its
own content wherever that is taller. No copy, hierarchy, social-data or
navigation change.

Both sweeps are kept and now pass, and
`sprint-w9-members-link-target.spec.ts` is the direct measurement the ruling
asked for: it names the control, prints what it measured, and asks the harder
question a sweep does not — that the top, middle and bottom of the box all
belong to this pressable rather than to an ancestor with padding. (It scrolls
the row clear of the raised MOVE control first: at the arrival scroll that
overhang covers its lower edge, and a hit test there measures the bar.)
Proven discriminating: with `minHeight` mutated to 43 it fails and reports the
measured 43.

## The Champion's goal hero — RULED, and fixed by moving Manage into the shell

`ui-mobile-acceptance`'s Eastern-time journey ends by returning from a created
goal to Community Home and asking that the goal hero starts within 220 px of
the product area. It **passes on the base** — measured at 210, with 10 px of
slack — and here it has no slack left at all: the same test measured **262** in
two full-suite runs, **226** in two consecutive solo runs, and passed in two
others. The budget is exhausted for the Champion view, and which side of the
line a run lands on is decided by whether the identity band's presence line has
rendered when the measurement is taken. A verdict that depends on a render race
is not a verdict, which is why it was reported rather than papered over with a
second screen-specific budget.

The 52 px are the bar's, and the measurement says so exactly. On the base, the
page's own chrome row carried the wordmark AND the Champion's Manage control
together, starting at y=12:

```
base   page chrome row y=12 h=44 (wordmark + Manage) → community name y=87  → hero y=210
head   shell top bar   y=0  h=52 → page row y=64 h=44 (Manage alone) → name y=139 → hero y=262
```

The wordmark moved into the shell; the row it shared did not move with it,
because it still holds Manage. So a Champion now pays for two rows where they
used to pay for one. An ordinary member pays for one and lands at 204 — which
is why the empty-row fix above was worth making and is not enough on its own.

**The Director ruled** (`5795072805`): do not widen the 220 px budget — remove
the duplicate management row by making Manage a context action in the
persistent hamburger, for an authorized Champion only.

That is what landed. `src/ui/memberShellActions.tsx` is a registry the shell
provides and the focused screen writes to — a key, a label and a callback. It
holds no sheet state and there is no second Manage: Community Home keeps its
sheet, its state and its behaviour, and what travels through the registry is a
callback that flips the same `manageOpen`. The row is deleted, with its styles.

Stale actions are the whole design, because tabs stay mounted on purpose:
registration rides `useFocusEffect`, so it is withdrawn on a tab switch, a push
or an unmount; a scope of account and community rebuilds it when either
changes; and the provider empties outright when the account does.

Measured at 390×844 with the presence line rendered:

```
before the ruling   Champion 226-262 (race) · member 204
after               Champion 204            · member 204
```

The budget is met deterministically, on the ordinary 220 px, with no
screen-specific exception. `sprint-w9-shell-manage-action.spec.ts` guards all
of it: no row on the page, a 44 px menu row that opens the sheet that did not
move, the hero inside the budget with the presence line on screen, and the
action withdrawn on a tab switch, on leaving for a focused flow, and when the
next account signs in on the same device.

### One colour moved with the row

Deleting the row exposed a contrast violation that was always there. The
hero's presence line is `INK_QUIET` (#6B7C93) on cream — **3.9:1**, where WCAG
AA wants 4.5:1 at that size. axe could not say so before: the line sat at
y=209, overlapping the navy hero that starts at 210, and an overlap makes the
contrast check INCOMPLETE rather than a violation. Lifting the line onto plain
cream let the check finish, and `ui-a11y` R7a failed on it. It now uses
`TEXT_MUTED` (#5A6B85), the design system's own muted token, which measures
**5.0:1** on the same cream — an existing token, not a new colour.

### What it cost the rest of the suite

Forty-one call sites across nineteen specs opened the sheet by tapping the
page's own row. Each now goes through `openMemberManage`, which opens the bar's
menu and chooses Manage community; nothing inside the sheet changed. The "this
person is not offered Champion tools" assertions became `manageOffered(page)
=== false`, which asks the question where the way in now lives. Three needed
more than that: `ui-a11y`'s Tab walk expects the shell's menu button, its
Escape test expects focus back on that button (the bar hands focus back to
itself as the menu closes, because a chosen row is gone), and
`ui-mobile-acceptance` — which may only tap by coordinates — makes the two taps
a thumb makes.

## MOVE — HELD on the Director's actual-pixel review, then made a real sheet

The pixel review (`5795268359`) passed the shell direction and held one thing:
the migrated MOVE frame was an opaque cream screen with no visible Close. The
outer stack was already presenting `/move` as a transparent modal — the
finding was that the screen then painted cream across the whole viewport, so
the tab underneath was mounted and invisible. It also still reserved
`MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG`, chrome belonging to a screen
it is no longer part of, which is where the large empty lower field came from.

`apps/westayfit/app/move/index.tsx` was released to W9 for presentation and
navigation only. Every goal-resolution path, callable, ordering, no-goal and
error meaning, destination URL, the one-goal auto-resolution and the
contribution handoff are untouched, and so is every word on the screen.

- **A scrim and a bounded panel.** The scrim covers the viewport, which is what
  keeps the tab bar — and the covered tab's top bar — from being touched while
  the sheet is open, as well as what dims the context. The panel stops at 88 %,
  so the screen it opened over stays identifiable behind it.
- **One explicit Close**, 44×44, top right, in the same place in every state.
  `back()` to the exact mounted tab with its scroll and loaded state; on a cold
  or deep-linked `/move`, where nothing was covered, it resolves to the
  canonical member destination instead of being a dead control. The scrim
  dismisses too, because that is what a scrim is.
- **The obsolete bottom-bar reservation is gone**; the sheet pads to the
  device's own safe area.
- **No top bar inside MOVE.** The one visible belongs to the tab underneath and
  is behind the scrim with it.
- **Reduced motion** is unchanged and still removes the travel: the entrance is
  the Stack screen's `animation: reduced ? 'none' : 'slide_from_bottom'`, and
  the screen adds no travel of its own.

The proofs are in `sprint-w9-shell-production.spec.ts`, and they are about what
can be SEEN and TOUCHED rather than what is in the document: opened from Home
and from You the tab underneath keeps a planted mark; the panel is bounded and
the scrim is translucent, so there is context to see; neither the tab bar nor
the top bar resolves to itself at **nine points across its own width**; Close
is 44×44 and returns to that exact screen with its non-vacuous planted scroll;
and a cold `/move` closes to the canonical member destination. The twelve
successor frames are re-shot on it.

## How the suite's own arithmetic reconciles

L0 asked (`5796367768` §1) which figure the runner printed, and where the
one-test difference in my earlier receipts came from. Every run's arithmetic
balances exactly; **the mismatch was in my heading, not in the run**. I had
quoted a `playwright test --list` total taken at a different moment — after a
spec file was added — instead of the total the run itself printed.

| Retained log | Runner printed | passed + failed + skipped |
|---|---|---|
| `e2e-full3.log` | **393** | 330 + 22 + 41 = 393 |
| `e2e-final.log` | **393** | 343 + 9 + 41 = 393 |
| `e2e-gate.log` | **396** | 348 + 7 + 41 = 396 |
| `e2e-gate2.log` | **396** | 350 + 5 + 41 = 396 |
| `e2e-gate3.log` | **399** | 355 + 3 + 41 = 399 |

No skipped-versus-counted discrepancy and no duplicate id: the totals are the
totals. The headings that said 392 and 397 were wrong by one and by one.

### Every failure in the successor run, named

`e2e-gate3.log`, sorted into the three bins L0 asked for:

| Bin | Count | Which |
|---|---|---|
| The accepted `?groupId=` seam | **0** | it has a narrow regression now (`expectCommunityUrl`), so it fails nothing |
| Real defects | **0** | — |
| Non-reproducing | **3** | `event-return:230`, `ui-a11y` R1 maxima, `ui-contribute-guide:356` — all three re-run serially in one command and **all three passed** |

### What the tested build carried

`EXPO_PUBLIC_WSF_AUTH_ENABLED=1` and `EXPO_PUBLIC_WSF_USE_EMULATORS=1`, plus
`build:web`'s own `EXPO_PUBLIC_BUILD_COMMIT` and `EXPO_PUBLIC_WSF_BUILT_AT`.
The **ordinary** `npm run build:web` — no flags — was also run at this head and
exited 0 with no ERROR line and no tree deletion; the flagged build is what the
emulator then serves, because the flagless one puts the whole app in its
accounts-closed state.

The functions emulator carries **49** loaded functions, which is what the
merged base `740a763` defines. An earlier run of mine was made against a stale
emulator carrying 46, which produced CORS failures on `wsfCommunityMembers` and
`wsfCommunityActivity`; those results were discarded, not reported.

Every run's complete log is retained in this session's scratchpad
(`e2e-full3`, `e2e-final`, `e2e-gate`, `e2e-gate2`, `e2e-gate3`, `e2e-gate4`,
plus each build log), and every count in this file cites the run it came from.

## Three per-page AFTER capture specs still name wordmarks that no longer exist

`design-community-after-capture`, `design-progress-after-capture` and
`design-you-after-capture` measure `wsf-community-wordmark`,
`wsf-activity-wordmark` and `wsf-you-wordmark` — the copies the Director
released Community, Progress and You from drawing. All three specs are **gated
and skipped** in an ordinary run, so they do not block anything today, and a
gated re-capture of those packages would fail on a missing locator rather than
silently shoot the wrong thing. They are other packages' AFTER producers, so
they are flagged here rather than rewritten.

## Results at the head of this branch

Every number below is the count the suite's own run printed, not a tally by eye.

| Run | Result |
|---|---|
| **Whole e2e suite** (399 tests) | **355 passed / 3 failed / 41 skipped**, 19.7 min |
| — standing failures | **0** |
| — parallel-load flakes | **3** — `event-return`, `ui-a11y` R1 maxima, `ui-contribute-guide` — all three re-run serially and **passing** |
| `sprint-w9-*` e2e (eleven files) | **22 passed / 0 failed** |
| `sprint-w9-shell-geometry` vitest | **11 passed / 0 failed** |
| Whole vitest suite | **821 passed / 0 failed**, 48 files |
| `sprint-w1b-kiosk-confinement` / `-idle-finish` | **10 / 0** and **9 / 0** |
| `ui-mobile-acceptance` + `ui-contribute-short-phone` | **15 passed / 0 failed** |
| Ordinary `npm run build:web` | **exit 0**, no ERROR line, no tree deletion, 9 route-group duplicates skipped |
| `ts:check` | clean |
| `check-evidence-intact.mjs` | frozen **9** / accepted **20** intact |

The two failures that stood at the previous head were the base build's 43 px
members link. The Director released that correction into this branch, so the
suite now has **no standing failure at all**.

### The Director's gate, item by item

| # | Gate | Where it is asserted |
|---|---|---|
| 1 | ordinary `build:web`, no export-tree deletion | run above; `dist/` intact, 9 duplicates skipped |
| 2 | same-tab reselect: zero navigation, zero reload, no remount | `sprint-w9-shell-production` — `history.length` unchanged, a `window` mark and a DOM-node mark both survive, scroll preserved |
| 3 | four tabs stay mounted and restore state | `sprint-w9-shell-production` — each tab marked, each still the same node when returned to |
| 4 | MOVE over the mounted prior tab, bar unreachable, Close returns to it | `sprint-w9-shell-production` — both tests, opened from Home AND from You, with the sheet bounded, the scrim translucent, neither bar reachable at nine points across its width, Close 44×44, and a cold `/move` fallback |
| 5 | ordinary contribution Back/Close, six-point proof at a non-vacuous 390×640 scroll fixture | `sprint-w1b-kiosk-confinement` |
| 6 | Champion hamburger Manage opens the existing sheet and disappears on route/role change | `sprint-w9-shell-manage-action` |
| 7 | successor frames, MIGRATED BUILD / NOT ACCEPTED, one masthead, no duplicate page chrome, explicit Close on MOVE, no obsolete bottom-bar spacing | `successor/`, re-shot on this head — **13 frames**: the twelve plus `MIGRATED-g-champion-menu-open-390x640.png` |
| + | the members link is a 44 px touch target | `sprint-w9-members-link-target`, plus the two sweeps that first reported it |

An ordinary run without `WSF_CAPTURE_FRAMES` still writes zero bytes of this
package's evidence; the guard above is what proves it after every pass.

## The BEFORE producer is non-deterministic in its pixels

`sprint-w9-current-shell-before.spec.ts` seeds a member, a community and a goal
with a fresh stamp on every run, so the rendered display name and ids differ
run to run and the PNGs come back a few hundred bytes different while showing
the same thing. Re-running it **gated** therefore rewrites frames that have
already been exported and reviewed (#444, artifact `10731246963`, reviewed at
`ebae2d9`), which is churn on accepted evidence rather than new information.

What the review actually depends on — the measured chrome geometry — is stable:
`before/chrome-geometry.json` came back **byte-identical** across runs. So the
rule is: run the BEFORE producer **ungated** whenever you like (it asserts, and
writes nothing), and gate it only when you intend to replace those frames on
purpose. The five PNGs a packet-2 run had rewritten were restored to their
reviewed bytes.

## The headline numbers

| | Shipping build | Proposed |
| --- | --- | --- |
| Wordmark across the four tabs | navy 22 / navy 22 / **white 17** / absent on `/move` | one navy 22, every tab |
| Top-bar box across the four tabs | four different compositions | **1** distinct value |
| Page-title origin across the four tabs | 66 / 66 / 68 / — | **1** distinct value |
| Reselect the active tab | `router.replace` → remount | **0** navigations, **0** remounts |
| Leave a tab and come back | rebuilt from scratch | **0** remounts, still mounted |
| History added by 3 tab switches | — | **1** entry |
| Bar under the MOVE page | present, raised MOVE and all | occluded; MOVE has no tab route |
| Back from a community detail | returns to the list | **returns to the list**, still mounted, state and scroll intact |
| History added by 3 tab switches *(the fix's cost)* | — | **2**, up from 1 — see BACK-PATH-SPIKE.md |
