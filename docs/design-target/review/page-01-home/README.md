# Visual checkpoint — Page 1, Home (community command centre)

Route: `/community/[groupId]`, which is where `/` lands a member who has a
current community. This is the real Home.

## The frames

| File | What it is |
| --- | --- |
| `ACTUAL-home-390x844.png` | **ACTUAL IMPLEMENTATION.** The product as it renders today, at this branch head. Not a drawing. |
| `ACTUAL-home-390x640.png` | ACTUAL IMPLEMENTATION, short phone. |
| `ACTUAL-home-430x932.png` | ACTUAL IMPLEMENTATION, large phone. |
| `TARGET-home-390x844.png` | **TARGET / CONCEPT — NOT IMPLEMENTED.** Real React Native against the real design system, captured from a gated preview route. The words are burnt into the image. |
| `TARGET-home-390x640.png` | TARGET / CONCEPT — NOT IMPLEMENTED, short phone. |
| `TARGET-home-430x932.png` | TARGET / CONCEPT — NOT IMPLEMENTED, large phone. |
| `TARGET-home-state-matrix.png` | TARGET / CONCEPT — NOT IMPLEMENTED. Twelve lifecycle states in one frame, each a full-size phone rendering of the same composition. |

There is no AFTER for this page. An AFTER is the product once a change has
shipped, and nothing has been implemented from this target.

## How they were made

Both sets come from the same harness, a local emulator build, at the same head.
No staging, which design review does not need. **No real member data**: the
community, the goal, every number and every timestamp are sample values, and
the accounts behind the ACTUAL frames are synthetic test accounts created by
the e2e fixtures.

```
ACTUAL   tests-e2e/ui-app-shell.spec.ts
TARGET   tests-e2e/design-target-capture.spec.ts
```

The target's preview route is gated on `EXPO_PUBLIC_WSF_USE_EMULATORS`, which
`scripts/westayfit/build-staging.sh` refuses to build with, so no deployed
artifact can serve it.

## What to compare against

`../../owner-north-star/OWNER-BOARD-2-after-target-wsf-vision.png`.
