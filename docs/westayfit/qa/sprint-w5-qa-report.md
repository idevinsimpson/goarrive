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


## PACKET 2 — the idle-Finish contract at product `84acea5`: PASS

**Product SHA** `84acea5378e915f611858b80eb86fc7fec86e657` (#436, W1B's corrected successor — **not**
the held `e4243f1`).
**Verification head** `8a50406168daea49830e019e2aadac956d37abc4` — my tests merged locally with
the candidate `c8f38e3` and then with `84acea5`; built and driven, not pushed, named by its
parents.

Blobs confirmed by hash before building: `src/kioskSession.ts` `6f69d0ae…` and
`app/contribute/[goalId].tsx` `ae490a4f…` equal to `84acea5`; `app/index.tsx` `c7f2c629…` and
`src/ui/MemberTabBar.tsx` `0b14df95…` equal to the candidate, since `84acea5` sits on `6690370`
and does not itself carry #432 or #420.

### Result

    17 cases, 17 passed, 0 unexpected
    (K1 remains the uncounted historical baseline -> 16 substantive)

Five cases are new and added to the suite rather than replacing any of it.

#### (a) The ordering that loses a reminder — W5-K13

The contribution route returns its load-error branch **before** its pending one, so a goal that
stops loading while an attempt is unresolved renders an error screen with no reconcile control.
Two things have to hold together, and either alone is worthless:

- the **copy** does not point at a retry the screen cannot offer — the notice is
  *"We couldn't load this goal to confirm your contribution. Entering it again elsewhere could
  count it twice."*, the accepted "confirm here" sentence is absent, and
  `wsf-contribute-reconcile` is not on the screen;
- the **outcome** passed to Finish is the live one. `wsf.pendingContribution.<goalId>.<uid>` is
  present before Finish and **still present after**, while auth polls to zero and the kiosk key
  goes. Finishing as `none` would have cleared it.

A screen that says the right thing while erasing the record would pass a copy check and still
lose somebody's effort, which is why both are in one case.

#### (b) Where the deadline must not be — W5-K14

    entry=no-countdown  review=no-countdown  inFlight=no-countdown  initialLoad=no-countdown

Asserted by the countdown's absence on screen, not by reading the predicate: `kioskMayFinishUnattended`
is W1B's to unit-test, and what this suite owes is the behaviour. The in-flight case holds the
contribution request open so the screen genuinely sits in its sending state.

#### (c) The deadline and `Stay` on the three settled screens — W5-K15

    closed:    opened=90  fell=88  renewed=90
    notFound:  opened=90  fell=88  renewed=90
    loadError: opened=90  fell=88  renewed=90

The deadline is read from what the product's own countdown **says**, so a changed
`KIOSK_IDLE_MS` would surface as a different number instead of passing silently. `Stay` is only
pressed after the countdown has visibly fallen, so a `Stay` that merely paused the timer could
not pass as one that renews a whole deadline.

#### (d) The deadline fires, and a failed sign-out still refuses to lie — W5-K16

The deadline is **waited out for real** — the product reads `Date.now()`, and a faked clock would
be testing the fake. Once, on one screen (a closed goal). At the deadline the device returns to
its start screen by itself, auth polls to **zero**, the kiosk key is gone, the start screen names
nobody, and the next visitor meets the gate.

The failed sign-out is exercised on a settled screen (a missing goal) by pressing Finish with the
readwrite storage fault injected — the same `runKioskFinish` path, without buying a second
90-second wait. The error appears, the resting screen stays hidden, and the account is observed
still attached **through a probe that returns `ok` first**. That last point is not decoration:
the successor's own fix is fail-closed auth inspection, and a fail-open read here would have
turned the failure under test into a pass. W1B's helper was not reused.

#### The control — W5-K17

    closed:    shell=true wayOn=1 countdown=none attached=1
    notFound:  shell=true wayOn=1 countdown=none attached=1
    loadError: shell=true wayOn=1 countdown=none attached=1

An ordinary member meeting the same three screens on their own device keeps the shell and a way
on, is never put on a deadline, and is not signed out. This is the likeliest collateral of the
change and it is clean.

### Four more instrument errors of mine, all found by running

Every one of these failed on the first pass and **none was a product finding**:

1. K13 read the load-error screen through `wsf-contribute-screen`. The screen wrapper takes its
   testID as an optional argument and that branch passes none, so the line waited out the whole
   300-second test timeout on an element that does not exist there. It reads the document body
   now. The assertion that mattered — the contextual notice — had already passed before it.
2. K14 unrouted the contribution callable while its held handler was still in flight, so
   Playwright handled the route first and the handler's `abort` threw *Route is already handled!*.
3. K14 also waited for `wsf-contribute-loading`, **a testID I invented**. The loading branch
   renders a spinner and the words "Loading goal…" and carries no testID at all. Asserting on an
   invented testID is how a test claims to have checked a screen it never reached.
4. K16 waited out the deadline on a **missing** goal and then asserted the kiosk hero.
   `/kiosk/<absent>` correctly renders the display's generic refusal instead, so the assertion was
   about the wrong screen for the fixture I picked. The deadline had fired either way — the URL
   change arrived — so the wait moved to a closed goal, whose resting screen is the one the
   assertion is about.

That makes seven instrument errors of mine recorded across this packet's life. They are all here
because a QA record that shows only the product's mistakes is not a record, it is an argument.

### Limits

