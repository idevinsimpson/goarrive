# We Stay Fit — Dependencies

## Runtime — App (`apps/westayfit/`)

- `expo` ~54 (matches GoArrive to keep Expo/React-Native versions coherent across the monorepo).
- `expo-router` ~6.0.23.
- `react` 19.1.0, `react-dom` 19.1.0, `react-native` (Expo-managed version), `react-native-web`.
- `firebase` ^11.4.0 — web SDK only, initialized in `apps/westayfit/src/firebase.ts` (no reads, no writes in M-U1).

## Runtime — Functions (`functions-westayfit/`)

- Node 20 (matches GoArrive `functions/` runtime).
- `firebase-functions` ^4.9.0 — v2 API (`firebase-functions/v2/https`).
- `firebase-admin` ^12.7.0 — imported for parity but not used to write claims (see zero-claims invariant).

## Dev — App

- `typescript` ~5.9.2 (matches GoArrive).
- `vitest` ^4.1.2 + jsdom for the smoke suite.
- `@playwright/test` ^1.59.1 for the e2e suite.
- `@axe-core/playwright` ^4.12.1 for accessibility check on `/`.

## Dev — Functions

- `typescript` ~5.9.2.
- `firebase-tools` — used via `npx -y firebase-tools@latest` for deploys; not pinned as a repo dev-dep to avoid version drift with GoArrive's deploy path.

## Build / Deploy

- Firebase CLI via `npx -y firebase-tools@latest`.
- Service account key at `~/dev-westayfit/.secrets/firebase-service-account.json` (hardlinked from `~/dev-goarrive/.secrets/`), exported as `GOOGLE_APPLICATION_CREDENTIALS`.

## External / Shared With GoArrive

- **Firebase project `goarrive`** — shared. WSF adds Hosting site `westayfit-app` and functions codebase `westayfit`.
- **Firebase Auth pool** — shared. Same users can exist in both app contexts (see `DATA_OWNERSHIP.md`).
- **`firestore.rules`, `storage.rules`** — shared files, dual-regression required.

## What Is NOT A Dependency

- No EAS build service (out-of-scope for M-U1).
- No shared UI/theme package with GoArrive — WSF has its own theme.
- No shared functions library — WSF functions cannot import from `functions/src/`.
- No custom-claims-based auth — see `ARCHITECTURE.md` (f).
- No PWA/service worker/manifest tooling for M-U1.
