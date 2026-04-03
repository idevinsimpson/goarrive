# GoArrive Deployment & Build Workflow

## Repository Structure
The GoArrive repository is organized as a monorepo-style project with the following top-level structure.

| Directory/File | Purpose |
|---|---|
| `apps/goarrive/` | The main Expo/React Native application (frontend). |
| `functions/` | Firebase Cloud Functions (backend). |
| `scripts/` | Build and deployment helper scripts. |
| `docs/` | Historical documentation and review notes. |
| `firebase.json` | Firebase Hosting, Functions, Firestore, and Storage configuration. |
| `firestore.rules` | Firestore security rules. |
| `firestore.indexes.json` | Composite index definitions for Firestore. |
| `storage.rules` | Firebase Storage security rules. |

## Frontend Build & Deploy
The frontend application is built and deployed using a multi-step process. First, the Expo export command generates the static web build into the `apps/goarrive/dist/` directory. Then, a Node.js script generates a service worker for PWA support, and a Python script injects PWA meta tags, Google Fonts, and CSS overrides into the `index.html`. Finally, Firebase Hosting deploys the contents of the `dist/` directory.

The deployment command chain is defined in `apps/goarrive/package.json`:
```
expo export --platform web
node ../../scripts/generate_sw.js
python3 ../../scripts/inject_pwa_meta.py
firebase deploy --only hosting
```

The service worker (`scripts/generate_sw.js`) scans the `dist/` directory and creates a `service-worker.js` that pre-caches static assets for offline support. It uses a cache-first strategy with version-based cache busting (`goarrive-v1-<timestamp>`).

The PWA injection script (`scripts/inject_pwa_meta.py`) adds viewport meta tags, theme-color, Apple mobile web app capability, the web app manifest, Google Fonts preconnect links, CSS overrides for fixed header and tab-bar positioning, Safari-specific fixes, and modal scroll fixes for iOS Safari PWA.

## Firebase Hosting Configuration
The `firebase.json` file defines the hosting behavior with specific caching strategies.

| Asset Type | Cache Strategy | Rationale |
|---|---|---|
| `/**` (default) | `public, max-age=0, must-revalidate` | Ensures fresh content for SPA routes. |
| `/index.html` | `public, max-age=0, must-revalidate` | SPA entry point must always be fresh. |
| `/service-worker.js` | `no-cache` | Service worker must always be the latest version. |
| `/manifest.json` | `no-cache` | PWA manifest must always be current. |
| `/_expo/static/js/**/*.js` | `public, max-age=31536000, immutable` | Hashed JS bundles are immutable and cached for one year. |

All routes are rewritten to `/index.html` for SPA behavior, except for the service worker, manifest, `_expo` assets, and static assets.

## Cloud Functions Deployment
Cloud Functions are deployed separately from the frontend. The `functions/` directory contains the source code, and the `firebase.json` file specifies a `predeploy` step that runs `npm run build` to compile TypeScript before deployment.

```
firebase deploy --only functions
```

## Key Deployment Considerations
When deploying, developers must be aware of several critical details. The Firebase project ID is `goarrive`, and the hosting target is `goarrive.web.app`. The `dist/` directory is gitignored and must be generated fresh before each deployment. The service worker and PWA meta injection scripts must run after the Expo export and before the Firebase deploy. The Cloud Functions are compiled from TypeScript, so the `functions/` directory must have its dependencies installed and the build must succeed before deployment.