Verification head local and unpushed, named by its parents. Emulator fixtures, one browser.
`kioskMayFinishUnattended` is exercised only through the screen; its unit-level behaviour is
W1B's. The Director's AFTER review of the two changed frames (via #440) is separate and these
results do not stand in for it. No product edit, no staging action, no pin edit, no approval or
merge recommendation.


## Base advance to `ba774eff` — re-verified, and three cases re-pinned

`claude/wsf-app-shell` moved from `c8f38e3` to **`ba774eff`** (#435, the responsive public
display). It touches **product source** — `app/display/[goalId].tsx` and a new
`src/ui/displayLayout.ts` — so the kiosk verdicts were not carried over on an argument.

Established first: every file the kiosk journey renders is **byte-identical to `c8f38e3`** —
`src/kioskSession.ts`, `src/ui/MemberTabBar.tsx`, `app/contribute/[goalId].tsx`,
`app/kiosk/[goalId].tsx`, `app/_layout.tsx`, `app/you.tsx`, `app/activity.tsx` — and neither the
kiosk route nor the contribution screen references `displayLayout`. Then the suite was **re-run
anyway**, because a two-minute run is better evidence than that paragraph.

    17 cases, 17 as expected, 0 unexpected
      14 passing
       3 tripwires pinned ahead of their product (K13, K15, K16)

### Why three cases are failing on purpose again

K13, K15 and K16 assert the idle-Finish contract from #436 (`84acea5`) — **verified PASSING
there**, and deliberately not in this base. On the base they fail because the behaviour does not
exist yet. That is not a regression and not a defect, and saying so is the whole point of
marking them rather than leaving the suite red and unexplained. `test.fail()` again, not a skip
and not a softened assertion: the bodies still run, the assertions are the same ones that passed
at `84acea5`, and each retires itself the moment the base carries #436.

### One thing `test.fail()` does not do, learned here

K16 first came back **`timedOut`**, which `test.fail()` does **not** absorb — Playwright treats a
timeout as its own status, so a tripwire pinned ahead of its product reported as an *unexpected*
result. The cause was a click on a Finish control that does not exist on that base, waiting out
the whole test timeout. The case now asserts its precondition with a bounded timeout
(`a settled kiosk screen offers Finish (introduced by #436)`), so it fails in seconds and names
the missing fact instead of hanging for five minutes.

Worth writing down because it generalises: **a tripwire only works if its failure mode is a
failed assertion.** One that hangs reports as a broken run, which is exactly the confusion
between a harness problem and a finding that this report has already had to correct twice.


## Base advance to `d86620cc` — #436 landed, and the last three tripwires retired

`claude/wsf-app-shell` moved `ba774eff` → **`d86620cc`**, which merges #436 (`84acea5`): the kiosk
idle-Finish contract this suite verified PASSING at that head in packet 2. Merged here by merge
commit.

K13, K15 and K16 were pinned ahead of it and failing on purpose. They are **retired**: the
`test.fail()` markers are gone and **nothing in any of the three cases was changed to get there**
— the assertions are the same ones that passed at `84acea5`, now met by the base. K16's timeout
is restored to the 300 s the real elapsed-deadline wait needs, from the 200 s that only capped
the cost of failing fast while the feature was absent.

    17 cases, 17 passed, 0 unexpected
    no test.fail() anywhere in the file

The suite is now entirely ordinary positive coverage on the branch's own base: the escape-control
contract, the flag-shape agreement, the bounded states, the legibility floors, the failed
sign-out and its recovery, the idle-Finish contract in full, and the two controls — the ordinary
member's navigation and the ordinary member never being timed out.

**The one case still worth reading with care is K1.** It passes by early return, because with the
shell gone there is nothing to tap. It stays exactly as written as the historical record of the
defect, and it is **not** safety evidence. K4 is what holds that line, and K4 is a positive
assertion.

### The tripwire pattern, end to end

Five cases in this suite were written to fail against a product that did not yet have the
behaviour they describe, and all five have now retired by the base catching up: W5-K1 and K4 when
the seam closed, K13, K15 and K16 when the idle-Finish contract landed. None was ever skipped,
and none was softened to make a run go green. The discipline that made that work is one line:
**a tripwire must fail by assertion, never by hanging** — the correction K16 forced, and the
eighth of the instrument errors recorded in this report.


## Base advance to `9a65324c` — the first advance that changes the BACKEND, and a correction to my own coverage claim

`claude/wsf-app-shell` moved `d86620cc` → **`9a65324c`**, carrying #441 (W8 social community) and
#433 (W6 goal setup). Unlike every earlier advance this one changes
**`functions-westayfit/src/index.ts` (+734)** and **`app/you.tsx`**, which the kiosk suite drives.

That retires a caveat I have repeated since packet 1: my identity suites were "a non-regression
read **because the candidate carries no backend change**". At this base that sentence is false, so
they were re-run here as a real check of the privacy line.

### The correction: my probe covered six of seventeen public callables

`sprint-w5-public-surface-identity` walked a **hardcoded list of six** surfaces. My report and my
PR body described it as covering "**every** `invoker: 'public'` surface called unauthenticated".
**That was not true.** Parsing `src/index.ts` at this head gives **seventeen** public callables:

    wsfCallNext  wsfCancelTurn  wsfChallengePulse  wsfCombinedGoalPulse
    wsfCommunityActivity  wsfCommunityMembers  wsfCompleteTurn  wsfGoalPulse
    wsfGoalRecentAdditions  wsfPreviewCommunity  wsfSendPasswordResetEmail
    wsfStartTurn  wsfStationClaimPairing  wsfStationPairingStatus
    wsfStationRequestPairing  wsfStationState  wsfTurnState

Eleven were never driven, and the omission predates this base — the six named in the report were
always accurate, the word "every" never was.

**It is also precisely the defect I raised against somebody else's work.** #393's F1 was a reach
matrix walking a hardcoded array of job names instead of one derived from the parsed workflow, so
an added job is invisible to it. My own probe had the same shape, and the surfaces it stopped
covering were exactly the ones just added.

**Fixed at the root, not by lengthening the list.** The probe now derives the public set from
`src/index.ts` and a coverage test fails when a declared public callable is not driven. A new
public surface breaks this probe until somebody points it at that surface.

### Result at `9a65324c`

    public-surface-identity   19 passed  (17 surfaces + coverage guard + detector self-test)
    pending-reconcile-identity 6 passed
    kiosk suite K1-K17        17 passed, 0 unexpected

**The social surfaces are clean to an unauthenticated caller.** `wsfCommunityMembers` and
`wsfCommunityActivity` resolve member display names by design, for authenticated members of that
community, and they carry `invoker: 'public'` — which governs who may reach the Cloud Run service,
not who the function will answer. Driven anonymously against a real seeded community with two
members whose names, uids and addresses are unmistakable, neither returns any of them, in a
payload or in a refusal.

`wsfSendPasswordResetEmail` is driven with a **real** member address, because a reset surface that
echoes whether an address is known is an account-existence oracle and the only way to see that is
to ask it about somebody who exists. It names nobody.

### What this result is and is not

It is an independent check of the **declared public set** at this head. It is **not** a review of
W8's social visibility model, and it does not duplicate W8's own
`sprint-w8-social-visibility.test.ts` or their invoker test — those are theirs, I did not run them
as mine, and their assertions are not mine to claim. The member-visible-by-default behaviour for
**authenticated** members is a different question from the one this probe asks, and I have not
tested it.

That is nine instrument corrections recorded in this report. This one is the most consequential:
the others would have misreported a single case, and this one overstated the reach of the probe
the sprint has been reading as the privacy line.


## CORRECTION TO THE CORRECTION — the derivation read prose, and inverted a security story

L0 relayed W8's evidence (#395 `5791139717`, W8 on #365 `5790688899`) that
`wsfCommunityMembers` and `wsfCommunityActivity` do **not** carry `invoker: 'public'`.
**They are right, and I have verified it in the source myself rather than on their word.**

At `9a65324c`, `functions-westayfit/src/index.ts:9336` reads:

    // NO `invoker: 'public'`. That marker is a NO-OP IN THE EMULATOR and enforced …

and line 9568 refers back to it for the second callable. **A sentence forbidding the marker
contains the marker**, and my derivation matched the raw file, so it matched the prose. Both
callables are declared `{ region: 'us-central1' }` with no invoker at all.

### What that means, stated as plainly as the original claim

The **measured behaviour** was right — an anonymous drive returns no name, uid or address. The
**classification was wrong, and the wrong way round.** I reported the two as "public but clean".
They are not public: Cloud Run IAM does not expose them, and the refusal I saw came from the
in-code `request.auth` check sitting *underneath* that. Describing an unexposed surface as a
public one that happens to behave is not a small mislabel on a release-gating record — it makes
the protection sound like a payload check when it is an access boundary. **Seventeen was wrong;
the number is fifteen.**

    wsfCallNext  wsfCancelTurn  wsfChallengePulse  wsfCombinedGoalPulse
    wsfCompleteTurn  wsfGoalPulse  wsfGoalRecentAdditions  wsfPreviewCommunity
    wsfSendPasswordResetEmail  wsfStartTurn  wsfStationClaimPairing
    wsfStationPairingStatus  wsfStationRequestPairing  wsfStationState  wsfTurnState

### Fixed, with the scanner's own fallibility guarded

- The source is **stripped of comments** before it is matched. The stripper honours string
  literals so a declaration is never eaten for mentioning the marker.
- **A control test for the stripper**, because a scanner that can be fooled by a sentence about
  itself is not a scanner: it proves the comment forms that actually appear in this file are
  discarded, that a real declaration survives, and that a string literal survives.
- **A guard against over-stripping**: every `export const` in the raw file must still be present
  after stripping. A mis-parse that swallowed part of the file would silently shrink the derived
  set — the same undercount failure this whole thread is about.
- The two social callables are **removed from the driven set**. This probe is about surfaces a
  signed-out stranger can reach; they are not among them, and driving them here implied they
  were. Their behaviour for authenticated members is W8's to test.

W8's `sprint-w8-social-invoker.test.ts` hit the same trap in its own first version and carries a
comment-stripping control. Per the packet I reused **the approach, not the file**.

### Result at `9a65324c` (product unchanged by the `740a7637` base merge)

    public-surface-identity    19 passed  (15 surfaces, coverage guard, detector self-test,
                                           stripper control, no-export-lost guard)
    pending-reconcile-identity  6 passed
                               25 passed, 0 failed

**One run was discarded**: the first attempt reported 25 failures with the emulators down between
turns. That is hazard (a) on my own list and not a result; it was repeated against a live stack.

This is the tenth instrument correction in this report, and the second on the same probe. The
first was covering six of seventeen while claiming every; this one is a derivation that read
comments as code. The lesson I take is narrower than "derive rather than list": **a derivation is
itself an instrument, and needs its own control — the first version of it was more confidently
wrong than the hardcoded list it replaced.**

---

## INSTRUMENT CORRECTION 11 — the escape probe could see the shell's new control, but not where it went

Found while reading W9's shell candidate `74661589c21d80c2d0d7f3c548edbbbb192a4614`
as source, not as a run. Nothing was driven against that head: the Director's
`5795073803` §4 gives the successor QA to W7 and says "no duplicate shell run".
The fix and its proof are on my own branch, against my own base
`37367fd256c4df4cbaed0f8f78c6ae5226f53929`.

### What W1B found, and why it pointed at me too

W1B recorded (`5795221257`) that `expectNoMemberNavigation`'s `a[href]` sweep
can no longer see the contribution screen's chrome control, because the
migration converted it from a `ButtonLink` to a `Pressable` calling
`router.back()` / `router.replace(...)`. An element that navigates through the
router is not an anchor and carries no `href`.

That is a statement about W1B's helper. The honest question for me was whether
`escapeControls` had the same hole. The answer turned out to be **half**, and
the two halves point opposite ways — which is exactly why it had to be checked
rather than assumed in either direction.

### Verified in the source, not inferred

`app/contribute/[goalId].tsx` at that head declares the control
`accessibilityRole="link"`. React Native Web's `createDOMProps` assigns
`domProps['role'] = role`, and `propsToAccessibilityComponent`'s
`roleComponents` map has **no** `link` entry — so the element renders as a
plain `div` carrying `role="link"`, with no anchor and no `href`.

- **Collection: not blind.** `escapeControls` enumerates `[role="link"]` and
  `[role="button"]` alongside `a[href]`, so the converted control is still
  picked up and still hit-tested. A control of this shape sitting OUTSIDE the
  kiosk screen's roots was, and is, reported as `@outside-screen`.
- **Destination: blind.** The second half read `el.getAttribute('href')` and
  flagged only a non-null href pointing somewhere other than `/contribute/` or
  `/kiosk/`. A null href fell through as though the control led nowhere. So a
  router-driven navigation control INSIDE the allowed roots would have passed
  in silence.

Harmless today, for the reason W1B gives: a kiosk session renders `Finish`,
`showBack` is false, and neither branch of the converted control is reachable
in kiosk mode. It is a bound on the instrument, not a product defect, and it is
recorded as the former.

### The fix, and its own control

The clause added: inside the allowed roots, an element whose `role` is `link`
and which carries no `href` is reported as
`@link-role-without-destination`. `role="link"` is the element's own claim that
it navigates; if it makes that claim and states no destination, this probe
cannot verify where it goes, and an unverifiable destination on a kiosk screen
is reported rather than passed. `role="button"` is deliberately excluded — a
button asserts an action, not navigation, and `Finish` is exactly that.

**K18** is the control, because a clause that cannot fire certifies nothing —
the mistake correction 10 was made of. It proves the screen is clean as the
product renders it, plants exactly the shape the migration introduced inside
the screen's own root, asserts it is reported, then removes it and asserts the
screen is clean again.

**Mutated:** with the clause disabled (`if (false && …)`), K18 fails at its
`toContain` and **no other case fails** — the mutation is caught by its own
test and by nothing else. Clause restored, both affected cases green.

### Result at `37367fd2` (my base; product source unchanged since `9a65324c`)

```
sprint-w5-kiosk-navigation-isolation.spec.ts   18 passed, 0 unexpected
  (K1–K17 as before, plus K18 the destination-check control)
check:evidence                                 intact — 9 frozen / 20 accepted
tsc --noEmit (app + tests-e2e)                 0 errors
```

No `test.fail()` anywhere in the file.

### What this is and is not

It is a strengthening of my own instrument, proven on my own base. It is **not**
a verification of `7466158`, **not** a defect report against W9, and **not** a
claim about the shell candidate's behaviour — the Back control it concerns is
unreachable in kiosk mode, which is the product's own doing and W1B's to speak
for. The clause matters *before* something on a kiosk-reachable screen converts
the same way, which is the point W1B made and the reason it was worth closing
now rather than after.

---

## PACKET — the staging verifier's candidate-addition change (L0 `5797498066`)

**Verification head** `b81d6c654e5f7df15e3be27317cf2320a5a32a37`
(`claude/wsf-staging-verifier-social-inventory`), W3's source
`d794c61e42eb5442b59ae5d28afc2c1a76de53a5`, operational base `main`
`340e1417a8c0a2c9c9a4b0a3a414f3d96b5574bc`. All printed by `rev-parse` this
session; the three files are blob-identical between the two heads
(`b75ea3ff…`, `d19333738…`, `c07e9b8d…`), and `approved-candidate.json`
(`700c3cf0…`), `read-inventory.mjs` (`1cb729f1…`) and
`workflow-contract.test.mjs` (`d2791bdd…`) are byte-identical to `main`.

Harness: `docs/westayfit/qa/sprint-w5-verifier-social-inventory-verify.mjs`,
written from the verifier's own contract rather than from W3's test file, and
driving **both** the old verifier (`5e40cf7d…`) and the new one — a suite that
exercises only the new script cannot establish a difference between them.

### Result: 24 cases, 0 FAIL

Items 1, 2, 3 and 4 PASS. Item 4a **confirms** the Director's rollback
concern rather than refuting it.

### The rollback answer (item 4)

Dropping `candidateAddedFunctions` while the three services remain deployed
gives `EXPECTED_INVENTORY=46` against `INVENTORY_AFTER=49` and is **rejected**
(`present but not expected: wsfcommunityactivity, wsfcommunitymembers,
wsfsetcommunityvisibility`). `expectedPriorFunctions: 49` alone does **not**
widen the expected inventory — measured at 46. So a rollback re-pin must
either keep the key, or actually remove the three services; removing them is
itself caught as a loss (`present before this deploy and now gone`), which is
the check working.

### The instrument was wrong first, and the control caught it

The first run reported **3 FAIL, including case 1a — the control**, which
asserts the OLD verifier passes the clean 46-set. A failing control means the
harness is wrong, not the subject. `startMock` derived the Cloud Run service
list from a function list that had **already** been mapped to API resources,
so every service name came out malformed and the verifier correctly reported
the whole inventory missing. Names in, mapped once, fixed; the control then
passed and the two real cases with it. Had the control been omitted, the two
genuine passes would have been reported as verifier defects.

### Mutation-proved

| Mutation of the verifier | Caught by | Other cases affected |
| --- | --- | --- |
| drop the "authorized addition did not deploy" loop | 2b | none |
| a parse error returns `[]` instead of exiting | 2i-1, 2i-2 | none |
| drop the service-name regex | 2i-5 | none |
| resolve the approval from the working directory | 3a | none |

### Release blockers (item 5) — all three confirmed from `main` source

1. `firebase deploy --only functions:westayfit` — the whole codebase, **no
   per-function selection**.
2. The workflow never deploys Firestore indexes. Stated carefully because a
   careless grep contradicts it: the `--only firestore` at line 260 is
   `emulators:exec --only firestore` for the GoArrive rules regression, not a
   deploy. The only `firebase deploy` is the functions one; Hosting goes
   through `hosting:channel:deploy`.
3. `firebase.westayfit.staging.json` has **no** `/community/*/members`
   rewrite. `/community/*/challenge` is index 0 and `/community/**` is index
   1, so `/community/<id>/members` falls through the catch-all to the
   community home — **not a 404**, exactly as reported. A new rewrite must sit
   ahead of the catch-all.

### Item 7 — reproduced, and the counts reconciled to the right head

`run-all.mjs` exits **0**, "all suites passed", on both heads. The packet's
expected "14 suites, 335 assertions" belongs to **`d794c61e`**, not to
`b81d6c6`:

| head | suites | self-counted + node:test | exit |
| --- | --- | --- | --- |
| `d794c61e` (W3's branch) | 14 | 240 + 95 = **335** | 0 |
| `b81d6c6` (the main-based draft) | 13 | 231 + 66 = **297** | 0 |

The difference is exactly one suite, `mail-binding.test.mjs`, which arrives
with #393 and is not on `main`. W3's figures are right for its own branch; the
packet attached them to a head that cannot produce them. Not a defect.

### Not established

`VERIFY=pass` with the new callables' transport reported SHUT does **not**
establish a working member feature (item 6) — that needs the separately
authorized transport step and a member / non-member / privacy smoke. No live
call, secret, deploy or dispatch was made, and nothing here folds into #393.

---

## DELTA PACKET — W3's packet-2 corrections (L0 `5798510976`)

Heads by `rev-parse`: #448 `5de3c71681f23dfe83c518d9f96c1f36cc308168` (docs only over the
already-reviewed `b81d6c65`, +208 / −6), #449 `10019faa7ae3ee981ff1026174f97b0851c8088b`
(over `main` `340e1417`, +106, two files). The accepted 24 / 0 carries; nothing from
`b81d6c6` is disturbed, which is what makes this a delta rather than a restart.

**Six items: PASS. Two findings, neither blocking, plus one sequencing note.**

### Item 1 — rewrite correctness: PASS

`/community/*/members → /community/__dynamic/members.html` sits at index **1**, after
`/community/*/challenge` (0) and before `/community/**` (2); the config diff against
`main` is exactly one line and the other ten rules are untouched.

**Five mutations re-derived here rather than taken on report** — accepting "five caught"
from the author verifies nothing. Each is caught (`exit=1`): rule removed; moved after the
catch-all; destination changed to the home document; source `*` → `**`; challenge rule
removed. Baseline `workflow-contract: 61 passed`, exit 0.

The negative is real, and it is the point of the finding: under `main`'s list the first
rule matching `/community/g123/members` is `/community/**` → `/community/__dynamic.html`,
i.e. the community **home**, not a 404. Source-derived from the rewrite table; no request
was made and none is claimed.

### Item 2 — destination exists at the candidate: PASS

`apps/westayfit/app/community/[groupId]/members.tsx` exists at `37367fd2` (blob
`829795d0`), and `inject_meta.py` replaces each `[param]` segment with `__dynamic`, so
`community/__dynamic/members.html` is emitted.

W3's build-guard finding is **confirmed in source**: `inject_meta.py:68` hardcodes
`HOSTING_CONFIG = REPO_ROOT / "firebase.westayfit.json"` — the **app** config. The guard
therefore cannot catch a staging-config omission, which is exactly how this gap survived.

### Item 3 — §6a doc correction: PASS, with one defect

§6a states everything required: a retaining rollback re-pin keeps the exact
`candidateAddedFunctions` list; `expectedPriorFunctions` describes the **measured** BEFORE;
removing the key while services remain is invalid; function removal is a separately
designed operation; `VERIFY=pass` with transport SHUT is not a working feature; and no
"permanently 49". Consistent with the item 4 I confirmed.

**FINDING D1 (low, documentation accuracy).** §6a cites `verify-deployment.mjs:182` as
where the three are reported `present but not expected`. On the head the document ships
with (`5de3c716`) that report is at **line 272**; line 182 is inside the turn-service name
list. On `main` the report is at 186 and 182 is the `unexpected` computation, so the
citation was imprecise before the +108-line change and is simply wrong after it. It is a
line number a reader consults mid-rollback, which is when a wrong one costs most.

### Item 4 — index procedure: PASS

One index only, derived from the query rather than the request; `index.ts:9597` at
`37367fd2` is exactly
`.collection('wsfContributions').where('communityGroupId','==',groupId).orderBy('createdAt','desc')`,
matching the declared COLLECTION index (`communityGroupId` ASC, `createdAt` DESC).

**`wsfCommunityMembers` needs none — checked, not assumed:** it queries `wsfMemberships`
with two equality filters and a `limit`, no `orderBy`, which single-field indexes serve.

Also present and correct: explicit `--project=westayfit-staging`; the catalog deploy
refused with its pruning hazard named; `datastore.indexes.create` on an operator identity
with an explicit refusal to widen the deploy SA; `READY` vs `CREATING` vs `NEEDS_REPAIR`;
`FAILED_PRECONDITION` before READY; rollback = leave the index. The unexecuted-command
statement **is** present, at §3: *"I could not execute or version-check this command — no
`gcloud` call is permitted to me and none was made."*

### Item 5 — sequence alignment: PASS on ordering, one gap

§6 already matches the Director's corrected ordering: index **READY** (step 3) precedes
the pin (4) and the dispatch (5); the transport is read at step 6, **after** the deploy;
the smoke follows at 7. No wording implies a pre-deploy transport measurement of services
that do not yet exist.

**FINDING D2 (low, completeness).** The corrected sequence also requires, before dispatch,
*a named legitimate operator with the applicable access and an agreed post-deploy
handoff*. §6 does not state that as a precondition — step 6 says only that opening the
services "is a separate approval". No handoff document exists on either branch; L0's
receipt references `docs/wsf-staging/OPERATOR-HANDOFF-social-staging.md`, which is **not**
present at `5de3c716` or `10019faa`.

### Item 6 — `/move/**` excluded, and one sequencing note

Confirmed absent from #449's config, as stated. **Note for the merge order, not a defect
in this delta:** `10019faa` carries a case at `workflow-contract.test.mjs:891` whose
success *requires* the `/move` gap — it asserts `firstMatch(stagingRewrites,
'/move/some-goal')` is `null`. The Director has already ordered that inverted in W3's
packet 3 ("do not preserve a test whose success requires the defect"). If #449 merges to
`main` before packet 3 lands, `main` briefly carries a test that passes only while the
defect exists and fails the moment it is fixed. Sequencing, and the packet-3 review closes
it.

### Numbers, as the runs printed them

| head | suites | self-counted + node:test | exit |
| --- | --- | --- | --- |
| #448 `5de3c716` | 13 | 231 + 66 = **297** (unchanged from `b81d6c6`; docs only) | 0 |
| #449 `10019faa` | 13 | 225 + 66 = **291** | 0 |

Both match the packet exactly. No live call, secret, deploy, dispatch or IAM; W3's files
read, never edited.

---

## ADDITIONS PACKET — W3's packet 3 and L0's handoff (L0 `5799290753`)

Heads by `rev-parse`: #449 **`47c32ba44264e905c7846495f054ac2ce3ff2cbb`** (one commit on
`10019faa`), #448 **`30734f4ae28897f7f622e568a50debdd884ed43c`** (six commits on
`5de3c716`). **All four items PASS. No findings.** Both D1 and D2 from the previous
packet are closed, and my merge-order note was adopted — #449 was held until this landed.

