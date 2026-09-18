# WE STAY FIT — One UI, pass 2 evidence (candidate C)

Owner instruction (13:29 ET): "I need all pages to be new ui and not old ui." UI/UX Director instruction (15:00 ET):
not a reskin; resolve the UI/UX end to end, no user-visible developer or test artifact, every route and secondary
state audited on phone and wide, strong tests, completion gate before candidate C is proposed, then stop for owner
deployment authorization.

| Field | Value |
|---|---|
| Candidate C | `80c26ffcf426306264b71d5a8388d71225dc9f3d` on `claude/wsf-ui-member-experience` (pass 1 `a45ff2e` + pass 2 `80c26ffcf426306264b71d5a8388d71225dc9f3d`) |
| Deployed on staging today | still `65d258d` (candidate B); nothing in this document is deployed |
| Approval file on `main` | `.github/wsf-staging/approved-candidate.json` pins `65d258db…`; the one-line change to `80c26ffcf426306264b71d5a8388d71225dc9f3d` is proposed as an ops PR, not merged |
| Owner action needed | authorize the approval PR merge and ONE `wsf-staging-deploy` dispatch |

## Completion gate

| Gate item | Evidence |
|---|---|
| Type check clean | `tsc --noEmit` exit 0 on the final tree (`final2-tsc.log`) |
| Unit suite green | Vitest 24 files, **390 / 390** (`final2-vitest.log`) |
| Browser / e2e suite green | Playwright on the Firebase emulators, **148 / 148** on the final build (`final2-e2e.log`); 145 original cases + 3 new (`e5-goal-form.spec.ts`) |
| No skipped or weakened assertions | test-strength review lens read every spec diff: one assertion rewritten to a data attribute (same matcher), two assertions added, three cases added, none removed, no `skip`/`fixme`, no widened timeouts |
| Phone captures, every materially distinct route/state | 37 states at 390×844 @2× (`captures-c/manifest.json`) |
| Wide captures | the same 37 states at 1280×800 (74 PNGs) |
| Narrow-width overflow | `noOverflow` rule at 360 and 195 px on all 37 states: 0 offenders (`captures-c/overflow.json`) |
| Adversarial visual review | visual/a11y lens over every capture: 11 findings, all confirmed ones fixed and re-captured |
| Accessibility review | 44 px targets, focus ring, animation, placeholder contrast and roles checked by the a11y lens and by the `ui-a11y*` specs in the suite |
| Every confirmed material finding fixed and retested | 10 of 12 confirmed findings applied (2 were integrator-side: reverting run-written PNGs, confirming the copy-only edits to pass-1 never-edit files); full suite re-run after fixes |
| Exact final SHA | `80c26ffcf426306264b71d5a8388d71225dc9f3d` |
| Changed-file summary | below |

## What changed in pass 2 (on top of pass 1)

- **Goal creation (`app/goals/new.tsx`)** is a Champion screen: "Start a goal", intro line, community implicit when the
  page is opened from a community (id carried only as `data-group-id` on the form), a guidance card instead of a raw id
  field when it is not, "Goal name" / "Target" / "What you're counting", a "When" card with the start in words, duration
  presets (1 week / 2 weeks / 1 month / Custom), Custom dates accepted as `2026-09-25 2:00 PM` or 24-hour, the time zone
  in words with a Change control, "How members take part" for the repeat policy, inline validation sentences, "Start this
  goal", a "Your goal is live" confirmation with "Open the contribute page", share links in plain words, "Back to
  community", no visible ids, no test badge. The callable request shape (local ISO start/end, IANA zone, repeat policy)
  is unchanged.
- **Secondary states** of Community Home, contribute, display, kiosk and challenge render on the kit (loading, signed
  out, not a member, error, closed, not available); the challenge screen gained a way back to the community.
- **Member sentences instead of codes**: new `src/callableErrors.ts` maps raw callable and Firestore failures
  (`internal`, `permission-denied`, "Missing or insufficient permissions.", field-name validation strings) to plain
  sentences on Home, profile setup, start community, join, challenge, Community Home, contribute, display and kiosk;
  "Missing goal id." / "Missing group id." became "This goal / community could not be found."; the emulator-only test note
  reads "Sample data"; the staging banner says "not real" instead of "synthetic"; the not-configured email states say the
  truth for this build: "Email isn't switched on for this test build yet, so no message / reset link was sent."
- **Specs that followed the UX** (selectors and strings only, never weaker): `e5-community-goal-seam.spec.ts` (reads
  `data-goal-id` / `data-group-id` instead of parsing a visible caption; one assertion added at each of two sites that
  had none), `e35-auth-polish.spec.ts` (the new not-configured sentence), new `e5-goal-form.spec.ts` (defaults,
  empty-submit messages, presets, Custom parsing, validation).

Changed files (pass 2 commit):

