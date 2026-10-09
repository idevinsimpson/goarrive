# W9 — production reservation and conflict map

**Status: PROPOSED / NOT ACCEPTED.** Deliverable (E). This is what W9 *would*
reserve if the Director accepts the architecture and L0 sequences the
implementation. **Nothing below is reserved now**, and this packet touches none
of it. L0 reserves the shared files; W9 does not take them by writing this.

Base: `c8f38e37b6286297d1f401834cd9500a675a2923`.

---

## 1. Files W9 would need to write

### 1.1 Sole-writer, no other lane touches them

| File | Change | Note |
| --- | --- | --- |
| `apps/westayfit/app/(tabs)/_layout.tsx` | new | the tab navigator + the persistent top bar mounted above it |
| `apps/westayfit/app/(tabs)/(home)/_layout.tsx` | new | Home tab stack |
| `apps/westayfit/app/(tabs)/community/_layout.tsx` | new | Community tab stack |
| `apps/westayfit/src/ui/MemberTopBar.tsx` | new | the persistent bar (promoted from `shellNext/ShellNextTopBar.tsx`) |
| `apps/westayfit/src/ui/memberShellMetrics.ts` | new | the geometry contract |

### 1.2 Shared — **must be sequenced by L0, and are the collision risk**

| File | Change W9 needs | Who else is in it | How to sequence |
| --- | --- | --- | --- |
| `apps/westayfit/app/_layout.tsx` | declare the `(tabs)` screen; declare `/move` as `transparentModal` with a transparent `contentStyle`; stop rendering `MemberTabBar` directly | nobody currently reserved | W9 takes it for one commit |
| `apps/westayfit/src/ui/MemberTabBar.tsx` | become a react-navigation `tabBar`; guard the press on `focused`; drop `'/move'` from `SHELL_EXACT`; decide `/contribute`, `/goals`, `/start-community`, `/join` | nobody currently reserved | W9 takes it for one commit |
| `apps/westayfit/app/index.tsx` | **move only**, to `app/(tabs)/(home)/index.tsx` — no content edit | **W4** (Home preview / `?view=communities`, integrated at `c8f38e3`) | after W4's Home work lands; a pure `git mv` |
| `apps/westayfit/app/community/index.tsx` | **move only**, to `app/(tabs)/community/index.tsx` | **W8** (community content) | after W8's PR #441 merges |
| `apps/westayfit/app/community/[groupId]/index.tsx` | **move only**, to `app/(tabs)/(home)/community/[groupId]/index.tsx` | **W8** | after W8 |
| `apps/westayfit/app/activity.tsx` | **move only**, to `app/(tabs)/activity.tsx` | nobody currently reserved | any time |
| `apps/westayfit/app/you.tsx` | **move only**, to `app/(tabs)/you.tsx` | **W8** (Settings entry point on You) | after W8 |
| `apps/westayfit/app/move/index.tsx` | **no file change**; it is declared a modal by the root layout | **W1B** adjacent (contribution) | no coordination needed |
| `apps/westayfit/package.json` | declare `@react-navigation/bottom-tabs` directly | shared | L0's call |

**Every row in the "move only" group is a `git mv` with no content edit.** That
is the point of proposing it this way: the move and the content are separable,
so W9 never has to touch a line another lane is writing. A move still conflicts
with a concurrent edit to the same file, which is why the sequencing column
exists.

---

## 2. Dependencies on other lanes

### W8 — social/community content and the member social backend (PR #441)
The one lane W9 must not collide with.

- **Boundary:** W8 owns what is *inside* Community, You and Settings. W9 owns
  the chrome around them and where they sit in the route tree. No file is
  written by both in this packet.
- **W9 needs from W8:** the real `/settings` route. Until it exists the menu
  renders a **non-pressable** integration slot naming W8's lane — not a greyed
  control that does nothing, which would be a dead control.
- **W8 should know from W9:** if tabs are adopted, `you.tsx`,
  `community/index.tsx` and `community/[groupId]/index.tsx` **move** (content
  unchanged). W8's Settings entry on You keeps working; only the file path
  changes. `/settings` itself is expected to be a stack route **above** the tab
  navigator (a focus flow reached from the menu), not a fifth bottom
  destination — the brief is explicit that Settings is not a bottom tab.
- **Ordering:** W8's content lands first, W9's moves second. A move over a
  merged file is clean; a move racing an open PR is not.

### W4 — member journey / `start-community` / Home `?view=communities`
- `app/index.tsx` is the shared file. W4 edits content; W9 would move the file.
- `app/start-community.tsx` is W4's. W9 needs a decision on whether it keeps
  the bottom bar under tabs (today it does). W9 proposes it does **not** — it
  is a flow, not a destination — but this is W4's surface and the Director's
  call, so it is raised rather than taken.

### W6 — goal setup (`goals/new.tsx`, PR #433)
- No file overlap. Same bar question as `start-community`: `/goals` wears the
  shell today and would not under tabs. Flagged, not decided.

### W2 — public display (`app/display/[goalId].tsx`, PR #435/#429)
- No overlap and no risk. Display is outside the member shell today and stays
  outside under this proposal; the e2e asserts that `/display/<id>` picks up no
  member chrome.

### W1B — kiosk confinement (`contribute/[goalId].tsx`, `kioskSession.ts`)
- **No change to kiosk logic, and none proposed.** The kiosk rule is a query
  flag evaluated by `isKioskFlag`, not a path, and the proposal does not touch
  it. The vitest test asserts the rule is still in `MemberTabBar` unchanged.
- `/contribute` currently wears the bar. Under tabs it would not. W9 proposes
  that is **correct** — a contribution is a focus flow — but it is adjacent to
  W1B's confinement work and must be confirmed with W1B before implementation.

---

## 3. What W9 will not do, under any sequencing

- Edit the *content* of Home, Community, Progress, You or Settings.
- Build Settings content.
- Change counting, contribution truth, idempotency, or kiosk logic.
- Add a second navigation system beside the current one in production.
- Deploy, merge to main, integrate, or approve.
- Redraw the wordmark, or edit `WsfWordmark.tsx` or `kit.ts`.

---

## 4. Suggested implementation order, if accepted

1. **The reversible half first, in one commit**, touching only `_layout.tsx`
   and `MemberTabBar.tsx`: persistent top bar, `focused` guard on reselect,
   `/move` out of `SHELL_EXACT` and presented as a modal. This is the
   minimum-change shell from ARCHITECTURE.md §4 — it delivers most of the
   visible fix, collides with no lane, and is easy to revert.
2. **Pause for the Director's verdict** on the two open product questions:
   back-across-a-tab-boundary (§3.1) and whether `/contribute`, `/goals`,
   `/start-community` and `/join` keep the bottom bar.
3. **The route moves**, once W8 (#441) and W4's Home work have merged: pure
   `git mv` into `(tabs)`, `(home)` and `community` groups, plus the three new
   layout files. No content edit in this step.
4. **Verify** against `ui-app-shell`, `ui-kiosk`, `ui-matrix` and the W9 specs,
   with the geometry and mount numbers re-measured on the production routes
   rather than the prototype.