### Item 1 — `/move/**` on #449: PASS

The rule is at index **10**, between `/queue/**` and `/combined/**`, and the staging list
is now identical **in content and order** to the candidate's `firebase.westayfit.json` at
`37367fd2` — twelve rules each, compared side by side rather than assumed.

**The old gap assertion is gone, not inverted:** `grep -c "still has NO rewrite"` on
`47c32ba4` returns **0**. That was the thing most likely to be "fixed" by flipping a sign
while leaving a test that still encodes the defect, so it was checked first. Its
replacement asserts the rule, the destination and a multi-segment path, and the new
negative is explicitly source-derived (`null` against the `main` list, with "no request
was made" stated in the case itself).

**Bare `/move` is preserved**, structurally: `app/move/index.tsx` and
`app/move/[goalId].tsx` both exist at the candidate, so bare `/move` exports a static
`move/index.html`, and Hosting serves a matching static file before applying any rewrite.

**W3's four mutations re-derived here** (baseline `workflow-contract: 64 passed`), each
caught: `/move` rule removed · destination changed · `**` → `*` · members rule removed.

**The pinned asymmetry case is sound and is NOT defect-preserving.** Its premise is true —
`firebase.westayfit.json` carries **0** rewrites on `main` `340e1417` and on #449's branch,
and **12** at the candidate `37367fd2` — so a cross-check inside this suite genuinely
cannot see both trees, and pinning that is more honest than a comparison that would
silently compare against an empty list. It differs from the `:891` case in the way that
matters: its failure mode is loud and self-describing (*"replace this case with a real
cross-check"*) rather than a quiet pass over a live defect. The one cost, noted rather
than objected to: it couples an unrelated file's state to this suite, so an unrelated
change to the app config on `main` would fail it.

### Item 2 — W3's doc corrections on #448: PASS

**D1 closed better than asked.** Rather than correcting the line number, §6a now cites the
named `present but not expected` guard plus the **immutable blob**
`b75ea3ff3692e77c37978d089bb6791fb0602a17`, with §1 pinned to `main`'s `5e40cf7d…`. A blob
cannot drift the way a line number did.

**D2 closed.** §6 step 5 now carries a four-row precondition table — index READY with its
receipt; the operational side reviewed and pinned; the candidate reviewed and pinned; and
**a named, legitimate, already-existing operator** with the applicable access and an agreed
post-deploy handoff — citing the authority already granted (`5797657663` / `5797754279` /
`5798443901`) rather than asking for scope again.

The ordering is right and now states its own reason: the three services do not exist before
dispatch, so no transport measurement of them is possible until step 6, which is the first
moment the measurement exists. §9 adds a hosted direct-load **and refresh** of
`/community/<id>/members` and `/move/<goalId>` judged on what rendered, not on HTTP 200.

### Item 3 — L0's handoff document: PASS

**The permission rows match what the operations actually require**, checked against the
operations rather than against the document's own assertion — a handoff that names the
wrong role sends a real person to a real console with the wrong grant:

- transport: **`run.services.setIamPolicy`** with `run.services.get` / `update`, identified
  as Cloud Run Admin (`roles/run.admin`);
- index: `datastore.indexes.create` + `.list` (`roles/datastore.indexAdmin`).

Both say the operator's **actual** permissions are checked rather than inferred from a
broad role, and no role is granted or identity retried.

The read-back is schema-matched and metadata-only, offering the verifier's Cloud Run **v2**
`invokerIamDisabled`, the Knative **v1** export annotation, or the console — and it
explicitly rules out `--format='value(invokerIamDisabled)'` as an invalid projection of the
v1 export. **"Empty output proves neither OPEN nor SHUT"** is stated.

The operator row is **UNASSIGNED**, with honest status for all three candidate identities,
and says plainly that *the owner is not described as the operator merely by being the
owner*. The reference edit (`30734f4a`) changes exactly **two lines in two files** — the
superseded handoff SHA/blob swapped for `dfcce291…` / `7cae9186` — and nothing else.

### Item 4 — merge readiness

The intermediate the Director held #449 for is gone: no test on `47c32ba4` has a success
condition that requires the `/move` gap. On the evidence of this review and the two before
it, I record that **both heads are consistent with the reviewed operational merge** under
`5797657663`. The decision is L0's and the Director's; **I neither approve nor recommend a
merge**, and the two access dependencies (index READY by a named operator, and the
post-deploy transport correction) remain open and are not mine to close.

### Numbers, as the runs printed them

| head | suites | self + node:test | exit |
| --- | --- | --- | --- |
| #448 `30734f4a` | 13 | 231 + 66 = **297** (unchanged; docs only) | 0 |
| #449 `47c32ba4` | 13 | 228 + 66 = **294** (= 291 + W3's three) | 0 |

Both match the packet. No live call, secret, deploy, dispatch or IAM; W3's and L0's files
read, never edited.

---

## SHELL INTEGRATION — K1–K18 at base `dd867211`, and three controls re-expressed

The accepted shell integrated into `claude/wsf-app-shell` as
**`dd8672115aea326a4e0e1153a2f73a6f7780f695`** (W9's migration at review head
`fca3326`, product `41f80f3`). Merged into this branch by merge commit; the
web bundle was rebuilt at the merged head before anything was measured.

**Carry fact 1 re-verified against the real integrated base, not assumed:**
`git diff --stat 37367fd2 dd867211 -- functions-westayfit/src` is **empty**, so
the identity suites (25) did not gate this and were not re-run.
`apps/westayfit/app` (+1450 / −330) and `apps/westayfit/src` (+1201 / −42) did
move, so the kiosk suite did. All four kiosk roots are still present and
`src/kioskSession.ts` — `isKioskFlag`, the single predicate — is untouched.

### The first run: 15 passed, 3 failed — and the failures were the right ones

K5, K11 and K17 failed. Every one of them failed on the same thing: they
asserted `wsf-member-tabs` on `/contribute`, and under the accepted shell that
route sits **outside `(tabs)`** and is a focused, barless flow by the
Director's ruling; `MemberTabBar` is no longer mounted over it at all. **The
kiosk half passed untouched** — K4's escape contract, K9's bounded states,
K13–K16's deadline work and K18's destination control all green.

This is exactly the case K5's own comment was written for: *"a patch that
closed the kiosk seam by dropping `/contribute` from the shell's prefixes
would turn CASE 4 green and take this with it."* The control did its job. The
difference is that this was not a patch dodging the test — it was an accepted
design ruling, so what needed re-expressing was my **expression** of the
property, never the property.

### Measured before deciding anything

A scratch copy of the spec (never committed) reported, on every settled screen
for an ordinary member at `dd867211`:

```
closed:    shell=false  wayOn=1  countdown=none  attached=1
notFound:  shell=false  wayOn=1  countdown=none  attached=1
loadError: shell=false  wayOn=1  countdown=none  attached=1
```

So the member is **not stranded**, is **never on a deadline**, and is **not
signed out**. The safety property is intact; only its mechanism changed, from
a tab bar to a Back control that pops to the mounted tab context.

### What changed, stated exactly

| Case | Was | Is | Weaker about | Exactly as strong about |
| --- | --- | --- | --- | --- |
| K5 | the bar is on screen, then press a tab | the member keeps a way out and no kiosk semantics, then leave by Back and reach the tabs from their own context | the mechanism | the member not being stranded |
| K11 clause 1 | the two readers agree | **the bar never renders over this route, for any shape** | nothing — there is no second reader left to compare | the defect it was born for |
| K11 clause 3 | `!(shell && memberBack)` | `!memberBack` | the bar | a non-kiosk surface with no way out |
| K17 | the member keeps the shell | (dropped; `shell` still measured and reported) | the bar | `wayOn > 0`, no deadline, still attached |

K11's clause 1 deserves its own note: the old comparison had two readers,
`shellAppliesTo` and the screen's `isKioskFlag`, and they could disagree. With
the shell no longer covering this route there is only one reader, so the old
formula flagged every non-kiosk shape on a correct product. It is replaced by
a property that still exists and still guards the original defect — a member
bar appearing over this route at all — and clause 4 (`lostKioskMode`) carries
the repeated-parameter defect on its own, unchanged.

### Mutation-proved, because a re-expressed control that cannot fail is worse than the red it replaced

Simulated at the DOM level in a scratch copy, so no product source was edited:

| Mutant | Caught by |
| --- | --- |
| the ordinary member's way out removed (stranded) | **K5** |
| the member bar returns over `/contribute` | **K11 `shellOverContribute`** |

### Result at `dd867211`

```
sprint-w5-kiosk-navigation-isolation.spec.ts   18 passed, 0 unexpected
check:evidence                                 intact — 9 frozen / 20 accepted
tsc --noEmit (app + tests-e2e)                 0 errors
identity suites                                NOT re-run — functions-westayfit/src unchanged
```

No `test.fail()` anywhere in the file (the single grep hit is prose in a
comment). No artifacts or test-results committed.

---

## PACKET — the staging hosting-route check, #450 at `6f70c171` (L0 `5800340328`)

**Reviewed:** `6f70c171cb0ba63b8fe91595d78364faf4356cb8` (`claude/wsf-staging-hosting-route-check`,
draft PR #450; parent `47c32ba4`; cherry-pick `-x` of W3's `d3605cdf`). Also reviewed on the tree
`main` will actually hold after merge: a local merge onto `main` `9df7e09a` (merge `75e21642`), whose
patch over `main` is byte-identical to the reviewed patch.

**Method.** Four independent reviewers ran in parallel, one per group of packet items. Each result then
went to an adversarial skeptic whose brief was to refute it, and a completeness critic reviewed the
whole. Every load-bearing number was reproduced by at least two agents. No PASS was overturned on the
facts; the skeptics corrected labels, wording and several of the reviewers' own instrument errors (see
below). Harness: `docs/westayfit/qa/sprint-w5-hosting-route-check-verify.mjs`.

### Status, stated precisely

`6f70c171` is **implemented and pushed**, and **tested locally** on both trees. It is **not CI-gated**:
no workflow invokes `run-all.mjs` or any `wsf-staging/tests` file, so its 12 cases and 2 contract cases
are worker gates only, and at deploy time only the helper runs. It is **not accepted, not integrated**
(not on `main`), and **not staged**.

### Verdicts

| Item | Verdict |
| --- | --- |
| (1) registration + prior cases retained | **PASS** — registered and running: **14 suites**. Every prior case retained by name (multiset diff, runtime and static). Exactly one replaced. 12 of 13 prior suite files blob-identical. |
| (2) placement | **PASS** — `deploy` step 5: after Confirm (4), before Authenticate (7). Parsed as YAML, not grepped. The wording defect is finding F5. |
| (3) reads only its inputs, no network, candidate-relative | **PASS** on those claims. Verified statically, by an fs/net guard preload, and at the syscall level with `strace`. Fail-closed on missing inputs. Resolution gap: finding F2. |
| (4) candidate + rollback compatibility | **PASS** — all four cells re-derived with modelled dist **and** with **real exports of both candidates**, in emulator and staging-mode builds, under node 20 and 22. Identical everywhere. |
| (5) replaced case + two new contract cases | **PASS** — sound in intent, one assertion lost (F3). The new case pins order, not liveness (F1). |
| (6) no other diff | **PASS** — exactly five files. The cherry-pick is faithful to `d3605cdf`: both new-file blobs and every changed line are identical. |

### Findings — none blocks today's configs

Every real configuration passes or fails exactly as it should. F1 and F2 are gaps in what the check
**guarantees**, not errors in what it currently **reports**.

**F1 (moderate) — the contract case pins the step's ORDER, not that it is LIVE.** Each of these leaves
every suite green while the check does nothing: step commented out; `continue-on-error: true`;
`if: ${{ false }}`; `|| true` appended; `run: echo node ops/…`. A deploy would then proceed with an
operational config missing rewrites — the defect this commit exists to stop. The suite already pins
this pattern for the gate job at `workflow-contract.test.mjs` lines 729–730.

**F2 (moderate) — single-segment shadowing passes.** `sampleFor` expands `**` into **two** path
segments (`/move/__seg_a__/__seg_b__`). Every real dynamic URL is **one** segment (`/move/<goalId>`),
so a rule that captures the one-segment shape ahead of the candidate's rule is never exercised.
Examples measured on the REAL candidate config and REAL dist, each printing `ROUTES=pass`, exit 0:
`/move/* → /index.html` ahead of `/move/**`; a single `/*/*` → `/index.html` placed first, which
mis-serves every one-segment URL of all ten `**` routes at once. The Hosting emulator's own matcher
(superstatic 10.0.0) confirms the mis-serving. The existing contract cases backstop this only for
`/move` and `/community`, and only when `run-all` is run locally. **A fix exists without disturbing
anything:** sampling each rule at both a one-segment and a two-segment shape closes all three harness
gaps with every control and all four real-config matrix cells unchanged.

**F3 (low) — the replaced case lost an unrelated guard.** Its
`notEqual(app.hosting.site, STAGING_HOSTING.hosting.site)` is now covered by nothing. Setting the app
config's site to the staging site is caught at `47c32ba4` and not at `6f70c171`. That field has a
consumer: `apps/westayfit/package.json` `deploy:staging`.

**F4 (low) — invariants no test pins.** Each of these mutants survives all 12 cases:
- a missing **candidate** config read as "no rewrites", which turns an error into `ROUTES=pass`; all three fail-closed cases target the operational config;
- the `__dynamic` filter dropped, which yields 76 errors on the real inputs and blocks every correct deploy (fails closed);
- `*` allowed to cross segments.

The no-network guard is a substring denylist, so `node:https`, `node:net`, fs writes, an env-var
redirect of the ops root, and a dynamically assembled `child_process` import all pass it. The helper
itself is clean today.

**F5 (low) — the credential wording overclaims.** The step comment says no credential is present, and
the test title says the check runs "BEFORE any credential exists". In fact the `config` job
authenticates to Google (its step 3) before the `deploy` job starts, and `deploy` holds
`id-token: write` from its first step. Accurate: *"runs before the deploy job authenticates, in a job
that can mint an OIDC token"*. The workflow's own header (lines 4–8) already says this.

**F6 (observation, for the Director) — a deliberate operational omission can no longer be expressed.**
On 2026-09-19 `/move/**` was removed from the operational config **on purpose** (`3b8142fa`: *"bd4bfec
carries the OLD 35-second player"*). Under this check, the same decision for a candidate that builds
`/move/__dynamic.html` hard-fails the deploy, with no exemption path. That kind of omission only ever
removed direct-load reachability, not the client route, so it was a partial control. Whether to keep
that capability is a policy call.

**Out of model.** Operational `redirects` and `hosting.ignore` are not considered. Both can make pages
unreachable while the check prints `ROUTES=pass`. None of the six real configs uses either today. The
helper header's *"Exit 0 only when every page this candidate builds is reachable"* is broader than what
it checks.

### Record corrections

- **"13 suites" is 14** (L0 `5800169170`, PR #450 body): the new file is registered and runs. L0 posted
  at 18:01Z, before #448 merged at 18:14Z, so for the tree it described only the suite count was wrong.
- **After merge, `main` holds 319** (253 + 66), not 307. The 307 (241 + 66) is the exact SHA's total;
  #448's 12 verifier cases are on `main` but not under `47c32ba4`.
- **"workflow-contract 73 → 74" and "344 → 359" are W3-lineage figures.** Measured at `d3605cdf`:
  15 suites, 262 + 95 = **357**, workflow-contract 74, so the commit message's 359 is wrong by
  measurement, not only by relay. On this tree the figures are 64 → 65 and 294 → 307.
- **L0's "hunks byte-identical"** holds for every changed line. The hunks themselves differ in offsets,
  and W3's `run-all` hunk carries `mail-binding.test.mjs` as context. This is not a defect.
- **The test fixture labelled** *"The rewrite list the served candidate `c8f38e3` declares"* holds 3 of
  its 11 rewrites.
- **The section comment at `workflow-contract.test.mjs` 805–812** still says the deploy never reads the
  app's `firebase.westayfit.json`. After this change it does.
- **The new suite never removes its `mkdtemp` fixtures**, so `/tmp/wsf-routes-*` accumulate on every
  run.

### Instrument errors — mine and my reviewers', all caught before reporting

- **Mine (13):** the harness first copied only `.github`. The unmutated contract suite then failed in
  the copy, so every neutering mutation "failed" for that reason alone, which would have reported four
  real gaps as **CLOSED**. Control **B0** caught it; the harness now copies the whole tree.
- **Reviewers', caught by the skeptic layer:**
  - one mutant was a syntax error, recorded as "caught by all 12" — a clean mutant is caught by 6;
  - "superstatic is not installed" was false (10.0.0 is present), and the chosen proxy was the wrong minimatch major;
  - a blob count of "11 of 13" is actually 12;
  - "byte-for-byte against L0's matrix" was unsupportable — L0's table paraphrases the error lines.

The adversarial layer is what kept each of these out of the verdict.

### Limits

These are documented, not measured, because no runner was available:
- step-skip semantics after a failure;
- the default `bash -e` shell;
- runner token exposure;
- the `upload-artifact` layout that yields `app/apps/westayfit/dist`, which was simulated.

Production Firebase Hosting's glob semantics are not measurable offline; only the emulator matcher was
compared, and it diverges from the helper on six edge shapes that no real config uses. "Deployable"
in item 4 means passing **this step only**; other deploy gates were not assessed.

## PACKET — SHA-independent pre-review of pin PR #452 at `ed8649ec` (L0 `5801807119`)

**Reviewed:** `ed8649ecb65e96d4ce2d2e9d99d8c533a14ee94c` (`claude/wsf-staging-pin-f2f901a`, one commit on
`main` `9df7e09a`). Also reviewed on the tree it would produce now: a local merge onto `main`
`13accc508ec28bd820eabaf0f089968a9531e0a6` (which carries #450), merge `fac65c27`, not pushed.
Harness: `docs/westayfit/qa/sprint-w5-pin-452-preview-verify.mjs` — **22 / 22 CONTROL rows OK on both
trees.**

**Status:** a pre-review of the parts that do not change with the SHA. It is not the pin review. The
final review is the `approvedAppSha` and notes delta on the successor SHA, on the final composed
ops head. #452 is HELD; nothing here is accepted, integrated or staged.

| item | result |
| --- | --- |
| `run-all` | pin head: exit 0, 13 suites, 242 + 66 = **308** (the PR body's figure). Merge onto `13accc5`: exit 0, **14** suites, 255 + 66 = **321** = merged `main`'s 319 + the 2 new live cases. `verify-deployment` has 30 cases on both trees. |
| #450's effect on the pin | **none.** The two change **zero** files in common (#450's five vs `approved-candidate.json` + `verify-deployment.test.mjs`); every suite passes on the merge. |
| legacy restructure | all **16** legacy cases run through `opsCheckout(dir, NO_ADDITIONS)`. **Isolated:** six mutations of the live approval, plus replacing it with malformed JSON, leave all 16 green (A1–A6, B2). **Necessary:** reverting the runner to the live approval fails the suite at a legacy case (B1), exactly as the file's comment says. |
| live cases + tripwire | each of these fails the suite: dropping one name, adding a fourth, removing the key, `expectedPriorFunctions` 49, a short SHA (A1–A5). |
| 46 BEFORE / 49 AFTER | kept distinct through the real verifier. BEFORE 46 / AFTER 49 passes with `beforeCount` 46 and `createdThisDeploy` exactly the three (C1). Two of three deployed fails, naming the missing one (C2). |
| the preflight gate | `read-inventory` accepts staging at 46 (R1). It **fails closed** at 49, a re-dispatch after success (R2), and at 47, an earlier partial deploy (R3). |
| rollback | a retaining rollback (key **kept**, prior 49, staging 49) passes and creates nothing, in both the verifier (C4) and the preflight (R4). With the key **removed** while the three stay, it fails `EXPECTED_INVENTORY=46`, naming all three (C5). |
| `resolve-candidate` | resolves `CANDIDATE=f2f901acbe31…` (D1). The approved SHA is accepted as a request (D2); the old served `c8f38e3` is **refused** (D3). |
| three deployed SHUT | `VERIFY` passes (C3). The approval notes already say so: "VERIFY=pass with the three SHUT is not a working feature". Transport is a post-deploy measurement, not a verifier result. |

**Observations (low, none blocking):**
- **The tripwire is order-sensitive (A6).** The same three names in another order fail the suite,
  though the verifier treats the list as a set. That strictness is harmless but will surprise a future
  edit.
- **One claim in the notes is stale after #450's merge.** `packageLabel` says the hosting-route check is
  "(PR #450, under review)"; it merged as `13accc5`. The notes are rewritten at the successor
  SHA anyway.
- **The three new cases leave `wsf-v-*` temp directories behind,** as the suite's existing cases
  already do.

## PACKET — K1–K18 on release candidate `9f27c6ea` (L0 `5802407526`, Director `5802482930`)

**Head:** `9f27c6eae26beebd610779a61fb458bd18266f27` = `f2f901a` ⊕ W4 `7f37e2a` ⊕ W8 `eff65b0` ⊕ W9
`cd02949`. It was run in its own worktree, with a fresh build and with the emulators started from
that tree. Hosting served that build's entry bundle, `entry-dc5b357e…`.

- **Blobs:**
  - `app/contribute/[goalId].tsx` is `253278fb`, identical to W9's `cd02949`; `f2f901a` had `8f506c6b`.
  - `src/kioskSession.ts` is `6f69d0ae`.
  - The spec's blob is `20440579`, unchanged from the `dd86721` run.
- **Protected paths:** no change against `f2f901a`, so the identity suites are carried and not rerun.
- **Result:** Chromium, one worker, **18 passed / 0 failed**; there is no `test.fail()` call in the
  file. W9's new labelled exits do not reach any kiosk state (K4, K9, K11, K18). Idle-Finish and its
  real deadline hold (K14–K16), and the ordinary member keeps a way out without being timed out (K5,
  K17).
- **Evidence guard:** 9 frozen / 20 accepted, intact after the run. Receipt: #395 `5802569443`.

**Status:** tested. The Director's visual PASS covers the 24 frames. The candidate is not
functionally accepted, not integrated and not staged, and this is not an approval.

## PACKET — #450 F1 + F2 follow-up, W3 `d690435a` (L0 `5802077885`, Director `5802482930`)

**Reviewed:** `d690435a9418dcc0d4643507ba3176e2c5662066` (parent `30bb8e0b`). It was also reviewed as a
clean `-x` cherry-pick onto `main` `13accc50` (local commit `6696565d`, not pushed). Every changed
line of the cherry-pick is identical to the original.

- **Scope:** exactly three files — `check-hosting-routes.mjs` (+31/−12), `check-hosting-routes.test.mjs` (+64)
  and `workflow-contract.test.mjs` (+28).
  - The helper change is `samplesFor`: a one-segment and a two-segment sample per `**` rule, and one
    failure per rule. Four route cases and one liveness case are added.
  - Nothing outside F1/F2 changed. F3, F4 and F5 are not touched, as the release specified.
- **Harness** (`sprint-w5-hosting-route-check-verify.mjs`, helper and contract from the cherry-pick):
  **G1–G7 all CLOSED.**
  - All **13** control and matrix rows are OK: A1–A7, B0 (66 passed), B1, and the four real-config
    cells, which are unchanged.
  - Those four cells are: `f2f901a` against the old ops config failed (4) and against current ops
    passed; `c8f38e3` failed (2) and then passed.
- **Liveness mutants,** each failing at the new case with its own message:
  - the step commented out;
  - `continue-on-error: true` on the step;
  - `if: ${{ false }}`;
  - `|| true` appended;
  - `run: echo node …`;
  - job-level `continue-on-error: true`.
- **Fail-first, re-derived on unfixed `13accc50`:**
  - **F2:** the new test file run against the old helper fails at its first SHADOWING case.
  - **F1:** a `continue-on-error` mutant passes the old contract (65 passed, exit 0) and fails the new
    one.
- **`run-all` on the cherry-pick:** exit 0, **14 suites, 258 + 66 = 324** (W3 reported 324 / 14).
  `check-hosting-routes` has 16 cases and `workflow-contract` 66.
- **Recorded and excluded:** `/tmp/wsf-routes-*` fixtures still accumulate (1,134 on this box). This is
  F3/F4-class cleanup and outside the release.

**Verdict: PASS** on the bounded delta. It is not CI-gated, and not accepted, integrated or staged.
L0 carries it with `-x` under the standing ruling.

## PACKET — FINAL #452 pin delta at `2f286e94` (L0 `5803970970`; Director final acceptance `5803984351`)

**Reviewed:** pin head `2f286e945cb1ab65dcadb426d15db81da1945db2` (`claude/wsf-staging-pin-f2f901a`), confirmed by
`ls-remote` at 22:26Z.
- History: `ed8649ec` → `c9ea9104`, L0's merge of `main` `18dd21eb` → `2f286e94`, the approval edit.
- Candidate: `7ee70e4f4db73c9d3fd475ef4729d3eb51064619`, accepted by the Director as final.

**Instrument:** `docs/westayfit/qa/sprint-w5-pin-452-final-delta-verify.mjs`. It was pushed at `86b4d519` before
the pin moved. Its self-test on a local, never-pushed simulated pin gave 11/11 control rows and caught 8/8 mutants.

**Result on the real pin: 11/11 OK, exit 0.**

| row | result |
| --- | --- |
| E0 | `ed8649ec` is an ancestor; no history rewrite |
| E1 | the pin tree is `ed8649ec` ⊕ `main` plus **only** `approved-candidate.json` |
| E2 | changed fields are `approvedAppSha`, `packageLabel` and `_fullCandidateNote`. `expectedPriorFunctions` stays 46, and the three additions are unchanged and in the same order. No key was added or removed. |
| E3 | `approvedAppSha` = `7ee70e4f…`, a real commit descending from `f2f901a` and `c8f38e3` |
| E4 | protected paths: 9 files from `c8f38e3`, 0 from `f2f901a` |
| E5 | candidate source exports go 46 → 49; the added three equal `candidateAddedFunctions` |
| E6 | no "#450 under review"; the candidate is cited in full; the note is re-based off `f2f901a` |
| E7 | `resolve-candidate` resolves `7ee70e4` and refuses `f2f901a`, `c8f38e3`, `9f27c6e`, `0bf8f42` and `dd86721` |
| E8 | the pre-review harness on pin ⊕ `main` scores 22/22 |
| E9 | `run-all`: `main` exits 0 with 14 suites, 258 + 66 = 324; pin ⊕ `main` exits 0 with 14 suites, 260 + 66 = **326** |
| E10 | the hosting check (`main`'s helper, F1/F2 included) passes the candidate's config: `ROUTES=pass`. The dist is **modelled** from the declared destinations. The candidate's `firebase.westayfit.json` blob `b22d77ac` is identical to `f2f901a`'s, which passed against a real export in the #450 review. |

**Checked by hand against git:**
- The prose claims hold: `c8f38e3..7ee70e4` is 257 files, +22,642 / −882, over 15 first-parent commits.
- The five composition merges have exactly the named second parents (`7f37e2a`, `eff65b0`, `cd02949`, `e653330`, `7a4b271`).
- There is no protected change since `f2f901a`.
- The DRAFT / HELD paragraph claims no final acceptance, as L0's scope required.

**Verdict: PASS.**

**Observations, low and non-blocking:**
1. **An inherited sentence is now stale.** `_fullCandidateNote`'s "Independent verification of this exact SHA" sentence was carried over from the `f2f901a` version. It still cites checks at `fca3326` and `dd86721` only. It omits W7 Checks 16–18 and W5's K-run on `9f27c6e`, which was carried to `7ee70e4`. The note calls itself a boundary record, so this is prose only.
2. **The DRAFT / HELD wording is now historical.** The Director's `5803984351` says so and asks for no re-review.
3. **The candidate is reachable from one branch only.** At 22:27Z, `7ee70e4` was reachable only from `claude/wsf-release-candidate-round-2`, and the deploy checks it out by SHA. That branch, or `claude/wsf-app-shell` once the candidate is integrated, must keep it reachable. The Director has already told L0 to preserve the frozen candidate.

**Status:** reviewed. The pin is not merged, nothing is dispatched, and staging still serves `c8f38e3`. This is not an approval.

**Limits:**
- Dispatch still needs the operator preflight and the index READY receipt.
- The hosting check used a modelled dist, not a real build of `7ee70e4`.
- No Actions runner was used.

### Addendum — the red team found bypasses in my harness; v2 closes them; the #452 verdict is unchanged

**Instrument correction 14 (mine).** Before relying on `sprint-w5-pin-452-final-delta-verify.mjs`, I red-teamed it with
adversarial probes (workflow `wf_31f83f28-07c`). It showed that v1 (`86b4d519`) could be passed by wrong pins:
- **Extra parent.** An extra "ours" parent carrying the candidate's 168-commit history, with none of its content, passed 11/11.
- **Main not merged.** A pin without `main` merged in passed E0–E7, and E8–E10 then ran on a merge the harness had synthesized.
- **Weak prose checks.** E2 and E6 accepted:
  - a gutted `packageLabel`, with the dispatch, index, kiosk and SHUT guards removed;
  - an NBSP-disguised "#450 under review";
  - a `_fullCandidateNote` still based on `f2f901a`;
  - a rewritten rollback note;
  - duplicate JSON keys.
- **Not demonstrated, but real gaps:** a symlink-mode approval; a single-branch candidate anchor; an uncaught crash in a heavy row hiding every row; leaked temp directories.

Two of these were independently reproduced by a skeptic. The remaining skeptic checks did not run because the session budget ran out; the extra-parent bypass carries its own measured output.

**v2** adds the following, and each check has its own SELFTEST mutant:
- **E0 ancestry:** `main` must be in the pin; new commits must be first-parent only; any side parent must be on `main`.
- **E1:** a raw diff with mode `100644` pinned, and `main` merged in as a hard requirement.
- **E2:** canonical JSON, `ed8649ec`'s key order, and only `approvedAppSha`, `packageLabel` and `_fullCandidateNote` may change.
- **E6 structure:** the label must be `ed8649ec`'s label verbatim except the one `(PR #450, under review) will enforce.` sentence, whose replacement cites `13accc5` as an ancestor of `main`. The note must start with the candidate, and hidden characters are rejected.
- **E3:** the candidate must be reachable from app-shell or the candidate branch.
- **E8–E10:** run on the pin itself and crash-contained.
- **E9:** compared suite by suite against `ed8649ec` ⊕ `main`.
- **ONLY:** a probing run prints PARTIAL and exits 3.

**Results:**
- **SELFTEST:** the control passes 11/11, and **17/17 mutants** are caught (the 8 from v1 plus 9 red-team shapes).
- **The real pin `2f286e94`, re-run under v2 with MAIN `18dd21eb`: 11/11.**
  - E0: 2 new commits, both first-parent.
  - E6: the label's only interior change is the #450 sentence, now "(PR #450, merged as 13accc5; … #460 18dd21e) enforces.", behind a 1,664-character prefix. It has no hidden characters.
  - E9: 14 suites and 326 on both sides.
- **The verdict does not change.** It also rested on the hand read of the three-field diff and the full prose.

**New observation (low):** `apps/westayfit/package-lock.json` also changed across `c8f38e3..7ee70e4`: +1 line, the `@react-navigation/bottom-tabs` entry that mirrors the declared `apps/westayfit/package.json` dependency. It is unchanged since `f2f901a`. The notes' "NINE protected files" list and their UNCHANGED list both omit it, so the protected delta is ten files, not nine. v2 counts ten.

**Integration fact:** #452 merged to `main` as `cc30f1d3` (parents `18dd21eb`, `2f286e94`). Its tree `5090c963` is byte-identical to the reviewed pin's. Staging still serves `c8f38e3`, and nothing has been dispatched.

## PACKET — run-receipt check, staging run 47 (`35937603929`) (L0 `5804106757` / `5805115660`)

**Run:** workflow_dispatch from `main` `cc30f1d3` with `app_sha` `7ee70e4f…`, 00:15–00:26Z, conclusion **failure**. The source is
job logs read through the GitHub API: gate, deploy (985 lines, read in full by grep), hosted-verify (977 lines, read in
full by grep). The run's log zip host is blocked by this container's proxy, so the artifacts were not downloaded;
their digests are quoted from the logs.

| row | result | evidence |
| --- | --- | --- |
| gate resolution | **PASS** | `CANDIDATE=7ee70e4f4db73c9d3fd475ef4729d3eb51064619` (requested = approved) |
| artifact identity | **PASS** | build "Confirm the checkout is the approved commit" ✓; deploy "artifact belongs to 7ee70e4f…"; downloaded artifact sha256 `ccac6043…` |
| hosting-route step | **PASS, ran live** | deploy step 7 (after Confirm 6, before Authenticate 9): `CANDIDATE_REWRITES=12`, `ROUTES=pass`. This is the first production-path run of #450 / #460. |
| preflight | **PASS** | `PREFLIGHT_BEFORE=46`, `PREFLIGHT_BASELINE_MATCHES_APPROVAL=true` |
| inventory | **PASS** | `INVENTORY_BEFORE=46`, `INVENTORY_AFTER=49`, `EXPECTED_INVENTORY=49`; `CREATED_THIS_DEPLOY` = `APPROVED_ADDITIONS` = exactly the three; `PREEXISTING_TRANSPORT_VERIFIED=22/22` |
| transport of the three (feature readiness; W3's lane) | **NOT READY** | "Failed to set the IAM Policy" ×3, and per-service `invoker_iam_check_enabled` (SHUT) for all three. Operation 2 by a named operator is required. |
| hosted marker | **served on the channel as `7ee70e4` at 00:24:04Z** (hosted-verify "PASS correct staging build — health marker 7ee70e4") | The deploy verifier's single `/health` read at 00:22:34.99, ~1.9 s after "release complete", did not match. That is the **only** VERIFY failure (`VERIFY=failed (1)`). The read has no retry (`verify-deployment.mjs:365`). A propagation race is the likely explanation, **not proven**. |
| hosted-verify | **6 results, 1 FAIL** | FAIL = Package E suite, `waitFor(getByTestId('wsf-community-manage'))` timed out. Root cause below. |
| cleanup | **PASS** | `CLEANUP_STATUS=COMPLETE`, 91/91 documents deleted, 6/6 users already absent |

**The Package E FAIL is drift in the hosted smoke, not a product defect in `7ee70e4`, and not caused by the SHUT transport.**
- The operational smoke `hosted-package-e-smoke.mjs` (last changed 2026-09-20) opens Manage with the in-page button
  `wsf-community-manage` (`:422–424`).
- W9's shell migration `0b2d50cf` (in `f2f901a`, not in the served `c8f38e3`, whose run 46 passed Package E) removed that
  button. Manage became the founding Champion's context action in the top-bar menu:
  `wsf-member-topbar-menu-button` → `wsf-member-topbar-menu-manage-community`, opening the unchanged `wsf-community-manage-panel`.
- The candidate's own e2e suite was adapted (`tests-e2e/helpers/memberShell.ts`: `openMemberManage`, `manageOffered`). The ops smoke was not.

**Second consequence, more serious for the evidence:** the smoke's three negative checks now count a testID that no longer
exists, so they pass whatever the product does. They are the "member does NOT have Manage" checks at `:545`, `:1056` and
`:1261`. The Champion-only boundary has **no working hosted check** until the smoke asks the menu, as `manageOffered` does.

**Proposed fix (not mine to make; ops file):**
- `openManage` opens the menu and clicks the `manage-community` row.
- The three negative checks open the menu and count that row, returning false when no bar is rendered.
- A contract case pins both locators.

**Status:** receipts read. Staging's served state is not claimed; the Director's served conditions are not met (transport SHUT;
Package E unverified). This is not an approval.

## PACKET: the hosted Package E smoke's Manage locator, W3 `dc639571` composed onto `main` `8c1aa40b`

**Verdict: PASS.**

**Reviewed:**
- source `dc639571b69ac77f42c97bd094cc15a5c4b9bdb2`, a two-file delta over `d690435a`;
- target `main` `8c1aa40b116e374b13e390d5ac44364fac99b9f0`;
- the composition, built locally as tree `f6532601ba5cf95c21f59606b487dace73e08900` (`merge-tree --merge-base=dc639571^`).

The composed patch over `main` is byte-identical to `dc639571^..dc639571`. On `main`, both files are blob-identical to those in `d690435a`.

**Packets:**
- Director `5805464194`, then `5805592534`;
- W3 `5805442619`, then `5805517599`.

### Measured

| check | evidence kind | result |
| --- | --- | --- |
| scope | git | Exactly 2 files: the smoke and `hosted-smoke-contract.test.mjs`. No product, cloud, marker-retry, verifier or workflow change. |
| run-all | local node | `main` 14 suites / 326 tests. Composed tree 14 / 337. W3 head 15 / 373 (this matches W3's message). All exit 0. The contract goes from 34 to 45. |
| real surfaces in product code | source | On `7ee70e4`, the `MemberTopBar` menu button toggles the menu, and the `manage-community` row is registered only when the page is ready, the role is `foundingChampion` and there is a uid. On `c8f38e3`, `wsf-community-wordmark` is drawn for every role and `wsf-community-manage` only when `isChampion`. Neither candidate carries the other's marker. |
| B1–B12 | mocked, independent model | The helpers' real source was run against a page model that renders elements late. The Champion reaches the panel on both surfaces. The member passes on both, and on the shell the menu is really opened and closed. A Champion row that registers 500 ms after the menu opens still fails the member check. Each of these fails: neither surface, both surfaces, a menu that won't close, a row that opens no panel, and a panel that is already open. |
| X1–X11 | mutation | Every mutant fails the contract suite (9 mutants: X1–X5, X7 and X9–X11). They include: a member check that never opens the menu, a misspelt row id, "neither" falling back to legacy, the both-surfaces guard removed, an inverted hold, swapped detection, and a member site reverted to a bare count. |
| S1–S7 | git, static | All 24 green-run PASS rows are identical by name and order. All nine `finally` cleanup blocks are byte-identical. There are 17 `wsf-goal-display-auth-*` references and 6 `openManage` sites, both unchanged. No bare count of the removed control remains. |
| real browser | **local emulator + real web exports, Chromium 141** | Each candidate had 11 of 11 cases as required (details below). |
| control | harness on `main` | Exits 1: the helpers are absent. |

### Real-browser cases

The helpers were sliced verbatim from `dc639571` by `sprint-w5-package-e-manage-browser-extract.mjs`. The candidates were built with `expo export` in emulator mode and served by the hosting emulator. Seeding used the repo's `tests-e2e/helpers/mobile.ts`. The contexts were desktop and the smoke's `PHONE_CONTEXT`.

**`7ee70e4`, where `manageSurface` returned `shell`:**
- P1: the Champion's `openManage` showed the panel on desktop and on phone.
- P2: the member check passed. A poller saw the menu open on 20 of 21 samples, and it was hidden afterwards.
- N1: a Champion put through the member check was rejected with "…Manage community is in the menu".
- N2: a member's `openManage` was rejected at the row.
- N3: `about:blank`, `/signin` and `/` signed out were each rejected with "Neither Manage surface".
- N4: an injected legacy marker was rejected with "Both Manage surfaces".

**`c8f38e3`, where `manageSurface` returned `legacy`:**
- P1 and P2 passed.
- N1 was rejected with "…the legacy Manage control is drawn".
- N2 was rejected at `wsf-community-manage`.
- N3 was rejected with "Neither".
- N4: an injected shell marker was rejected with "Both".

### Open gaps

These are low severity. Each mutant survives the contract, but the smoke itself is correct:

- **G1:** dropping the member check's final "panel closed" assertion.
- **G2:** returning from `openManage` on the shell without waiting for the panel. The next Champion step waits on its own control anyway.
- **G3:** the member hold `holdMs` cut to a single look. My B5 shows that the default 2 s catches a late row.

The contract's fake page opens elements synchronously, so it cannot express G2 or G3.

### Limits

- **Emulator, not hosted staging.** The fixture was seeded by REST rather than by the smoke's `seedFixture`. Only fresh `goto` loads were tested. The helpers click without `.last()`, and a pushed in-app route could mount two shells; the smoke always navigates with a full `goto`.
- **The legacy member check is a single instant count.** Its safety relies on the caller first waiting for the goal link. N1 shows the Champion's control is already drawn at that moment.
- **No hosted Package E run was made.** Whether the hosted row turns green is still unmeasured until the operator's next run.

**Status:** delivered by W3. This is a W5 review verdict: not accepted by the Director, not integrated, not staged, and not an approval to merge.

**Evidence** (all under `docs/westayfit/qa/`):
- `sprint-w5-package-e-manage-verify.mjs`, run as `ROOT=. REV=<tree|sha> BASE=<main> node …`. It reported 32/32 required rows on `f6532601` and on `dc639571`.
- `sprint-w5-package-e-manage-browser-{extract.mjs,probe.spec.ts.txt,results.json}`. The probe used a synthetic emulator-only password.

## QA2: PR #491, social-privacy mode, exact head `6d0e5e83caa1be575bead85482650a10a9e0d004`

**Released by:** Director #395 `5840747149` / `5840912664`. **ACK:** #395 `5840965813`.

**What the PR is:** one commit on `a4b228a5`, which is current `main`. It changes seven files, all under `.github/`.

### Verdict by item

| # | item | verdict | evidence |
| --- | --- | --- | --- |
| 1 | the mode reaches gate, config and privacy only | **PASS** | Parsed from the workflow YAML: for `social-privacy`, the reachable jobs are exactly `gate`, `config` and `social-privacy`. Every checkout uses the workflow's own commit (`ref: github.sha`); there is no candidate ref. Mutants M12 (build reachable) and M13 (candidate checkout) are both caught. |
| 2 | a SHUT setter blocks before any fixture write | **PASS on the measured shape, with finding F1** | Emulator run R1: the setter answers an HTML 403. All 7 rows are BLOCKED and the run exits 3. The manifest lists 0 users and 0 docs, and before/after totals are unchanged. Mutants M1–M3 are caught. F1 is below. |
| 3 | seven-row status and verdict fail closed; only 7/7 is READY | **PASS** | L1 and L2; mutants M4–M6. On the emulator, R0 gave 7/7 and exit 0. R2 and R1 gave blocked and exit 3. R1b, R3 and R4 gave fail and exit 1. |
| 4 | the harness itself makes no IAM, index or service change | **PASS** | Source read, plus M8 caught. The harness's only calls are callable HTTP requests and Firestore/Auth REST calls. |
| 5 | run-tag ownership, cleanup manifest, and the scan/upload gate | **PASS; actual deletion is CANNOT-MEASURE** | The `e5p-` prefix is owned in `run-tag.mjs` and cross-checked in `cleanup-synthetic`. The manifest is written before the first write and was complete on the emulator: every real document and all 3 users are listed, with nothing left out. Cleanup, the scan and the final gate all run with `if: always()`, and the upload is gated on the scan (M10, M11, M14 caught). `cleanup-synthetic.mjs` is staging-only, so its deletion of an `e5p` manifest was not run. Reading its rules, the manifest's shape is acceptable to it. |
| 6 | workflow permissions no broader than needed | **PASS** | The job has `contents: read` and `id-token: write` only (M9 caught). Top-level permissions are `{}`. The job uses the same auth pattern as the other privileged jobs. |
| 7 | a missing index's `INTERNAL` counts as BLOCKED | **PASS** | Emulator run R2 (INTERNAL injected by a proxy): rows 3 and 6 are BLOCKED and every other row passes. The verdict is blocked, exit 3, `READY=false`. Mutant M7 is caught. |
| 8 | re-derive a transport-SHUT fail-first and a product mutant | **PASS** | SHUT: R1 on the real emulator, plus M1–M3. Real product mutants, on the candidate `0b460ce3` functions: R3 (the members list ignores a private name) fails row 3, exit 1. R4 (the setter also writes the other community) fails row 4, exit 1. |

### Findings

- **F1 (moderate; smallest fix is one line).** The setter probe is unauthenticated, so the real handler can only answer `UNAUTHENTICATED`. Yet `classifyTransport` counts **any** JSON body carrying `error.status` as "open": a 403 `PERMISSION_DENIED`, a 503 `UNAVAILABLE`, even `{"result":null}`.
  - Emulator run R1b gave the setter a Google-front-end-style JSON 403. The harness read it as open.
  - It then wrote 3 users and 17 documents, and reported all 7 rows **FAIL** (exit 1) instead of BLOCKED (exit 3).
  - `READY` stays false and the manifest was complete, so this is contained, but it breaks item 2's intent: nothing written while the setter is SHUT.
  - **Fix:** count the probe as open only when it returns HTTP 401 with `error.status === 'UNAUTHENTICATED'` and no numeric `error.code`.
  - Whether Cloud Run's invoker refusal can ever take this JSON shape was not measured. The known shape is HTML.
- **G1 (low).** For an authorised viewer, an error other than INTERNAL from the members or activity read (for example `PERMISSION_DENIED` to the champion) makes the affected rows BLOCKED instead of FAIL. The verdict still fails closed, but the result is misclassified.
- **G2 / G3 (low).** No focused test catches two changes: dropping row 5's anonymous-setter check, or loosening row 6's people-moved-today check.
- **G4 (low).** The contract's "no candidate checkout" check only matches the `needs.gate.outputs.app_sha` spelling. A second checkout of any other ref is not caught.
- **Observation.** Row 6 does not re-check that a private name is absent (row 3 does), so the R3 mutant fails row 3 only.

### Measured

- **Focused suites at the head:** `social-privacy-postop` 8, `workflow-contract` 72, `cleanup-synthetic` 42, all exit 0.
- **`sprint-w5-pr491-verify.mjs`:** 19 of 19 required rows. Gaps L4 and G1–G4 are recorded as open.
- **Emulator runs R0–R4:** real Auth, Firestore and Functions emulators with project `demo-wsf-local`, running the functions of the pinned candidate `0b460ce3`. The PR head carries no function source.
  - The harness file run is exactly the PR head's.
  - R0, R3 and R4 started from empty emulator state. R1, R1b and R2 ran on state left by earlier runs, with before/after deltas measured.
  - Receipts, logs and the fault proxy are in `docs/westayfit/qa/sprint-w5-pr491-emulator/`.

### Limits

- **No staging access.** The real SHUT response shape, real index behaviour and real cleanup deletion were not measured.
- **The Firestore emulator doesn't enforce composite indexes,** so R2's missing index is an injected INTERNAL, not a real one.

**Status:** reviewed by W5; not accepted, integrated or dispatched. This is not an approval to merge.

### QA2 F1 delta: successor `2cfaa34916c0b7b19ad65b7521d5515ce0be955c` (one commit on `6d0e5e83`) — **PASS**

**Scope.** Exactly two files changed: `social-privacy-postop.mjs` (`classifyTransport` and its comments) and its test. There is no other drift.

**Unit and contract suites.** `social-privacy-postop` passes 9 tests and `workflow-contract` passes 72. My mutation harness passes 19 of 19 required rows. L4 is now CLOSED: a JSON 403 `PERMISSION_DENIED` is classified as `shut`.

**Real harness against a write-counting fake server.** The fake server records every request. Any request that is not an unauthenticated probe of one of the three services would count as a write attempt.

| shape answered by the setter | transport | exit | rows | requests | writes |
| --- | --- | --- | --- | --- | --- |
| my R1b JSON 403 `PERMISSION_DENIED` | shut | 3 | 7 BLOCKED | 3 probes | 0 (manifest 0/0) |
| HTML 403 | shut | 3 | 7 BLOCKED | 3 | 0 |
| JSON 503 `UNAVAILABLE` | unknown | 3 | 7 BLOCKED | 3 | 0 |
| 200 `{"result":null}` | unknown | 3 | 7 BLOCKED | 3 | 0 |
| setter JSON 403, the other two services a 401 `UNAUTHENTICATED` | setter shut | 3 | 7 BLOCKED | 3 | 0 |

**The OPEN path is kept.** On the real Functions emulator, R0 answered all three probes with `HTTP 401, UNAUTHENTICATED`. That is exactly the one shape now classified as open.

**Residual (low, not a condition).** A 401 with a Google-front-end-style JSON body that carries `status: UNAUTHENTICATED` and a numeric `code` would still read as open. An anonymous request to an IAM-protected service is refused with a 403, so this shape was not observed.

**Probe:** `sprint-w5-pr491-emulator/f1-delta-fake-server.mjs`.

## QA2 carry review: Progress Phase A (PR #495), exact `f79a3c49e4593d5f18a62b6f89bfc4444f06eb87`

This was released by Director #395 `5841328326`. It is one commit on `0b460ce3`, the head of `claude/wsf-app-shell`, and it adds 6 files. `package-lock.json` is blob-identical to the base.

**Skipped as superseded:**
- the local shared lifecycle/unknown logic (`statusOf` / `isReachedNow`);
- `whenLabel()` / `endsAt` formatting;
- the period-label fixture text.

**Measured:**
- the focused vitest files `progress-parity.test.ts` and `progress-parity-view.test.tsx`: 34/34 pass;
- `tsc --noEmit`: exit 0;
- the Phase A e2e spec, against an emulator-flagged `expo export` served locally: 12/12 pass at 390×844 and 390×640. The evidence case is skipped, because frames are off;
- W5's own jsdom probes P1–P10 (`sprint-w5-pr495-carry-probe.test.tsx.txt`): 10/10 pass.

| carry item | verdict | evidence |
| --- | --- | --- |
| pure: no Firebase, router, auth, storage or demo authority | **CARRY PASS, with note C4** | The component and model import only react, react-native, `progressParity`, `kit` and `MemberTabBar`. Every action is a callback. |
| the private hero, with per-unit totals that never blend | **CARRY PASS** | P1: 17 squats and 5 steps give two totals, and no 22 appears. `unitTotals` is keyed on the exact unit text. |
| `receipts: null` is honest and invents no rows or times | **CARRY PASS** | P2: the "unavailable" line is shown, with no rows and no relative-time words. See C2 for an empty array. |
| first-eligible versus no-open-goal CTA | **CARRY PASS** | P10: Start moving and Open community are exclusive, and each calls only its own callback. See C1 for the wording under partial data. |
| partial and failure don't invent 0; both offer Retry | **CARRY PASS** | P4: the failed state has no digit and no totals, and Retry calls only `onRetry`. P5: the partial note is shown, totals come only from loaded goals, and its Retry works. |
| actions labelled, targets sane at 390×640/844 | **CARRY PASS** | primary action `minHeight` 54, secondary 48, receipt 60. The e2e spec proves "Start moving whole on screen" and keyboard Tab/Enter at both sizes. |
| no rank, streak, score or inferred impact | **CARRY PASS** | P8: none of those words appears outside the one disclaimer footnote. |
| the route-handle bridge is not misleading | **CARRY PASS** | Every reused handle (`wsf-activity`, `-title`, `-subtitle`, `-loading`, `-signed-out`, `-error`, `-retry`, `-partial`, `-empty`, `-start`, `-rows`, `-privacy`) keeps its meaning. `wsf-activity-empty` now carries `data-state` (`first-eligible` / `no-open-goal`). Per-goal handles are renamed from `row-`/`done-` to `goal-<id>`, rather than reused with a different meaning. |
| short-phone compact behaviour and accessibility | **CARRY PASS** | Compact mode turns on at `height ≤ 700`, and only after hydration. The e2e spec passes at 640. |
| the focused tests cover the above | **CARRY PASS, with the gaps below** | Both the unit and view suites cover order, units, receipts, states and callbacks. |

### Findings (none blocks the carry)

- **C1 (moderate).** With `partial: true`, no goals loaded and `canStart: false`, the no-open-goal card says "No goal is open for contributions … your community has no goal accepting contributions right now" (probe P6). That is a community-wide negative drawn from an incomplete read. The smallest fix is to hedge the title and body when `partial` is set, for example "No open goal loaded".
- **C2 (low).** `receipts: []`, meaning a future source that answers "none", draws only the heading "Recent contributions" with nothing under it (P3). It needs a one-line empty state.
- **C3 (low).** The types allow a zero-credit goal: `yourPart: 0` draws "YOURS 0 squats" and a hero total of "0 squats recorded" (P9). This is a contract the route must keep, because the list means "own credit". Either filter out `yourPart > 0` in the view, or document it as a route precondition.
- **C4 (low).** The component imports `MemberTabBar` only for two numeric constants. That pulls `kioskSession` (sessionStorage and sign-out helpers) and the bottom-tabs types into the pure module graph. Nothing is called, but the constants belong in `memberShellMetrics`.

**Limits.** This is component-level review only; no route hook exists yet (Phase B). Pixel comparison is the Director's. PR #495's head has since moved to `da9aae08`; that commit was not reviewed.

## QA2: YOU-PARITY-1 Phase A (PR #492), exact product `5e76a10ca34c33a2cb3dc9f3ff48450e413ea264` — **PASS**

**Routing.** Routed by L0 in #395 `5841499924`. The scope follows the carry rule in `5841133868` and the hold in `5841277254`. The baselines `92123f26` and `66e56c4d` are both ancestors.

**Scope checked by git.** Against `0b460ce3`, the only non-docs files are `goalTruth.ts`, `youParity.ts`, `YouParityView.tsx`, `app/design-target/you-parity.tsx`, three unit/view tests and the e2e spec. `package-lock.json` is blob-identical to the base.

**Measured**
- Focused vitest (`goal-truth`, `you-parity`, `you-parity-view`): 41/41.
- `tsc --noEmit`: exit 0.
- `sprint-w6-you-parity.spec.ts` against an emulator-flagged export served locally: 12/12 at 390×844 and 390×640. The evidence case is skipped.
- W5 jsdom probes Y1–Y8 (`sprint-w5-pr492-you-probe.test.tsx.txt`): 8/8.

| truth item | verdict | evidence |
| --- | --- | --- |
| `SharedPosition` cannot encode an unknown total as a fake zero | **PASS, with note Y-F1** | Probe Y1: an open lead with an unknown total shows OPEN and "Not available right now". It draws no digit in the shared card and no Living WE or track, and the own part is kept. `sharedTotalOf` returns null for unknown. |
| open and closed-unknown lifecycle | **PASS** | Y2: a closed goal with an unknown total shows `CLOSED · RESULT UNAVAILABLE` with an "Unknown" cell, never REACHED, UNFINISHED or 0. Y3: `REACHED · STILL OPEN` and `CLOSED · UNFINISHED` both appear only on known totals. |
| no Date, Intl or device-zone logic in the You parity sources | **PASS** | `goalTruth.ts`, `youParity.ts` and `YouParityView.tsx` contain no `Date`, `Intl`, `toLocaleDate/TimeString` or `timeZone`; their only locale call is `toLocaleString('en-US')` on numbers. Note: the unchanged helper `progressFormat.formatCount`, reached through `LivingWeProgress`, formats numbers with `Intl.NumberFormat(undefined)`. That is device-locale digit grouping, not dates or zones, and it predates this PR. |
| `periodLabel` passes through verbatim | **PASS** | Y4: an arbitrary label appears byte for byte. A null label leaves no dangling "·". |
| each row carries its own `communityName` | **PASS** | Y5: the Harbor Lunch Crew row shows its own community, not the current one. |
| lead columns 230 / 110 / 10 | **PASS** | The e2e spec measures shared 230 ±1, own 110 ±1 and a 10 px gap, at both heights. |
| no filler "Community" sub-line | **PASS** | Y6: an undefined, `custom` or unknown group type prints no "Community" in the band. |
| no Firebase, router, auth or storage authority | **PASS, with carry note C4** | The view imports react, react-native, labels, the model, kit, `LivingWeProgress`, `MemberTabBar` (for constants only; see C4 on #495) and `progressFormat`. Only the design-target fixture uses `expo-router` (`useLocalSearchParams`), and it is gated. |

**Y-F1 (low, not a condition).** `knownShared(total)` accepts any number:
- `knownShared(NaN)` draws "NaN / 500 confirmed", "NaN squats to go" and a Living WE, because `hasInstrument` only checks `kind`.
- `knownShared(-5)` draws "-5 / 150".

The route should only ever pass a finite, non-negative aggregate. A one-line guard in `knownShared` or `hasInstrument` (`Number.isFinite(total) && total >= 0`) would make that impossible to encode.

**Instrument note.** Probe Y8's first draft flagged the view's own disclaimer, "No rank, streak, score or inferred impact.". After excluding that sentence it passes, and no other ranking language appears.

**Not reviewed.** PR #492's evidence head `cf3423ec` (docs and frames) was not reviewed for pixels; that is the Director's.

## QA2: You Y-F1 `02f86fc2` (#500) and Progress `92993f09` (#501)

Released in L0 `5842371466`, per Director `5841927035`. Everything below was measured at `92993f09`, which contains `02f86fc2`.

**Measured**
- Focused vitest (goal-truth, you-parity ×2, progress-parity ×2): 77/77.
- `tsc`: 0.
- The You and Progress fixture e2e specs, on one emulator-flagged export: 26 passed, 2 skipped (the evidence cases).
- W5 probes: the You set 8/8 and the Progress set 13/13 (`sprint-w5-pr501-progress-probe.test.tsx.txt`).

### You `02f86fc2` — **PASS**

**Scope.** One commit on `cf3423ec` (the evidence head, on top of `5e76a10c`). The only non-docs changes are `goalTruth.ts`, `goal-truth.test.ts` and `you-parity-view.test.tsx`. `YouParityView.tsx`, `youParity.ts` and the fixture are blob-identical to `5e76a10c`.

**The fix.** `knownShared` now returns `UNKNOWN_SHARED` for NaN, ±Infinity or a negative total. `knownShared(0)` stays a known zero.

**Checked.** My original Y7 probe now shows the NaN lead as "Not available right now" and the −5 row as `CLOSED · RESULT UNAVAILABLE` / "Unknown". No other source constructs `{ kind: 'known' }` directly, so nothing bypasses the constructor. **Y-F1 is closed.**

**Residual (low).** The guard is on the constructor only, so a hand-written literal would bypass it. `target` itself is not validated here (for example `Infinity`). Neither case exists in the source today.

### Progress `92993f09` — **PASS (stacked delta)**

**Scope.** A merge of `02f86fc2` into `0bae01e3` (`b8b96f61` plus evidence). All six Progress-specific files are blob-identical to `b8b96f61`. `goalTruth.ts` is identical to the one in `02f86fc2`.

**Delta against my `f79a3c49` carry review**
- `progressParity.ts` now imports and re-exports `isReachedNow`, `sharedCell` and `statusOf` from the hardened `goalTruth`.
- The `sharedTotal` field became `shared: SharedPosition`.
- Local `whenLabel` and all `Date` handling were removed.
- `periodLabel` is displayed verbatim; there are 4 changed lines in the view.

**Probes**
- Q1: an arbitrary period label shows byte for byte, and null leaves no dangling "·".
- Q2: a closed goal with an unknown total shows `CLOSED · RESULT UNAVAILABLE` / "Unknown".
- Q3: `knownShared(NaN)` shows "Unknown", never NaN.
- The receipt seam and the CTA probes P1–P10 all still pass.

**Carried findings, still open and not conditions**
- **C1 (moderate):** the no-open-goal card makes a community-wide claim under partial data (P6 reproduces).
- **C2 (low):** an empty receipts array draws only a heading.
- **C3 (low):** a zero-credit goal draws "0 squats recorded".
- **C4 (low):** the `MemberTabBar` import.

## QA2: Community / Privacy pure Phase A, exact product `db41ffd2110ff92467c238ec6be306ef92587701` — **PASS, with one finding (K-F1)**

This was released in Director `5842003820` and L0 `5842371466`. The evidence commit is `88d5969e`.

**Scope.** Three commits on `0b460ce3`. They add seven files: two views, the types, the fixture, two view tests and the e2e spec. `package-lock.json` is unchanged.

**Measured**
- Focused vitest (`community-parity-view`, `community-privacy-panel-view`): 40/40.
- `tsc`: 0.
- `sprint-w4-community-parity.spec.ts` against an emulator-flagged export: 12/12 at 390×844 and 390×640; the evidence case is skipped.
- W5 probes: K1–K6 and V1–V4, 10/10. They are saved as `sprint-w5-pr496-*-probe.test.tsx.txt`.

| # | row | verdict | evidence |
| --- | --- | --- | --- |
| 1 | purity | **PASS** | The views and types import only react, react-native, labels, kit, `CommunityPresence`, `LivingWeProgress`, `progressFormat` and `MemberTabBar` (for its constants; see C4 on #495). None of them uses Firebase, the router, auth, storage, a timer or an overlay. |
| 2 | numeric fail-closed | **PASS** | `effectiveTotal` and `validTarget` turn NaN, ±Infinity, negative totals and non-positive or infinite targets into "unknown" or "no target". K1 ran seven impossible total/target pairs; none drew a Living WE, a percentage, "to go", reached/unfinished, NaN, ∞ or a negative. K2 showed that a confirmed 0 stays a real zero. |
| 3 | read truth | **PASS for every read state; see K-F1** | K3: the failed/loading goals, history, roster, communities and a null member count all show "—" or "Members", never 0 people, "No past goals yet" or "No active goal". K4: an incomplete roster claims no anonymous remainder. |
| 4 | privacy | **PASS** | V1: pressing a switch asks the route for the change, and the switch stays on the stored value (no optimistic flip). V2: Space asks once, and a row that is saving ignores both Space and click. V3: `membershipRefused` hides the switches and Retry and names the reason. The not-saved and unconfirmed copy is explicit, and the e2e spec shows a failed save staying visible, with Retry, beside the stored value. |
| 5 | copy | **PASS** | V4: the footer promises nothing dated ("Your private Progress keeps the exact amounts we can read for you."). The consequence paragraph removed in `db41ffd2` stays gone, and the focused tests pin that. |
| 6 | accessibility | **PASS** | Toggle rows have `minHeight` 60 and a 48×28 track. Retry is `minHeight` 44. Switches have role `switch` with `aria-checked`, `aria-busy`, `aria-describedby` and a polite live hint. The e2e spec proves Space works and that every chip is at least 44 px. |
| 7 | hierarchy | **PASS** | K6: banner → facts → communities → period → history → roster, checked by DOM order. The e2e spec confirms it at both heights. |
| 8 | focused tests only | **PASS** | No full suite was run and no pixels were scored. |

**K-F1 (moderate, one line to fix): an impossible member count renders as a number.**
- `memberCount` is `number | null`, but only `null` is treated as unknown.
- `formatCount(NaN)` returns `'0'`, so a NaN count renders the MEMBERS fact as **"0"** and the roster heading as **"0 people"**. That is exactly the fabricated zero row 3 forbids.
- A negative count renders as "-3" and "-3 people".
- The route shouldn't ever pass either value, but Y-F1 on You was closed for the same class of problem.
- **Smallest fix:** treat a `memberCount` that is not finite or is below 0 as `null` (one helper, used by the fact, the heading and `anonymousRemainder`), and add a test for it.

### K-F1 delta recheck: #496 product `646c9579bc5761a219d76c49f24dd64eaa3e485b` — **PASS**

This follows L0 `5843155084` and Director `5842638933`. The commit sits on `88d5969e`, which is on `db41ffd2`. It changes `communityParityTypes.ts`, `CommunityParityView.tsx` and one test.

**The fix.** A new function, `knownMemberCount`, returns `null` unless the count is a non-negative integer, and normalises `-0` to `0`.
- The MEMBERS fact and the roster heading both read through it.
- `anonymousRemainder` calls it internally.
- The view has no other raw use of `memberCount`; the remainder call passes the raw value into that guarded function.

**Measured**
- Focused vitest (the Community and Privacy view tests): 42/42.
- `tsc`: 0.
- W5 probes: 2/2, saved as `sprint-w5-pr496-kf1-probe.test.tsx.txt`.
  - NaN, ±Infinity, −3 and 2.5 each show "MEMBERS —" and the "Members" heading, with no remainder and no NaN, ∞, −3, 2.5 or "0 people" anywhere.
  - Both 0 and −0 show "0" and "0 people" (never "-0").
  - A real count of 23 with 2 named members still gives "21 members shown without names".

**K-F1 is closed.**

## QA2: MEMBER-SNAPSHOT-1 Phase A (#510), exact product `b71cf07f24bb388822c4c355357873dcb76515c2` — **FAIL (one material defect)**

Released by Director `5846709025`. Base `74d19281`; receipt `baae5e21`. The change is one additive callable, `wsfMyMemberSnapshot`, plus the `FieldPath` import and one new test file. No existing export changed: git shows a single removed line, the old import, which is re-added with `FieldPath`.

**Measured on local emulators** (`demo-wsf-local`, `emulators:exec --only firestore,auth`; the callable runs in-process through `.run()`):
- The PR's own suite: 10/10.
- The constituent suites, unchanged: 35/35 (my-communities 5, list-goals 10, list-goals-history 13, my-contribution 7).
- W5 probes: 12 cases, 10 pass. The two failures are both P6. Files: `sprint-w5-pr510-snapshot-probe.test.ts.txt`, `sprint-w5-pr510-probe.log`.

| # | row | verdict | evidence |
| --- | --- | --- | --- |
| 1 | the subject is `request.auth.uid` only | **PASS** | An anonymous call returns `unauthenticated`. A caller sending `{uid, userId, groupId}` belonging to user B gets only its own data; none of B's ids or credits (9871 / 6543 / 4321) appear. |
| 2 | recursive allowlist | **PASS** | Seeded private fields (`ownerUid`, `joinCode`, `createdByUserId`, `email`, notes, the caller's uid, `communityGroupId`, `contributionCount`) never appear. Every key path is inside the contract. |
| 3 | departed communities | **PASS** | Memberships that are `left`, `removed`, `pending` or `banned` leak no group or goal id, including for goals with own rows. |
| 4 | 0 versus unknown | **PASS** | No own row gives `ownCredit` 0. A malformed, negative or Infinity own total gives `null`. A goal with no shard docs gives `sharedTotal` 0 (a real zero; only a failed read gives `null`). A community with no active goals gives `goals: []` and `partial: false`. |
| 5 | cursor | **FAIL: F1, plus F2** | Malformed, oversized, negative, fractional, path-bearing and non-string cursors all return `invalid-argument`. A forged but well-formed cursor stays within the caller's own rows. See F1 and F2. |
| 6 | caps / truncated / partial | **FAIL: F1 makes pagination untruthful** | The 20-community cap sets `truncated.communities`. The `partial` semantics match the source. See F1 and F3. |
| 7 | no unordered fallback | **PASS** | When the own-rows query fails the result is `partial: true` with no fallback. There is no lifetime-history read. |
| 8 | cost | **PASS, receipt reproduced** | The 20/4/25 case gives exactly 50 goals, 47 RPCs and 725 docs. 500 of those docs are shards (10 per goal). The response is about 14.9 kB. No cost shape is materially worse than claimed; F3 covers the smaller points. |
| 9 | constituent callables unchanged | **PASS** | Additive diff only; 35/35 on their suites. |
| 10 | deployment boundary | **PASS (source)** | The receipt says the index must be READY first, the inventory goes 49 → 50 via `candidateAddedFunctions`, and the client fallback stays while transport is SHUT. The source says it must not be deployed or wired before the index is ready. |

**F1 (material): the page cursor silently drops rows that share a millisecond.**
- **Cause:** the cursor stores `t = updatedAt.toMillis()`, truncated to the millisecond, and resumes with `startAfter(Timestamp.fromMillis(t), id)` under `updatedAt desc, __name__ desc`. Every row whose `updatedAt` lies in (floor-ms, the 25th row's exact instant] is treated as already served.
- **Measured (P6):** 30 own rows, where rows 23–30 have the same millisecond but finer precision.
  - Page 1 returns 25 rows.
  - Page 2 returns **0** rows with `nextCursor: null`, so **5 rows are silently lost** and the client believes it has everything.
  - This happens both with identical microsecond instants and with distinct microseconds inside one millisecond.
  - Whole-millisecond controls return 25 + 5 = 30.
- **Production exposure:** production writes `updatedAt` with `FieldValue.serverTimestamp()`, which has microsecond precision in Firestore. The emulator's `serverTimestamp()` is millisecond-only, and the PR's own pager test seeds whole milliseconds, so neither can catch this.
- **Smallest fix:** carry the full `seconds` + `nanoseconds` (or the Timestamp's exact value) in the cursor, and add a sub-millisecond test.

**F2 (low): an out-of-range cursor time returns `internal`, not `invalid-argument`.** A `t` of 9007199254740991 or 3e14 passes `decodeSnapshotCursor`. `Timestamp.fromMillis` then throws outside the guarded block. Bound `t` to the Timestamp range inside the decoder.

**F3 (low, cost and shape).** None of these is a condition.
- Every active membership's community document is read before the 20-community cap applies: 25 memberships read 25 community docs.
- At the 50-goal cap, about 25 active goals are cut while `truncated.goals` is `true` and `nextCursor` is `null`, so those goals cannot be reached on any page. The flag is truthful, but the cut is permanent for this call shape.
- 10 of the 35 own-total reads are for goals the cap then drops.

**Not measured:** production's microsecond precision (taken from Firestore's documented behaviour), the composite index (the emulator does not enforce indexes), and the HTTP transport (the callable ran in-process).

### MEMBER-SNAPSHOT-1 successor recheck: exact product `8dc65316d282fc9ee0e91dcb4bb631b263825e98` — **PASS**

Released by Director `5847278911`. The receipt commit is `8fd2568b`. The predecessor `b71cf07f` failed under my evidence at `e01c9772`.

**Boundary.** From `b71cf07f` to `8fd2568b`, only three files change: `functions-westayfit/src/index.ts`, the focused snapshot test, and `docs/westayfit/member-snapshot-1-receipt.md`. Nothing touches the app, rules, indexes, auth, packages or deployment.

**F1: exact cursor. PASS.**
- The cursor now carries `{s: seconds, n: nanoseconds, id}` and resumes with `startAfter(new Timestamp(s, n), id)`, under the same ordering: `updatedAt desc`, then `__name__ desc`.
- My 30-row probe P6 on `8dc65316` covered five variants: an identical sub-millisecond instant, the same millisecond with different microseconds, a whole-millisecond control, `serverTimestamp()` in a batch, and sequential `serverTimestamp()` writes. Each returned page 1 = 25 and page 2 = 5, with 30 unique rows, 0 skipped and 0 duplicated. `nextCursor` was set after page 1 and `null` only after page 2.
- On `b71cf07f` the same probe skips 5 rows in the first two variants.
- The successor's own new tests, run against the `b71cf07f` source, fail 2 of 12: "loses no row that shares a millisecond…" and "refuses cursor instants outside Firestore's range…". On `8dc65316` they pass.

**F2: invalid input returns `invalid-argument`. PASS.** Each of the following, on `8dc65316`, returns `invalid-argument`:
- seconds above or below Firestore's range, and a huge `s`;
- `n` below 0, `n` above 999,999,999, a fractional `n`, and a fractional `s`;
- a legacy `{t}` cursor, including a huge legacy `t`, which on `b71cf07f` resolved or returned `internal`;
- a path-bearing id, and a missing `n`.

The boundary values `s` = max with `n` = 999,999,999, and `s` = min with `n` = 0, resolve.

**F3: caps before own-total reads. PASS.**
- Own-total reads now run on the returned goals after the 35/50 caps.
- On the receipt fixture of 20 communities / 4 active each / 25 owned, the snapshot returns 50 goals with **47 RPCs and 715 docs**: own-total `getAll` fell from 35 docs to 25, and shards stay at 500.
- My earlier byte measurement on this fixture was 14,860 (the receipt says ≤14,900), and the response shape is unchanged. I did not re-measure bytes.
- The two disclosed remaining cost-shape limits were not expanded, per the packet.

**Counts.**
- On `8dc65316`, the PR snapshot suite plus the W5 probes gave 25/25; the probe file alone gave 13/13.
- On `b71cf07f`, the W5 probes plus the old suite gave 20/23, failing P6a, P6b and the new F2 probe.
- The successor's own test file run against the `b71cf07f` source gave 10/12.

Local emulators only (`demo-wsf-local`). No broad suite, no cloud. The callable stays held until the composite index has a cloud READY receipt.

## SECURITY / OPS FINDING: Browser Use credential in `skills/browser-use-e2e/SKILL.md` (Director `5848177252`)

This was a read-only check. The key value is not reproduced anywhere. It is identified only by prefix `bu_`, length 46 and sha256 prefix `45b5e468`.

**Exposure**
- **The repository is public** (GitHub `visibility: public`).
- The literal key is at `skills/browser-use-e2e/SKILL.md` lines 12 and 28 on `main` `37f18ea9` and on development `claude/wsf-app-shell` `6c7f975c`.
- It entered in `81789e80` on 2026-04-04 and was re-added by `b7e57764` and `11bb1dbc`, both on `main`.
- It is in the tip tree of **350 remote branches**. It is the only Browser Use key found on any branch.

**The earlier fix was never merged**
- `dcc0bbcc` (2026-08-31, branch `fix/remove-leaked-browseruse-key`) replaced both occurrences with `BROWSER_USE_API_KEY` and added a rotation notice.
- No PR was ever opened for that branch, and it is not an ancestor of `main`.
- Branches cut later re-carry the literal (`7c89c41b` … `38fea68f`).

**Whether the key is active: CANNOT-MEASURE.** Testing it would mean using it, and no provider-side access is authorised. Since the repository is public, the key must be treated as compromised whatever its current state.

**Other secrets**
- On `main` under `skills/**`, `.claude/**`, `docs/westayfit`, `docs/wsf-staging`, `.github/wsf-staging`, `CLAUDE.md` and `AGENTS.md`, I scanned for the following patterns and found no other live-looking provider secret: Browser Use, OpenAI `sk-`, Stripe `sk_`/`rk_`/`whsec_`, Resend, GitHub `ghp_`/`github_pat_`, Slack `xox*`, AWS `AKIA`, Google `AIza`, PEM private keys and service-account JSON.
- Two `AIza…` hits are synthetic test canaries: `scan-evidence.test.mjs:32` (marked "CANARY … dO_nOt_DiScLoSe") and `write-sdk-config.test.mjs:17` (marked TEST). They are intentional.

**Remediation**
1. **Rotation (owner only).** Devin, as the Browser Use Cloud account holder, revokes the exposed key in the Browser Use dashboard and issues a new one. Removing the key from source does not revoke it; only the provider-side revocation ends the exposure. No agent may do this.
2. **Source fix.** Carry `dcc0bbcc`'s two-line change to `main` as a docs-only PR, either by cherry-picking `-x` or by recreating it: use the `BROWSER_USE_API_KEY` env var in both places and keep the rotation notice. Development branches then pick it up on their next merge from `main`.
3. **History.** Removing the literal from HEAD does not remove it from history, from 350 branch tips, or from any clone. Rewriting history is not recommended: this repo syncs to Lovable and forbids force-pushes, and rotation (item 1) is what neutralises the key. Stale branches can be pruned separately, at the owner's discretion.
4. **Prevention (optional).** Add a secret-pattern check (the `bu_` prefix and similar) to an existing CI or pre-commit lane, and enable GitHub secret scanning and push protection in repo settings (owner).

## INSTRUCTION-AUTHORITY-QA-1: PR #520 docs audit at exact head `54d3eaca6686f4f0bbb1595ad37622acb5b1eb4a` (base `6c7f975c`) — **FINDINGS (not PASS)**

**Method.** Three independent readers covered rows (1, 2, 8), (3, 4, 5) and (6, 7). Each candidate finding was then adversarially verified against the exact head text, and the two key claims were re-checked by W5 with git. Raw per-agent results, including the rejected candidates, are in `sprint-w5-pr520-authority-audit.json`.

**Rows**
- **Clean or mostly clean:** 2 (`CURRENT_STATE.md` is a pointer to the #365 CURRENT comment), 3, 5 (the multi-movement wording keeps its no-invented-equivalents guard), 6 and 7 (no live-capability overclaim).
- **With findings:** 1, 4 and 8.

| # | sev | file / heading | conflicting statement | governing source | smallest correction |
| --- | --- | --- | --- | --- | --- |
| A1 | high | `AGENTS.md` L27, Standing Release Policy WSF note | The PR removes "Cross-app bundling into one integration branch is not permitted; combined-staging bundles are per-app." Nothing replaces it, so L131 ("every staging deploy is built from main + all open, release-scoped PR branches merged into an integration branch") now reads as covering WSF + GoArrive together. | The WSF release train, `skills/wsf-staging-deploy/SKILL.md`, and the base AGENTS.md rule | Restore the removed sentence at the end of L27. |
| A2 | high | `docs/westayfit/ARCHITECTURE.md`, "Environment clarification — September 26" plus invariants (b)/(c) | The clarification demotes "the old direct Firebase commands **below**", but those commands sit **above** it: L27 `firebase hosting:channel:deploy staging --config firebase.westayfit.json` and L36. Invariant (c) also still says "(or `--only functions` for both)". | AGENTS.md ("never the bare `--only functions`"), the file's own Deploy Boundary Summary, RISKS R-2, and the WSF staging skill | Change "below" to "above (invariants (b)–(c))", and replace "(or `--only functions` for both)" with "(never bare `--only functions`; WSF staging goes only through skills/wsf-staging-deploy)". |
| A3 | medium | `ARCHITECTURE.md` §(g) L68 | "The Lovable-side WSF marketing/interest surface and the Firebase-side WSF app share the same Firebase project…" | `LOVABLE_HANDOFF.md` §1, `DATA_OWNERSHIP.md` §4, Project Instructions v3.1 (marketing is on Lovable/Supabase, separate from the Firebase product) | Say they are separate systems of record (marketing/inquiry on Lovable/Supabase; community product on Firebase), and drop "share the same Firebase project". |
| A4 | medium | `docs/westayfit/RISKS.md` R-WSF-E1 (heading and body) | "…is present in the currently served product lineage" / "CLOSED in served lineage". This is a volatile served-state claim with no build marker, run or receipt. | DOCUMENT_AUTHORITY §3–§4 (served state comes from build marker + receipt; volatile state lives only in the #365 CURRENT comment) | Make it past tense and pin it to its receipt ("was hosted-verified on build `<SHA>`, run `<id>`"), then point current state to #365. |
| A5 | medium | `DOCUMENT_AUTHORITY_AND_SUPERSESSION.md` §6 | The status table has no row for the new `WE_STAY_FIT_IMPLEMENTATION_OPERATIONS_CHARTER_v1_2026-09-26.md`, and the "Implementation Plan v0.2 … SUPERSEDED" row does not name its successor. The map also never says where Strategic Master v3.0 lives: it is not in the tree, and only `DECISIONS.md` L286 says it is "held outside this repository". | The charter's own header and DECISIONS 2026-09-26 (the charter replaces v0.2's sequencing role) | Add a charter row (GOVERNING execution sequencing and evidence, under v3.0+v3.1); name it as v0.2's successor; add "(held outside this repo; the v3.1 addendum and Project Instructions summarize it in-repo)" to the v3.0 row. |
| A6 | medium | `docs/westayfit/EXPO_CRITICAL_PATH.md` (unchanged, no banner) | "Governed by `WE_STAY_FIT_MASTER.md`" and "Cutting privacy controls, adult-only enforcement, … are the conditions of shipping at all" | DOCUMENT_AUTHORITY §6 (v1.2 master superseded), DECISIONS 2026-09-06 "Age gate removed", Project Instructions ("do not silently reinstate adults-only") | Add a HISTORICAL banner and list the file in DOCUMENT_AUTHORITY §6 as historical, noting that its adult-only language is superseded. |
| A7 | low | `UNIVERSAL_COMMUNITIES_CHARTER.md`, principle 5 (kept as "not superseded") | "No leaderboards by default. Comparative ranking is off by default and opt-in per community." | Project Instructions v3.1 ("No … ranking") and addendum §7 ("no rankings") | Mark principle 5 as superseded: no rankings and no per-community opt-in. |
| A8 | low | v3.1 addendum preamble | "When this addendum and v3.0 are silent, v3.0 governs." This contradicts itself. | Addendum §2 and DOCUMENT_AUTHORITY §1 | Replace with: "Where this addendum is silent, v3.0 governs; where both are silent, follow the §2 authority order." |
| A9 | low | `RISKS.md` R-2 mitigation and R-10 | R-2 relies on `RELEASES.md` receipts, which is now historical. R-10 says "before the first WSF index ships", but WSF indexes already exist. | The AGENTS.md RELEASES-historical clarification and R-10's own new note | R-2: point to the WSF staging control plane receipts. R-10: say "before any further `firestore:indexes` deploy". |

**Not raised (rejected in verification).**
- The v1.2 master's own §0/§11 text sits under a clear SUPERSEDED banner.
- MILESTONES "In flight" and "E2 starts now" are dated history.
- `.claude/firebase-deploy-setup.md` is scoped by the new authority notes.
- DATA_OWNERSHIP §7 wording is fine.
- The multi-movement DECISIONS entry and addendum §10 explicitly forbid invented equivalents and mixed-unit totals.

The audit was read-only: no edit to #520, no merge, deploy or cloud action.

## SECRET-HYGIENE-1 (Director `5849086217`) — delivered as a carry-ready change against `main` `37f18ea9`

The change is packaged for L0 in two files, neither of which contains the credential (both verified: 0 key-shaped literals):
- `sprint-w5-secret-hygiene-1.patch` — `git apply` onto `main`. It adds one rule to `scan-evidence.mjs`, a new `tests/committed-secrets.test.mjs`, and a `run-all` registration.
- `sprint-w5-secret-hygiene-1.SKILL.md` — the full post-image of `skills/browser-use-e2e/SKILL.md`. It is shipped as a file rather than as a diff, because a diff's removal lines would reproduce the value.

**What changes**
1. **Source.** Both literal uses in `skills/browser-use-e2e/SKILL.md` (line 12 and the client snippet) now read `BROWSER_USE_API_KEY` from the environment (`os.environ[...]`, with `import os` added). A security notice says the old key stays in git history and must be revoked and replaced by the account owner.
2. **Prevention.** The existing redacting scanner (`scan-evidence.mjs`) gains the rule `browser-use-api-key`, `/\bbu_[A-Za-z0-9_-]{20,}/`. The new suite `committed-secrets.test.mjs` (5 cases) runs that scanner over `skills/`, `.claude/`, and root `AGENTS.md`/`CLAUDE.md`. A synthetic canary, `bu_SYNTHETICcanaryNotARealKey…`, is refused by path, line and rule, and the test asserts the value is never echoed. Env-var references and placeholders are allowed.

**Evidence**
- **Fail-before, on `main`'s `SKILL.md` with the new rule:** exit 1, with `browser-use-e2e/SKILL.md` line 12 and line 28 matching `browser-use-api-key (value withheld)`. The output contains no key.
- **The same scanner without the new rule** returns `clean` on `skills/`, which is the gap this closes.
- **Pass-after:** `committed-secrets` 5/5. The full `run-all` exits 0: all suites passed, including `scan-evidence` 11.
- **Replay:** on a fresh `main` worktree, `git apply --check` is clean and the four files come out as expected.

**Limit.** `run-all` is a contributor/worker gate. No GitHub workflow runs it on PRs, so recurrence is caught when the gate is run, not enforced by CI. The owner can add enforcement with GitHub secret scanning and push protection.

**Owner action still required.** Revoke the exposed Browser Use Cloud key (sha256 prefix `45b5e468`) in the Browser Use dashboard. Then provision its replacement only through `BROWSER_USE_API_KEY` in a local `.env` or shell, or a runner's secret store. No agent may do this.

No provider call, key validation, rotation, IAM/WIF/secret-store change, history rewrite or branch cleanup.
