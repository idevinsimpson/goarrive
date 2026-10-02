# WSF worker execution profiles

Status: SOURCE PREPARED + LOCAL TESTS. Not merged, not a live worker cutover,
not proof that an existing phone session retained a setting. The operator `run`
path now refuses to launch unless it can confirm subscription-only credentials
(see "Credential mode"); no real credential or model call has tested it.
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

The local test run passes 30 tests (24 in the first draft). Process-level
invocations use a **fake** Claude CLI, in an environment built from scratch:
- identical W7 settings and the same credential preflight on the initial launch and on resume;
- every conflicting credential, provider, endpoint, profile, stored-login,
  settings-helper and effective-auth case refusing before the fake model is
  reached, without a secret value in the output.
No Anthropic request, credential read, worker wake, application test, staging
operation or production action was performed by those tests. They do not prove
hosted/mobile persistence or worker-reporter compatibility.

For an operator-owned CLI environment, after an explicit single-executor
handover, with a subscription setup-token and a dedicated config directory:

```sh
WSF_WORKER_LAUNCH_CONFIRMED=existing-executor-stopped \
WSF_WORKER_CONFIG_DIR=/absolute/dedicated/dir \
  node .github/wsf-workers/launch.mjs run W7 --prompt-file /path/to/approved-task.txt
```

`CLAUDE_CODE_OAUTH_TOKEN` must already be in that shell (from `claude setup-token`,
set by the operator; never in chat, code, issues or artifacts).

## Credential mode (subscription-only run path)

Official precedence (authentication docs, "Authentication precedence"):

1. cloud provider (`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`)
2. `ANTHROPIC_AUTH_TOKEN`
3. `ANTHROPIC_API_KEY`, which a `-p` run always uses when present
4. `apiKeyHelper`
5. `CLAUDE_CODE_OAUTH_TOKEN`
6. Anthropic profile / federation credentials
7. the `/login` subscription

A signed-in gateway session outranks all of them. Settings files can set any of
these through `env` or `apiKeyHelper`. Removing one variable therefore proves
nothing, and the earlier wrapper passed every one of them through. `run` now
launches only when all three checks pass, on the initial launch and on every
`--resume` alike:

1. **Environment.** The exact child environment has a nonempty
   `CLAUDE_CODE_OAUTH_TOKEN`. It sets no other `ANTHROPIC_*` variable (only
   `ANTHROPIC_MODEL`, which the launcher writes). It also sets none of
   `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_PROVIDER*`, `CLAUDE_CODE_SIMPLE` (bare mode
   ignores the OAuth token), other `CLAUDE_CODE_OAUTH_*` or `AWS_BEARER_TOKEN_BEDROCK`.
   Variable **names** are reported, never values.
2. **Configuration.** `WSF_WORKER_CONFIG_DIR` is an absolute, existing directory,
   passed as `CLAUDE_CONFIG_DIR`.
   - It holds no `.credentials.json`. This is an existence check; the file is never opened.
   - Its `settings.json`, if any, parses and has no credential, helper, `env`,
     provider, login, endpoint or gateway key.
   - The run passes `--setting-sources user`, so the checkout's project and local
     settings are not loaded.

   These checks run before any CLI process starts, so a configured helper is never
   executed to discover its output.
3. **Effective auth.** `claude auth status`, run with that same environment, must
   exit 0 and report:
   - `authMethod` `oauth_token`;
   - a first-party `apiProvider`, if it reports one;
   - a `configDirectory` that is the dedicated directory.

   Only those three fields are read, and the output is never printed. Any other
   method (`api_key`, `api_key_helper`, `third_party`, `claude.ai`, `none`, or an
   unknown value), or output this wrapper cannot interpret, refuses.

Conflicts are refused, never deleted, overridden or worked around. Managed
policy still applies and is not bypassed: a managed `apiKeyHelper`, provider or
gateway shows up in check 3 as a non-`oauth_token` method and refuses.

**Limits, stated rather than guaranteed:**
- Check 3 is the CLI's own report, made moments before launch. The file checks
  cover local files only; MDM and server-managed policy are covered only through
  check 3.
- None of this measures billing. A subscription token still draws on plan usage
  and any extra-usage the owner allows.

`--resume LOCAL_SESSION_ID` is optional and applies only to the CLI's local
transcript store. It does not attach to or reconfigure a phone/cloud session.
The confirmation variable is an operator interlock, **not a distributed lock or
proof that another executor stopped**. Existing ledger ownership, scope, review
and deployment contracts still govern. This wrapper does not replace them.

## Pilot readiness

**Implemented (source only, fake-CLI tested):**
- Role profiles, tiers, and bounds.
- `plan` makes no CLI or model call, even when conflicting credentials are present.
- `run` preflights subscription-only credentials on the initial launch and on
  every resume, with the same profile and same checks.
- An opt-in, one-turn, tool-free GitHub smoke, disabled by default.

**Unsupported / not established:**
- Any automatic wake consumer or live worker cutover.
- A reporter identity the ledger accepts for ACK/delivery/PASS/finding.
- Real implementation or review work from Actions.
- Remote Control or claude.ai connectors with a setup-token.
- Phone-session persistence.
- A total credit or subagent cap.
- Observed effort/Ultracode at runtime.

The fake-CLI tests and a one-turn smoke prove none of these.

**Smallest owner/operator authentication action**, only when the owner chooses
to pilot:
1. Run `claude setup-token` on the owner's own machine.
2. Place the token as `CLAUDE_CODE_OAUTH_TOKEN` in the single shell or protected
   environment that will run the pilot. Never paste it anywhere else.
3. Create an empty dedicated directory for `WSF_WORKER_CONFIG_DIR`.

Nothing else (API keys, provider settings, App permissions) is needed or wanted.

**Proposed first pilot (not activated):** one W3 run on the `economy` tier
(Ultracode off) with a bounded, already-authorized prompt, to measure credit
use. Saved role defaults are not changed by this proposal. Token use, subagent
count, model availability and extra-usage remain unverified until measured.

**Evidence needed, both from the same operator CLI execution surface:**

*First launch:*
- the `WSF_CONFIGURED … auth=oauth_token(preflight)` line;
- the observed model from the run result;
- the account's usage readback before and after;
- exactly one accepted worker report.

*Restart/resume:* a second launch with `--resume <id>` from the first, showing:
- the preflight passing again;
- the same configured line;
- that the prior context was retained;
- the observed model again.

On either launch, stop and report a refusal, a fallback model, or lost context;
never call those a pass.

**An Actions run is not the phone conversation.** A GitHub Actions execution is
a separate executor with its own credential. It is not the existing Claude phone
conversation and does not change that conversation's settings.

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
