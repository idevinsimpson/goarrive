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

## Contents (filled as the packet lands)

- `ARCHITECTURE.md` — true Tabs vs the minimum-change shell, decided with code.
- `CONFLICT-MAP.md` — file-level dependencies on W8 / W4 / W6 / W2 / W1B.
- `before/` — current-build frames.
- `target/` — proposed frames, each carrying a PROPOSED / NOT ACCEPTED strip
  inside the image.
