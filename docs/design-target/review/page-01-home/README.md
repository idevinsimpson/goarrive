# Visual checkpoint — Page 1, Home (community command centre)

Route: `/community/[groupId]`, which is where `/` lands a member who has a
current community. This is the real Home.

## The frames

| File | What it is |
| --- | --- |
| `BEFORE-home-390x844.png` | **ACTUAL CURRENT BEFORE.** The product as it rendered before this slice. Not a drawing. |
| `BEFORE-home-390x640.png` | Baseline, short phone. |
| `BEFORE-home-430x932.png` | Baseline, large phone. |
| `TARGET-home-390x844.png` | **APPROVED TARGET.** Real React Native, captured through a gated preview route. `TARGET / CONCEPT — NOT IMPLEMENTED` is burnt into the image. |
| `TARGET-home-390x640.png` | Approved target, short phone. |
| `TARGET-home-430x932.png` | Approved target, large phone. |
| `TARGET-home-state-matrix.png` | Approved target, twelve lifecycle states in one frame. |
| `AFTER-home-390x844.png` | **ACTUAL IMPLEMENTATION AFTER.** A screenshot of the running product with the slice applied. |
| `AFTER-home-390x640.png` | After, short phone. |
| `AFTER-home-430x932.png` | After, large phone. |

An AFTER is a screenshot of the product once a change has shipped to the
branch. The three above are that. The TARGET frames are not, and say so in the
image itself.

## How they were made

All three sets come from the same harness, a local emulator build, at this
branch head. No staging, which design review does not need.

```
BEFORE / AFTER   tests-e2e/ui-app-shell.spec.ts
TARGET           tests-e2e/design-target-capture.spec.ts
```

**No real member data.** Every community, goal, number and timestamp is a
sample value, and the accounts behind the BEFORE and AFTER frames are
synthetic test accounts the e2e fixtures create.

## Where the AFTER differs from the TARGET, and why

- **The sample data is the fixture's, not the target's.** The target says
  "Smyrna Strong, 23 members, 241 of 500". The AFTER says what the e2e
  fixture's community actually holds: one member, 1,847 of 5,000. The
  composition is what is under review, not the numbers in it.
- **No MOMENTUM row.** Recent movement is published only where a Champion has
  authorized public display, and this fixture's goal is not authorized. The
  screen renders nothing rather than inventing something, which is the
  unauthorized state — and that state has no target of its own yet.
- **The tab bar still carries four destinations and no raised MOVE.** See the
  checkpoint comment on the PR: a permanently visible MOVE control needs a
  destination this bar cannot currently know, and guessing one would put a
  control that lies into the shell.

## What to compare against

`../../owner-north-star/OWNER-BOARD-2-after-target-wsf-vision.png`.
