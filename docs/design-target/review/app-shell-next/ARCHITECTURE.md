# W9 — architecture decision: true Tabs vs the minimum-change shell

**Status: PROPOSED / NOT ACCEPTED.** This is a recommendation with evidence,
not a decision that has been taken. The Director gives the creative/product
verdict; L0 sequences any production implementation and reserves the shared
files first.

Measured at `c8f38e37b6286297d1f401834cd9500a675a2923` on `claude/wsf-app-shell`,
against the built artifact on the emulator (`demo-wsf-local`).

---

## 1. The finding, in numbers

The owner reported from a 14.9 s staging recording that the top of the app
jumps between routes and that the wordmark treatment changes by page.
`tests-e2e/sprint-w9-current-shell-before.spec.ts` signs a seeded member in and
measures the real routes, so the report is a table anybody can re-derive rather
than a description of a video. At 390×844:

| Route | wordmark x, y | height | artwork | first content y | tab bar | raised MOVE |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | — | — | — (redirects) | — | yes | yes |
| `/community` | 18, 21 | 22 | navy | 66 | yes | yes |
| `/activity` | 18, 21 | 22 | navy | 66 | yes | yes |
| `/you` | 20, **33** | **17** | **white** | 68 | yes | yes |
| `/move` | — | — | **none** | — | **yes** | **yes** |

Three separate things are wrong here, and they have three separate causes.

**The header is per-route, so it differs per route.** `app/_layout.tsx` renders
banners, a `Stack`, and `MemberTabBar`. There is no member top bar, so each
route draws its own: `kit.chrome` (minHeight 44) inside `kit.page`
(paddingTop 16, gutter 20, centred in a 640 column) on Home; a `wordmarkTap`
inside a page at paddingTop 10 and gutter 18 on Community and Progress; and on
You a full-bleed **navy** card — paddingTop 26, paddingBottom 22, 30px bottom
corners, `elevation.hero` — carrying the **white** wordmark at 17. Five routes,
five compositions. Note also that Home's wordmark is the only one that is not a
link home, and `/move` has no wordmark at all.

**Reselect reloads.** One line in `src/ui/MemberTabBar.tsx`:

```tsx
onPress={() => router.replace(tab.href)}
```

No guard on the pressed tab already being the current one. Replacing a route
with itself tears the screen down and rebuilds it, so the scroll position goes,
the loaded state goes, and every read on that screen runs again. The same line
explains why coming *back* to a tab shows a fresh skeleton: a flat `Stack`
holds one screen, so leaving Home unmounts it.

**MOVE wears the shell.** `const SHELL_EXACT = ['/move']` puts the member bar
over the MOVE resolver, so the raised MOVE control renders beneath the MOVE
page — a control offering to take a member where they already are. (The player
at `/move/<goalId>` is correctly excluded, because the entry is an exact match
rather than a prefix.)

---

## 2. Recommendation

**Adopt true Expo Router Tabs, with one route group per tab, and present MOVE
as a `transparentModal` in the stack above the tab navigator.**

It is recommended because the three findings above are three symptoms of one
cause — the member shell is chrome painted over a flat stack rather than a
navigator — and a tab navigator removes the cause rather than patching the
symptoms:

- reselect becomes a no-op because the press handler can check `focused`, and
  tabs stay mounted because each is its own screen;
- the top bar is mounted *above* the navigator, so no route can give itself a
  different one;
- MOVE stops being able to render a selected state, because it has **no route
  in the navigator at all** — there is nothing to suppress.

The last point is the one that matters most for durability. The current build
keeps MOVE off the player by a string-matching rule that a future edit could
plausibly get wrong; the proposal makes it structural.

### The URL claim, proven

`(tabs)` is a route **group**, and a group segment contributes nothing to the
URL. The static export is the proof — the build emits, with no group in any
path:

```
dist/design-target/shell-next/index.html
dist/design-target/shell-next/community/index.html
dist/design-target/shell-next/community/detail.html
dist/design-target/shell-next/activity.html
dist/design-target/shell-next/you.html
```

and `sprint-w9-shell-nav.spec.ts` cold-loads each address and asserts the
resulting `location.pathname` contains no `(`. Strip the prototype prefix and
those are `/`, `/community`, `/community/<id>`, `/activity`, `/you` — today's
addresses, to the character.

