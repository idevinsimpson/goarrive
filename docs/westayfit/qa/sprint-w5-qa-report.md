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
