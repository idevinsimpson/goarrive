# Relay Handoff — Mandatory Post-Staging Protocol

**This is a mandatory step. It is not optional. It runs every single time you deploy to staging.**

## What is Relay?

Relay (`<@U0B1YQS8L12>`) is an autonomous Slack bot running 24/7 on a dedicated cloud computer. When you mention it in `#dev-goarrive`, it immediately triggers Manus to perform a browser-based smoke test on the GoArrive staging environment (`https://goarrive--staging.web.app`) and posts the result back in the same thread. If the smoke test fails, Relay will tag you directly with the specific issues found so you can fix and redeploy.

This creates a fully autonomous Maia → Relay → Manus → Relay → Maia loop with no human required in the middle.

## The Rule

**After every successful `npm run deploy:staging` (Step 4 of `/ship`), before creating the PR, you MUST post the following message in the `#dev-goarrive` Slack channel:**

```
<@U0B1YQS8L12> smoke test — [one sentence describing what you changed and what to focus on]
```

### Examples

```
<@U0B1YQS8L12> smoke test — wired up WorkoutPlayer.tsx to the member workout page; test that a member can open and play a workout end to end
```

```
<@U0B1YQS8L12> smoke test — fixed the coach billing tile showing wrong earnings; check the coach Command Center billing section
```

```
<@U0B1YQS8L12> smoke test — deployed new movement library filters; verify coach can filter by equipment and muscle group in the Build tab
```

## What Happens Next

1. Relay immediately acknowledges in the thread: *"Launching smoke test on staging…"*
2. Manus navigates to `https://goarrive--staging.web.app` and tests the relevant flows
3. Relay posts the result back in the same thread:
   - **Pass:** `✅ Smoke Test Passed` — you can proceed to create the PR
   - **Fail:** `❌ Smoke Test Failed — <@U0AQAGGMTE3>, please review: [specific issues]` — fix the bugs, redeploy to staging, and trigger Relay again before creating the PR

## Updated /ship Workflow

The `/ship` command workflow now has an additional step between Step 4 (staging deploy) and Step 5 (PR creation):

```
Step 1: tsc --noEmit
Step 2: npm run test:vitest -- --run
Step 3: npx expo export --platform web
Step 4: npm run deploy:staging
Step 4b: POST in #dev-goarrive → <@U0B1YQS8L12> smoke test — [summary]
         WAIT for Relay's result before proceeding
         If FAIL → fix, redeploy, re-trigger Relay
         If PASS → continue
Step 5: git commit + push + gh pr create
Step 6: Report back to Devin
```

## Slack IDs Reference

| Agent | Slack ID | How to mention |
|---|---|---|
| Relay (smoke test bot) | `U0B1YQS8L12` | `<@U0B1YQS8L12>` |
| Maia (you) | `U0AQAGGMTE3` | `<@U0AQAGGMTE3>` |

## Hard Rules

- **Never skip this step.** Every staging deploy must be smoke tested before a PR is created.
- **Never create a PR if the smoke test failed.** Fix first, redeploy, re-test.
- **Always use the Slack ID** (`<@U0B1YQS8L12>`), not the display name `@relay`, to ensure the mention is correctly parsed.
- **Include context in your message.** Relay passes your message directly to Manus as the test brief. A vague message produces a vague test. Be specific about what changed.
