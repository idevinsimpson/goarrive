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

Staging URL: `https://goarrive--staging.web.app`

## Step 5: Commit and PR

- Stage only the files you changed — never `git add -A`
- Write a clear, concise commit message using conventional commits (e.g., `feat: ...`, `fix: ...`, `refactor: ...`)
- Push to a new feature branch — never push directly to `main`
- Create a PR on GitHub using `gh pr create` with:
  - **Title:** short and descriptive (under 70 characters)
  - **Body:** summary of changes, what was tested, and the staging URL (`https://goarrive--staging.web.app`)
  - **Base branch:** `main`
  - **Do NOT merge the PR** — only create it

## Step 6: Notify Devin

Report back with:

- The PR URL
- A plain-English summary of what changed
- Confirmation that type check, tests, and build all passed
- Confirmation that staging is updated and ready to review

Example message:
> "✅ /ship complete. Tests passed, build succeeded, staging updated at `https://goarrive--staging.web.app`. PR #[number] is open for your review — let me know when to merge."

## Hard Rules

- Never merge to `main` directly. PRs are the only path to production.
- Never skip the type check, tests, or build steps.
- If any step fails, stop, fix the issue, and restart from Step 1.
- The PR is a proposal — Devin approves and merges, or explicitly says "merge that" or "ship it."
- Only run `gh pr merge` after Devin gives explicit approval.
