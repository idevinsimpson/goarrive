# W9 packet 2 — the Back-path spike

**Status: PROPOSED / NOT ACCEPTED.** Prototype only; no production file is
touched. Answers the Director's precondition in #365 `5788831679` §1, routed by
L0 in #443 `5788847765`.

Measured on the built artifact against the emulator, from
`ebae2d9d5f8a08983b41ab226d752a9b0ebda911`.

---

## Result

**All five properties hold together.** The fix is one documented option on the
tab navigator — `backBehavior="history"` — not a hand-rolled history mutation.

| # | Property | Result |
| --- | --- | --- |
| 1 | visible URLs and cold deep links unchanged | ✅ 5/5 cold loads, no group segment in any path |
| 2 | the detail still resolves as Home, with Home selected | ✅ on a cold load **and** arriving from the list |
| 3 | Community-list → detail creates a real back destination | ✅ `history.length` **+1** |
| 4 | Back returns to the still-mounted list, state and scroll intact | ✅ `steps=2`, `scroll` preserved, **0** extra mounts |
| 5 | no duplicate router, no fake screen background | ✅ one tab bar, one top bar, production shell absent; sheet over the **live** tab |

The failing-when-fixed assertion from checkpoint 1 was **kept and inverted**,
not deleted. The same line now reads `toBeGreaterThan(historyOnList)` and fails
again the moment the entry stops being created.

---

## How it was found: the whole table, losers included

Five navigation methods for the one journey, each in its own browser context so
the history delta means what it says.

**Before the fix** — the tab navigator on its default back model:

| method | history | lit on detail | Back lands on |
| --- | --- | --- | --- |
| `Link` (default) | 2 → 2 (**+0**) | home | **left the app** |
| `Link push` | 2 → 2 (**+0**) | home | **left the app** |
| `router.push` | 2 → 2 (**+0**) | home | **left the app** |
| `router.navigate` | 2 → 2 (**+0**) | home | **left the app** |
| `parent.navigate` | 2 → 2 (**+0**) | home | **left the app** |

So **no URL-layer or navigator-layer call fixes it.** That mattered: it ruled
out the whole family of "use a different navigate" answers before reaching for
anything structural, and it is why the fix is not a call site change.

**After `backBehavior="history"`** — the same five, unchanged otherwise:

| method | history | lit on detail | Back lands on | list state |
| --- | --- | --- | --- | --- |
| `Link` (default) | 2 → 3 (**+1**) | home | **the Community list** | `steps=2 scroll=200` |
| `Link push` | 2 → 3 (**+1**) | home | the Community list | `steps=2 scroll=200` |
| `router.push` | 2 → 3 (**+1**) | home | the Community list | `steps=2 scroll=200` |
| `router.navigate` | 2 → 3 (**+1**) | home | the Community list | `steps=2 scroll=200` |
| `parent.navigate` | 2 → 3 (**+1**) | home | the Community list | `steps=2 scroll=200` |

The list ships the plain `Link`, and that row is asserted by name rather than
left to be inferred from "one of them worked".

---

## Why `backBehavior`, and why it is not a history hack

`backBehavior` is a first-class option on `createBottomTabNavigator`,
implemented by the shared tab router. It decides what the navigator's back
action means — and, on web, whether a tab change becomes a real browser history
entry. It is configuration, not a `pushState` call written by hand, so there is
nothing brittle to maintain and nothing to keep in sync with the router's own
idea of its state.

All six modes were driven, because choosing one without measuring the others is
how a "fix" quietly costs something nobody wrote down:

| `backBehavior` | detail entry | Back from detail | 3 tab switches cost | detail lights Home |
| --- | --- | --- | --- | --- |
| **`history`** | **+1** | **the Community list** | **+2** | home |
| `fullHistory` | +1 | the Community list | **+3** | home |
| `order` | +0 | left the app | +2 | home |
| `initialRoute` | +0 | left the app | +1 | home |
| `firstRoute` *(the default)* | +0 | left the app | +1 | home |
| `none` | +0 | left the app | +0 | home |

Two things fall out of this table.

**`history` is the cheapest mode that satisfies the Director.** Only `history`
and `fullHistory` give a real back destination, and `fullHistory` costs one more
entry per journey for no benefit here.

**The `firstRoute` row reproduces checkpoint 1 exactly** (+0 on the detail, +1
for three switches, Back leaving the app), which is the cross-check that the
measurement is of the right thing: the default really was the cause.