**So a production migration needs no redirect, changes no visible URL, and
breaks no existing deep link.** The route *files* move into group directories;
the addresses do not move. Every dynamic route keeps its brackets and its
existing `__dynamic` hosting rewrite, because the rewrite matches on a path the
group never enters.

### Measured, on the built artifact

| Claim | Result |
| --- | --- |
| Every member URL cold-loads on its own, no visit to Home first | ✅ 5/5 |
| Group segment absent from every URL | ✅ |
| Active-tab reselect: navigations | **0** (3 presses recorded) |
| Active-tab reselect: remounts | **0** |
| Active-tab reselect: URL change / history entry / lost scroll or state | **none** |
| Home → Community → Progress → Home: Home remounts | **0** |
| All three tabs still mounted after the round trip | ✅ |
| History entries added by 3 tab switches | **1** |
| MOVE open: bar + raised control occluded at their own coordinates | ✅ |
| MOVE open: previous tab still mounted **and painted** underneath | ✅ |
| MOVE close: returns to that exact tab, state intact | ✅ |
| MOVE selected state on any surface | **none — it has no tab route** |
| Top bar box identical across the four tabs | ✅ 1 distinct value |
| Page title origin identical across the four tabs | ✅ 1 distinct value |
| Kiosk / display / event / production routes pick up prototype chrome | **none** |

Regression baseline `ui-app-shell`, `ui-kiosk`, `ui-matrix`: **8/8**,
undisturbed.

---

## 3. What it costs — the honest column

### 3.1 The one measured regression: back across a tab boundary

**This is the only place the proposal is worse than the build it replaces, and
it is the thing to weigh.**

In the shipping build, opening a community from `/community` pushes, and the
browser Back button returns to the list. Under a tab navigator the community
detail must live in the **Home** tab (§3.2), so that navigation crosses tabs;
react-navigation performs a tab jump, and on web a tab jump **replaces** the
history entry instead of pushing one. Measured: `history.length` **2 → 2**
across the jump, and `page.goBack()` from the detail lands on `about:blank` —
it leaves the app.

The URL is right, the lit tab is right, and both tabs stay mounted. The in-app
way back works: the Community tab still holds the list and tapping it returns
there with its state. But the browser/hardware Back gesture from a
community detail no longer returns to the list.

It is asserted in `sprint-w9-shell-nav.spec.ts` as a *failing-when-fixed*
check, so it cannot quietly persist or quietly disappear. Options, none of
which I have authority to choose:

1. **Accept it.** On iOS there is no hardware back button and the in-app path
   works; the cost falls on web and Android back.
2. **Put the community detail in the outer stack**, beside MOVE, so it pushes
   over the tabs with a real history entry. Back works. The cost is that Home's
   redirect then *opens the community over Home* rather than being Home, which
   is a product change to what Home is.
3. **Ship the minimum-change shell instead** (§4), which keeps today's history
   behaviour exactly and gives up mounted-tab state.

### 3.2 A product decision hidden in a file path

`app/index.tsx` does not render a page of its own for a member who has a
community: it resolves one and calls `router.replace('/community/<id>')`. The
community detail **is** what Home is, which is why `MEMBER_TABS[0].match` is
`p === '/' || p.startsWith('/community/')`.

So under tabs the detail has to live in the Home tab, or Home's own redirect
lands the member in a tab they did not press. The prototype does that, and the
consequence is that `/community` (Community tab) and `/community/<id>` (Home
tab) are sibling URLs served by **different tabs**. Expo Router resolves this
without complaint — proven by the export listing above and by a cold load of
each — but it is unusual enough to be worth the Director seeing explicitly, and
it is what produces the back-button cost in §3.1.

### 3.3 Migration surface

Adopting this in production means **moving production route files**, which is
exactly what this packet was told not to do and what L0 must sequence:

