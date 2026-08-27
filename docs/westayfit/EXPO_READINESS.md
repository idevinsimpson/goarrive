# We Stay Fit — Expo Readiness

Anchor: `092839b1fa3ff43b0d0139e2b56d0f1662d4cfdf`.

## M-U1 Target: Web-Only

M-U1 ships the WSF Expo shell as a **web-only** deploy to Firebase Hosting site `westayfit-app`. Native iOS/Android builds are declared in `app.json` (slug, scheme, bundle ID) but not built, not submitted, and not tested in this milestone.

## Expo Config

- **Slug:** `westayfit`
- **Scheme:** `westayfit`
- **iOS bundle identifier:** `com.westayfit.app`
- **Android package:** `com.westayfit.app`
- **`eas.projectId`:** intentionally absent. WSF has no EAS project registered. Native builds in a future milestone will require a separate EAS setup ADR.
- **Web bundler:** `metro`
- **Web output:** `static` (for Firebase Hosting compatibility).
- **`newArchEnabled`:** `true` (matches GoArrive to avoid Expo config divergence across the repo).

## Router

`expo-router` with two routes in M-U1:

- `app/index.tsx` — brand shell (WSF colors + logo placeholder), `<meta name="robots" content="noindex,nofollow">`.
- `app/health.tsx` — build stamp (commit SHA, build timestamp), `<meta name="robots" content="noindex,nofollow">`.

Unknown routes render Expo Router's default 404 (no custom handler in M-U1).

## `node_modules` Strategy

Metro bundler breaks on symlinked `node_modules/` when running `expo export`. WSF's `apps/westayfit/` avoids this by owning its own `package.json` + lockfile; a fresh `npm install` inside `apps/westayfit/` produces real directories, not symlinks.

This is documented in R-6 of `RISKS.md`. If a future contributor reorganizes the repo into pnpm workspaces or similar, they must verify `expo export --platform web` still succeeds in `apps/westayfit/`.

## Native Readiness Backlog

Post-M-U1 native work (not committed until an explicit milestone):

- Register an EAS project (`eas init`) → produces `eas.projectId`; add to `app.json`.
- Configure `eas.json` build profiles.
- App Store Connect + Google Play Console registration under `com.westayfit.app`.
- Native icon set, splash screen, adaptive icon.
- App-tracking transparency + privacy manifest requirements.

None of the above is in M-U1.

## Verification For M-U1

M-U1 is considered Expo-ready when:

1. `npx expo export --platform web` produces `apps/westayfit/dist/` with `index.html` and hashed JS bundles.
2. `firebase hosting:channel:deploy staging --config firebase.westayfit.json` serves `/` and `/health`.
3. Playwright specs against the staging channel URL pass for `/`, `/health`, and an unknown route.
