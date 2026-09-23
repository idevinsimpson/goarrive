# W9 — App shell + navigation UX (`app-shell-next`)

**Status: PROPOSED / NOT ACCEPTED.** Nothing in this package is an AFTER.
Every image here is a prototype drawing of a proposed shell, pending the
Director's creative/product verdict and L0's sequencing of any production
implementation.

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

## The code and the checks

| Path | What it is |
| --- | --- |
| `apps/westayfit/app/design-target/shell-next/**` | Deliverable (B). A runnable prototype behind the existing `EXPO_PUBLIC_WSF_USE_EMULATORS` gate. |
| `apps/westayfit/src/ui/shellNext/**` | The prototype's top bar, tab bar, page scaffold, geometry contract and instrumentation. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-nav.spec.ts` | Deliverable (D) and the deep-link / history contract. Asserts, so it runs in the ordinary suite and writes nothing. |
| `apps/westayfit/tests-e2e/sprint-w9-current-shell-before.spec.ts` | Measures the shipping routes' top chrome and asserts they do **not** agree with each other. |
| `apps/westayfit/tests-e2e/sprint-w9-shell-capture.spec.ts` | Produces `target/`, and asserts each frame's device size and its label. |
| `apps/westayfit/tests/sprint-w9-shell-geometry.test.ts` | The geometry contract and the shipping shell's own rules, as unit checks. |

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
