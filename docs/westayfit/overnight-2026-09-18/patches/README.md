# Prepared patches — NOT applied (2026-09-18, post-overnight)

Both files here are `git diff` output prepared in throwaway scratch worktrees after the
morning audit. Neither is applied to this branch. Nothing under `firestore.rules` or
`apps/westayfit/app/signup.tsx` has changed on `claude/wsf-ui-member-experience`.

| Patch | Defect | Verification done | Status |
|---|---|---|---|
| `d5-firestore-rules-status-aware.patch` | D-5 — `wsfIsGroupMember` in `firestore.rules` is existence-only; a removed/departed member whose membership row is kept with a changed `membershipStatus` can still read `wsfCommunityGroups/{groupId}` directly (incl. the live and rotated join codes) | Rules suite run in a scratch copy with the patch applied: **24 passed / 24** (22 existing + 2 new `assertFails` cases seeding `membershipStatus: removed` and `departed`) | **NOT applied.** Owner boundary: Firestore rules are outside overnight authority. |
| `d1-signup-single-navigation.patch` | D-1 — `signup.tsx` `onSubmit` navigates to `/verify-email` twice; the late `router.replace` after a slow verification-email round trip can pull a member back from profile setup | App `tsc --noEmit` clean in a scratch copy. The new `d1-signup-single-navigation.spec.ts` was **not run** (needs the branch web build plus an exclusive emulator run). | **NOT applied.** Pre-existing product behaviour on the base branch; awaiting explicit owner authorization per the morning audit's step A/B. |

## Release blocker recorded (D-5 delivery path)

Read-only check of `.github/workflows/wsf-staging-deploy.yml` on `main`: the keyless staging
workflow runs `firebase deploy --only functions:westayfit` plus hosting. It never deploys
Firestore rules. So even once D-5 is authorized and merged, the current workflow cannot ship
it to staging. Options are an owner decision, none taken here: extend the workflow's
`--only` list to include `firestore:rules` (a `.github` change, outside this PR), or deploy
rules by a separate owner-run step. No IAM/WIF broadening is proposed or needed to record
this; whether the existing WIF principal already holds rules-deploy permission was not
tested and is not claimed.

## D-1 fails-before evidence (2026-09-18 ~12:30 UTC, head e910142 build, spec only)

The regression spec from the D-1 patch was run alone against the unpatched build (the
`signup.tsx` change NOT applied; only the spec file placed in the working tree, then removed):

```
✘ d1-signup-single-navigation.spec.ts:153 › D-1: a verified member is not pulled back to
  /verify-email by the late send round trip (12.2s)
  expect(locator).toBeVisible() failed at line 176  — wsf-profile: element(s) not found
  1 failed
```

Reading: the member reached profile setup (the earlier `wsf-profile` expectation passed),
the held `wsfSendVerificationEmail` response was released, and 4 s later profile setup was
gone. That is exactly the late duplicate `router.replace('/verify-email')`. The passes-after
run needs the product change applied to the branch build, which waits for the owner's
explicit authorization.

## D-5 rules coverage against the 08:08 ET audit's six cases

| Audit case | Test | Where |
|---|---|---|
| active member can read its community | `member can read own group` | existing suite (`wsf-rules.test.ts`) |
| removed member cannot | `a REMOVED member cannot read the group (row kept, status changed)` | **new** in the D-5 patch |
| departed member cannot | `a DEPARTED member cannot read the group` | **new** in the D-5 patch |
| unrelated member cannot | `non-member cannot read group` | existing suite |
| platform-admin behaviour unchanged | `platform admin can read any group`, `platform admin cannot write groups either` | existing suite |
| no client writes become allowed | `client cannot create a group directly`, `client cannot update or delete a group`, membership write denials | existing suite |

All eight pass together with the patch applied (24/24). No other rule or index changes.

## How to apply (when authorized)

```
git apply docs/westayfit/overnight-2026-09-18/patches/d5-firestore-rules-status-aware.patch
git apply docs/westayfit/overnight-2026-09-18/patches/d1-signup-single-navigation.patch
```

Then re-run: `npm --prefix functions-westayfit run test:rules` (expects 24) and, for D-1, the
branch web build followed by the full emulator browser suite including the new spec.
