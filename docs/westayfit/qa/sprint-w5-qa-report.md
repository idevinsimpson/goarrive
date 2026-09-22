# Sprint Round 1 — W5 Independent QA / Security

Worker: **W5 — INDEPENDENT QA / SECURITY**
Branch: `claude/wsf-sprint-independent-qa`
Starting SHA: `e609c57319b2cb9f2a6dac044f310c535ec61185` (`claude/wsf-app-shell`, verified by `git rev-parse` at session start, not assumed)
Assignment: PR #365 comment 5781435779, section W5 + section 4.

## Pinned heads under review

| Ref | Head SHA (verified) |
|---|---|
| `claude/wsf-app-shell` (#365) | `e609c57319b2cb9f2a6dac044f310c535ec61185` |
| `claude/wsf-staging-mail-binding` (#393) | `cb91d7879119ec94550986b1caf9be71723d2942` |
| `claude/wsf-community-visibility` (#390) | `e982ddc78267355cda057c0a04b0134b2acf1928` |

All three matched the SHAs named in the assignment at fetch time.

## Scope and constraints held

- Read-only on every branch reviewed (`git show` / detached worktree only; no modification, no push to another branch).
- Regression probes added ONLY as new `apps/westayfit/tests-e2e/sprint-w5-*.spec.ts` or
  `functions-westayfit/tests/callable/sprint-w5-*.test.ts` files. No existing test or product UI edited.
- No deployments, no `gcloud secrets` access, no IAM/WIF/network-policy change, no rules/index deploy.
- No test skipped, disabled or weakened. No secrets, join codes or enrolment codes printed.
- No approval or merge recommendation issued for any PR — the Program Director reviews, the owner decides.

## Status

- Part 1 — independent review of #393 at `cb91d78`: **CHECKPOINT-READY**.
  Posted as a comment on PR #393 and reproduced in PR #395's body.
- Part 2 — member-work QA: **CHECKPOINT-READY**. One defect found (W5-M1, LOW).
  No privacy or data-isolation defect, so no escalation was triggered.

## Part 1 — #393 independent review, findings

Full evidence is in the #393 comment. Summary, three moderate and three low/trivial:

| | finding | severity |
|---|---|---|
| F1 | `reachedJobs` (`workflow-contract.test.mjs:316-338`) walks a hardcoded seven-name `order` array, so a job added to the workflow is invisible to the reach matrix; neither it nor the structural test catches a job with **no `if:` at all**, which GitHub runs in every mode including `mail-binding` | moderate |
| F2 | when the serving revision carries the alias — real Cloud Run behaviour after a `--set-secrets=SECRET:latest` deploy, since Cloud Run resolves `latest` at instance start — the report prints `served version latest` with no qualifier on that line; the docstring (`:18-23`) claims revision-time resolution and `fake-gcloud.mjs:72` hardcodes `'2'`, so the case is never modelled | moderate |
| F4 | `:150` matches `v?.key === secretName \|\| v?.secret === secretName`, conflating the **env var name** with the **secret name**; a different secret's version can be reported under the requested secret's header, and `ref.secret` is never printed | moderate |
| F3 | the revision projection `json(spec.containers[].env)` is path-wide, not variable-wide — literal env values enter the process (nothing reaches stdout, proven), so the stated mechanism is not what prevents the dump | low |
| F6 | a failure carrying an absence token and none of the three guard tokens still reads as `absent`; unproven against real `gcloud`, and bounded (`absent`, never `unbound`) | low |
| F5 | docstring says "FOUR STATES" and lists five (`:25-32`); `readsAsAbsent` evaluated twice at `:133-134` | trivial |

Verified correct rather than assumed: no secret payload read is reachable (`versions`/`secrets` → 0 hits,
array-form `spawnSync` with no shell, `secretName` never passed to `gcloud`); nothing read reaches the
log; an alias is never relabelled as a number and a served version is never guessed; permission failure
never reads as absence for any phrasing carrying a guard token; the report never fails the run; and in
`mail-binding` mode no build, deploy or verify job runs at this head.

`node .github/wsf-staging/tests/run-all.mjs` at `cb91d78`: **exit 0, all suites passed, 14 suites,
293 assertions, 0 failures.**

Nine mutations attempted (`sprint-w5-393-mutations.sh`, reproducible): M1/M2/M3 caught by the PR's own
tests; M4/M5 caught only incidentally by unrelated rules; **M6, M7 and M9 survived**; M8 is a case the
fixture does not model.

No member-privacy or data-isolation defect was found in #393, so no escalation was triggered by part 1.
No approval or merge recommendation was given.


## Part 2 — member-work QA

Run against the emulators (`firebase.westayfit.emulators.json`, project `demo-wsf-local`,
Firestore 8080 / Auth 9099 / Functions 5001 / Hosting 5010) with `functions-westayfit`
compiled first and the web bundle built with `EXPO_PUBLIC_WSF_AUTH_ENABLED=1
EXPO_PUBLIC_WSF_USE_EMULATORS=1`. Probes added ONLY as new `sprint-w5-*` files; no existing
test or product file was edited. `npx tsc --noEmit` was run after each spec edit, not only
before. Artifacts were reverted and `check-evidence-intact.mjs` re-run after every e2e run —
frozen BEFORE (8 paths) and accepted TARGET/AFTER (16 paths) intact, no byte changed.
`WSF_CAPTURE_FRAMES` and `WSF_CAPTURE_BEFORE` were never set.

### Whole-suite baseline at `e609c57`, with the new probes in place

`npx jest --config jest.callable.config.cjs` (the full callable suite, including the two
probes added here): **30 suites, 445 tests, 445 passed, 0 failed, exit 0.**
`npx jest --config jest.rules.config.cjs`: **28 passed, 0 failed.**
So the probes are additive — they pass alongside everything that was already there, and
nothing that was already there regressed with them present.

### At `e609c57` — identity switching

`identity-account-switch.spec.ts`: **2 passed, 0 failed.** Both cases — signing out and
creating another account never shows the first, and a second context signed in as A is
untouched by B's sign-up — pass on this head, so the corrected e5 sign-out fixture holds.

New probe `functions-westayfit/tests/callable/sprint-w5-pending-reconcile-identity.test.ts`:
**6 passed, 0 failed.** The account-switch hazard documented in
`apps/westayfit/src/pendingContribution.ts` — a pending attempt replayed under a different
uid, which the server's `{goalId}_{uid}_{attemptId}` key does not deduplicate — behaves
correctly end to end:

- ALPHA contributes 40, reconciles to their own 40.
- BRAVO reconciling the SAME goal sees a real `0` — not ALPHA's 40, and not the goal total.
- The SAME `attemptId` submitted by BRAVO is BRAVO's own contribution (7) and leaves ALPHA's
  credit at 40: the duplicate is neither swallowed nor misattributed.
- ALPHA replaying their own `attemptId` still totals 40, not 80.
- A signed-out reconcile is `unauthenticated` and names nobody.
- A non-member's refusal carries neither the number nor either uid.

### At `e609c57` — public / kiosk / display payloads

New probe `functions-westayfit/tests/callable/sprint-w5-public-surface-identity.test.ts`:
**7 passed, 0 failed.** Two seeded members with unmistakable identifiers, real contributions
through the real callable, then each `invoker: 'public'` surface called **unauthenticated**
and the whole response searched recursively — keys as well as values, case-insensitively,
and on failures as well as successes:

`wsfGoalPulse`, `wsfGoalRecentAdditions`, `wsfChallengePulse`, `wsfCombinedGoalPulse`,
`wsfPreviewCommunity`, `wsfStationState` — **zero identity in any of them.**

The seventh case is the detector proving it can fire (a name in a value, a uid used as an
object KEY, an email interpolated into an error string, and a clean aggregate payload), so
the six above cannot pass vacuously.

### At `e609c57` — short phone, 390x640

New probe `apps/westayfit/tests-e2e/sprint-w5-short-phone-usability.spec.ts`:
**6 tests, 6 passed** (one of them an explicitly annotated expected failure recording W5-M1).
Home, MOVE and You each checked for horizontal overflow, the tab bar's whole box inside the
viewport, every tab's rendered box against the 44px tap floor, the raised MOVE action
unclipped, and — after scrolling to the end — no interactive control left under the bar.

Home and You are clean on every check. MOVE carries one defect.

#### W5-M1 — LOW — "Skip timer" is visible but untappable on a short phone

**Where:** `/move` (`apps/westayfit/app/contribute/[goalId].tsx:1829-1838`), control
`wsf-contribute-skip-timer` — "Skip timer and enter {unit}".

**Reproduce:** sign in as a member of a community with an active goal, open `/move` at a
390-wide viewport, wait for `wsf-contribute-done`, then read
`document.elementFromPoint()` at the centre of `wsf-contribute-skip-timer`:

| viewport | what is at the control's own centre | reachable |
|---|---|---|
| 390x844 | the control itself | yes |
| 390x664 | `wsf-member-tab-move` | **no** |
| 390x640 | the raised MOVE action | **no** |

The screen does not scroll at any of the three heights (`scrollHeight === clientHeight`),
so nothing can bring it clear.

**Cause:** the raised MOVE action rises `MEMBER_TAB_MOVE_OVERHANG` = 24px above the tab bar
(`apps/westayfit/src/ui/MemberTabBar.tsx:181`) and occludes whatever the screen puts there.
Once the viewport is short, the contribute screen's `actions` block ends inside that overhang.

**Severity LOW, and only because of this:** the primary control directly above it,
`wsf-contribute-done` ("I'm done — enter my {unit}"), calls the *same* `onDoneMoving`
handler, is hittable at all three heights, and was driven by a real click at each — reaching
the entry screen every time. No member is blocked from recording. What is wrong is a control
that reads as available and cannot be pressed.

**Two things worth the Director's attention:** it reproduces at **390x664**, which
`PHONE_CONTEXTS` key `B` already covers — the existing specs miss it because they assert
visibility, and `toBeVisible` passes for an occluded element. And the same file already
adapts at `windowHeight < 700` (it hides a caption at line 1815), so a threshold for this
case exists and this control was simply not included in it.

It is recorded with Playwright's `test.fail()` rather than a skip: the body still runs, so
the day the occlusion is fixed the annotation itself fails with "expected to fail but
passed" and has to be removed. A skip would go quiet and the finding would rot.

Not a privacy or data-isolation defect, so it did not trigger the escalation path.

### At `e982ddc` (#390) — read-only, from a throwaway detached worktree

Probe parked as `sprint-w5-390-visibility.probe.ts.txt` with
`sprint-w5-390-visibility-HOWTO.md` (it cannot compile on this branch, where those
callables do not exist). **11 tests, 11 passed, 0 failed:**

- a fresh membership is private; the directory names nobody;
- opting in names you in THAT community and **not** in another community the same account
  belongs to;
- **no `targetUid` override** — a Champion passing `targetUid` publishes only themselves,
  and the target's row is left with no `visibility` field at all;
- only the two literals are accepted: `true`, `1`, `'Visible'`, `' visible'`, `null`, `{}`,
  `['visible']` and a missing field are each `invalid-argument`, and none publishes anybody;
- turning it back off removes the name, and still stamps `visibilityPromptedAt` — declining
  is an answer;
- **reinstatement resets to `private`** and clears the prompt, though the Champion is the actor;
- **rejoining after leaving resets to `private`** and clears the prompt;
- the directory is `permission-denied` to a non-member and `unauthenticated` signed out, and
  a nonexistent group returns a **byte-identical** refusal to a real one the caller is not
  in, so the pair cannot enumerate community ids;
- `removed`, `departed`, `''`, `'Active'` and `'pending'` are never listed, however visible
  the row was;
- legacy or malformed `visibility` values (`'Visible'`, `' visible'`, `true`, `1`,
  `'VISIBLE'`, `null`) never publish;
- a listed row carries exactly `['displayName', 'role']`, the role is one of the two allowed
  values, and the payload contains **no uid and no `@`**.

#390's own suites at that head: `wsf-community-visibility` + `wsf-overnight-privacy-audit`
**85 passed, 0 failed**; rules suite **35 passed, 0 failed**. Both W5 probes written for
`e609c57` also run clean against #390's code, so opting in to be named in one community
still puts nothing into any public, kiosk or display payload.

**No privacy or data-isolation defect was found in #390 or in the member work at
`e609c57`. No `PRIVACY ESCALATION` was raised, because none was warranted.**

No approval or merge recommendation is given for #390 or any other PR.
