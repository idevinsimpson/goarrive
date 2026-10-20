# Native build readiness (NATIVE-BUILD-1)

This document is preparation only. No EAS project was created, no build ran, and no signing credential was made. Each of those is an owner account action, listed below.

## Profiles (`apps/westayfit/eas.json`)
| Profile | Artifact | Where its JavaScript comes from | Backend | Who may install it |
|---|---|---|---|---|
| `development` | Development client: Android APK, iOS device build (Debug) | **The developer's local `npx expo start`.** Nothing is embedded. | Whatever the local dev server's env says (see below). | Developer devices only |
| `development-simulator` | iOS simulator development client | The local dev server | Same as above | Developers only |
| `preview` | Standalone internal build: Android APK, iOS ad hoc (Release) | **Embedded at build time** | staging (`EXPO_PUBLIC_WSF_ENV=staging` plus the EAS `preview` environment) | Testers |

- All three profiles set `EXPO_PUBLIC_WSF_ENV=staging`. There is **no production profile**: a bare `eas build` defaults to `production` and fails with `MissingProfileError`. Production publishing and store submission stay held.
- `autoIncrement` is on for `development` and `preview`, so each build carries a new build number.
- **Development builds are debuggable.** On Android, `adb run-as` can read app data, cleartext traffic is allowed, and the network inspector is on. Install them only on developer devices and never sign in with a real member account on them. Testers receive `preview` builds only. Both build types share the bundle id `com.westayfit.app`, so installing one replaces the other.

### How the backend is chosen
- **`preview`:** EAS merges the EAS `preview` environment's variables with the profile's `env` at build time and embeds the result. The build itself refuses (`app.config.js`) when `EXPO_PUBLIC_WSF_ENV=staging` and any of the six `EXPO_PUBLIC_WSF_STAGING_*` values is missing. If one were still missing at runtime, the app would refuse to start (`resolveStagingConfig`). It never falls back to production.
- **`development` / `development-simulator`:** the profile's `env` only gets the build-time check past. The JavaScript and its `EXPO_PUBLIC_*` values come from the machine running `npx expo start`:
  1. In `apps/westayfit`, run `npx eas-cli@latest env:pull --environment development --path .env.development.local`. This writes the EAS `development` variables to `.env.development.local`, which is git-ignored and read **only** by the development server. **Do not pull into `.env.local`:** Expo also loads `.env.local` for `expo export`, so a later `npm run build:web` from that checkout would quietly build a web bundle aimed at staging.
  2. Make sure `.env.development.local` contains `EXPO_PUBLIC_WSF_ENV=staging`. `env:pull` does not copy the profile's `env`, so either add the line or store `EXPO_PUBLIC_WSF_ENV=staging` in the EAS `development` environment as well.
  3. Run `npx expo start`. If `EXPO_PUBLIC_WSF_ENV` is not set, the app refuses to start (`nativeTargetProblem`).
  4. For the local emulator suite instead, set `EXPO_PUBLIC_WSF_USE_EMULATORS=1` and `EXPO_PUBLIC_WSF_EMULATOR_HOST` to the computer's LAN address, or to `10.0.2.2` on the Android emulator.

## Permissions (verified with `expo prebuild` at this head)
- **Android requests:** `CAMERA`, `INTERNET` and `VIBRATE`.
- **Android removes** (`tools:node="remove"`, which strips them from every library manifest): `RECORD_AUDIO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`.
- **Android backup:** `android:allowBackup="false"`. Before any production build, also add `dataExtractionRules` (cloud backup and device transfer).
- **iOS:** `NSCameraUsageDescription` is "We Stay Fit uses your front camera to count your squats on this device. No video or photos are recorded, saved or uploaded." There are no microphone or location keys, and `UIBackgroundModes` is empty.
- **expo-video:** configured with `supportsBackgroundPlayback: false` and `supportsPictureInPicture: false`.
- **Pending checks:**
  - After the first preview APK, confirm the merged list with `aapt2 dump permissions`. Transitive Google AAR manifests could not be inspected from the sandbox.
  - Before a store build, add `uses-feature android.hardware.camera required=false`.
- **Native dependencies included ahead of use** (`expo-dev-client`, `react-native-svg`, `expo-video`, `expo-system-ui`): they are baked into the development client so later JavaScript work needs no rebuild.

## What the sprint sandbox can and cannot do
- **Can:** `expo prebuild --no-install`, whose template comes from npm. Prebuild output was used for the permission check above.
- **Cannot:** run Gradle, because the network policy denies `dl.google.com` and so blocks the Android SDK. iOS builds need macOS and Xcode.
- **So the evidence today is** JavaScript bundle export plus prebuild configuration, **not** a built, installed or launched binary.

## Owner actions (exact)
1. **Create the WSF EAS project under `idevinsimpson`.** GoArrive already uses project `dd72ba84-…` there; do not reuse that one. From `apps/westayfit`, run `npx eas-cli@latest login`, then `npx eas-cli@latest init --account idevinsimpson`. This writes `extra.eas.projectId` and `owner` into `app.json`; commit that change.
2. **EAS environment variables:** set the six `EXPO_PUBLIC_WSF_STAGING_*` values from the `westayfit-staging` Firebase Web App config in both the `preview` and `development` environments. They are public client identifiers, so plain-text visibility is fine. Optionally add `EXPO_PUBLIC_WSF_ENV=staging` to `development` as well.
3. **Android internal test:** run `npx eas-cli@latest build -p android --profile preview`.
   - On the first build, accept the EAS-generated keystore. That is the Android signing credential, and EAS manages it.
   - Install the APK by link or QR, allowing "install unknown apps" for the browser that opens it.
4. **iPhone:** a **paid Apple Developer Program** membership is required for both `preview` and `development` device builds, because both use internal (ad hoc) distribution.
   - Register each test iPhone with `npx eas-cli@latest device:create`.
   - Run `npx eas-cli@latest build -p ios --profile preview`.
   - On the phone, turn on Developer Mode (Settings › Privacy & Security › Developer Mode, iOS 16 and later) before the build will launch.
   - The bundle id `com.westayfit.app` must be free in that Apple team.
5. **Staging backend reachability:** the 13 platform-auth-required callables (#629) refuse native callers too, until the separately authorized IAM repair is done.

## What a run proves
- **Build success:** a binary exists.
- **Install and launch on a device:** DEVICE VERIFIED for launch only.

Neither proves camera accuracy, store readiness or production behaviour.

## Known gaps carried forward
- **No app icon or splash defined.** Binaries get the Expo placeholder icon. This belongs to the visual lane, using the approved WE-on-navy brand asset.
- **`@react-navigation/bottom-tabs@7.18.18`** is flagged by `expo install --check` (expected `^7.4.0`). It is unchanged since base and tracked separately.
- **The monorepo upload is about 108 MB per build.** A repo-root `.easignore` would shrink it, but it replaces `.gitignore` for EAS, so it needs care. Deferred.
