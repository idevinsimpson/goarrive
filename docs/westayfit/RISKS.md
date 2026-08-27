# We Stay Fit — Risks

## R-1: Shared `firestore.rules` merge hazard

A single ruleset file is written by both apps' work streams. Concurrent PRs can conflict silently in ways rules-lint does not catch (e.g., a rule that permits reads on a collection GoArrive assumed was closed).

**Mitigation:** dual regression required before any `firestore.rules` merge — run both apps' rules test suites; block on either failure. Documented as invariant (d) in `ARCHITECTURE.md`.

## R-2: `firebase deploy --only functions` (no codebase filter) deploys BOTH codebases

Someone running the bare command from muscle memory redeploys GoArrive functions when they intended to touch only WSF (or vice versa).

**Mitigation:** deploy commands in `RELEASES.md` receipts always include `--only functions:default` or `--only functions:westayfit`. `firebase functions:list` before/after diff proves scope.

## R-3: Custom claim clobber

If any WSF path ever calls `setCustomUserClaims`, one of the 7 replace-style GoArrive writers will clobber it on the next auth event affecting that user.

**Mitigation:** static Vitest guard (`apps/westayfit/tests/zero-custom-claims.test.ts`) fails CI on any `setCustomUserClaims` occurrence in WSF paths. Not a lint suggestion — the invariant itself.

## R-4: `test:e2e` scope creep

A future contributor adds WSF specs under `tests/` (the GoArrive root testDir) instead of `apps/westayfit/tests-e2e/`, causing the GoArrive regression run to depend on the WSF staging channel URL.

**Mitigation:** WSF playwright config is self-contained with its own `testDir: './tests-e2e'`. Reviewers must reject WSF specs added under root `tests/`.

## R-5: Lovable → Firebase drift

Lovable-side and Firebase-side WSF surfaces evolve independently and develop conflicting mental models of what a "user" or "campaign" means.

**Mitigation:** the four never-builds in `LOVABLE_HANDOFF.md`. No dual-write, no bidirectional sync, no auto-conversion of `interest_responses`, no auto-conversion of `champion_campaigns`. Conversion is always deliberate, one-way, user-triggered.

## R-6: Expo web bundler + symlinked node_modules

Metro bundler in Expo breaks on symlinked `node_modules/` during `expo export`. If WSF's `apps/westayfit/node_modules/` ever becomes a symlink (e.g., via `pnpm` or a workspaces reorg), `expo export` fails cryptically.

**Mitigation:** `apps/westayfit/` uses its own `package.json` and own npm install → real directories. Documented in `EXPO_READINESS.md`.

## R-7: Hosting site name collision on Firebase project

Someone attempts to create a Hosting site named `westayfit` (without `-app`) or renames `westayfit-app` and drops the DNS/preview channels.

**Mitigation:** `firebase.westayfit.json` pins `hosting.site = "westayfit-app"`; renames require an explicit ADR + coordinated DNS change.

## R-8: `firebase functions:delete` prompt-abort false-positive

A functions redeploy that renames a function shows a delete-prompt. Aborting the deploy is safe; accepting it deletes a live GoArrive function. Auto-accepting via `--force` or piped `yes` is the failure mode.

**Mitigation:** WSF deploy commands never pipe `yes` or pass `--force`. Prompt-aborts are treated as stop-conditions, not blockers to be bypassed.
