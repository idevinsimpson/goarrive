# BEFORE — reused, not re-shot

There is no PNG in this folder on purpose.

The current-build BEFORE for `/goals/new` already exists, in full, at
[`../../goal-setup-current/`](../../goal-setup-current/): 16 frames at 390×844 and 390×640,
shot off the real route with real fixtures against the local emulator, with the created receipt
produced by the real `wsfCreateGoal` callable.

Re-shooting them here would produce **the same pixels from the same source** and put a second
copy of evidence in the tree, which is exactly the failure mode
`scripts/westayfit/check-evidence-intact.mjs` exists to catch. So this package reuses them and
proves the reuse instead.

## Why reuse is valid — the route's source is byte-identical

| Claim | Command | Result |
|---|---|---|
| The route's blob at the BEFORE capture SHA | `git rev-parse 0757379:apps/westayfit/app/goals/new.tsx` | `e5be66f0e9afb03ae92c1ba3573fc641bd749ef3` |
| The route's blob at this package's base `a193b43` | `git rev-parse a193b43:apps/westayfit/app/goals/new.tsx` | `e5be66f0e9afb03ae92c1ba3573fc641bd749ef3` |
| Every app-source change between the two | `git diff --stat 0757379 a193b43 -- apps/westayfit/app apps/westayfit/src` | `app/join/[joinCode].tsx`, `src/ui/designTarget/JoinSetupTargets.tsx` — **nothing else** |

Neither changed file is rendered by `/goals/new`: one is the `/join/:joinCode` route, the other
is the Join batch's target component. The screens in `goal-setup-current/` are therefore what
this branch's `/goals/new` renders today.

`e5be66f` is also the blob the Director had read when the W6 packet was written, so the target
below is drawn against the same source the packet describes.

## The frames this package's TARGET answers

Verified in this container with `sha256sum`; each matches the digest recorded in
`../../goal-setup-current/README.md`, so the frozen bytes are intact.

| BEFORE frame | sha256 (first 16) | The TARGET frame that answers it |
|---|---|---|
| `form-populated-top-390x844.png` | `b6552e98f8334205` | `PROPOSED-form-top-390x844.png` |
| `form-populated-top-390x640.png` | `89589fb6014700ed` | `PROPOSED-form-top-390x640.png` |
| `form-duration-options-390x844.png` | `e56a6de66a66c3b5` | `PROPOSED-form-top-390x844.png` |
| `form-duration-derived-window-390x844.png` | `aa802ba90b25d6bf` | `PROPOSED-form-top-390x844.png` |
| `form-custom-window-390x844.png` | `a102247aeb893de2` | `PROPOSED-custom-window-390x844.png` |
| `form-repeat-once-390x844.png` | `0ba083ff7c1a63e5` | `PROPOSED-summary-commit-390x844.png` |
| `form-repeat-multiple-390x844.png` | `32b5aa2ba5dcb533` | `PROPOSED-summary-commit-390x844.png` |
| `form-summary-check-it-over-390x844.png` | `2973f029af3d4fff` | `PROPOSED-summary-commit-390x844.png` |
| `form-summary-check-it-over-390x640.png` | `f5d78e35e871de8f` | `PROPOSED-summary-commit-390x640.png` |
| `form-server-refusal-INJECTED-NETWORK-390x844.png` | `5855ca2f7f30880d` | `PROPOSED-refused-*` and `PROPOSED-unconfirmed-*` (the build draws ONE state where the route has two) |
| `created-receipt-390x844.png` | `cb91d4b27f6ec6b3` | `PROPOSED-created-390x844.png` |
| `created-actions-390x640.png` | `5fd70104e9876198` | `PROPOSED-created-390x640.png` |

Four BEFORE frames have no TARGET opposite in this checkpoint and are listed so the omission is
deliberate rather than silent: `form-validation-first-refused-390x844.png`,
`form-submitting-INJECTED-DELAY-390x844.png`, `no-community-390x844.png` and
`signed-out-390x844.png`. The first two keep the build's treatment unchanged (the field message
in `kit.errorText` under the field; `Starting…` on the disabled control) and the last two are
arrival guards this proposal does not touch. Drawing them would have made an atlas where the
packet asked for a checkpoint.
