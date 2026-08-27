# We Stay Fit — Architecture

Anchor commit: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf` (origin/main at M-U1 dispatch).

We Stay Fit (WSF) is a second first-party app that lives inside the `goarrive` monorepo and ships from the same Firebase project as GoArrive, without sharing UI code, functions codebase, hosting site, or user claims. GoArrive is proven-unchanged after every WSF change; that proof is the contract.

## Permanent Invariants

These invariants hold across all future milestones. Any change to them requires an explicit ADR entry in `DECISIONS.md` and dual regression proof against GoArrive.

### (a) Two applications, one repo, one Firebase project

The repository at `github.com/idevinsimpson/goarrive` hosts two first-party apps:

- `apps/goarrive/` — the GoArrive coach/member fitness platform (pre-existing).
- `apps/westayfit/` — the We Stay Fit universal-community app (this milestone).

Both apps ship from Firebase project `goarrive` (single project ID). There is no `westayfit` Firebase project and none will be created. `.firebaserc` is not changed by this milestone.

### (b) Two Hosting sites, one project

Firebase Hosting in a single project supports multiple sites. WSF ships to Hosting site `westayfit-app` (created inside the `goarrive` project). GoArrive continues to ship to its existing sites unchanged.

- WSF config: `firebase.westayfit.json` (`hosting.site = "westayfit-app"`, `hosting.public = "apps/westayfit/dist"`).
- GoArrive config: root `firebase.json` (`hosting` block unchanged by this milestone; only the `functions` array is extended — see invariant (c) below).

The two configs are deployed independently. `firebase hosting:channel:deploy staging --config firebase.westayfit.json` deploys only the WSF site; the GoArrive site is untouched.

### (c) Two functions codebases, one deploy graph

The root `firebase.json` `functions` array carries two entries:

- `{ "source": "functions", "codebase": "default", ... }` — the existing GoArrive functions (unchanged).
- `{ "source": "functions-westayfit", "codebase": "westayfit", ... }` — the new WSF functions.

Codebases are the isolation boundary. WSF functions deploy via `firebase deploy --only functions:westayfit`; GoArrive functions deploy via `firebase deploy --only functions:default` (or `--only functions` for both). `firebase functions:list` after a WSF-only deploy must show every pre-existing GoArrive function still present.

### (d) Shared canonical Firestore ruleset (dual regression required)

`firestore.rules` is a single file for the whole `goarrive` project. WSF-owned collections (see `DATA_OWNERSHIP.md`) get their own rule blocks inside that file. Any change to `firestore.rules` — for either app — must be regression-tested against both apps before merge. There is no separate `firestore.westayfit.rules`; splitting the ruleset would create a merge hazard at deploy time (last writer wins).

### (e) Shared Storage rules

`storage.rules` is likewise a single file. Same dual-regression rule applies.

### (f) Zero custom claims for WSF users

WSF functions must never call `admin.auth().setCustomUserClaims(...)`. Rationale:

The GoArrive functions codebase has **8 call sites** that write custom claims. **7 of them replace the whole claims object** and would silently clobber any WSF-specific claim on the same user:

- `functions/src/index.ts:1892`
- `functions/src/index.ts:2945`
- `functions/src/index.ts:3099`
- `functions/src/index.ts:3221`
- `functions/src/index.ts:3318`
- `functions/src/index.ts:11060`
- `functions/src/leads.ts:214`

**Exactly one** site — `setAdminRole` at `functions/src/index.ts:6460` — spreads existing claims (`{ ...existingClaims, admin: true }`). The zero-claims invariant exists because of the 7; the lone merge-style site is the exception that proves the codebase has no consistent merge convention.

Enforcement: the WSF Vitest suite includes a static guard (`apps/westayfit/tests/zero-custom-claims.test.ts`) that greps `functions-westayfit/` and `apps/westayfit/` for `setCustomUserClaims` and fails on any hit. This guard is not a lint suggestion — it is the invariant.

WSF authorization uses Firestore document reads, not custom claims.

### (g) No dual-write, no bidirectional sync, no auto-conversion

The Lovable-side WSF marketing/interest surface and the Firebase-side WSF app share the same Firebase project but are treated as separate systems for data flow:

1. No dual-write: a single write operation must not fan out to a second collection with a "keep them in sync" intent.
2. No bidirectional sync: cross-collection copies flow one way per collection and are explicit, not implicit.
3. No auto-conversion of `interest_responses` into user accounts or memberships.
4. No auto-conversion of `champion_campaigns` into any downstream artifact.

Any conversion is a deliberate, single-direction, user-triggered action with its own function and its own audit.

See `LOVABLE_HANDOFF.md` for the full boundary description.

### (h) Playwright configs are per-app and self-contained

Each app owns its own `playwright.config.ts` with its own `testDir` and its own `baseURL` env variable. There is no shared root Playwright config that runs both apps' e2e specs.

- GoArrive: `playwright.config.ts` at repo root (pre-existing), `testDir: './tests'`, `PLAYWRIGHT_BASE_URL`.
- WSF: `apps/westayfit/playwright.config.ts`, `testDir: './tests-e2e'`, `WSF_PLAYWRIGHT_BASE_URL`.

`npm run test:e2e` at the repo root runs the GoArrive suite only. WSF e2e is invoked as `npm --prefix apps/westayfit run test:e2e`, which passes `--config` to its own file. This prevents a bare `test:e2e` from silently pulling WSF specs into a GoArrive regression run.

## Deploy Boundary Summary

| Surface | GoArrive command | WSF command |
|---|---|---|
| Hosting | `firebase deploy --only hosting --config firebase.json` | `firebase hosting:channel:deploy staging --config firebase.westayfit.json` |
| Functions | `firebase deploy --only functions:default` | `firebase deploy --only functions:westayfit` |
| Firestore rules | `firebase deploy --only firestore:rules` (shared file, dual regression required) |  |
| Storage rules | `firebase deploy --only storage` (shared file, dual regression required) |  |
| Vitest | `npm --prefix apps/goarrive run test:vitest` | `npm --prefix apps/westayfit run test:vitest` |
| Playwright | `npm run test:e2e` (root) | `npm --prefix apps/westayfit run test:e2e` |
| Type-check | `npm --prefix apps/goarrive run ts:check` | `npm --prefix apps/westayfit run ts:check` |

## Proof-of-Unchanged Contract

Every WSF change must produce these two receipts before PR merge:

1. `git diff --stat origin/main -- apps/goarrive functions firestore.rules firestore.indexes.json storage.rules` — must be empty.
2. `firebase functions:list` before and after WSF-only deploy — every GoArrive function still present, no unexpected deletions or renames.
