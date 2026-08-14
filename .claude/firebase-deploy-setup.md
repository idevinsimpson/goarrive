# Firebase Deploy Setup for CI/Agent Environments

## Problem
The Firebase CLI requires interactive browser login, which fails in non-interactive shells (like Claude Code). This document explains how to deploy using a service account key instead.

## Service Account Key Location
The key file is stored at `.secrets/firebase-service-account.json` (gitignored — never committed to the repo).

If the file is missing from your environment, ask Devin or Manus to regenerate it from the Firebase Console (Project Settings → Service Accounts → Generate New Private Key).

## How to Deploy

### Option 1: Environment Variable (Recommended)
```bash
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/.secrets/firebase-service-account.json"
firebase deploy --only hosting
```

### Option 2: Staging Channel Deploy
```bash
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/.secrets/firebase-service-account.json"
firebase hosting:channel:deploy staging --expires 7d
```

### Option 3: Full /ship Pipeline
```bash
cd apps/goarrive
npx expo export --platform web
node ../../scripts/generate_sw.js
python3 ../../scripts/inject_pwa_meta.py
export GOOGLE_APPLICATION_CREDENTIALS="$(git rev-parse --show-toplevel)/.secrets/firebase-service-account.json"
firebase hosting:channel:deploy staging --expires 7d
```

## Important Notes
- The `.secrets/` directory is in `.gitignore` — the key file must be placed manually in each new environment
- Google will auto-disable any service account key detected in a public repository
- The service account (`firebase-adminsdk-fbsvc@goarrive.iam.gserviceaccount.com`) has full Firebase Admin SDK access
- For production deploys, use `firebase deploy --only hosting` instead of channel deploy

## Hotfix Back-Port Rule (MANDATORY)

A production hotfix is frequently cut from the **currently deployed baseline commit**
rather than from `main`, so the prod delta stays scoped to the fix. That is the correct
technique — but it creates a branch whose commits are *not* ancestors of `main`.

**A hotfix is not "done" when it deploys. It is done when `main` carries it.**

Before closing out any baseline-cut hotfix deploy:

1. Open a back-port PR to `main` the **same day**, before the deploy debrief is closed.
2. Verify each hotfix commit is actually reachable from `main`:
   ```bash
   git merge-base --is-ancestor <hotfix-sha> origin/main && echo ON-MAIN || echo MISSING
   ```
3. Diff the deployed surface against `main` and confirm nothing is prod-only:
   ```bash
   git diff --stat origin/main..<hotfix-branch> -- <touched paths>
   ```
   `main` ahead of production is normal. **Production ahead of `main` is a latent
   regression** — the next build from `main` silently reverts it.

Never rely on a debrief's claim that a hotfix "was already merged"; verify with the
ancestry check above.

### Why this rule exists

On 2026-08-14 the iOS background-audio hotfix deployed to production correctly, but its
6-line default flip (`musicHandoffVariant.ts`: `return 'v3'`) lived only on the hotfix
lineage cut from baseline `45491ef`. `main` still returned
`isStagingLikeHost() ? 'v3' : 'off'` — i.e. **`off` on production hosts**. The feature PR
(#259) *was* on `main`, so the code looked complete. The next production build from `main`
would have silently restored the exact member-facing regression the deploy had just fixed,
with no failing test and no red CI. Caught during PM verification and repaired by #274.
