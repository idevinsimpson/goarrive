# Champion Manage sheet — CURRENT-BUILD CAPTURES for Board 07

**Source SHA: `5356e3cff2808b52ebc6ac0d3ac5dca24fcfe9de`** (`claude/wsf-app-shell`, the merge of
PR #400 at `ff8c880`).

Produced by W4 for W2's Board 07 work. **These are current-build captures — not a new page, not
an acceptance, not hosted proof.** Every frame is the real contextual Manage sheet the product
renders at `/community/[groupId]` behind the quiet "Manage" control, reached by clicking that
control as a Champion does. No admin page was built, nothing is mocked UI, and no product file
was edited to produce any of it.

| | |
|---|---|
| Producer | `apps/westayfit/tests-e2e/sprint-w4-champion-manage-capture.spec.ts` |
| Frames | `after/` — 17 PNGs, all distinct |
| Write gate | `WSF_CAPTURE_FRAMES=1` (the repository's opt-in convention, via `helpers/capture`) |
| Ordinary run | asserts all 10 cases and **writes nothing** — verified: 10 passed, 0 files |
| Capture run | `WSF_CAPTURE_FRAMES=1 … test:e2e -- sprint-w4-champion-manage-capture.spec.ts` → 10 passed, 17 frames |

Every shot is preceded by an assertion of the named state. A screenshot of the wrong state is
worse than none, because it looks like proof.

## What is injected, and where it is said

Error and in-flight states cannot be photographed without making something fail or hang. Each
such frame carries the injection in its **filename**, and nowhere is an injected failure
presented as an organic one.

| Marker | Meaning |
|---|---|
| `INJECTED-NETWORK` | a callable aborted at the network layer (`route.abort`) |
| `INJECTED-DELAY` | a callable held open, released after the shot |
| `INJECTED-CLIPBOARD` | `navigator.clipboard.writeText` replaced with a rejecting stub |

Everything else is ordinary local emulator fixtures: one verified member, one community, seeded
goals. No public or staging account, no deployment.

## State map

### The sheet, 390×844 (primary)

| Frame | State | Asserted before the shot |
|---|---|---|
| `manage-entry-390x844.png` | normal Champion entry, 2 goals | sheet panel + title visible, Goals section, `A permission you grant per goal.` |
| `manage-goals-loading-INJECTED-DELAY-390x844.png` | goal read in flight | `Loading goals…`; released afterwards and the real read completes |
| `manage-goals-error-INJECTED-NETWORK-390x844.png` | goal read failed | `Goals could not be loaded, so there is nothing to manage yet.` |
| `manage-no-goals-390x844.png` | loaded, none | `No goals yet. Close this and start one from the community page.` |
| `manage-invite-not-ready-390x844.png` | invite link not ready | `wsf-community-invite-link` present (count 1), scrolled into frame |
| `manage-private-no-link-390x844.png` | private community | `wsf-community-invite-link` **and** `wsf-community-reset` both count 0 |
| `manage-reset-confirming-390x844.png` | reset asks first | confirm block + Yes + Keep-the-current-link all visible |
| `manage-resetting-INJECTED-DELAY-390x844.png` | reset in flight | the control reads `Creating a new link…` |
| `manage-reset-done-390x844.png` | reset landed | `wsf-community-invite-reset-done` visible |
| `manage-leave-confirming-390x844.png` | leave asks first | confirm block + Yes + Cancel visible |
| `manage-leave-failed-INJECTED-NETWORK-390x844.png` | leave failed | `wsf-community-leave-error` + its dismiss visible |

### The page's invite card, 390×844

Named `page-*` deliberately — see the first observation below.

| Frame | State |
|---|---|
| `page-invite-copied-390x844.png` | `Copied` |
| `page-invite-copy-failed-INJECTED-CLIPBOARD-390x844.png` | `Copy failed — use the QR code` |
| `page-invite-not-ready-390x844.png` | `Your invite link isn't ready yet. Reload the page to try again.` |

### The short phone, 390×640 — reachability only

The sheet is capped at 88% of the viewport, so this is where a confirmation could fall out of
reach. Not every case is multiplied across every device; only the ones where reaching the
control is the question.

| Frame | State |
|---|---|
| `manage-entry-390x640.png` | the sheet opens and is usable |
| `manage-reset-confirming-390x640.png` | reset confirmation reachable |
| `manage-leave-confirming-390x640.png` | leave confirmation reachable |

Reachability here is a **hit test**, not `toBeVisible`: a tap at the control's own centre must
resolve to that control. W5-M1 was a control that passed `toBeVisible` while the shell took its
taps, so visibility alone is not the question worth asking.

## Invariants asserted on every sheet state

- **No Living WE anywhere in the sheet.** The mark is the shared-progress instrument and belongs
  on the goal hero; a tools sheet has no denominator to be truthful about. Asserted by locator
  count, not by eye.
- **Own-community identity.** The header reads `CHAMPION TOOLS` over the community's own name.
- **Quiet hierarchy, Advanced last** and in the danger colour, so nothing routine is read past it.
- **A private community has no join link** — the whole subsection is absent, not disabled.
- **A reset asks first**, because the consequence belongs to everyone holding the old link.
- **A failed leave does not promise an irreversible departure** — it says the server could not be
  reached and offers OK; the member is still in the community.

## Observed differences from the lock — reported, not built around

Per the packet: report what the build actually does rather than change the product to match the
board.

1. **`copied` / `copy-failed` are not states of the Manage sheet.** The lock groups them with the
   sheet's states, but in this build the copy control lives on the page's "Invite people" card
   (`wsf-community-invite-copy`); the sheet carries the QR and the reset only. The frames are
   named `page-*` so Board 07 does not place a control inside a sheet that does not contain one.
2. **The invite-link caveat does not adapt when there is no link yet.** In
   `manage-invite-not-ready`, the QR block correctly says the link is not ready, while the
   sentence directly beneath still reads "Anyone with this link can join… It keeps working until
   you create a new one." Minor copy inconsistency, product untouched.
3. **The sheet's section order** is: Your event (kiosk / screens) → Goals → Members and invites →
   Advanced. Entry opens on "Your event", so a board framing the sheet on Goals or Members is
   framing a scrolled position, not the arrival.
4. **The header's second line varies with goal count** — "2 goals running · 1 member" with two,
   but `"Autumn squat challenge" is running · 1 member` with one. Both appear across the set.
5. **Two states differ only below the fold.** `invite-not-ready` and `private-no-link` were
   byte-identical on the first capture run, because a shot of the page shows only the sheet's
   top. The producer now scrolls each state's own section into frame before the shutter. Worth
   knowing for Board 07: a single top-of-sheet frame cannot distinguish most of these states.

## Reproducing

```
# from the pinned source, in an isolated runtime
npm --prefix functions-westayfit run build
EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 \
  npm --prefix apps/westayfit run build:web
METADATA_SERVER_DETECTION=none npx firebase emulators:start \
  --config firebase.westayfit.emulators.json --project demo-wsf-local

WSF_CAPTURE_FRAMES=1 \
WSF_PLAYWRIGHT_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 \
  npm --prefix apps/westayfit run test:e2e -- sprint-w4-champion-manage-capture.spec.ts
```

Nothing else in the repository was touched: no product file, no shared renderer, no manifest, no
`.github`, no accepted or frozen frame, and no existing spec.