```
.../app/community/[groupId]/challenge.tsx          |  17 +-
apps/westayfit/app/community/[groupId]/index.tsx   |  38 +-
apps/westayfit/app/contribute/[goalId].tsx         |   4 +-
apps/westayfit/app/display/[goalId].tsx            |   2 +-
apps/westayfit/app/goals/new.tsx                   | 841 ++++++++++++++++-----
apps/westayfit/app/index.tsx                       |  13 +-
apps/westayfit/app/join/[joinCode].tsx             |   7 +-
apps/westayfit/app/kiosk/[goalId].tsx              |   2 +-
apps/westayfit/app/profile-setup.tsx               |   5 +-
apps/westayfit/app/reset-password.tsx              |   8 +-
apps/westayfit/app/start-community.tsx             |   3 +-
apps/westayfit/app/verify-email.tsx                |   6 +-
apps/westayfit/src/StagingBanner.tsx               |   2 +-
apps/westayfit/src/callableErrors.ts               | 106 +++
apps/westayfit/tests-e2e/e35-auth-polish.spec.ts   |   2 +-
.../tests-e2e/e5-community-goal-seam.spec.ts       |  28 +-
apps/westayfit/tests-e2e/e5-goal-form.spec.ts      | 358 +++++++++
17 files changed, 1183 insertions(+), 259 deletions(-)
```

## Verification runs (all on the local Firebase emulators, one at a time)

| Run | tsc | Vitest | Browser suite | Notes |
|---|---|---|---|---|
| Pass-2 battery (stages 1–2b) | clean | 390 | 145 / 145 | before the review fixes |
| Fix round 1 | clean | 390 | 147 / 148 | one seam case hit its 30 s timeout on an untouched member path; passed 8–9 s in every other run |
| Fix round 2 | clean | 390 | 148 / 148 | |
| Fix round 3 (final agent build) | clean | 390 | 148 / 148 | after the time-zone wording |
| Integrator final 1 | clean | 390 | 148 / 148 (6.8m) | after the not-configured wording |
| Integrator final 2 | clean | 390 | 148 / 148 (6.7m) | after the goals-error sentence and the challenge back link (final tree) |

Capture matrix (final tree): 74 PNGs, 37 states, 0 problems, 0 overflow offenders at 360/195. Board:
`scratchpad/wsf-ui-board-c.html` (private artifact shared with the owner).

States captured: home signed-out / signed-in / empty; signin; signup; verify-email; reset-password; profile-setup;
start-community (form, server error, unverified); join (signed-out, signed-in, invalid, private); goals/new (community
known, no community, validation error, custom dates, created); challenge; health; Community Home (member, no goal, closed
goal, signed-out, not a member, error, goals error); contribute (entry, closed, not found, signed-out); display
(authorized, closed, not available); kiosk.

## Review lenses and findings

- Contracts lens: hosted-harness testIDs, momentum regex, kiosk wording and the display uid rule verified byte-identical;
  the four owner-reviewed primary renderings unchanged in structure; changes confined to `apps/westayfit/app`,
  `apps/westayfit/src`, `apps/westayfit/tests-e2e`.
- Test-strength lens: 2 findings (coverage for the new controls → `e5-goal-form.spec.ts`; a comment without an assertion → assertion added).
- Visual/a11y lens: 11 findings; fixed: developer copy on verify/reset, raw "Community ID" variant, time zone as an IANA
  id, silent no-op submit on a bad Custom start, ISO-shaped Custom inputs, role-less Pressables, challenge back path,
  goals-error sentence; confirmed-but-integrator-side: run-written tracked PNGs (reverted before commit), copy-only edits
  to pass-1 never-edit files (reviewed and accepted).

## Intentionally deferred (with reasons)

1. `/health` stays technical (commit, build time in monospace): it is the build-stamp page the ops harness and the owner
   read; reachable only from the "Build details" footer link.
2. The Home identity line prefers the account's display name and falls back to the email; the fixture account in the
   captures had no display name on its Auth record, so the email showed. No product change.
3. The "Sample data" note on contribute / display / kiosk renders only when the build targets the local emulators
   (`wsfUsingEmulators`), never on staging or production.
4. Hosted staging harness (`.github/wsf-staging` on `main`) untouched; its W8 fixture fix (`joinPolicy: 'inviteOnly'`)
   remains a separate one-line ops change awaiting owner approval.
5. Still owner-side from earlier today: W2 transport alignment on `wsfgoalrecentadditions`, removal of the temporary
   `wsfStagingRunInvokerPolicy` binding with before/after scope, staging email configuration (recorded decision: not
   configured).

## Boundaries kept

No production, no WIF/IAM change, no secrets, no spending, no deploy; #327 draft; #332 unmerged; no force push; no
artifacts committed (`tests-e2e/artifacts` reverted before the commit).
