# WSF worker execution profiles

Status: SOURCE PREPARED + LOCAL TESTS. Not merged, not a live worker cutover,
not proof that an existing phone session retained a setting.
Owner request: 2026-10-02, recorded in #365 comment 5962595624.

## What this fixes, and what it does not

The saved profiles separate **model**, **reasoning effort**, and **Ultracode**.
The launcher supplies the selected values on every invocation, including an
explicit local `--resume`, without writing global or shared project settings.
A previous session's picker selection is not the source of those launch values.

The repo's current WSF workflow posts canonical inbox wakes; it does not launch
Claude through `anthropics/claude-code-action`. The workers visible on Devin's
phone are existing Claude sessions. A GitHub Actions job is a different executor,
not a setting update to one of those sessions. This change does not stop them,
create replacements, post wakes, or move their assignments.

The included GitHub workflow resolves any profile without a model call by
 default. Its separately enabled, tool-free smoke can check a model invocation
using subscription OAuth. It is **not an autonomous inbox consumer**. Existing
worker progress still uses the existing App/router and report contract.

## Role decisions

These are configured defaults, not claims about a worker's actual serving model.
The canonical role source is `docs/westayfit/ops/control/contracts/WORKER_INBOXES.md`.

| Role | Default model | Effort | Ultracode | Why |
|---|---|---|---|---|
| L0, #365 | Opus 5.5 | high | off | Cross-lane judgments; reference only, no second integrator |
| W3, #396 | Sonnet 5.5 | high | off | Staging/backend implementation; explicit deep escalation for auth, race and permission questions |
| W4, #394 | Sonnet 5.5 | high | off | Independent source/regression review, without automatic agent multiplication |
| W5, #395 | Opus 5.5 | xhigh | off | Independent security, enumeration, authorization, secrets and cross-account correctness |
| W7, #434 | Sonnet 5.5 | high | on | Preserve Devin's requested workflow preference for bounded journey cross-checks |
| W9, #497 | Sonnet 5.5 | high | on | Bounded UI implementation, focused tests and capture tasks |

The current W3 email task is a strong candidate for a deliberately selected
`deep` profile when investigating ambiguous send outcomes or authorization.
Defaults do not silently downgrade a task or replace a required specialist.
W5's unavailable session is a transport/capability problem, not something a
model JSON file repairs. No PASS is fabricated and no security gate is waived.

### Explicit tiers

- `default`: the role's saved configuration.
- `economy`: turn Ultracode off; W9 uses medium effort, other eligible roles high.
  W5 refuses economy. L0 remains non-executable even when its profile is inspected.
- `deep`: Opus 5.5, xhigh, Ultracode off. Operator choice, never an automatic upgrade.
- `ultracode`: enable orchestration while retaining the role's default effort.
  W5 and L0 refuse this override; W7/W9 already enable it by default.

For maximum credit conservation, choose economy for W7/W9 rather than assuming
Ultracode is cheaper than Extra. Ultracode can create many subagents. The saved
`workflowSizeGuideline: small` is **advice, not a hard cap**. Max turns and process
or job timeouts are also not a dollar/weekly-credit cap. Subscription availability,
extra-usage controls, actual model, and token consumption still require readback.
No automatic API-key fallback, top-up or paid-credit consent is implemented.

## Persistence details

Official docs retrieved 2026-10-02 distinguish current behavior from old versions:

- From Claude Code 2.1.284, `ultracode: true` leaves the chosen effort unchanged.
- `effortLevel` contains medium/high/xhigh, **never** the word ultracode.
- `--effort ultracode` is supported, but also requests xhigh; this launcher instead
  passes an ordinary effort and the separate boolean deliberately.
- Model/effort flags and per-launch settings are passed again on every launch.
  `maxEffortLevel` matches the selected tier, preventing casual upward effort drift.
- The wrapper pins documented Anthropic model IDs, not moving family aliases.
- Managed settings, host restrictions, provider support or fallback can still
  prevent the requested settings taking effect. A configuration receipt is not
  runtime verification, and settings cannot legitimately bypass managed policy.

A shared `.claude/settings.json` can reach a single-repository cloud session,
but it is repository-wide, not a per-W7 profile. User/local settings on a computer
do not configure phone/cloud environments. Nothing here overwrites `.claude/`
settings in this mixed WSF/GoArrive repository.

## Files and local verification

`profiles.json` is the source of role defaults and bounds. `launch.mjs` validates
and resolves them. `profiles.test.mjs` checks defaults, version floor, explicit
resumes, conflicting environment variables, unknown workers, rejected flags,
L0 isolation, W5 escalation restrictions, and the manual-only workflow boundary.
`report-smoke.mjs` reads only safe runtime-result fields, never full transcripts.

