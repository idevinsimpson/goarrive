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

**Default handler CONFIRMED HEALTHY, 2026-09-02 (Maia, LIVE VERIFIED).** A deliberately
invalid `oobCode` against `https://goarrive.firebaseapp.com/__/auth/action` returns HTTP
200 with Firebase's own auth-action SPA shell — an empty `<div id="actionElement">` that
`action.js` populates client-side — and no server-side redirect. So the handler WSF
retargets to is real and serving, which is what makes `retargetActionLink` a sound fix
rather than a guess.

**Still unconfirmed — and this test did NOT settle it.** The check above hit the *default*
handler. GoArrive's own minted links point at the *custom* action URL
(`https://goarrive.web.app/reset-password`), which was never tested and is still believed
dead. `generatePasswordResetLink` in `addCoach` and `sendMemberInvite` receives that same
custom URL, so every coach and member invite link GoArrive has issued may be inert.
GoArrive's exposure is exactly what it was before the RESETPAGE check — unchanged, not
cleared. Two things could still make it false: `goarrive.web.app` may serve an older
deployment that had the route, or the handler may live outside this repo.

*Recorded because the distinction is easy to lose: proving the fallback works is not the
same as proving the thing in production works, and the first result reads like the second
if nobody writes down which URL was actually hit.*

**Mitigation:** treat every project-level console setting as an undeclared dependency of WSF, not as ambient environment. Before a milestone ships anything that touches auth, email, storage or enforcement, enumerate the console settings that path depends on and record their current values in `DEPENDENCIES.md` — a value nobody wrote down is a value nobody can diff. No automated gate substitutes: these settings are outside the repo, so the only defence is that a human walks the real flow as a real member before the milestone is called done. Every one of these four passed emulator verification, live rules verification, and five PHASE 3 checks.

## R-10: `firestore.indexes.json` is the same shared-file hazard as `firestore.rules`, with no drift gate

R-1 covers the ruleset. The index file has identical replace-the-whole-file semantics on `firebase deploy --only firestore:indexes`, and one extra edge: a deploy from a stale file can propose **deleting** indexes it does not contain. A dropped composite index is a production outage on whatever query needed it, with a rebuild measured in minutes to hours.

Currently latent — 48 indexes, zero for `wsf*`, because WSF runs no compound queries at all; every read is a direct `doc()` get. The first one (M-U3 invites, or listing a member's communities) walks straight into it.

**Mitigation:** GATE 0 — the live-vs-`main` diff built for the rules deploy — has no equivalent for indexes. Build one against the indexes endpoint before the first WSF index ships, and never accept an index deploy that proposes a deletion.

## R-11: Findings recorded only in Slack are findings that will be missed twice

The `auth/email-already-in-use` collision above was found and written up on 2026-08-26, in a Slack message, as N-U8 — in the WSF → GoArrive direction only, and judged not a blocker. The mirror direction, which is the one that blocks the entire existing user base, was never written down anywhere. When it surfaced in a real smoke test five days later it was treated as new.

The audit was right. The record of it was a chat message, so what survived was a label and a wrong summary.

**Mitigation:** an audit whose conclusion matters to a later decision lands in this repo, in `RISKS.md` or `DECISIONS.md`, in the same work session — not in the channel where the work was discussed. When an audit clears a gate, write down the scenarios it *did not* clear as explicitly as the ones it did.

## R-WSF-E1 — goal-read authorization (OPEN — source implementation pending acceptance and hosted verification)

**Was:** possession of a `goalId` returned a community's shared progress to anyone, through
`wsfGoalPulse`; `wsfChallengePulse` did the same for challenge aggregates. Package D's
removal controls did not close it, and its own tests said so.

**Now: source implementation pending acceptance and hosted verification.** The risk stays
OPEN. It was briefly recorded as CLOSED on 2026-09-16; that was wrong, and the correction is
the point of this entry. Nothing that reaches a deployed environment has changed. What exists
is source on `claude/wsf-package-e-display-auth` — per-goal `aggregateDisplayAuthorized`,
default off, Champion-controlled through a real interface control, plus an active-member
route for the member experience. See DECISIONS.md 2026-09-16.

**The deployed baseline is still `1cbf231`, which does not contain any of it.** Until a
deployment of this branch is verified against hosted staging, every deployed WSF surface
behaves exactly as it did before Package E: `wsfGoalPulse` serves any caller holding a
`goalId`. Treat the defect as live in every environment.

**What "closed" will require**, all three: Devin accepts the source; the branch deploys;
the hosted staging smoke re-runs against the deployed build and shows the refusal and the
authorized path behaving as they do locally. Local verification is against `demo-wsf-local`
only and is not hosted verification.

**Residual even then, and deliberately not closed here:** the transport remains publicly
reachable, which is correct and is not the boundary. Whether the legacy challenge aggregate
should ever be shown anonymously is an open compatibility decision, not a defect.

## R-WSF-E2 — the member experience around an authorized goal is unreviewed (OPEN)

Package E made publication a deliberate permission and proved the boundary holds. It did
**not** look at what a member or a visitor actually experiences around an authorized goal:
the Living WE surface, what a display communicates beyond a number, and the member-facing
copy and flow raised during the founder smoke. That work was deferred out of Package E on
purpose so the authorization boundary could be reviewed on its own terms.

**Why it is a risk and not just a backlog item:** the permission is now real and Champions
can turn it on. The experience it turns on has not been designed or reviewed, so the first
community to use it is the review.

**Deliberately not scoped here.** This entry records the deferral once so it is not
rediscovered as a surprise. It is not a licence to redesign anything inside Package E, and
no Package E change should be justified by it. It needs its own packet and its own owner
decision about scope before any of it is built.

## R-12: Competing WSF masters can send an agent backward in time

The repository retained a September 6 file titled `WE_STAY_FIT_MASTER.md` that called
itself the governing master while the project had already adopted Strategic Master v3.0
on September 11. Other files still described M-U1 as current.

**Risk:** a new worker can follow a document that is internally coherent but no longer
authoritative, reintroducing superseded age gates, milestone meanings, deployment paths or
visual direction.

**Mitigation:** `DOCUMENT_AUTHORITY_AND_SUPERSESSION.md`; v3.1 project instructions;
prominent supersession banner on the v1.2 master; CURRENT_STATE.md reduced to a pointer to
the canonical editable #365 state.

## R-13: North Star drift from "latest Lovable" can invalidate in-flight parity work

The WE Community Home reference continues to evolve. An implementation packet that starts
against one accepted state and later chases the newest Lovable head can never have a stable
target or evidence set.

**Mitigation:** freeze journey-specific references in
`ops/NORTH_STAR_JOURNEY_MANIFEST.json` / issued packets. A newer project head does not
retarget work without an explicit Director decision and manifest update.

## R-14: Node.js 20 decommission threatens post-freeze WSF function deploys

Current WSF function deployment receipts warn that Node.js 20 was deprecated April 30,
2026 and is scheduled for decommissioning October 30, 2026.

**Risk:** a release that otherwise passes source review may become undeployable after the
runtime deadline.

**Mitigation:** plan and independently review the runtime upgrade as an explicit
operational packet before decommissioning; do not bundle it incidentally into a product
feature release.

