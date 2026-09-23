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


## W5-M1 revisited — verification of PR #400, and two corrections to my own finding

Assignment: PR #395 comment 5782616705
https://github.com/idevinsimpson/goarrive/pull/395#issuecomment-5782616705

Head tested: **`ff8c880598d7684d68cc259129d129fc2a32c9d7`** (`claude/wsf-fix-contribute-skip-timer`,
a direct child of `e609c57`). Reviewed and run read-only; nothing was pushed to that branch.
Emulators were rebuilt and restarted **from that head's own worktree**, so the functions, the
rules and the web bundle under test all came from `ff8c880`.

### Two corrections to what I reported first — mine, not the fix's

1. **"The screen does not scroll" was wrong.** I read `scrollHeight`/`clientHeight` off
   `document.scrollingElement`, which never scrolls on this route; the screen's own
   `ScrollView` does. Measured: 794px of content in a 540px box at 390x640. The lead's
   correction is right, and my sentence "nothing can bring it clear" did not hold.
2. **My "buried" metric was too broad.** It counted any interactive control whose centre fell
   below the tab bar's top edge, which also catches a control that is merely below the scroll
   view's fold — covered by nothing. On the fixed build that metric would have gone on
   reporting the same control forever.

What did hold: the `elementFromPoint` table reproduced exactly on both heads, and the
occlusion itself was real.

### The measure that actually discriminates

A control is occluded when its own centre is **inside the scroll view's visible box** — so the
member can see it at rest, without scrolling — **and still resolves to the shell**. Measured at
rest with the same spec run unchanged on both heads:

| height | `e609c57` (before) | `ff8c880` (after) |
|---|---|---|
| 390x640 | centre below the fold; not occluded | centre below the fold; not occluded |
| **390x664** | **centre INSIDE the box, resolves to `wsf-member-tab-move`** | centre below the fold; covered by nothing |
| 390x844 | resolves to itself | resolves to itself |

So the true defect sat at **390x664**, not at 640 — at 640 the control was already below the
fold. And on the fixed head the scroll view's bottom edge sits exactly
**24px (`MEMBER_TAB_MOVE_OVERHANG`) above the bar's top at 640, 664 and 844**, so the band the
raised circle covers is never scrollable content at any scroll position. **The fix holds.**

### A real tap does not decide this, and that matters

The acceptance criterion I was given was a real, non-forced tap on the fixed head. It passes —
`TAP-OK` at 640, 664 and 844. But I ran the identical tap on the **broken** head and it passes
there too, at all three heights, because Playwright scrolls an element into its scroll
container before clicking. A passing tap is therefore necessary but not sufficient: it cannot
distinguish the fixed build from the broken one. The geometry above is what does.

### My probe, corrected

`sprint-w5-short-phone-usability.spec.ts` now uses the in-box-centre-resolves-to-the-shell
measure, checks **both 640 and 664**, and waits for `wsf-contribute-done` rather than
`wsf-member-tabs` so it cannot measure the `/move` resolver before its redirect. Proven to
discriminate:

- unannotated on `e609c57`: **1 failed, 5 passed** — the failure names
  `wsf-contribute-skip-timer` at `height: 664`;
- unannotated on `ff8c880`: **6 passed, 0 failed**.

The `test.fail()` annotation therefore stays for now — this branch's base is still `e609c57`,
which does not carry the fix. It is retargeted onto the corrected case and says plainly that it
goes the moment #400 reaches the base; because it is `fail` and not `skip`, the body keeps
running and it will start failing with "expected to fail but passed" if it is ever left behind.

### On #400's own diff

Its change to `check-evidence-intact.mjs` only **adds** paths — `page-02-move/short-phone/before`
to the frozen list and `.../after` to the accepted list. It weakens no existing guard. I have
not re-run #400's own spec's frame capture: `WSF_CAPTURE_FRAMES` and `WSF_CAPTURE_BEFORE` were
never set, per my constraints.

No approval or merge recommendation is given for #400.


## Verification of W3's #393 corrections

Posted: https://github.com/idevinsimpson/goarrive/pull/393#issuecomment-5783988860
Harness: `sprint-w5-393-corrections-verify.sh`

The corrections arrived as a **patch against `cb91d78`**, not a pushed head
(`docs/wsf-staging/393-reporter-corrections-NOT-APPLIED.patch` @ `41ea4dd`,
sha256 `bfdb5f6652f7fee6cc140ac915987092aa6338033c069c6879853ea06995aeed`).
Applied to a throwaway detached worktree — `git apply --check` clean, so it is a
true diff against that commit. `claude/wsf-staging-mail-binding` was never written to.

**Patched tree: 14 suites, 311 assertions, exit 0** — matches W3's figure.
`workflow-contract` 58→62, `mail-binding` 10→24.

**Verdict: F2, F3, F4, F5 hold; F1 is substantially but not completely closed; F6
deliberately unaddressed and I concur.**

- **F1** — the derived-order matrix now sees a new job (the failure diff carries
  `'rollout-helper': true`), and the shipped `ungatedJobs()` predicate, extracted
  verbatim, returns `["rollout-helper"]` for M7 and `[]` for the real workflow.
  Critically, `no npx invocation exists in any job` **passes** on the privileged
  probe, so the catch is the gating invariant itself and not the incidental ban.
  M6 and M7 both CAUGHT.
- **F2** — `revision version UNRESOLVED (the revision carries the alias latest)`;
  no bare `revision version latest`. A numeric revision still resolves.
- **F3** — projection verified from recorded argv, not from source:
  `json(spec.containers[].env[].name,spec.containers[].env[].valueFrom.secretKeyRef)`.
- **F4** — `mismatch (this variable is fed from RESEND_API_KEY)`; revision-level
  identity checked too.
- **F5** — six states, six listed; double evaluation gone.

### R1 — moderate, OPEN — four legal job ids the gating regex cannot see

Both parsers use `/^ {2}([a-z][a-z0-9-]*):\s*$/`. Each of these is a GitHub-legal,
**ungated** job id running `gcloud secrets versions add WSF_EMAIL_API_KEY`, and each
passes all 62 assertions: `Rollout:`, `rollout-helper:  # temporary helper`,
`_rollout:`, `rollout_helper:`. The positive control comparing the two parsers cannot
help — both share the blindness, so they agree and both are wrong.

Validated fix (tested, not guessed): `/^ {2}([A-Za-z_][A-Za-z0-9_-]*):(\s|$)/` names
all four and is a no-op on the real workflow (9 jobs, `ungated=[]`). Both parsers
need it.

### Low / trivial

- **N1** — the empty-string `name` half of the completeness guard is untested.
  Mutated, a describe returning `name: ""` yields `bound_pinned` instead of `unknown`.
- **N3** — the numeric predicate's anchors are untested. Mutated to `/\d+/`, a
  declared version `v2-beta` reports as `bound_pinned` instead of `bound_alias`.
- **N5** — `some`→`every` survives but only relabels one refusal as another. Trivial.
- **Not a finding:** the revision-level empty-string `name` guard survives mutation
  but changes no answer — the next comparison catches `''` anyway. Redundant, not a gap.