And **the detail lights Home in every mode**, which says the two concerns are
not entangled — which tab a route belongs to is a property of the route tree,
not of the back model. That is asserted, so if it ever stops being true this
note is flagged as wrong rather than quietly outdated.

---

## The honest column: what the fix costs

**Three tab switches now add two history entries where they added one.**

This is not incidental, and it cannot be separated out. The mechanism that
gives the community detail a real back destination *is* "a tab change is an
entry in browser history". The matrix shows it with no exceptions: every mode
that brings Back home to the list also makes tab switches cost entries, and
every mode that keeps tab switches cheap leaves Back exiting the app.

So the back button now retraces tab history: from Home after
Home → Community → Progress, Back goes to Progress, then Community. (Two rather
than three because returning to Home collapses onto its earlier entry.)

That sits against a line in the owner's own brief — *"switching primary tabs
stacks no history trail"* — which checkpoint 1 satisfied at +1. The Director's
properties 3 and 4 are explicit and option 1 ("accept it") was refused, so the
fix is in and this is reported rather than smoothed over.

**It is worth noting the two are not obviously both achievable, and this may not
be a loss.** On Android, Back retracing where the member actually went is the
platform convention; the brief's line was written against the old shell, where
`router.replace` made Back unpredictable rather than cheap. But that is a
product judgement, not mine, so: **the cost is stated, the mechanism is
measured, and the call is the Director's.** If the trail is unacceptable, the
matrix above is the evidence that no mode delivers both, and the choice becomes
which of the two properties to keep.

---

## Chrome decisions folded in

From the Director's §1, asserted where they touch this packet:

- **hamburger and sheet Close each measured ≥ 44×44** — the pressable's own box,
  not the glyph; the three-rule hamburger inside it stays 20 wide. ✅
- `/contribute`, `/goals/new`, `/start-community`, `/join` as focused flows
  outside the four-tab chrome — recorded in `CONFLICT-MAP.md` for the migration;
  the prototype has no production routes to demonstrate it on.
- public display, kiosk, station, event and `/move/<goalId>` stay outside —
  asserted (`/kiosk/<id>`, `/display/<id>`, `/move/<id>`, `/` pick up no
  prototype chrome).
- Settings stays a stack utility from the hamburger / You entry, never a fifth
  tab — the menu still carries a **non-pressable** integration slot, and W8's
  `60604ca` now provides the real `/settings` and `/settings/privacy` behind an
  ordinary row in You content for it to point at.

---

## Two instrument errors of mine, recorded

Both were caught by running, not by review, and both would have produced a
confidently wrong report.

1. **The first table shared one browser page across all five methods**, so
   `history.length` plateaued after the first: once you go back and navigate
   forward again the browser *replaces* the forward entry rather than appending.
   Four methods that genuinely worked were reported as `NO BACK ENTRY`. Each
   method now gets its own context.
2. **The five-property test hard-coded `mounts.community === 1`** — the same
   hydration double-mount I had already documented in checkpoint 1 and corrected
   there. A cold `goto` mounts the route twice (static export render, then
   hydration), so a list that had not been rebuilt at all read as rebuilt. The
   baseline is read, not assumed.

A third, smaller: the matrix asserted `scroll=200` exactly, where the browser
clamps to the content's maximum (195). The check was wrong, not the build; it
is a floor now.

---

## Files

| Path | What it does |
| --- | --- |
| `apps/westayfit/tests-e2e/sprint-w9-back-path-spike.spec.ts` | the five-method table, the five properties together, and the 44×44 targets |
| `apps/westayfit/tests-e2e/sprint-w9-back-behaviour-matrix.spec.ts` | all six `backBehavior` modes and what each costs |
| `apps/westayfit/app/design-target/shell-next/(tabs)/_layout.tsx` | `backBehavior`, selectable by query parameter for the spike; `history` by default |
| `apps/westayfit/app/design-target/shell-next/(tabs)/community/index.tsx` | the five-method rig, behind `?spike=1` so it stays out of the review frames |
| `apps/westayfit/tests-e2e/sprint-w9-shell-nav.spec.ts` | checkpoint 1's assertion, kept and inverted |

## Results at this head

- `sprint-w9-*` e2e — **15 passed / 0 failed**
- `sprint-w9-shell-geometry` vitest — **11 passed / 0 failed**
- regression `ui-app-shell` + `ui-kiosk` + `ui-matrix` — **8 passed / 0 failed**
- `ts:check` clean · evidence guard frozen **9** / accepted **20** intact
- ordinary run without `WSF_CAPTURE_FRAMES` writes **zero bytes** (24 files,
  sha256 identical before and after)
