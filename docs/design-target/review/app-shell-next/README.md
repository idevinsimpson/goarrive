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
| The Champion's goal hero, 42 px past its budget | 1 | The shell's 52 px bar is pure addition above a Champion's own Manage row — see below | **Reported, not patched** |

The first four groups are 14 of the 22, and all 14 pass at this head. Two more
surfaced only after those were fixed, and are in the table above: W1B's
scroll-restore claim, re-made at a height where the page has a scroll, and the
Champion hero.

## The `?groupId=` artifact: what it is, and why it is not patched here

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

**This is a ruling, not a patch**, so the three assertions are left failing and
naming the truth rather than being widened to accept it.

## `wsf-community-members-link` is 43 px, and it is not this branch's

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
about 23 — and nothing the shell adds or removes touches it. The one-line
patch is `minHeight: 44` on `peopleLink`; it belongs to whoever owns that
surface, and W9 has not applied it.

## The Champion's goal hero is 42 px past the 220 px budget

`ui-mobile-acceptance`'s Eastern-time journey ends by returning from a created
goal to Community Home and asking that the goal hero starts within 220 px of
the product area. It **passes on the base** and fails here at **262**.

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

Two ways out, and both are somebody's call rather than mine:

1. **Manage joins the shell.** The top bar already carries a menu on the
   right; Champion tools belong there far more than in a row of their own, and
   the page row disappears entirely (hero at 204, 16 px inside the budget).
   It is member chrome, so it is W9 work, but it changes a Champion's surface
   and the Manage sheet's state lives in the page, so it needs plumbing and a
   release rather than a quiet patch.
2. **A screen-specific budget**, the way B.3 gave "Start your community" 224 px
   at 390×844. This one would need 264, which is not a pixel of headroom — it
   is a different composition — so it should not be granted without (1) having
   been considered first.

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

- `sprint-w9-*` e2e — **15 passed / 0 failed**.
- `sprint-w9-shell-geometry` vitest — **11 passed / 0 failed**.
- Regression baseline `ui-app-shell`, `ui-kiosk`, `ui-matrix` — **8 passed / 0 failed**.
- `ts:check` clean; `check-evidence-intact.mjs` frozen 9 / accepted 20 intact.
- An ordinary run without `WSF_CAPTURE_FRAMES` writes **zero bytes**: 24 files
  in this package, sha256 identical before and after.

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
