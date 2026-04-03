# /setup — Verify Credentials & Environment

Run this command to verify that your environment is fully authenticated and ready to ship code for GoArrive.

## Step 1: Verify GitHub Auth

Verify that you are authenticated with GitHub and can push to the repository:

```bash
gh auth status
```

If not authenticated, you cannot create PRs. Request a GitHub token or login from Devin.

## Step 2: Verify Firebase Auth

Verify that you have the Firebase Service Account credential configured. This is required for deploying to staging (`npm run deploy:staging`).

```bash
firebase projects:list
```

**Expected Output:** You should see `goarrive` in the list of projects.

**If it fails:** You do not have the Firebase credential. Tell Devin:
> "I need the Firebase Service Account JSON key to deploy to staging. Please generate it in the Firebase Console (Project Settings -> Service accounts) and provide it to me securely."

## Step 3: Report Status

Once both checks are run, report your status back to Devin:

> "✅ `/setup` complete. GitHub is authenticated. Firebase is authenticated. I am ready to `/ship`."

OR

> "❌ `/setup` incomplete. I am missing Firebase credentials. I cannot deploy to staging until I have the Service Account key."