**F6** — I agree with leaving it. Neither W3 nor I can prove `gcloud` emits those
phrasings for an IAM-masked gen2 describe, and broadening the absence guard on an
unproven string turns real NOT_FOUNDs into `unknown` — the same misdirection in the
other direction. It stays bounded: `absent`, never `unbound`.

No approval or merge recommendation given.


### Re-take against the real head `b2a7ad8`

Posted: https://github.com/idevinsimpson/goarrive/pull/393#issuecomment-5784327955

W3's `.github/` write restriction lifted and the corrections landed as a commit.
**Head `b2a7ad89345365f783bf502db45254ae4785f35b`.**

Verified it is `cb91d78` + exactly the patch already reviewed, by applying the patch to a
fresh `cb91d78` worktree and **diffing the whole tree** against the real head — no
difference under `.github/wsf-staging`. (`git apply --check --reverse` alone would only
have shown the patch was *contained*, not that nothing else rode along.)
`.github/workflows/` untouched.

Re-run at that head rather than carried over: **exit 0, 14 suites, 311 assertions,
0 failures** — `workflow-contract` 62, `mail-binding` 24. That total was re-tallied
independently; the head-move note said it had not been.

Everything transfers verbatim: M6/M7 CAUGHT by the gating invariant itself; N1, N3 and
N5 still survive; N4 still caught; **R1 still open — all four job ids still evade every
assertion at the real head.** R1 and the N1/N3 fixtures are queued as a follow-up commit.


## Progress and You — short-phone and keyboard check: CLEAN

Assignment: PR #395 comment 5784436697. Candidate pinned: **`e609c57`** (this branch's base;
#400 touches only the contribution route and is not in this base yet).

Routes read from source rather than assumed — `MemberTabBar.tsx:47-48` gives
Progress = `/activity` (`app/activity.tsx`) and You = `/you` (`app/you.tsx`).

Both routes **do** still carry the end-padding pattern W5-M1 found wanting:

- `activity.tsx:112,253` — `paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom + 16`
- `you.tsx:662` — `paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG`

That is a reason to look, not a defect. **Neither route is defective.**

`sprint-w5-progress-you-occlusion.spec.ts`: **4 tests, 4 passed.** At 390x640, 390x664 and
390x844, at rest and at half and full scroll, **no control whose centre is inside the route's
own scroll container resolves to the shell** — on either route, at any height, at any of the
three positions. Keyboard: Tab reaches the controls and none of them is covered once focused.

Method, per the packet and the W5-M1 correction: the scroll container is **discovered**, not
assumed (`/activity` has a testID, `/you` does not, and the document element scrolls on
neither); merely-below-fold content is **not** counted as occluded; a real tap is recorded as
context only and never as proof, because Playwright scrolls an element into its container
before clicking and so succeeds on a broken build too.

### The clean result is not vacuous — the detector was proven against a known defect

The identical detector, pointed at `/move` on the same build in the same run, reports:

```
"664/at-rest": ["wsf-contribute-skip-timer -> wsf-member-tab-move"]
```

That is W5-M1 exactly — same control, same height, same occluding element — reproduced by an
independently written probe, while Progress and You stayed clean in that same run. A detector
that never fires proves nothing; this one fires on the real defect and not on these two routes.

One incidental observation, not a finding: `/move`'s **keyboard** case passes even on the
broken build. The occluded control is reachable by focus and uncovered once focused; it is
dead only to a tap at rest. That is consistent with W5-M1's severity and is why the geometry
check, not the keyboard or the tap, is what decides.

Probe stopped, as instructed.


## W5-M1 closed on this branch

The base `claude/wsf-app-shell` advanced to **`5356e3cf`**, which carries #400's
`ff8c880`. Merged into this branch as **`fb728ae6`** with a merge commit — no rebase,
no amend, no force-push — and the expected-failure annotation on the W5-M1 case removed,
because the base now actually contains the fix. It was never removed on an older base,
and W4's checkout was not touched.

Both short-phone specs on the merged head: **10 tests, 10 passed, 0 failed.** The MOVE
occlusion case — the one that carried `test.fail()` — now passes outright at 390x640 and
390x664, which is the discriminating check the annotation existed for. That is exactly
why it was `fail` and not `skip`: the body kept running, so the day the base carried the
fix the annotation started failing and had to go.

Frozen evidence after the merge: **9 BEFORE and 17 accepted paths, no byte changed** —
up from 8 and 16, because #400 added `page-02-move/short-phone/{before,after}` to the
guard. Nothing of #400's evidence was altered by any of my runs.


## W3's R1 / N1 / N3 commit — verified, R1 CLOSED

Posted: https://github.com/idevinsimpson/goarrive/pull/393#issuecomment-5784977904

**Head verified: `0092953174b2a3ecf13b1a3179f031d80350c0ac`** on `claude/wsf-sprint-email-staging`.
Not yet on `claude/wsf-staging-mail-binding` (still `b2a7ad89`), so this verdict is against
W3's commit awaiting cherry-pick; to be re-confirmed on the picked SHA rather than assumed.

The reporter is untouched — the fix is tests and fixtures only, which is the right shape,
because N1 and N3 were missing negative tests rather than wrong behaviour.

Suite: **exit 0, 14 suites, 315 assertions, 0 failures** (was 311); `workflow-contract`
62→64, `mail-binding` 24→26.

- **R1 CLOSED** — all four ids now CAUGHT (`Rollout:`, `rollout-helper:  # temporary helper`,
  `_rollout:`, `rollout_helper:`). Fixed with a shared
  `JOB_ID = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):(\s|$)/` used by **both** parsers — the half I
  flagged as easy to get wrong.
- **N1 CLOSED**, **N3 CLOSED**. N4 still caught. N5 still survives and is still trivial.
- Two improvements beyond what I proposed: the positive control tightened from `>= 9` to
  `=== 9`, and each probe asserts the parser **sees** the id rather than only that
  `ungatedJobs` flags it.

Three new probes of my own:

- **P1** (narrow only one parser) — CAUGHT, with `the parser did not see job Rollout at all,
  so no invariant could apply to it`.
- **P3** (a legitimately gated tenth job) — CAUGHT by the exact-count control, by design.
- **P2** (a **quoted** job id, `"rollout":`) — **SURVIVED**. Legal YAML, resolves to key
  `rollout`, ungated, privileged; `yaml.safe_load` confirms 10 jobs with `ungated=['rollout']`,
  and all 64 assertions pass. Low: nobody quotes a job id by convention and the four unquoted
  forms are closed. If ever worth closing, the honest fix is to stop hand-rolling the parse,
  not to add `"` to the character class.

## Base kept current

