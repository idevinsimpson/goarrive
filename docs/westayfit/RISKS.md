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

## R-9: WSF inherits project-level Firebase config it does not own and cannot see

R-1 through R-8 are all about *files* two apps share. This is the harder version: settings that live in the **Firebase console**, belong to the project rather than to either app, were configured for GoArrive's needs, and are invisible in the repo. WSF picks them up silently and no test can see them.

Four instances surfaced within one hour of the first real member walking the flow, after every automated gate had passed:

- **Shared Auth pool.** Every existing GoArrive member and coach already owns their email address in this project, so `createUserWithEmailAndPassword` returns `auth/email-already-in-use` for exactly the people most likely to be handed a WSF invite. Not an edge case — the default case for anyone already in the ecosystem.
- **Built-in email delivery.** WSF is the only thing in the project relying on Firebase Auth to send mail. GoArrive stopped: it has a Resend provider on a verified domain (`functions/src/notifications.ts`) and its `addCoach` / `sendMemberInvite` hand the generated link to an admin instead. WSF self-signup has no admin in the loop, so it inherited an abandoned path. Verification mail does not arrive.
- **Custom action URL.** Auth action links point at `https://goarrive.web.app/reset-password`. **That route does not exist** — no match in any of the 45 routes under `apps/goarrive/app`, and no `oobCode` / `applyActionCode` / `verifyEmail` handling anywhere in the app source. GoArrive hosting ends in a catch-all `** → /index.html`, so the URL returns **200**, renders the app shell, and silently discards the code. Firebase's default handler at `https://goarrive.firebaseapp.com/__/auth/action` still works and is what the custom URL overrode.
- **App Check** (clear today, listed because the coupling is live): enforced nowhere, so WSF callables pass with `app: "MISSING"`. Enabling it project-wide for GoArrive breaks every WSF callable the same day.

**Unconfirmed and worth settling:** `generatePasswordResetLink` in `addCoach` and `sendMemberInvite` receives the same dead action URL. If it is dead for `verifyEmail` it is dead for password resets, which would make every coach and member invite link GoArrive has issued inert. Two things could make that false — `goarrive.web.app` may serve an older deployment that had the route, or the handler may live outside this repo.

**Mitigation:** treat every project-level console setting as an undeclared dependency of WSF, not as ambient environment. Before a milestone ships anything that touches auth, email, storage or enforcement, enumerate the console settings that path depends on and record their current values in `DEPENDENCIES.md` — a value nobody wrote down is a value nobody can diff. No automated gate substitutes: these settings are outside the repo, so the only defence is that a human walks the real flow as a real member before the milestone is called done. Every one of these four passed emulator verification, live rules verification, and five PHASE 3 checks.

## R-10: `firestore.indexes.json` is the same shared-file hazard as `firestore.rules`, with no drift gate

R-1 covers the ruleset. The index file has identical replace-the-whole-file semantics on `firebase deploy --only firestore:indexes`, and one extra edge: a deploy from a stale file can propose **deleting** indexes it does not contain. A dropped composite index is a production outage on whatever query needed it, with a rebuild measured in minutes to hours.

Currently latent — 48 indexes, zero for `wsf*`, because WSF runs no compound queries at all; every read is a direct `doc()` get. The first one (M-U3 invites, or listing a member's communities) walks straight into it.

**Mitigation:** GATE 0 — the live-vs-`main` diff built for the rules deploy — has no equivalent for indexes. Build one against the indexes endpoint before the first WSF index ships, and never accept an index deploy that proposes a deletion.

## R-11: Findings recorded only in Slack are findings that will be missed twice

The `auth/email-already-in-use` collision above was found and written up on 2026-08-26, in a Slack message, as N-U8 — in the WSF → GoArrive direction only, and judged not a blocker. The mirror direction, which is the one that blocks the entire existing user base, was never written down anywhere. When it surfaced in a real smoke test five days later it was treated as new.

The audit was right. The record of it was a chat message, so what survived was a label and a wrong summary.

**Mitigation:** an audit whose conclusion matters to a later decision lands in this repo, in `RISKS.md` or `DECISIONS.md`, in the same work session — not in the channel where the work was discussed. When an audit clears a gate, write down the scenarios it *did not* clear as explicitly as the ones it did.
