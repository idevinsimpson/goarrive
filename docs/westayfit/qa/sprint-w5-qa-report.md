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
- Part 2 — member-work QA (identity switching, pending/unknown outcomes, short-phone
  390x640 Home/MOVE/You, and #390 visibility/rejoin plus payload identity): in progress.

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