| Today | Under tabs | Lands in |
| --- | --- | --- |
| `app/index.tsx` | `app/(tabs)/(home)/index.tsx` | Home tab |
| `app/community/[groupId]/index.tsx` | `app/(tabs)/(home)/community/[groupId]/index.tsx` | Home tab |
| `app/community/index.tsx` | `app/(tabs)/community/index.tsx` | Community tab |
| `app/activity.tsx` | `app/(tabs)/activity.tsx` | Progress tab |
| `app/you.tsx` | `app/(tabs)/you.tsx` | You tab |
| `app/move/index.tsx` | stays at `app/move/index.tsx`, declared `transparentModal` in the root stack | above the tabs |
| `app/move/[goalId].tsx` | unchanged | above the tabs |
| `/contribute`, `/goals`, `/start-community`, `/join` | unchanged | see below |

New files: `app/(tabs)/_layout.tsx`, `app/(tabs)/(home)/_layout.tsx`,
`app/(tabs)/community/_layout.tsx`. Changed: `app/_layout.tsx` (declare the
`(tabs)` screen and the modal presentations) and `src/ui/MemberTabBar.tsx`
(become a `tabBar` with a `focused` guard).

**A behaviour change to flag:** today `shellAppliesTo` puts the bar on
`/contribute`, `/goals`, `/start-community` and `/join`. Under tabs those are
stack routes above the navigator, so they would **lose** the bar unless moved
inside it. For `/contribute` that is arguably right (it is a focus flow, like
MOVE). For `/start-community` and `/join` it is a decision, and it touches W4's
and W1B's surfaces — so it is named here rather than settled.

### 3.4 Two smaller things

- **`@react-navigation/bottom-tabs` (7.18.18) resolves only transitively**, via
  `expo-router`. Fine for a prototype. A production implementation importing
  its `BottomTabBarProps` type should declare it directly — a `package.json`
  change, therefore L0's to sequence.
- **Home mounts twice on a cold load.** The static export renders the route
  into the exported HTML and React mounts it again on hydration. It happens
  before any navigation exists, has nothing to do with tab behaviour, and is
  visible in the `mounts 2` reading on the Home capture. The mount assertions
  are baseline-relative because of it. It is pre-existing and not introduced by
  this proposal.

---

## 4. The alternative, costed rather than dismissed

**The minimum-change shell:** keep the flat `Stack`, add a persistent top bar
to `AppShell`, guard the tab press on `active`, and drop `'/move'` from
`SHELL_EXACT`.

It is real and it is cheap. It fixes the persistent top bar (the bar is in the
root layout, so it is mounted once), it fixes reselect-reloads (the guard is
three lines), and it fixes MOVE's selected state. It changes **no route file**,
so it collides with nobody's lane and could ship this sprint. It keeps today's
history behaviour, so §3.1 does not arise.

**What it cannot do.** A flat `Stack` holds one screen. Leaving Home unmounts
it; coming back builds a new one. So "switching away and back does not throw
your page out" is unreachable — the member still gets a fresh skeleton for a
page they were looking at seconds ago, and every read on it runs again. Nor can
MOVE be a true overlay with the real previous tab underneath: `router.replace`
has already unmounted it, so the only ways to show a context behind the sheet
are to keep a second navigation system alive beside the first (explicitly
forbidden for production in this packet) or to fake the background (forbidden
outright).

**Recommendation stands on that one line.** If preserving mounted tab state and
presenting MOVE over the member's real context are part of the target, true
Tabs is the only one of the two that can deliver them, and the back-button cost
in §3.1 is the price. If they are not, the minimum-change shell is the better
trade this sprint and should be taken instead — it is genuinely most of the
visible win for a fraction of the risk.

A reasonable middle path, if the Director wants the visible fix now and the
structural one later: **ship the minimum-change shell first**, then migrate to
tabs once §3.1 has a decision. The two are not mutually exclusive and the top
bar built for one is the top bar for the other.

---

## 5. What the prototype does not claim

- It is not a design for Home, Community, Progress, You or Settings content.
  Every prototype page is a stand-in; the real pages belong to their lanes.
- It proposes no change to counting, contribution truth, idempotency, kiosk
  logic or any backend behaviour, and touches none of them.
- It invents no notification bell, avatar, "Switch community", face, name,
  quote, reaction or count. The menu holds only what works today — Sign out and
  Build details (`/health`), both currently reachable only from the bottom of
  Home — plus a **non-pressable** integration slot naming W8's `/settings`.
- The captures in `target/` are prototype drawings. They are not AFTERs, they
  are not accepted, and each carries a PROPOSED / NOT ACCEPTED strip inside the
  image.
