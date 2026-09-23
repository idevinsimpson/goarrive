# Sprint Round 1 — W7 Independent Journey QA

Worker: **W7 — INDEPENDENT JOURNEY QA**
Branch: `claude/wsf-sprint-w7-journey-qa`
Starting SHA: `a193b43086ee0564b8edf99083ab164c08f9ceff` (`claude/wsf-app-shell`, verified by `git rev-parse HEAD` at session start, not assumed)
Assignment: PR #365 comment 5787366259, section "W7 — INDEPENDENT JOURNEY QA".
Session: `session_0196eWn3hsB1BduPkKM8y5md` (Claude Code Remote, the owner's included subscription; no API billing).

## Scope and constraints held

- Tests and evidence only. No product source, no screenshot rebaseline, no creative verdict, no deployment.
- Files reserved to W7 and nothing else: `apps/westayfit/tests-e2e/sprint-w7-*.spec.ts` and `docs/westayfit/qa/sprint-w7-*.md`.
- Emulators only (`demo-wsf-local`). No gcloud, no IAM/WIF/network change, no secret read, no live account.
- Existing `e5-goal-form` coverage is reused, not re-created. W5's kiosk suite is not duplicated.
- Findings route through L0 to W6; W7 takes no fix ownership.

## Environment — verified, not assumed

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` at root, `apps/westayfit`, `functions-westayfit` | exit 0 each |
| Functions build | `npm --prefix functions-westayfit run build` | exit 0 |
| Web build | `EXPO_PUBLIC_WSF_AUTH_ENABLED=1 EXPO_PUBLIC_WSF_USE_EMULATORS=1 npm run build:web` (in `apps/westayfit`) | exit 0 |
| Emulators | `METADATA_SERVER_DETECTION=none npx -y firebase-tools emulators:start --config firebase.westayfit.emulators.json --project demo-wsf-local` | hosting 5010, firestore 8080, auth 9099 answer; functions 5001 loaded 46 functions incl. `wsfCreateGoal` |
| Browser | `WSF_PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` | Playwright drives the pre-installed Chromium; no `playwright install` run |
| Stack smoke | `WSF_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5010 npm --prefix apps/westayfit run test:e2e -- e5-goal-form.spec.ts` | **3 passed, 0 failed (16.4s)** |
| Evidence guard after the run | `node scripts/westayfit/check-evidence-intact.mjs` | frozen BEFORE 9 paths intact; accepted TARGET/AFTER 20 paths intact |

Artifacts reverted and `test-results` cleaned after every e2e run; none committed.

## Status

- Packet 1 — `/goals/new` creation-result / recovery contract on the pinned code: **IN PROGRESS** (ACK posted; the probe `apps/westayfit/tests-e2e/sprint-w7-goal-setup-contract.spec.ts` is the first artifact to follow).
