# Native build readiness (NATIVE-BUILD-1)

This file is source preparation only. No EAS project was created, no build ran, and no signing credentials were made. Each of those is an owner account action, listed below.

## Profiles (`apps/westayfit/eas.json`)
| Profile | Artifact | Needs a dev server? | Backend |
|---|---|---|---|
| `development` | Development client (Android APK; iOS device build) | **Yes**: it loads JavaScript from `npx expo start` | staging (`EXPO_PUBLIC_WSF_ENV=staging`) |
| `development-simulator` | iOS simulator development client | Yes | staging |
| `preview` | Standalone internal build (Android APK; iOS ad hoc) | **No**: JavaScript is embedded | staging |

There is deliberately no production profile. Production publishing and store submission stay held.

Both profiles set `EXPO_PUBLIC_WSF_ENV=staging`. The six `EXPO_PUBLIC_WSF_STAGING_*` values come from the EAS environment named in each profile (`development` / `preview`). If any is missing, the app refuses to start (`resolveStagingConfig`). It never falls back to production, and on native a missing selector also refuses (`nativeTargetProblem`, PR #632).

## Why no binary was built in the sprint container
The sandbox's network policy denies `dl.google.com`. The Android SDK, platform and build-tools cannot be downloaded, so `expo prebuild` plus Gradle cannot run here. iOS needs macOS and Xcode. The available evidence is the Hermes JavaScript bundle export for both platforms, which is **not** proof that a binary builds or runs.

## Owner actions (exact)
1. **Create the WSF EAS project under the existing Expo account `idevinsimpson`.** GoArrive already uses project `dd72ba84-…` there; do not reuse that one. From `apps/westayfit`, run `npx eas-cli@latest login`, then `npx eas-cli@latest init`. This writes `extra.eas.projectId` and `owner` into `app.json`; commit that change.
2. **Set EAS environment variables** for the `development` and `preview` environments: the six `EXPO_PUBLIC_WSF_STAGING_*` values from the `westayfit-staging` Firebase Web App config. They are public client identifiers, not secrets, so plain-text visibility is fine.
3. **Android internal test:** `npx eas-cli@latest build -p android --profile preview`. It produces an installable APK. Use `--profile development` for a development client.
4. **iPhone:** this needs a **paid Apple Developer Program** membership. Register the test iPhone with `npx eas-cli@latest device:create`, then run `npx eas-cli@latest build -p ios --profile preview`. Ad hoc provisioning covers only registered devices. Bundle id `com.westayfit.app` must be free in that Apple team.
5. **Staging backend reachability:** the 13 platform-auth-required callables (#629) will refuse native callers too, until the separately authorized IAM repair is done.

## What a run proves
- **Build success:** a binary exists.
- **Install and launch on a device:** DEVICE VERIFIED for launch only.

Neither proves camera accuracy, store readiness or production behaviour.
