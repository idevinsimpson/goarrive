# Board 07 — Champion management

**Status: SELF-CHECKED · independent board review pending.** The `_FINAL`
filename is the lock verdict's canonical name for this artifact, not an
acceptance status. Locked by PR #365 comment
[`5771412585`](https://github.com/idevinsimpson/goarrive/pull/365#issuecomment-5771412585).

Status layer, from that lock: *"current Manage sheet = BUILT / current-build
review; dedicated dashboard beyond it = NOT BUILT."* Nothing gains standing by
appearing here — **and nothing loses the standing it already had.** The page
the sheet opens over is accepted, and the board records that rather than
overwriting it; see *Two provenances* below.

`WE_STAY_FIT_NORTH_STAR_BOARD_07_CHAMPION_MANAGEMENT_FINAL.png` · 2560×11280 (1280×5640 @2x)

Cut from canonical `31a1560`.

## How it was made

```
node scripts/westayfit/north-star/render-board.mjs scripts/westayfit/north-star/board-07.mjs \
  docs/design-target/north-star-final/board-07/WE_STAY_FIT_NORTH_STAR_BOARD_07_CHAMPION_MANAGEMENT_FINAL.png
```

Seventeen frames, every one read in place from
`docs/design-target/review/champion-manage/after/` — W4's capture package,
delivered by PR #411. None was copied, altered or re-captured. Nothing on this
board was drawn by this worker; the board is a composition of existing evidence
and quotations from the lock.

**Control before authoring.** The renderer was first run against an untouched
committed board — Board 03 — and reproduced it **byte-identically**
(`6072abdc…`). So the toolchain is faithful here, and nothing on Board 07 is an
artefact of a different browser or font stack.

**Every frame was opened.** All seventeen PNGs were read at their native 2×,
not by hash, filename or README. Three of the findings below exist only because
the pixels were looked at.

## Two provenances, and they are not the same fact

| Source | Actual state | Tag on the board |
| --- | --- | --- |
| the three `page-*` frames | **Home itself.** `/community/[groupId]` *is* Page 1 — `app/index.tsx` redirects `/` there for a member with an open community — **accepted at `3562156`** (2026-09-21), recorded in `.github/wsf-staging/approved-candidate.json`. Exactly two commits touched that route between the acceptance and W4's capture SHA: `6e1ce26` removed the 104px mini Living WEs from secondary and closed goal rows so the mark is drawn once per screen, and `e609c57` fixed the hero's "Try again" from navy on navy. | `ACCEPTED BUILD · LATER CAPTURE` |
| the fourteen Manage-sheet frames | the contextual sheet — **current-build review**, per the lock's own status layer. | `CURRENT BUILD · CAPTURED` |

**One fact recorded rather than used to argue.** `renderManageSheet` is 766
lines that are **byte-identical between `3562156` and `5356e3c`** — the sheet in
these frames is the same code that shipped inside the accepted page. That does
not make the sheet accepted: the page verdict rested on frames that never open
it. Not photographed is not the same as not accepted, and it is not the same as
accepted either. The board states the code fact and defers to the lock for the
standing. This is the Board 06 lesson applied in the other direction: there, the
mistake was inferring an absence of acceptance from a freeze list; here the
temptation was to infer its presence from a diff.

## Checked against the lock, line by line

| Locked requirement | On the board |
| --- | --- |
| a Champion remains in the same member journey; Home stays member-first and exposes one quiet `Manage` control | The Home frame — the whole Champion affordance is one pill in the header, beside the real Living WE |
| opening Manage is a bottom sheet over the current community rather than navigation to a new admin section | `manage-entry` at both sizes: the sheet rises over a dimmed Home, which stays visible behind it in every one of the fourteen sheet frames |
| sheet identity is community-first: eyebrow `Champion tools`, title = the community's real name, close control | `CHAMPION TOOLS` / **Harbor Walkers** / `Close`, on every sheet frame |
| sections are grouped rather than sprayed: Goals, Community details, Invite QR, Invite link, Advanced / Membership | *The whole sheet, in one scroll* — `Your event` → `Goals` → `Members and invites` (Community details, Invite QR, Invite link) → `Advanced` · `Membership` |
| per-goal Public display authorization, not a global community switch | *"A permission you grant per goal."* and a per-goal block: **Public display is not authorized for this goal.**, what a display may show and what it never shows, then `Authorize public display`. No global switch appears anywhere |
| `Set up kiosk`, `Screens at this event` and `Start a goal` remain contextual Champion tools; Boards 08, 10–13 detail those flows | `Set up kiosk` and `Start another goal` are on the board as contextual tools and nothing more. **`Screens at this event` is named, not drawn** — see the honest-limits panel |
| Invite QR / link exist only for link-joinable communities; Private communities have no invite link | The Private frame: `Invite QR` reads *"This community cannot be joined from a link, so there is no invite link or QR code to share."* and **the `Invite link` subsection is absent, not disabled** |
| creating a new invite link retires the old and therefore requires an ask-first confirmation | *Asks first* — **The current invite link will stop working for everyone who has it.** + `Yes, create a new link` / `Keep the current link`. The consequence is named for the people holding the link |
| community details may show returned members, created date, type, joining mode, status and role | Only `Members` and `Community since` are photographed; `Show all details` is never expanded in this set. Stated as a limit, not implied as absent |
| leaving is an Advanced membership action with explicit confirmation; **do not** claim it is universally irreversible | *The confirmation, in full*: what stops, what **stays counted**, and *"You can rejoin with a current invite link."* Then `Yes, leave` / `Stay`. Nothing says it cannot be undone |
| loading, goal-read failure, no-goals, invite-not-ready, private-community, copied, copy-failed, resetting/reset-confirming, leave-confirming, leave-failed remain distinct | All ten are on the board and mapped by name in their own panel |
| operational failures never masquerade as genuine empty states | The three-frame section: the header's state line, the kiosk card and the Goals section each say which one it is, and the failure copy never borrows the empty state's words |
| no Living WE introduced as decoration inside management; the only one is the real Home instrument behind the entry | **Exactly one Living WE on this board**, on Home, at the goal's confirmed 14,460 of 30,000. The producer asserts none in the sheet by locator count; all fourteen sheet frames were also read here at 2× |
| no invented member identities, directory, role-management UI or broad administration | None anywhere; the four not-built items are quoted on a navy panel and drawn nowhere |

## What this board deliberately does not do

- It does not promote the Manage sheet to accepted-page status, and it does not
  disturb Home's existing acceptance.
- It does not draw a dedicated admin dashboard or route, a member directory, a
  role-management system, or any administration beyond the sheet — not as a
  target, not as a seam.
- It does not reproduce the kiosk, station or goal-setup flows; the lock assigns
  those to Boards 08 and 10–13.
- It does not show a QR code, or the expanded community details: neither
  `Show QR code` nor `Show all details` is opened anywhere in this capture set.

## Three things the pixels said that the paperwork did not

1. **`page-invite-not-ready-390x844.png` is a top-of-page capture.** The
   producer's state map lists it as *"Your invite link isn't ready yet. Reload
   the page to try again."*, and that message is **below this frame's fold**.
   The frame is used on the board for what it does show — the contextual entry
   and the real Living WE — and the board claims nothing about that state.
2. **The sheet header's second line is a state line, not a goal count.** Five
   variants appear across the set — `2 goals running`, `"Autumn squat challenge"
   is running`, `No goal running yet`, `Checking what is running…` and
   `Goals could not be loaded` — so two of them disclose a failure before the
   member scrolls at all.
3. **The invite-link caveat does not adapt when there is no link yet**
   (W4 reported this; confirmed here by eye). In `manage-invite-not-ready` the
   QR block correctly says the link is not ready while the sentence beneath it
   still describes a link that keeps working. Reported, not built around — no
   product file was touched.

## Fixtures

"Harbor Walkers", "Autumn squat challenge", "Morning walks", the totals, the
dates and every address on these frames are synthetic. No real community,
person or invite link appears. Error and in-flight states carry their injection
in the filename (`INJECTED-NETWORK`, `INJECTED-DELAY`, `INJECTED-CLIPBOARD`),
and no injected failure is presented as an organic one.

## Nothing was filled from memory

Every claim on the board is either a quotation from the lock, a property visible
in the frame it captions, or a fact read out of the repository at a named SHA.
Where the lock did not settle something, it is not asserted.

## Independent board review — PASSED 2026-09-22

Creative / Product Director verdict on PR #416, comment `5785727716`: a pixel
review of the exported original at head `fe82c1e` (run `35795219165`, artifact
`10723837867`; ZIP sha256 `df667d32…`; PNG git blob `df1a5870` matched to the
PR head), all six contiguous inspection sections opened alongside Board 00 and
both exact owner references — **PASS as the canonical CURRENT-BUILD /
RECONSTRUCTED REFERENCE at this source.** L0 may integrate these exact bytes
into the canonical DRAFT and update the status, index and review copy.

The verdict accepts the reference artifact only: **no new app, hosting, privacy
or release acceptance is implied.** The submission footer's
`SELF-CHECKED · INDEPENDENT REVIEW PENDING` is historical submission labelling
and was deliberately not re-rendered — the PNG bytes are exactly the reviewed
bytes.

The unshown expanded-details, QR and `Screens at this event` paths were read as
**explicitly disclosed rather than falsely pictured**. They remain evidence gaps
in the underlying management journey, not a reason to redraw this reference.

### Two annotations that travel with this board

These are **product findings recorded in the integration record**. They are not
permission to repaint source screenshots, and they do not open a further pixel
cycle on this artifact.

1. **The not-built quote is scoped to `5356e3c`, and erases nothing.** The
   lock's `member directory` line, quoted on the navy boundary panel, is the
   not-built list *at this board's source SHA*. It says nothing about work
   authorized elsewhere. PR **#390** — `claude/wsf-community-visibility` into
   `claude/wsf-app-shell`, open and unmerged, review-gate accepted at `e982ddc`,
   nothing deployed — implements the bounded, self-only, per-community naming
   choice that is the first mechanism in the product returning one member's name
   to another. That is a different, unshipped branch with its own authorization,
   and this board's quotation must not be read as retiring it.
2. **Accepting this image does not canonise this composition.** The sheet
   photographed here is the existing **event-first, dense utility** arrangement:
   it opens on `Your event`, and Goals, Members and invites and Advanced follow
   below the fold. Accepting a faithful reference to it does **not** make that
   composition the final premium standard, and it does not override the
   member-first priority. Nor does it bless the copy: the
   **invite-not-ready sentence still incorrectly describes a usable link**
   (finding 3 above). Both remain open product questions against the build, and
   neither is fixed by editing this board.
