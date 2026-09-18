# Prepared patches (2026-09-18, post-overnight) — BOTH APPLIED on the branch at 5a3fbde after the owner's 08:2x ET authorization

Both files here are `git diff` output prepared in throwaway scratch worktrees after the
morning audit, before the owner's authorization. They are kept as the historical record of
what was proposed; the live code on the branch (commit `5a3fbde` and later) is the source of
truth and has since been hardened further by the adversarial review (positive-control reads
in the rules tests, a trimmed and deterministic D-1 spec, the spec added to Gate 1).

| Patch | Defect | Verification done | Status |
|---|---|---|---|
| `d5-firestore-rules-status-aware.patch` | D-5 — `wsfIsGroupMember` in `firestore.rules` is existence-only; a removed/departed member whose membership row is kept with a changed `membershipStatus` can still read `wsfCommunityGroups/{groupId}` directly (incl. the live and rotated join codes) | Rules suite run in a scratch copy with the patch applied: **24 passed / 24** (22 existing + 2 new `assertFails` cases seeding `membershipStatus: removed` and `departed`) | **Applied at `5a3fbde`** (owner-authorized 08:2x ET). |
| `d1-signup-single-navigation.patch` | D-1 — `signup.tsx` `onSubmit` navigates to `/verify-email` twice; the late `router.replace` after a slow verification-email round trip can pull a member back from profile setup | App `tsc --noEmit` clean in a scratch copy. The new `d1-signup-single-navigation.spec.ts` was **not run** (needs the branch web build plus an exclusive emulator run). | **Applied at `5a3fbde`** (owner-authorized 08:2x ET); passes-after proven in the branch build (see `today-2026-09-18/00-LIVE-STATUS.md`). |

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
run was done on the branch build at `5a3fbde` after authorization: the spec passed, together
with the four signup-driving specs (32/32).

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
