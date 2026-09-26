# COMMUNITY-SETTINGS-PARITY-1 — evidence (PR #506)

Product head **`495cf847`** on base `87a86531` (branch `claude/wsf-w9-community-settings-parity-2`).
Supersedes the parked #497 run (`aa22c723` / `e7dc36ee` / `e07453b4`); the older
`RAW-*-aa22c723.log` / `RAW-*-e7dc36ee.log` files that sit in this directory in some
checkouts were never committed (`*.log` is gitignored) and are not part of this record.

Status: **delivered** for W7 verification and Director pixel review. Not accepted, not
integrated, not staged. Emulators only (`demo-wsf-local`); nothing deployed.

## What changed (Director `5841956174`, L0 `5843378340`)

- `app/(tabs)/community/index.tsx` no longer draws its own parity markup. A small adapter
  (`toParityProps`) hands route state to W4's accepted **`CommunityParityView`**. The route
  keeps Firebase / memberReads state, selection, navigation and the `ad3d2f88` `wasRefused`
  drop. The secondary rows ("OPEN ANOTHER COMMUNITY", Momentum) stay outside the core, in
  the view's `footer` slot, after the roster.
- `src/ui/CommunityPrivacyControls.tsx` is now the state owner only, drawing W4's accepted
  **`CommunityPrivacyPanelView`**. It keeps the per-setting generations, account epoch,
  save concurrency (a community takes no second action while its save is unresolved),
  the authoritative quiet re-read, and the three kept failure kinds
  (`notSaved` / `unconfirmed` / `membershipRefused`).
- The Settings overlay (scrim, 180 ms, focus return) is unchanged in behaviour; its body is
  the panel.

### Dependencies — W4-owned files touched (please review as such)

| File | Change | Why |
|---|---|---|
| `src/ui/communityParityTypes.ts` | `footer?: ReactNode` | secondary features after the core, outside W4's view |
| `src/ui/CommunityParityView.tsx` | renders `footer` after the roster | same |
| `src/ui/CommunityParityView.tsx` | Fact labels "Members" / "Your role" / "Goals" + `textTransform: 'uppercase'` | W7 Check 45 C-F2 / C-F7 read the accessible text; it looks identical |
| `src/ui/CommunityParityView.tsx` | `bannerRing` becomes a quarter ring inside the banner's bounds | the full ring was laid out past the right edge at 360 px (`ui-app-shell`) |
| `tests-e2e/sprint-w4-community-parity.spec.ts` | four text assertions follow the label casing | `'Members23'`, `'Your roleMember'`, `'Goals3'`, `'Goals2'` |

### Spec rows whose meaning changed (not weakened — the product changed)

- `community-list.spec.ts` — the populated tab's **Join** is now real (asserted to land on
  `/?view=communities`), where the old route had none.
- `sprint-w8-social-privacy.spec.ts` — waits for `aria-checked="false"` on
  `wsf-privacy-panel-name-<g>` instead of the anonymous note W4's hardening C2 removed.
- H1 — the focus outline must be visible (not `none`, width > 0); the browser draws `auto`,
  not `solid`.
- H3 — the whole community is busy during a save, so there is no second action to take.
- H4 — the refused block says "no longer a member of…" and shows no switches.

## Results on `495cf847`

| Run | Result | RAW |
|---|---|---|
| W7 Check 45 (`18d8caca`), exact | FAIL-BEFORE **15/15**, PRESERVE **13/13**; 6 passed | `RAW-w7-check45-495cf847.txt` |
| W7 Check 43 (`8e5d5955`), exact | 1/7 — selectors only (the switches' test IDs are now W4's `wsf-privacy-panel-*`) | `RAW-w7-check43-exact-495cf847.txt` |
| W7 Check 43, labelled local variant | **6/7**; the one failure is row 3's anonymous note, removed by W4 hardening C2 by design — W7's call | `RAW-w7-check43-variant-495cf847.txt`, `W7-CHECK43-LOCAL-VARIANT.diff` |
| Dependency set (15 spec files) | **133 passed, 1 skipped** (W4's frame capture, gated on `WSF_CAPTURE_FRAMES`) | `RAW-dependency-495cf847.txt` |
| Frame capture (`WSF_CSP_STAGE=CANDIDATE`) | **6/6** | `RAW-capture-495cf847.txt` |
| vitest | 1028 / 1028 | — |
| `tsc --noEmit` | clean | — |

The Check 43 variant changes only selectors (every changed line is marked
`/* W9 LOCAL VARIANT */`); no assertion is changed. W7's own spec copies are not committed.

## Frames (CANDIDATE only — no BEFORE stage this run)

Route-level, full frame, at **390×640** and **390×844**, stamped `495cf847`:

- `CANDIDATE-community-*`, `CANDIDATE-community-lower-*` — the Community tab through W4's view.
- `CANDIDATE-settings-entry-{000,120,240}ms-*`, `-open-*`, `-exit-{000,090,170}ms-*`,
  `-closed-*` — the Settings panel's open, closing and closed states; the timeline
  (including focus return) is in `CANDIDATE-settings-timeline-*.json`.
- `CANDIDATE-reduced-settings-{open,closed}-*` + `CANDIDATE-reduced-motion-*.json` — reduced motion.
- `CANDIDATE-switch-{000,050}ms-*`, `-settled-*` — a privacy switch from press to settled.
- `CANDIDATE-states-*.json` — measured states.

**No Lovable overlays** are included: final pixel acceptance is route-level against frozen
Lovable and is the Director's review.

## Not ours

- The H3c successor belongs to its owner, not this packet.

`MANIFEST.sha256` lists every committed file here.
