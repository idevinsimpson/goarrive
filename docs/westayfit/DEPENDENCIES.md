# We Stay Fit — Dependencies and Environment Boundaries

Reconciled: September 26, 2026.

Exact package versions live in the relevant `package.json` / lockfiles. This document
records load-bearing system/environment dependencies and current operational boundaries.

## 1. Product source

- App: `apps/westayfit` — Expo / React Native / Expo Router / Firebase web SDK.
- Backend: `functions-westayfit` — Firebase Cloud Functions.
- Shared repository: `idevinsimpson/goarrive`.
- Shared infrastructure files include Firestore rules/index definitions; treat them as
  cross-app release surfaces, not incidental WSF files.

## 2. Environment model

### Production architecture
WSF remains a first-party app in the GoArrive repository with the established shared
Firebase architecture and isolated WSF app/functions/hosting boundaries described in
`ARCHITECTURE.md`.

### Staging control plane
Current WSF staging is controlled through the dedicated reviewed staging workflow and its
approved candidate pointer. The staging control plane currently targets the
`westayfit-staging` project/environment.

Do not interpret the separate staging project as authority to split production
architecture without an explicit decision.

## 3. Only supported WSF staging path

Do not use the old service-account-key instructions in historical documents.

For WSF staging:
1. read `skills/wsf-staging-deploy/SKILL.md` from operational `main`;
2. use the reviewed `.github/workflows/wsf-staging-deploy.yml` control plane;
3. use `.github/wsf-staging/approved-candidate.json` as the reviewed deployment pointer;
4. use the current manifest/changed-journey/receipt discipline;
5. do not reconstruct an alternate Firebase CLI deploy path from memory.

The workflow uses the authorized cloud identity path; no local service-account JSON file is
the canonical WSF staging mechanism.

## 4. Console/cloud dependencies that code alone cannot prove

Depending on the journey, WSF can depend on:
- Firebase Auth provider/action-link configuration;
- real verification/password-reset delivery;
- callable invocation/IAM transport;
- Firestore index READY state;
- App Check/enforcement settings;
- Hosting/action URLs;
- event network/device availability.

Record and verify these when applicable. Emulator/source tests do not establish cloud
configuration.

## 5. Node runtime deadline

`functions-westayfit` currently declares Node.js 20. Current deployment receipts warn
that Node.js 20 was deprecated April 30, 2026 and is scheduled for decommissioning on
October 30, 2026. Treat the runtime upgrade as an explicit operational dependency; do not
wait for decommissioning to discover deploy failure.

## 6. Lovable

Public marketing Lovable/Supabase is a separate marketing/inquiry dependency within its
approved scope.

The WE Community Home Lovable project is a North Star reference dependency only. It is not
a production runtime/backend dependency.

## 7. GoArrive boundary

WSF must preserve GoArrive behavior and shared infrastructure. Do not import from
`apps/goarrive` or `functions/` for WSF convenience, and do not introduce WSF custom
claims that GoArrive claim writers could clobber.

## 8. Not implied

This document does not authorize:
- a new Firebase project split;
- a production release;
- an index/rules deployment;
- new auth providers;
- EAS/native distribution;
- new external SDKs;
- R&D camera/vision integration.