```sh
node --test .github/wsf-workers/profiles.test.mjs
node .github/wsf-workers/launch.mjs plan W7
node .github/wsf-workers/launch.mjs plan W7 --tier economy
node .github/wsf-workers/launch.mjs plan W5 --output /tmp/wsf-w5-settings.json
```

The local test run in this PR passed 24 tests. Two process-level invocations use
a **fake** Claude CLI to prove identical W7 settings on initial launch and resume.
No Anthropic request, credential read, worker wake, application test, staging
operation or production action was performed by those tests. They do not prove
hosted/mobile persistence or worker-reporter compatibility.

For an operator-owned CLI environment, after an explicit single-executor
handover and valid existing authentication:

```sh
WSF_WORKER_LAUNCH_CONFIRMED=existing-executor-stopped \
  node .github/wsf-workers/launch.mjs run W7 --prompt-file /path/to/approved-task.txt
```

`--resume LOCAL_SESSION_ID` is optional and applies only to the CLI's local
transcript store. It does not attach to or reconfigure a phone/cloud session.
The confirmation variable is an operator interlock, **not a distributed lock or
proof that another executor stopped**. Existing ledger ownership, scope, review
and deployment contracts still govern. This wrapper does not replace them.

## GitHub setup and phone-only use

After independent review and merge, GitHub Actions exposes **WSF worker profiles**.
From GitHub in a mobile browser, choose Run workflow, the worker, tier, and `plan`.
No terminal or per-worker settings-file editing is required for that inspection.

Actual smoke execution remains disabled unless the owner/operator:

1. Creates/reviews environment `wsf-worker-profile-smoke`, ideally with required
   approval and main-only branch restriction.
2. Adds `CLAUDE_CODE_OAUTH_TOKEN` there using the official supported token setup.
   Do not put the token in chat, code, issue comments or artifacts. The existing
   GitHub App installation does not prove this secret exists or can be exported.
3. Confirms account/plan eligibility and extra-usage policy, then sets repository
   variable `WSF_WORKER_PROFILE_SMOKE=enabled` and explicitly selects `smoke`.

The workflow has only `contents: read`, no cloud keys, writer-App private key,
Actions write, issue/PR write, or OIDC grant. The action is pinned to
`ed670b4cf9de2a5a570d130d2f6197b9e543cd64` (v1.0.240). Its inspected base installer
pins Claude Code 2.1.288, above the 2.1.284 behavior floor. Full output and the
Claude report are disabled. The one-turn prompt has no tools and cannot take an
expo assignment. Model response verification is separate from profile compilation.
Effort and Ultracode remain CONFIGURED, not independently runtime-attested by the
result's `modelUsage` field. An unavailable/wrong model fails the smoke.

The smoke uses subscription OAuth rather than an API key. This avoids silently
moving to API billing, but does not guarantee unlimited/free usage. Owner billing
controls and GitHub Actions allowance still apply. No smoke was dispatched here.

## Gate before replacing any existing worker transport

Do not change `automaticCutover: false` and assume there is now a live adapter.
That field documents the boundary; there is intentionally no cutover implementation
in this settings-only PR. A future adapter must be separately reviewed and prove:

- One executor per worker/wake, using current App state and the canonical inbox.
- Original executor stopped/checkpointed; acknowledged work not duplicated.
- Exact current packet, subject, reserved paths, and review role preserved.
- Subscription authentication and configured/observed model/effort/Ultracode
  readback on both first launch and restart.
- Correct ACK/delivery/PASS/finding identity: `worker-intake.mjs` currently accepts
  unedited owner-associated comments. `github-actions[bot]` or a new App report
  cannot be presumed accepted. No owner impersonation or writer-key reuse.
- Stale wakes, timeouts, retries, cleanup, branch changes and usage exhaustion
  handled without an extra integrator or silent permission expansion.

Until then this is a persistent settings package, an operator CLI wrapper, and
an opt-in verification workflow, **not a replacement automation platform**. It
must not delay email, account-entry or the expo journey.

## Sources and inspection anchors

Repository source inspected at main `9ca268d2500c60dddc3aba8d490a67f24b97a2cb`:
`WORKER_INBOXES.md`, `.github/workflows/wsf-control-reconcile.yml`,
`tools/wsf-control/worker-intake.mjs`, `tools/wsf-control/check.mjs`.
Live App state read at 257 events: email under review, account entry ACKed to W9.
Those are historical inspection anchors, not future CURRENT truth.

Official references (retrieved 2026-10-02):
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/workflows
- https://code.claude.com/docs/en/github-actions
- https://code.claude.com/docs/en/claude-code-on-the-web
- https://github.com/anthropics/claude-code-action/blob/ed670b4cf9de2a5a570d130d2f6197b9e543cd64/action.yml
- https://github.com/anthropics/claude-code-action/blob/ed670b4cf9de2a5a570d130d2f6197b9e543cd64/base-action/action.yml