Merged `claude/wsf-app-shell` `0757379` (#408, four lines guarding Batch B's accepted TARGET
frames) as `937d67e9`. It touches only `scripts/`, no app source, so the web bundle and the
two sprint-w5 specs would exercise byte-identical code — re-running them would have been an
unchanged suite, which this packet was told not to repeat. Evidence guard after the merge:
**9 frozen / 18 accepted paths, no byte changed** (accepted up from 17 by #408).


### Re-confirmed on the cherry-picked head `7ba8dba5`

Posted: https://github.com/idevinsimpson/goarrive/pull/393#issuecomment-5785298896

L0 picked W3's R1 commit onto `claude/wsf-staging-mail-binding` as
**`7ba8dba52bbd6fbc2b74cc9c082ab4f38e321c42`**. Checked rather than trusting the `-x`:
worktrees of the picked head and of W3's `0092953`, `diff -ru` across the whole of
`.github/wsf-staging` — **no difference**; `.github/workflows/` untouched by the pick.

Re-ran anyway, because identical files are not a green run: **exit 0, 315 assertions,
0 failures**; all four R1 ids CAUGHT; N1 and N3 CAUGHT; N4 caught (control); N5 survives
(trivial). **Verdict unchanged: R1 CLOSED, N1 CLOSED, N3 CLOSED**, with the quoted-job-id
residual (P2) low and not blocking.

Every finding from the original review is now closed or explicitly accounted for.

### Base kept current (second advance)

Merged `claude/wsf-app-shell` `181ab04` (#411, W4's Champion Manage sheet capture spec and
evidence) as `8d2e1e6e`. No product or functions source changed — one new e2e spec owned by
W4 plus frames — so this branch's two specs exercise byte-identical application code and were
not re-run. The merged tree typechecks (`tsc --noEmit` clean, W4's new spec included), and the
evidence guard reports **9 frozen / 18 accepted paths, no byte changed**.


## Join: a response lost AFTER the server committed — BASELINE reproduced

Assignment: PR #395 comment 5785415007. App head pinned:
**`44cc0633f3d62b1f33d757f6bc0e401758f04523`** (`claude/wsf-app-shell`), merged into this
branch as `968893ea`. Product source at that head is byte-identical to `5356e3cf`, so the
existing bundle is valid for it — confirmed by diff, not assumed.

Probe: `apps/westayfit/tests-e2e/sprint-w5-join-response-lost.spec.ts`. **3 tests, 3 passed.**
Test and evidence only; no application or backend file touched; W4 owns the fix.

### The defect is real, and the source says why

`app/join/[joinCode].tsx` classifies a failed join by callable CODE only
(`callableCode`), falling back to:

```
JOIN_FAILURE_DEFAULT = 'Nothing was changed. Check your connection and try again.'
```

whose own comment reads: *"The default is safe to state as fact: the whole join runs inside
`db.runTransaction`, so a failure commits nothing."*

That reasoning is correct about the **server** and silent about the **wire**. A transaction
that committed and a response that never arrived is not something the transaction can roll
back. The client holds a transport error with no callable code, `callableCode(e)` returns
`null`, and the default sentence renders.

### What the member is actually shown, verbatim

With the membership **proven to exist on the server first**:

```
We couldn’t join this community.Nothing was changed. Check your connection and try again.
```

Both halves are false at that moment. The heading (`wsf-join-submit-error`,
`[joinCode].tsx:398`) is unconditional, and the body is the default claim.

### How the case is actually produced

The request is allowed through to the real `wsfJoinCommunity` and only its **response** is
discarded at the browser boundary — `route.fetch()` performs the real call, its HTTP status is
asserted `200`, then `route.abort('connectionfailed')`. A request aborted before reaching the
server would prove nothing, so the premise is asserted before any UI claim:

- the visitor starts a non-member (membership doc absent, 1 active membership — the Champion);
- the callable answered `200`;
- `wsfMemberships/{groupId}_{uid}` exists, polled from Firestore, **before** the screen is read;
- active memberships = **2**.

If that premise ever fails the test fails there, on its own setup, rather than reporting a UI
finding it has not earned.

### Retry is already safe — recorded so the fix cannot regress it

Second press, uninterrupted: lands on `/community/{groupId}` and active memberships stay at
**2**. `wsfJoinCommunity` answers an active membership with `alreadyMember: true` inside the
same transaction, and the join writes no `memberCount` field at all, so there is no counter to
double. That is BASELINE behaviour W4's fix must preserve, not something the fix needs to add.

### The control that keeps the finding honest

A join aborted **before** the server sees it: membership absent, and the same default sentence
renders — **correctly**. Without this the baseline could be misread as "the default copy is
always wrong", which is not the finding and would send the fix after the wrong thing.

### Fixed-revision half

**Not yet runnable.** W4's branch `claude/wsf-sprint-member-journey` is at `81636fad` and does
not touch `app/join/[joinCode].tsx` — there is no corrected immutable revision to test. The
baseline is published now; the fixed verdict follows against W4's actual revision when it
exists, requiring: uncertainty wording, no raw server text, one safe retry landing on the
intended community/event, and no duplicate membership.


## Join outcome — FIXED half verified on W4's `a760a4e`

Assignment: PR #395 comment 5785633689. Revision held to:
**`a760a4ed01f80c50a4aab9140414371eb4ceecc2`** (PR #417,
`claude/wsf-sprint-w4-join-outcome-copy`), confirmed a direct child of `44cc063`.

Built and run **from W4's own worktree** — functions compiled and the web bundle built from
`a760a4e`, emulators started there — so the app under test is W4's revision and not mine.
W4's checkout was not touched; test and evidence only, in `sprint-w5-*` paths.

### The baseline now fails against the fix, and that is the evidence

`sprint-w5-join-response-lost.spec.ts`, run **unmodified** on `a760a4e`: **2 failed, 1 passed.**
The two failures are the two cases that recorded the false claim. The assertions were
deliberately not softened to agree with the fix — a baseline rewritten to pass destroys the
only record of what was wrong. A retirement note is committed in that file instead: when
`a760a4e` reaches this branch's base, those two cases are **deleted, not edited**, and the
fixed spec carries the guard.

The passing one is the retry case, which asserts behaviour that had to survive the fix — and did.

### All four stated criteria met

`sprint-w5-join-outcome-fixed.spec.ts` — **4 tests, 4 passed** on `a760a4e`:

| criterion | result |
|---|---|
| uncertainty wording, not a false no-change claim | **met** — `We couldn't confirm your join.Check your connection, then try again.` with the membership proven present; no `Nothing was changed.`, no definite `We couldn't join this community.` |
| no raw server text | **met** — a planted unmapped-code error carrying `W5RAWSERVERTEXT …` appears in neither the card nor anywhere in the page body |
| one safe retry to the intended community | **met** — lands on `/community/{groupId}` |
| no duplicate membership | **met** — active memberships stay at **2** |

Plus W4's own additional claim, tested rather than trusted: **a throw after the call succeeded
is no longer shown as a failed join.** With `sessionStorage` forced to throw at the browser
boundary, the member lands on the community, **no failure card renders**, and the membership
exists. The event context is what is lost, which is the stated trade.

### One behaviour change worth naming — correct, not a regression

On the fix, the aborted-**before**-the-server case also now reads "unconfirmed" rather than
"Nothing was changed." My baseline control recorded the old wording as *true* in that case,
and on the fix it changes.

That is right, and it is worth being precise about why: the client cannot distinguish a request
that never left from one whose answer was lost. The old sentence was **accidentally** correct
there — correct by luck, not by knowledge — and a screen that states certainty it does not
have is wrong even on the occasions it happens to be right. Uniform uncertainty across both is
the honest outcome.

**Verdict: the fix holds on every criterion W5 stated before seeing the patch.** No approval or
merge recommendation — that is the Director's and the owner's.


## #393 malformed-metadata recheck — `0e58f419`

Head verified: **`0e58f4199e86f4a12ab0a404f2222d329c0a0546`** on `claude/wsf-staging-mail-binding`
(`a shape nobody could read is unknown, not an absent binding`). Read-only detached worktree;
nothing pushed. This one **does** touch the reporter (+99/−9), unlike the R1 commit.

Suite: **exit 0, 323 assertions, 0 failures** (was 315); `mail-binding` 26 → **34**.

### The states that must not collapse

| scenario | state |
|---|---|
| `malformed` / `partial` / `no-name` | `unknown` |
| `no-version` / `no-secret-field` / `no-project-field` / `project-number` | `unknown` |
| `nosecret` (a legitimate empty binding) | **`unbound`** — not swallowed |
| `pinned` / `alias` / `wrong-secret` / `other-variable` | unchanged |

### Its two stated guarantees, tested rather than trusted

**"One function's bad metadata must not suppress the other's row."** Driven with my own
two-function stub — `fnBAD` returning `serviceConfig: []`, `fnGOOD` a clean binding:

```
WSF_MAIL_BINDING_FNBAD=unknown
WSF_MAIL_BINDING_FNGOOD=bound_pinned      exit 0
```

Both rows present. The guarantee holds.

**Shape is part of the answer.** `isPlainObject` closes `serviceConfig: "invalid"` and
`serviceConfig: []`, which previously reached the reference lookup, found nothing, and were
reported `unbound` — the report asserting the deploy never wired the secret from metadata that
was not a function description at all.

### Probes

| # | mutation | result |
|---|---|---|
| Q1 | `isPlainObject` stops rejecting arrays | **CAUGHT** — `AN ARRAY serviceConfig IS UNKNOWN, not unbound` |
| Q2 | drop the `Array.isArray` guard on containers | **CAUGHT** twice, including `A MALFORMED REVISION DOES NOT SUPPRESS THE OTHER FUNCTION` |
| Q3 | remove the per-function `try/catch` | **SURVIVED — not a finding.** Every shape it guards is validated upstream, so no fixture can reach it; its own comment says so and keeps it anyway. An unreachable guard being untestable is the point of it, not a gap. |

R1's four ids still CAUGHT; N1, N3, N4 CAUGHT; **N5** still survives and is still trivial;
**P2** (a quoted job id) still open, low, unchanged.

**Verdict: the malformed-metadata correction holds.** No approval or merge recommendation.

A note on method: my first attempt at Q3 edited the file with a regex that did not match, leaving
it broken, and the run produced unrelated failures. That result was discarded rather than
reported — a mutation that did not apply proves nothing, and reporting its noise as a finding is
how a reviewer wastes a writer's time.


## Join baseline RETIRED — the fix reached this branch's base

`claude/wsf-app-shell` advanced to **`d0477cc`**, which carries W4's
`a760a4ed01f80c50a4aab9140414371eb4ceecc2`. Merged here as `cc7356a4`.

That is the condition the retirement note was written against, so it was executed as written:
the two claim-recording cases in `sprint-w5-join-response-lost.spec.ts` are **deleted, not
edited**. Softening them to agree with the fix would have left a test that looked like a guard
and guarded nothing; the record of the defect lives in the commit history and in this report,
which is where it belongs.

`sprint-w5-join-outcome-fixed.spec.ts` carries the guard now, and it is the stricter of the
two: uncertainty wording, no raw server text, a safe retry, no duplicate membership.

**The retry case stays.** It asserts behaviour that had to survive the correction and did — a
second press lands on the community and adds no second membership. True before the fix and
true after, which is precisely what makes it worth keeping: it is the part of the old
behaviour the correction was not allowed to break.

This base advance **did** touch product source (`app/join/[joinCode].tsx`, +89/−26), so unlike
the last three merges the bundle was rebuilt and the specs were genuinely re-run rather than
reasoned about:

- both join specs on the merged head: **5 passed, 0 failed**;
- the other two sprint-w5 specs: **10 passed, 0 failed**.

Evidence guard after the merge: **9 frozen / 20 accepted paths, no byte changed** (accepted up
from 18 — `d0477cc` freezes the Join AFTER set and the correction frames).


## Kiosk navigation isolation — DEFECT, bounded (probe `sprint-w5-kiosk-navigation-isolation.spec.ts`)

**Packet:** investigate the kiosk navigation seam W1B reported in #423 at
`3e311beec260b01e6468beee3e90efec65cf0d30`; establish what ordinary taps actually permit and
whether the shared device clears the visitor on returning to rest; return PASS or one
reproducible defect, not an assumed leak.

**Source delta, checked first.** `git diff --stat d0477cc..3e311be -- apps/westayfit/app
apps/westayfit/src functions-westayfit/src` is **empty**. W1B's capture head and my pinned
product source are byte-identical across app, src and functions, so what reproduces here at
`d0477cc` reproduces at `3e311be`.

### What the bar is, before anything is claimed about it

`MemberTabBar` is rendered unconditionally by `app/_layout.tsx:52` as
`<MemberTabBar signedIn={Boolean(user)} />`, and `shellAppliesTo` admits any path under
`/contribute` (`src/ui/MemberTabBar.tsx:58`). `kioskContributeRoute()` returns
`/contribute/<goalId>?kiosk=1` (`src/kioskSession.ts:73`) — the kiosk deliberately rides the
existing contribution route rather than minting a second bracketed one. So the shell applies
to the kiosk's contribution screen for the same reason the kiosk works at all, and the flag
that makes it a kiosk is a query parameter the shell never reads.

That the bar is on screen is not itself the finding. The bar's own docstring says the event
surfaces are kept bare because a bar on a station screen "would offer a room's worth of
strangers a way into somebody's account" — the question is whether that is what it does here.

### What one ordinary tap actually permits — measured, not inferred

Signed in as a synthetic visitor at `/contribute/<goalId>?kiosk=1`, the kiosk's own chrome is
correct: `wsf-contribute-back` absent, `wsf-kiosk-finish-chrome` present. The bar is also
present and is hit-testable where a thumb lands (`document.elementFromPoint` resolves inside
`wsf-member-tabs`, not merely "in the DOM").

One press of the **You** tab:

    url=/you  namesVisitor=true  emailShown=true  signOutOffered=true
    stillAttached=true  kioskFinishControls=0

One press of **Progress**:

    url=/activity  rendersAsSignedIn=true  stillAttached=true  kioskFinishControls=0

`stillAttached` is read from the Firebase web SDK's IndexedDB store, not from the screen: it is
what the next person would inherit, not what the current screen chooses to draw.

An early version of this measurement reported `namesVisitor=false`. That was **my probe being
wrong**, not the product being safe — `wsf-you` is visible while the profile is still loading,
and I was reading a spinner. The probe now waits for one of `/you`'s terminal states
(`wsf-you-identity`, `wsf-you-signed-out`, `wsf-you-no-community`) before measuring anything.
Recorded here because a QA report that quietly fixes its own instrument is not a record.

### The defect

**Head:** `d0477cc` (identical product source to `3e311be`). **Steps:** open
`/kiosk/<goalId>` → *Contribute here* → sign in → on the entry screen press **You** in the
bottom bar.

**Expected:** a kiosk session cannot be left by ordinary chrome; wherever a tap lands, the
session is still endable.
**Actual:** the device lands on `/you`, which shows the visitor's display name, their email
under "SIGNED IN AS", and a Sign out control; `/activity` renders their own recorded movement.
The account is still attached. Neither destination carries any kiosk control — `Finish` is a
child of the contribution screen, which has unmounted, and the 90-second idle auto-finish
(`kioskTerminal` in `app/contribute/[goalId].tsx`) goes with it.

**Impact:** a shared device left on `/you` or `/activity` sits on the previous visitor's
identity and private movement, signed in, with nothing on screen that ends the session and no
countdown that would end it unattended. The next person walks up to that. This is exactly the
failure the bar's own docstring keeps it off event surfaces to avoid; the kiosk's contribution
screen is an event surface that the `/contribute` prefix did not know about.

### What is NOT broken — the bound on the finding

The kiosk's rest-clearing defence holds, and this is the half that keeps the finding a
navigation defect rather than a carry-over between visitors. After a tab tap and a Back, and on
any arrival at `/kiosk/<goalId>`:

- auth attachment drops to **zero** records (polled, read from IndexedDB);
- `wsf.kioskReturnGoalId` is gone;
- the start screen names nobody;
- the second synthetic visitor meets the sign-in gate and signs in to **their own** session,
  with no text of the first visitor's on the gate or the entry screen.

`app/kiosk/[goalId].tsx` does this in a `useFocusEffect` — tied to the device having come to
rest on its start screen, not to a bare `user` change, which is what keeps it from firing
underneath the sign-in hop.

### Unresolved attempts, kept distinct from kiosk-owned state

Asserted in the same test so neither can be mistaken for the other. With the contribution
callable served and its answer dropped (`route.fetch()` then `route.abort()`), the screen
reaches its pending/unknown state and `wsf.pendingContribution.<goalId>.<uid>` is written.
After the visitor leaves via the bar and the device returns to rest:

- kiosk-owned state **goes** — auth detached, `wsf.kioskReturnGoalId` removed;
- the member's unresolved record **stays**, keyed to a uid that is no longer signed in;
- the next visitor's gate and entry screen carry no trace of it — no `13`, no name, and
  `wsf-contribute-reconcile` absent for them.

That is `kioskFinishPlan`'s documented rule holding under a route this probe is the first to
exercise. Erasing that record to make the device look clean would be the defect, not the fix.

### Result

    3 tests, 3 as expected on d0477cc
      W5-K1  an ordinary tap ... stays inside the kiosk session   — expected failure (the defect)
      W5-K2  after a tap away and a Back, the device clears ...   — passed
      W5-K3  an unresolved attempt survives ...                   — passed

W5-K1 is marked `test.fail()`, not skipped: the body still runs, so it retires itself the day
the shell stops rendering over the kiosk's contribution screen.

**No fix proposed in product source and none attempted** — this is a QA branch and the seam is
W1B's to close. The shape of a fix is not mine to choose, but the measurement narrows it: the
shell needs to know the route is a kiosk session, and nothing in `shellAppliesTo`'s inputs
carries that today.

Evidence guard after the run: **9 frozen / 20 accepted paths, no byte changed.** No artifacts
or test-results committed.


### Patch-verification assertions, prepared while the fix is pending

The Director accepted the finding as real and bounded, assigned the app-shell patch to W1B
(#423), and asked me to prepare the discriminating assertions in my own files rather than
re-run the unchanged defect. Four cases added at `d0477cc`; **7 of 7 as expected**.

**W5-K4 — the contract, not the locator.** The obvious fix is to stop rendering the shell over
`/contribute`, and the obvious verification is that the bar's testID is gone. Both are traps.
So K4 enumerates every interactive element on the kiosk contribution screen, keeps the ones
whose centre actually resolves to themselves under `elementFromPoint`, and allows only the
screen's own content and the kiosk's own controls. Today it names exactly what is wrong:

    wsf-member-tab-home@43,805 | wsf-member-tab-community@120,805 | wsf-member-tab-move@195,782
    | wsf-member-tab-activity@270,805 | wsf-member-tab-you@347,805

A renamed bar, a restyled bar, a drawer, or a wordmark that starts navigating all fail this and
none of them fail a locator check. `test.fail()`, so it becomes ordinary passing coverage the
day a patch lands.

**W5-K5 — the control case, and the reason K4 cannot be trusted alone.** The shell *belongs* on
an ordinary member's contribution screen. A patch that closes the seam by dropping `/contribute`
from `SHELL_PREFIXES` turns K4 green and breaks ordinary member navigation. K5 passes **now**
and must pass **after**: signed in without the kiosk flag, `/contribute/<goalId>` wears the
shell and `wsf-contribute-back`, carries no kiosk control, and the destinations still navigate.

One thing K5 taught me about the product rather than the patch: signing in from a bare
`/contribute/<goalId>` does **not** return there. With no kiosk handoff key there is nothing for
`nextRouteAfterAuth()` to read, so the member lands on their community. My first draft asserted
a return the product never promised and timed out on it. The test now follows the ordinary
journey instead of inventing one.

**W5-K6 — browser Back, with its scope stated.** What is claimed: the history entry behind the
kiosk's contribution screen is the kiosk's own start screen, and arriving there resets the
device (auth to zero, kiosk key gone, nobody named). What is **not** claimed, and must not be
read into it: that a browser can be prevented from going elsewhere, or that the device is locked
down. A kiosk in a browser has no such power and the feature never claims it. Passes now.

**W5-K7 — Finish reachable, and the start screen only reached detached.** Finish is
hit-testable where a thumb lands on the screen the session rests on, and after pressing it the
device is at its start screen **and** the account is gone — asserted as a coupling, with no
`wsf-kiosk-finish-error` on screen. A patch that hides the shell but loses Finish fails this.

**~~What K7 cannot establish~~ — RETRACTED, see W5-K8 below.** I wrote here that a FAILED
sign-out could not be reached from a browser harness without editing product code, because
Firebase's web `signOut` does not depend on a reachable server. **That was wrong.** The fault
does not have to be a network fault: sign-out removes the persisted record from IndexedDB, so
failing only the *readwrite* transaction on `firebaseLocalStorage` makes it reject while leaving
reads alone. W5-K8 does exactly that and the case is now covered. The original sentence is left
struck through rather than deleted, because a report that silently repairs its own claims is not
a record.

Cases at `d0477cc`: **five passing safety cases** (K2, K3, K5, K6, K7) and **two intentionally
failing tripwires** (K1, K4). Not "seven passes" — a tripwire that fails on purpose is not
evidence of safety, and counting it as one would be the same error as counting a spinner as
proof that nobody is named. The historical failing baseline stays as K1, untouched, so the
record of what was wrong survives the fix.


### The failure-injection correction, and three more bounded states

The Director corrected two things in my last report at once (#395 comment 5786636183), and both
corrections were right.

**1. My "seven expected" phrasing.** Two of those seven fail on purpose. Reporting the run as a
count of "expected" outcomes invites reading it as seven safety passes, which it is not. The
count is now always given split: passing safety cases, and intentionally failing tripwires.

**2. The sign-out failure IS reachable.** My claim that it was not, without editing product
code, was wrong. Sign-out removes Firebase's persisted record from IndexedDB, so failing only
the **readwrite** transaction on `firebaseLocalStorage` makes it reject while every readonly
inspection keeps working. W1B had already done this at `be3ff1b4daabbdd4ede9f116ec8e1cecb0d92233`
(`sprint-w1b-kiosk-capture.spec.ts`). The recipe is theirs; the run below is mine.

#### W5-K8 — the failed sign-out: PASSES

After a real confirmed contribution, with the fault injected, pressing Finish:

- shows `wsf-kiosk-finish-error` with the product's exact words — "We couldn't sign you out.
  Don't leave this device signed in — try Finish again.";
- does **not** reveal the resting screen (`wsf-kiosk-screen` hidden, URL still
  `/contribute/…?kiosk=1`, receipt still on screen);
- leaves Finish offered and enabled rather than spinning;
- and the account is still attached — observed through a **successful readonly probe**, not
  inferred.

Then the fault is removed **in place** (not by reloading, which would drop the page state and
prove less) and Finish is pressed again: the device reaches its start screen, auth polls to
zero, the kiosk key is gone, no pending record is left, and the next visitor meets the gate.
That positive control is the half W1B's capture did not need and mine does — a device that
refuses while it cannot sign out must still finish once it can, or the refusal is its own defect.

**This case is why my auth probe had to be fixed first.** `readAuthRecords` used to resolve `[]`
on every error path. Under an injected IndexedDB fault that would have reported "nobody is
signed in" — turning the exact failure under test into a pass. It now returns a discriminated
result and `authKeys` throws on an unreadable store, so an inspection failure can never be
mistaken for an empty one. Same class of mistake as reading a spinner and reporting "does not
name the visitor": both are an instrument answering a question it was not asked.

#### W5-K9 — the bounded states: the exits W1B found, corroborated independently

The contract enumeration, run across three more states. Measured:

    receipt      = [the five member-tab controls]
    missingGoal  = [wsf-contribute-home->/, the five member-tab controls]
    loadError    = [wsf-contribute-home->/, the five member-tab controls]

The source says the same thing plainly: `wsf-contribute-load-error` and
`wsf-contribute-not-found` each render a `wsf-contribute-home` link to `/` with **no `kiosk`
condition**, while the refused and pending states *do* gate their Back on the flag
(`{kiosk ? renderKioskFinish(...) : <ButtonLink … />}`). So a kiosk session that fails to load,
or is pointed at a goal this account cannot see, offers a door out that the same session does
not offer when everything works. A patch verified on the entry screen alone would miss it.

#### W5-K10 — the chrome Finish is not legible on the dark receipt

Measured contrast of `wsf-kiosk-finish-chrome` on the confirmed receipt:

    ratio=1  fg=11,31,58  bg=11,31,58

Navy on navy. The source agrees: `renderChrome`'s non-kiosk Back applies `chromeLinkTextDark`
(cream) when the tone is dark, and the kiosk branch beside it applies `chromeLinkText` (navy)
with no dark variant. `toBeVisible()` passes for this, which is why the assertion measures
contrast instead — against WCAG AA for **large** text (3:1), deliberately the lenient threshold,
so the result cannot be waved off as a strict-standard quibble. 1.00 is not near it.

This is a legibility defect, not a privacy one, and it is W1B's finding (5786572133) reproduced
here rather than a new one of mine.

#### Where the suite stands at `d0477cc`

    six passing safety cases          K2 K3 K5 K6 K7 K8
    four intentionally failing        K1 K4 K9 K10   (self-retiring tripwires)

K1 remains untouched as the immutable historical baseline. K4, K9 and K10 each fail on a
statement of intent rather than on a locator, so each becomes ordinary passing coverage on the
day the patch makes its statement true — and none of them can be satisfied by renaming or
hiding a testID.


### W5-K11 — the input shape: the two readers, and what a repeated parameter really does

Added on the Director's instruction (#395 comment 5786966553) while W1B corrects `b24da91f`.
Scope held: this is the input-shape and repeated-query guard only, in my own suite. No product
file touched, no re-run of the old matrix to pass the time.

**The disagreement, confirmed in W1B's source at `b24da91f2609fd7493886994a337118c13a25cc2`.**
The shell now reads the flag and fails closed on an array —
`if (Array.isArray(value)) return value.some((entry) => isKioskFlag(entry))` in
`MemberTabBar.tsx` — while `app/contribute/[goalId].tsx:203` still calls
`isKioskFlag(params.kiosk)`, and `isKioskFlag` is scalar-only
(`value === '1' || value === 'true'`). Two components decide kiosk mode from one URL, by
different rules.

**What the test asserts**, in a form that does not presume how anyone fixes it:

| clause | meaning |
|---|---|
| `disagreements` | the screen is in kiosk mode exactly when the shell is absent |
| `kioskWithEscapes` | a kiosk surface offers no control that leaves the session |
| `stranded` | a surface that is NOT a kiosk is a *whole* member surface — shell and Back |
| `lostKioskMode` | a URL carrying the flag actually reached kiosk mode |

The third clause is what stops "hide everything" from counting as a fix. The fourth exists
because the first three compare the two readers **against each other**, and two readers wrong in
the same direction agree perfectly.

**Measured at `d0477cc`**, in a real browser, signed in, per URL shape:

    single                screenKiosk=true   shell=true   back=false  escapes=5
    repeated-same         screenKiosk=false  shell=true   back=true   escapes=6
    repeated-mixed-forms  screenKiosk=false  shell=true   back=true   escapes=6
    explicitly-off        screenKiosk=false  shell=true   back=true   escapes=6

    disagreements    = [single]
    kioskWithEscapes = [single → the five member-tab controls]
    lostKioskMode    = [repeated-same, repeated-mixed-forms]
    stranded         = []

**The repeated parameter is not theoretical.** `?kiosk=1&kiosk=1` and `?kiosk=true&kiosk=1`
really do defeat the screen's detection in the browser: `screenKiosk=false`, and the surface
renders as an ordinary member contribution screen — `wsf-contribute-back` into the signed-in
member's community, no Finish, and no idle countdown, on a device standing in a room. This is a
defect **at `d0477cc`, independent of W1B's patch**, and it is the half of the Director's
source-supported finding that can be shown rather than argued.

**What I have NOT measured, said plainly.** `stranded` is empty here only because this head's
shell renders regardless of the flag. At `b24da91f` the shell fails closed on the array while
the screen still does not, so the predicted result is `stranded=[repeated-*]` — bar gone, Finish
absent, ordinary Back present. **That is a prediction from reading the diff, not a run.** I have
not built or driven `b24da91f`, and I will not present a read of someone's diff as my own
measurement. It can be measured on request before the corrected head arrives; otherwise the
corrected SHA's verification will settle it.

**One harness lesson, recorded because it nearly produced a false result.** The emulators died
between turns, and the first run of this case "passed" — as an *expected failure* whose cause was
`TypeError: fetch failed` in the fixture seed, not the product. A `test.fail()` case reports a
harness collapse and a real defect identically. The run was discarded and repeated against live
emulators; the numbers above are from that run. Any future tripwire result has to be read with
its error, not just its status.

**Reporting shape.** As four separate assertions the first failure hid the rest, so a patch
fixing the disagreement would have revealed `lostKioskMode` only on the following run. The four
groups are now one assertion and the whole verdict lands at once.


## FIX VERIFICATION — product `50806fa`: PASS, with the margins stated

**Verification head** `199d767e5a57c10d25a3febe22b3ecc15f791ac5` — a local merge of my tests at
`297d33a7` with product `50806fae45fccca74e82b64735a299204e664d42`. Built and driven; **not
pushed**, because this QA branch must not carry another worker's product edits. The reproducible
fact is the pair of parents, since a merge commit's own hash depends on when it was made.

The three product files were confirmed byte-identical to `50806fa` by blob hash before the
bundle was built — not assumed from the merge succeeding:

    src/kioskSession.ts        b9d2f4d728f72509649575c043a343a420e6bc08
    src/ui/MemberTabBar.tsx    0b14df9519e4a60fb10d17f808413f2f474ae120
    app/contribute/[goalId].tsx d2ccd90e872643aba6227527dc7d383555d9c3d2

Functions compiled and the web bundle rebuilt from that head with
`EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1`; emulators live on
8080/9099/5001/5010 and confirmed up before and after.

### Result: 11 cases, 11 ordinary passes, no tripwires, no fixture collapse

    expected 11, unexpected 0, flaky 0

Every `test.fail()` is gone from the file — the five self-retiring cases retired, and none of
them was softened to get there.

**K1 is NOT counted as safety evidence, and the reason is recorded.** With the bar gone it takes
its early return and passes *because there is nothing to tap* — a weak pass by construction. It
is left exactly as written, as the historical record of the defect. **W5-K4 is what holds that
line now**, and K4 is a positive assertion: every reachable interactive element on the kiosk
contribution screen belongs to the kiosk session. So: **ten substantive passes, plus one retired
baseline kept for the record.**

### 1. Kiosk flag, every shape — agreement, no escape, usable Finish

    single                screenKiosk=true   shell=false  back=false  escapes=0
    repeated-same         screenKiosk=true   shell=false  back=false  escapes=0
    repeated-mixed-forms  screenKiosk=true   shell=false  back=false  escapes=0
    explicitly-off        screenKiosk=false  shell=true   back=true   escapes=6

All four K11 clauses empty: `disagreements`, `kioskWithEscapes`, `stranded`, `lostKioskMode`.

The repeated parameter that defeated the screen at `d0477cc` no longer does. `isKioskFlag` in
`src/kioskSession.ts` now owns the normalisation (`Array.isArray(value) → value.some(...)`) and
both readers call that one predicate, so there is no second copy to drift. `?kiosk=0` still
resolves to a whole member surface — shell and Back — which is the clause that stops "hide
everything" counting as a fix, and it holds.

### 2. In-app exits, across every bounded state

    receipt=[none]  missingGoal=[none]  closedGoal=[none]  loadError=[none]

plus the entry screen through K4 (`escape-controls: none`). The `wsf-contribute-home->/` links
that were reachable on missing-goal and load-error are gone in kiosk mode, and the closed goal's
Back is gated too.

**One correction of mine, not a product finding.** K9's closed-goal step timed out on the first
verification run. That was my enumeration gap: the closed goal renders `wsf-contribute-closed`,
a state my poll had simply never named. Listed now. I report it because a timed-out step inside a
`test.fail()` case looks identical to a defect, and this is the second time that hazard has bitten
this suite.

### 3. Legibility of every kiosk control, both tones, size-appropriate floors

    dark receipt   chrome Finish 15.16  Finish 7.15  explainer 9.62  countdown 9.62  Stay 15.16
    warning        sign-out error 9.75
    light terminal chrome Finish 15.16  Finish 7.15  explainer 4.97  countdown 4.97  Stay 15.16
                   unresolved note 15.16

Every control is measured against **4.5:1** here, not the lenient large-text 3:1 — the floor is
chosen per control from its own computed size and weight, and none of these qualified as large
text. Contrast is measured on the composited colour: translucent foregrounds are blended over the
resolved background, and translucent backgrounds are composited down the ancestor chain first, so
a caption at 78% opacity is judged as it is actually seen. The chrome Finish that measured
**1.00** at `d0477cc` now measures **15.16**.

**The margin is worth naming rather than burying:** the explainer and the countdown on the light
terminal state sit at **4.97 against a 4.5 floor**. That passes, and it is the thinnest margin in
the set — a later change to that caption's colour or opacity has about half a point of headroom.

### 4. Failed sign-out — still protected, and still recoverable

K8 passes unchanged against the new product. With the readwrite fault injected on
`firebaseLocalStorage`: the product's own error appears, the resting screen is not revealed
(`wsf-kiosk-screen` hidden, URL still `/contribute/…?kiosk=1`), Finish stays enabled, and the
account is observed still attached **through a successful readonly probe**. Fault removed in
place, Finish pressed again → start screen, auth to zero, kiosk key gone, next visitor at the
gate.

### 5. Account-scoped unknown attempt, and the next visitor

K3 passes: `wsf.pendingContribution.<goalId>.<uid>` survives the visitor leaving and the device
returning to rest, while kiosk-owned state goes; the next visitor's gate and entry screen carry
no trace of it and `wsf-contribute-reconcile` is absent for them. K2 passes: second synthetic
visitor signs in to their own session with nothing of the first visitor's on screen.

### 6. Ordinary personal contribution keeps member navigation

K5 passes — the control case, and the likeliest way this patch could have gone wrong. Signed in
without the flag, `/contribute/<goalId>` still wears the shell and `wsf-contribute-back`, carries
no kiosk control, and You and Progress still navigate and still wear the shell. No collateral
damage.

### 7. Browser back and the URL boundary — scope stated

K6 passes: the history entry behind the kiosk's contribution screen is the kiosk's own start
screen, and arriving there resets the device (auth to zero, kiosk key gone, nobody named).
**No claim is made, here or anywhere in this suite, that a browser can be prevented from going
elsewhere or that the device is locked down.** A kiosk in a browser has no such power and the
feature never claimed it.

### Limitations, stated rather than left to be assumed

- **The verification head is local.** It is named by its parents and was not pushed; my branch
  carries tests and this report only.
- **`b24da91f` was never built or driven by me.** My earlier note predicted a stranded surface
  there from reading the diff. That prediction is now moot — the shared normalisation in
  `50806fa` removes the disagreement at its source — and it is retired as a prediction, never
  upgraded into a measurement.
- **Emulator fixtures only.** Synthetic accounts, one local browser, one viewport class. No
  staging, no live account, no device.
- **No pixel review.** Contrast here is computed from the DOM; matched-pixel review is the
  Director's and is not replaced by these numbers.

No product file was edited, nothing was deployed, and no approval or merge recommendation is
given. Shared/unattended kiosk use remains HELD as far as this report is concerned — that
disposition is not mine.


## DELTA VERIFICATION — product `6690370`: PASS

The copy-only successor to `50806fa`. Per the packet this is a **focused delta check, not another
eleven-case matrix**.

**Verification head** `3e713dcff7ef6b76ef653eb2ebff0e1174ec8b95` — a local merge of my tests at
`fa2244e3` with product `66903704e15a51a115499c3458e91930ea01bacb`; built and driven, not pushed.
Base merged first: `claude/wsf-app-shell` at `a193b430` (#420's Join TARGET rebaseline), whose
only product source is `src/ui/designTarget/JoinSetupTargets.tsx` — a design-target reference
component the kiosk journey never renders.

**Why a targeted run is sufficient, established rather than asserted.** The whole-tree delta
`50806fa..6690370` is eight files, and the only **product source** among them is
`src/kioskSession.ts`, +18/−5, which is the `KIOSK_UNRESOLVED_NOTICE` string and its docstring.
The rest is W1B's own spec, a unit test, the evidence README and four PNGs. So the eight cases
that do not touch the unresolved screen run against byte-identical product code to the
`50806fa` run already reported, and **I did not re-run them** — repeating an unchanged suite
would be theatre, not evidence.

### The delta, measured

`K12` (new), plus the two existing cases that touch the unresolved state, `K3` and `K10`:

    3 cases, 3 ordinary passes, 0 unexpected

- **The sentence, exactly:** "You can try to confirm this contribution here before you finish.
  Entering it again elsewhere could count it twice."
- **No portability claim anywhere on the screen** — not merely in that one element, because a
  promise moved into a neighbouring caption is still a promise. `/your own device/`,
  `/check it from/`, `/saved to your account/`, `/another device/`, `/any device/`: none present.
- **The uncertainty is still stated:** "NOT CONFIRMED YET" and "We don't know whether this effort
  was recorded."
- **The recovery the new sentence points at is actually offered:** `wsf-contribute-reconcile`
  visible, labelled `Confirm this contribution`.
- **Finish survives the longer sentence at both sizes.** At 800×1280 and 390×640: a real touch
  target (≥44px), wholly on screen (top ≥ 0, bottom ≤ viewport height — the specific thing a
  longer notice would break), resolving to itself under a thumb, and legible —
  `wsf-kiosk-finish=7.15/4.5`, `wsf-kiosk-unresolved-note=15.16/4.5` at both viewports.
- **The record survives Finish** (`K3`'s rule, asserted on the screen the new sentence is printed
  on): `wsf.pendingContribution.<goalId>.<uid>` present before Finish and still present after,
  while auth goes to zero and the kiosk key is removed. The copy now points at a recovery, so the
  artefact that recovery depends on had to survive the way out — it does.
- **K10 unchanged** at this head: every kiosk control on both tones still above its own floor,
  same numbers as `50806fa`, thinnest margin still 4.97/4.5 on the light terminal state.

### A third instrument error of mine, recorded

My first K12 asserted the screen must not match `/confirmed\b/i`. It failed — **on the honest
copy**. The screen's correct wording is built out of that very word: "NOT CONFIRMED YET", "We
couldn't confirm your contribution yet." A ban on the vocabulary fails the truthful sentence and
would have passed one that said "recorded!" instead. **Banning a word is not the same as banning
a claim.** The uncertainty is now asserted positively, which is the property that actually
matters. The portability checks were unaffected and passed as written.

That is the third time in this packet's life that my instrument, not the product, was the thing
at fault — the spinner read, the `[]`-on-error auth probe, and now this. Each is in this report
rather than quietly repaired, because a QA record that only shows the product's mistakes is not
an honest one.

### Limits

Verification head local and unpushed, named by its parents. Emulator fixtures, one browser, the
two viewports named above. Contrast computed from the DOM — the matched-pixel read of the
`6690370` frames is the Director's, through #430, and these numbers do not stand in for it. No
product edit, no staging action, no approval or merge recommendation. The shared/unattended-use
hold is not mine to lift.


## PACKET 1 — focused candidate check at `c8f38e3`: PASS

The combined app candidate, **without #436** as instructed.

**Product SHA** `c8f38e37b6286297d1f401834cd9500a675a2923` (`claude/wsf-app-shell` head).
**Verification head** `ba347d4987e1ff0e9205d932065f940d7fafe4c7` — a local merge of my branch at
`b602c25e` with the candidate; built and driven, not pushed, named by its parents.

**Blob equality confirmed before building**, not inferred from a clean merge:

    src/kioskSession.ts          bee956ca9bb66a581cf092b30a9267dd1bf1c3bb   = 6690370
    src/ui/MemberTabBar.tsx      0b14df9519e4a60fb10d17f808413f2f474ae120   = 6690370
    app/contribute/[goalId].tsx  d2ccd90e872643aba6227527dc7d383555d9c3d2   = 6690370
    app/index.tsx                c7f2c629cf0f1e233836f68cade676d96b48e3af   = de8f567

Product delta `6690370..c8f38e3` is two files: `app/index.tsx` (+40, #432) and
`src/ui/designTarget/JoinSetupTargets.tsx` (#420's design-target reference component).
Functions compiled and the bundle rebuilt from this head; emulators confirmed up before the run
and still up after it, so no result here rests on a collapsed fixture.

### Counts, split by suite

    my kiosk suite      K1-K12                                12 expected, 0 unexpected
                        (K1 is the historical baseline and is NOT counted:
                         11 substantive passes)
    candidate's own     ui-app-shell                           3
    specs, run          ui-kiosk                               3
    unmodified          ui-contribute-short-phone              7
                        sprint-w1b-kiosk-confinement          10
                        sprint-w4-home-view-communities        5
                                                        total 28 expected, 0 unexpected
    callable identity   sprint-w5-pending-reconcile-identity   } 2 suites,
                        sprint-w5-public-surface-identity      } 13 tests, 0 failures

**Not run, deliberately:** W7's `sprint-w7-home-view-communities` is W7's and was not
duplicated. **Not edited:** none of the candidate's five specs was touched — they were run as
they stand, which is the only way their passing means anything.

### What the identity suites are and are not evidence of

They pass, and they are reported as a **non-regression read**, exactly as assigned. The candidate
carries no backend change — `functions-westayfit/` is identical to the served `d0477cc` — so
this is confirmation that the privacy line did not move, not a fresh proof that it holds. The
fresh proof is the original run, and it is still pinned to its own head.

### Limitations

- The verification head is **local and unpushed**, named by its parents; my branch carries tests
  and this report only.
- Emulator fixtures, one browser, the viewport classes each spec chooses for itself.
- DOM-computed contrast where contrast is measured; no pixel review is claimed.
- A pass of somebody else's spec is a pass of **their** assertions. I did not audit what the
  candidate's five specs choose to assert; I established that they pass unmodified at this head.

No product edit, no staging action, no pin edit, no approval or merge recommendation. Nothing
here lifts the shared/unattended kiosk hold.
