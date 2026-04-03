# /ship — Ship code via PR

You are shipping code changes to the GoArrive repository. Follow this exact workflow — no shortcuts.

## Step 1: Run Tests
Run the Vitest test suite to catch logic errors:
```
cd apps/goarrive && npm run test:vitest -- --run
```
If any tests fail, fix the issues and re-run until all tests pass. Do not skip failing tests.

## Step 2: Run Build
Run the Expo web export to verify the build compiles:
```
cd apps/goarrive && npx expo export --platform web
```
If the build fails, fix the errors and re-run until it succeeds.

## Step 3: Commit
- Stage only the files you changed (never `git add -A`)
- Write a clear, concise commit message describing what changed and why
- Push to a new feature branch (never push directly to `main`)

## Step 4: Create Pull Request
Create a PR on GitHub using `gh pr create`:
- Title: short, descriptive (under 70 chars)
- Body: summary of changes, test plan
- Base branch: `main`
- Do NOT merge the PR — only create it

## Step 5: Notify
Report back with:
- The PR URL
- A plain-English summary of what changed
- Confirmation that tests passed and build succeeded

## Rules
- Never merge to main directly. PRs are the only path to production.
- Never skip tests or build verification.
- If tests or build fail, fix the issues before creating the PR.
- The PR is a proposal for review — Devin approves and merges, or tells you to merge.
- If Devin says "merge that" or "get that in production", then merge the PR via `gh pr merge`.
