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
