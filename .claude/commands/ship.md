# /ship — Ship Code via PR

You are shipping code changes to the GoArrive repository. Follow this exact workflow — no shortcuts, no skipped steps.

## Step 1: Type Check

Run the TypeScript compiler to catch type errors before anything else:

```bash
cd apps/goarrive && npx tsc --noEmit
```

If any errors are found, fix them before proceeding. Do not skip.

## Step 2: Run Tests

Run the Vitest test suite to catch logic errors:

```bash
cd apps/goarrive && npm run test:vitest -- --run
```

If any tests fail, fix the issues and re-run until all tests pass. Do not skip failing tests.

## Step 3: Build

Run the Expo web export to verify the build compiles without errors:

```bash
cd apps/goarrive && npx expo export --platform web
```

If the build fails, fix the errors and re-run until it succeeds.

## Step 4: Verify Credentials & Deploy to Staging

Before deploying, ensure you have the Firebase Service Account credential configured.
Run `firebase projects:list` to verify you can see the GoArrive project.

If verified, deploy the build to the staging environment so Devin can review it visually:

```bash
cd apps/goarrive && npm run deploy:staging
```

Staging URL: `https://goarrive--staging-gurfzjak.web.app`

**Combined-staging rule (2026-07-15):** staging must carry main + EVERY open PR branch, not just your feature. Before deploying, merge `origin/main` and all open PR head branches (`gh pr list --state open`) into a throwaway integration branch and deploy from that — a single-feature deploy wipes other features off staging mid-review.

## Step 4a: Update the Briefing Doc (MANDATORY — do not skip)

Before triggering Relay, update the Manus Smoke Test Briefing Doc so Manus has structured context. Run from the repo root:

```bash
node scripts/update-briefing-doc.js \
  --staging-url "https://goarrive--staging-$(firebase hosting:channel:list 2>/dev/null | grep staging | awk '{print $1}').web.app" \
  --commit "$(git rev-parse --short HEAD)" \
  --branch "$(git branch --show-current)" \
  --deploy-class "Hosting only" \
  --production-affecting "no" \
  --what-changed "[2-5 sentences describing what was shipped]" \
  --what-to-focus-on "[exact test steps: route, action, expected outcome]" \
  --what-not-to-retest "[stable routes to skip this cycle]" \
  --known-gaps "[anything that can't be tested yet and why]" \
  --activity-entry "[one-line summary for the activity log]"
```

**Requires:** `.secrets/firebase-service-account.json` — if missing, ask Devin or Manus to regenerate it from Firebase Console → Project Settings → Service Accounts.

After posting in Step 4b, re-run with `--slack-thread "[permalink]"` to add the thread link.

---

## Step 4b: Trigger Relay Smoke Test (MANDATORY — do not skip)

After staging deploys successfully, post this message in the `#dev-goarrive` Slack channel before creating the PR:

```
<@U0B1YQS8L12> smoke test — [one sentence: what you changed and what to test]
```

**Wait for Relay's response in the thread.**

- If Relay reports `✅ Smoke Test Passed` → proceed to Step 5.
- If Relay reports `❌ Smoke Test Failed` → fix the reported issues, redeploy to staging (`npm run deploy:staging`), and trigger Relay again. Do not create a PR until the smoke test passes.

Relay's Slack ID: `U0B1YQS8L12`. Always use the ID, not the display name.

---

## Step 5: Commit and PR

- Stage only the files you changed — never `git add -A`
- Write a clear, concise commit message using conventional commits (e.g., `feat: ...`, `fix: ...`, `refactor: ...`)
- Push to a new feature branch — never push directly to `main`
- Create a PR on GitHub using `gh pr create` with:
  - **Title:** short and descriptive (under 70 characters)
  - **Body:** summary of changes, what was tested, and the staging URL (`https://goarrive--staging-gurfzjak.web.app`)
  - **Base branch:** `main`
  - **Do NOT merge the PR** — only create it

## Step 6: Notify Devin

Report back with:

- The PR URL
- A plain-English summary of what changed
- Confirmation that type check, tests, and build all passed
- Confirmation that staging is updated and ready to review

Example message:
> "✅ /ship complete. Tests passed, build succeeded, staging updated at `https://goarrive--staging-gurfzjak.web.app`. PR #[number] is open for your review — let me know when to merge."

## Hard Rules

- Never merge to `main` directly. PRs are the only path to production.
- Never skip the type check, tests, or build steps.
- If any step fails, stop, fix the issue, and restart from Step 1.
- The PR is a proposal — Devin approves and merges, or explicitly says "merge that" or "ship it."
- Only run `gh pr merge` after Devin gives explicit approval.
