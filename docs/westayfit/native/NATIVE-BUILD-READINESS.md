# Native build readiness (NATIVE-BUILD-1)

This document is preparation only. No build ran from the sprint sandbox and no signing credential was made: each is an owner account action, listed below.

**EAS project (I-8a).** The owner's Expo account is **`devinsimpson`** (Free plan: 15 iOS and 15 Android builds a month). The app is linked to the owner's separate project **"We Stay Fit Preview"** (`devinsimpson/we-stay-fit-preview`) through `apps/westayfit/app.json`: `owner`, `slug` and `extra.eas.projectId` (`3288e568-daaa-4ead-afd2-826fbb59544a`). `eas init` is therefore **not needed**. The app's name, its link scheme (`westayfit`) and its bundle id and package (`com.westayfit.app`) are unchanged. No code, test, script or workflow reads the old slug `westayfit` (checked by grep), and the web export's output paths do not depend on it. **The web bundle now carries `slug`, `owner` and `projectId`**, because Expo inlines the app config into the web build. All three are non-secret, no code reads them, and a future production project will replace them.

**eas-cli version.** Every `eas` command here is pinned to `npx eas-cli@25.3.0`. Each subcommand and flag was checked against that package's own source from npm (`build/commands/**`). In 25.3.0, `env:set` creates or updates a variable; `env:create` and `env:update` are marked deprecated.

## Profiles (`apps/westayfit/eas.json`)
| Profile | Artifact | Where its JavaScript comes from | Backend | Who may install it |
|---|---|---|---|---|
| `development` | Development client: Android APK, iOS device build (Debug) | **The developer's local `npx expo start`.** Nothing is embedded. | Whatever the local dev server's env says (see below). | Developer devices only |
| `development-simulator` | iOS simulator development client | The local dev server | Same as above | Developers only |
| `preview` | Standalone internal build: Android APK, iOS ad hoc (Release) | **Embedded at build time** | staging (`EXPO_PUBLIC_WSF_ENV=staging` plus the EAS `preview` environment) | Testers |
| `preview-simulator` | iOS Simulator build (Release): extends `preview`, `ios.simulator: true` | **Embedded at build time** (the same checks as `preview`) | staging, as `preview` | Anyone with a Mac and Xcode's Simulator. **No Apple account needed; it cannot be installed on an iPhone.** |

- All four profiles set `EXPO_PUBLIC_WSF_ENV=staging` and `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` (`preview-simulator` and `development-simulator` inherit them). No profile sets a `resourceClass`: every build uses the free default worker (tests/native-build-config.test.ts guards this). There is **no production profile**: a bare `eas build` defaults to `production` and fails with `MissingProfileError`. Production publishing and store submission stay held. NATIVE-INTEGRATOR-1 task I-0 listed a production profile; it is **deferred to the owner** with production publishing (the production value of `EXPO_PUBLIC_WSF_AUTH_ENABLED` at launch is also an owner decision, NATIVE-PARITY-TARGET-1 Appendix E item 8).
- **Sign-in must be stated (INT-11).** Every build that embeds its JavaScript refuses at config time unless `EXPO_PUBLIC_WSF_AUTH_ENABLED` is `1` (or `true`), or `0` (or `false`) on a production build only. With it unset the binary would show "Accounts are opening soon" on every entry screen, and a staging build with it off could not be tested. Development clients take the value from the local dev server instead, so add `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` to the EAS `development` environment (owner action 2) or to `.env.development.local`.
- **Invite and share hosts (`EXPO_PUBLIC_WSF_INVITE_HOSTS`, NATIVE-MEMBER-1 #642).** The allowlist of canonical public hosts for invite and share links: plain host names, comma- or space-separated, https only, with no scheme, port or wildcard (an entry that is not a public DNS name is ignored; `apps/westayfit/src/joinInput.ts`). **It is not set today**, in any profile or EAS environment, because no canonical public origin is settled yet (INT-08, owner input I-4). Until it is set, a pasted `https://<host>/join/<code>` invite link is not read in the app (it says "not a valid code"; `westayfit:` links and bare codes still work), and an https share link is accepted from any public host except a development tunnel. **Where it goes, one place only:** the EAS environment of each build (`preview` and `development`), not `eas.json`. The hosts differ per environment and are settled by INT-08, so no commit is needed to set or change them; a development server reads the same name from `.env.development.local`. What the app does with it is #642's (NATIVE-MEMBER-1), not this lane's.
- **Build stamp (INT-10).** An EAS build stamps its own commit (`EAS_BUILD_GIT_COMMIT_HASH`, short) and build time in its app config (`extra.wsfBuild`, `app.config.js`). The staging strip and Build details read that stamp instead of "build dev", and nothing needs setting for it. A local or development-client build has no stamp and still says "dev".
- **Injected-throw test builds (INT-01).** `EXPO_PUBLIC_WSF_CRASH_HARNESS` (see `apps/westayfit/src/crashHarness.native.ts`) makes a staging build that throws at chosen render sites, for the crash-containment device checks. It is inert in production and on web, and a production build that sets it is refused at config time.
- `autoIncrement` is on for `development` and `preview`, so each build carries a new build number.
- **Development builds are debuggable.** On Android, `adb run-as` can read app data, cleartext traffic is allowed, and the network inspector is on. Install them only on developer devices and never sign in with a real member account on them. Testers receive `preview` builds only. Both build types share the bundle id `com.westayfit.app`, so installing one replaces the other.

### How the backend is chosen
- **`preview`:** EAS merges the EAS `preview` environment's variables with the profile's `env` at build time and embeds the result. The build itself refuses (`app.config.js`) when `EXPO_PUBLIC_WSF_ENV=staging` and any of the six `EXPO_PUBLIC_WSF_STAGING_*` values is missing. If one were still missing at runtime, the app would refuse to start (`resolveStagingConfig`). It never falls back to production. The build also refuses when it names no backend and carries only `EXPO_PUBLIC_WSF_USE_EMULATORS`: a release binary never uses the emulator (`src/firebase.ts` honours the flag on native only in `__DEV__`).
- **Which profiles count as development clients:** only those listed in `DEV_CLIENT_PROFILES` in `app.config.js` (`development`, `development-simulator`). Every other profile is checked as one that embeds its JS. A new `developmentClient` profile in `eas.json` must be added to that list.
- **`development` / `development-simulator`:** the profile's `env` only gets the build-time check past. The JavaScript and its `EXPO_PUBLIC_*` values come from the machine running `npx expo start`:
  1. In `apps/westayfit`, run `[ACCOUNT] npx eas-cli@25.3.0 env:pull --environment development --path .env.development.local` (it reads the owner's EAS environment). This writes the EAS `development` variables to `.env.development.local`, which is git-ignored. Every development-mode Expo command loads it (`expo start`, including `--web`, plus `expo config`, `expo prebuild` and debug `expo run`); the production `expo export` (`npm run build:web`) never does. **Do not pull into `.env.local`:** Expo also loads `.env.local` for `expo export`, so a later `npm run build:web` from that checkout would quietly build a web bundle aimed at staging.
  2. Make sure `.env.development.local` contains `EXPO_PUBLIC_WSF_ENV=staging`. `env:pull` does not copy the profile's `env`. **Recommended:** store `EXPO_PUBLIC_WSF_ENV=staging` as an EAS environment variable in the `development` environment (owner action 2), so `env:pull` writes it. Adding the line by hand is only a fallback: every re-pull rewrites the file from the EAS variables alone and drops it.
  3. Run `npx expo start`. If `EXPO_PUBLIC_WSF_ENV` is not set, the app refuses to start (`nativeTargetProblem`).
  4. For the local emulator suite instead, first rename `.env.development.local`, for example to `.env.development.local.off` (also git-ignored). The selector and all six staging values must be absent: with the selector the app refuses because staging and the emulator flag are both set, and with the staging values alone it refuses because they are supplied without the selector. Then set `EXPO_PUBLIC_WSF_USE_EMULATORS=1` and `EXPO_PUBLIC_WSF_EMULATOR_HOST` to the computer's LAN address, or to `10.0.2.2` on the Android emulator.
- While `.env.development.local` is present, every development-mode run in that checkout picks it up: `npm run web` targets staging, and the E4-A1 dev-server spec (`docs/westayfit/E4-A1-R4-evidence.md`) sees the staging selector too, so with its emulator flag it refuses to start. `scripts/westayfit/gate1.sh` and `npm run build:web` run `expo export` in production mode and are unaffected.
- `npx expo start` (with `experiments.typedRoutes` on) rewrites the tracked `apps/westayfit/expo-env.d.ts`, dropping its `declare module` lines, and appends an `@generated expo-cli` block to the tracked `apps/westayfit/.gitignore`. **Do not commit those changes**; restore them with `git checkout -- expo-env.d.ts .gitignore`. It also generates the git-ignored `.expo/types`, after which `npx tsc --noEmit` reports two pre-existing typed-route errors.

## Permissions (verified with `expo prebuild` at this head)
- **Android requests** (the generated main manifest): `CAMERA`, `INTERNET` and `VIBRATE`.
- **Android removes** (`tools:node="remove"`, which strips them from every library manifest): `RECORD_AUDIO`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`. This covers `preview` (release) builds. **Development-client APKs keep `SYSTEM_ALERT_WINDOW`** (the dev overlay): the Expo template's `debug` and `debugOptimized` manifests declare it, and a build-type manifest takes merge priority over the main manifest, whose remove markers act only on lower-priority manifests.
- **Android backup:** `android:allowBackup="false"`. Before any production build, also add `dataExtractionRules` (cloud backup and device transfer).
- **iOS:** `NSCameraUsageDescription` is "We Stay Fit uses your front camera to count your squats on this device. No video or photos are recorded, saved or uploaded." There are no microphone or location keys, and `UIBackgroundModes` is empty.
- **expo-video:** configured with `supportsBackgroundPlayback: false` and `supportsPictureInPicture: false`.
- **Pending checks:**
  - After the first `preview` APK and the first `development` APK, confirm each merged list with `aapt2 dump permissions`. Transitive Google AAR manifests could not be inspected from the sandbox. The development APK is expected to list `SYSTEM_ALERT_WINDOW` as well.
  - Before a store build, add `uses-feature android.hardware.camera required=false`.
- **Native dependencies included ahead of use** (`expo-dev-client`, `react-native-svg`, `expo-video`, `expo-system-ui`): these are ordinary dependencies, autolinked into every native build, including the `preview` builds testers get. On Android, `expo-dev-client` is linked into release builds too (its launcher and menu ship inert release stubs); on iOS it is debug-only. Later JavaScript work that uses them needs no new development client.

## Native type-check (NATIVE-TSC-1)
- **Run it from `apps/westayfit`:** `[LOCAL] npm run typecheck:native` (both platforms), or `npm run typecheck:native -- ios` for one. It runs `scripts/typecheck-native.mjs`.
- **Why the default check misses this.** `npm run ts:check` (`tsc --noEmit`) resolves every import the way the web build does, so `./kv` is always `kv.ts`. A file that only the phones run is checked against the web module's types, and an error that exists only on a phone type-checks clean: the first native check found 16 errors where the default found 0.
- **What it does:** it runs tsc once per platform with Metro's suffix order, `moduleSuffixes: [".<platform>", ".native", ""]`, over the files that platform can reach:
  - the git-tracked `app/`, `src/` and `modules/` sources, plus `expo-env.d.ts` and `.expo/types` when present;
  - minus tests, `*.web.*`, the other platform's files, `src/movement-camera/frozen`, and any file shadowed by a higher-priority sibling (a base `X.ts` beside `X.native.ts`).
- **Output:** the errors with app-relative paths. It exits non-zero on any error.
- **What it catches:** type errors as a phone resolves the code. That includes a `.native`, `.ios` or `.android` file that imports its own base specifier (by any spelling, including `.`, `./` or its own directory for an `index` file): on a phone that resolves to the file itself, so its types become `any`. `tests/native-self-import.test.ts` guards that case statically on every vitest run. If tsc cannot run at all, the script says "tsc did not run (<code>)" and fails.
- **What it is not:** a Swift, Kotlin, Xcode or Gradle compile. Native module code (for example `modules/wsf-pose-camera`'s Swift and Kotlin) is not compiled here, and a clean result says nothing about the binary building.
- **Known state:** until two lanes split their shared types into suffix-free modules, it reports the storage errors in `src/storage/kv.native.ts`, which imports `DeviceKv`/`KvRead` from `./kv` (ST-TSC-1, W13: `src/storage/kvTypes.ts`). With the camera lane merged it also reports `src/movement-camera/support.native.ts`, which takes `TestPoseHook` from `./support` (CAM-TSC-1, W15: `src/movement-camera/testPoseHookType.ts`). With both splits applied, iOS and Android report 0 errors.

## What the sprint sandbox can and cannot do
- **Can:** `expo prebuild --no-install`, whose template comes from npm. Prebuild output was used for the permission check above.
- **Cannot:** run Gradle, because the network policy denies `dl.google.com` and so blocks the Android SDK. iOS builds need macOS and Xcode.
- **So the evidence today is** JavaScript bundle export plus prebuild configuration, **not** a built, installed or launched binary.

## Owner actions (exact)
1. **EAS project: done, by link.** The project exists under `devinsimpson` and `app.json` names it (see the top of this document). Do not run `eas init`. Before any account command, from `apps/westayfit`, run `[ACCOUNT] npx eas-cli@25.3.0 login` as `devinsimpson`. To confirm the link, run `[RO] npx eas-cli@25.3.0 project:info`, which needs that login.
2. **EAS environment variables:** set the six `EXPO_PUBLIC_WSF_STAGING_*` values from the `westayfit-staging` Firebase Web App config in both the `preview` and `development` environments. Retrieve, verify and upload them as in "Staging values: retrieve, verify, upload" below. The owner verified on 21 Oct (03:39Z, read-only) that the project has **no environment variables in any environment** yet. Use **Plain text** or **Sensitive** visibility, **not Secret**: `eas env:pull` cannot read Secret values outside EAS servers and writes them only as comments (`# NAME=***** (secret)`; eas-cli 25.3.0 `build/commands/env/pull.js`), so the development client would be missing them and refuse to start. They are public client identifiers, so Plain text is fine. Also add `EXPO_PUBLIC_WSF_ENV=staging` and `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` to the `development` environment, so `env:pull` writes the selector (step 2 above) and a development client can sign in.
3. **Android internal test** `[ACCOUNT]`:
   - First, `[RO] npx eas-cli@25.3.0 env:list preview --format short` must list all six `EXPO_PUBLIC_WSF_STAGING_*` names. eas-cli never runs the `app.config.js` refusal locally, so a missing value otherwise shows up only on the build worker, after the upload. Plaintext values print in clear; sensitive ones stay masked.
   - Then `[ACCOUNT] npx eas-cli@25.3.0 build -p android --profile preview`.
   - On the first build, accept the EAS-generated keystore. That is the Android signing credential, and EAS manages it.
   - Install the APK by link or QR, allowing "install unknown apps" for the browser that opens it.
4. **iPhone** `[ACCOUNT]`: **BLOCKED until the Apple Developer Program membership shows Active; it is currently Pending (owner, 03:32Z).** A paid membership is required for both `preview` and `development` device builds, because both use internal (ad hoc) distribution. Once it is Active:
   - Register each test iPhone with `[ACCOUNT] npx eas-cli@25.3.0 device:create`.
   - Check the values first, as in action 3: `[RO] npx eas-cli@25.3.0 env:list preview --format short`.
   - Run `[ACCOUNT] npx eas-cli@25.3.0 build -p ios --profile preview`.
   - On the phone, turn on Developer Mode (Settings › Privacy & Security › Developer Mode, iOS 16 and later) before the build will launch.
   - The bundle id `com.westayfit.app` must be free in that Apple team.
5. **Staging backend reachability:** the 13 platform-auth-required callables (#629) refuse native callers too, until the separately authorized IAM repair is done.

## Staging values: retrieve, verify, upload (owner only)
Agents never see, set or upload a value. The owner runs these steps on their own machine; the tags are as in the next section. Use a private temporary directory, for example `TMP=$(mktemp -d)`.
1. **Retrieve** `[RO, the owner's Firebase login]`: `npx firebase-tools@15.30.1 apps:sdkconfig WEB --project westayfit-staging --json > "$TMP/sdkconfig.json"`.
2. **Shape** `[LOCAL]`: `node .github/wsf-staging/prepare-staging.mjs "$TMP/sdkconfig.json" "$TMP/wsf-staging.env" westayfit-staging`. It writes the six names at mode 0600 and echoes only the project id it resolved, never a config value. That script lives on `main` and is reused from there, not copied into this branch, so run it from a checkout of `main`.
3. **Remove the raw config** `[LOCAL]`: `rm -f "$TMP/sdkconfig.json"`.
4. **Verify before uploading** `[LOCAL]`: from `apps/westayfit`, run `npm run check:staging-env -- "$TMP/wsf-staging.env" --platform ios` (`scripts/check-staging-env.mjs`).
   - It checks the file with the app's own rules: `resolveStagingConfig` and `nativeTargetProblem` from `src/stagingEnv.ts` (a release build, so `__DEV__` is false), and `app.config.js` run as an EAS `preview` build would run it. It adds `EXPO_PUBLIC_WSF_ENV=staging` and `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` unless the file sets them.
   - It prints **only names**: the six names as present or missing, PASS or FAIL per check, and for each failure a rule label (for example "AUTH_DOMAIN must equal <PROJECT_ID>.firebaseapp.com") with the names involved. It never prints a value, even though the app's own refusal messages quote values. Exit 0 means PASS, 1 means FAIL.
   - It refuses a file git could commit: one git tracks (by the path given or its real path, so a symlink does not help), one inside the repository that git does not ignore (keep it outside, or use a `.env*.local` name), and one with a second hard link. It also refuses when git cannot answer (no git, no work tree), and it refuses unknown flags or more than one file.
   - Upload only on PASS.
5. **Upload** `[ACCOUNT, owner only; never run by an agent]`, one of:
   - `npx eas-cli@25.3.0 env:push preview --path "$TMP/wsf-staging.env"`. Note: eas-cli 25.3.0 `env:push` gives every `EXPO_PUBLIC_*` name **plaintext ("Public")** visibility (`build/commands/env/push.js:185`), so `env:list` will show those values in clear.
   - Or one name at a time: `npx eas-cli@25.3.0 env:set preview --name <NAME> --type string --visibility sensitive --scope project`. Leave out `--value`: eas-cli then prompts for it, and nothing lands in shell history.
   - Repeat for the `development` environment if a development client will use EAS-pulled values.
6. **Confirm** `[RO, the owner's EAS login]`: `npx eas-cli@25.3.0 env:list preview --format short`. Sensitive values stay masked unless `--include-sensitive` is given; plaintext ("Public") values are shown as they are.
7. **For path A (Expo Go or the dev server)** `[LOCAL]`:
   - `cp "$TMP/wsf-staging.env" apps/westayfit/.env.development.local`, then append `EXPO_PUBLIC_WSF_ENV=staging` and `EXPO_PUBLIC_WSF_AUTH_ENABLED=1` to that copy;
   - confirm `git check-ignore -v apps/westayfit/.env.development.local` reports it ignored (`.env*.local` in `apps/westayfit/.gitignore`);
   - then `npm run check:staging-env -- .env.development.local` from `apps/westayfit`.
8. **Clean up** `[LOCAL]`: `rm -f "$TMP/wsf-staging.env"`.

## iPhone testing without a paid Apple membership
The owner's Apple account offers only "Enroll Today": there is **no paid Apple Developer Program membership**, and enrolling is a purchase that is not authorized. These are the paths that remain, each command tagged:
- **[RO]** reads only (some need a login session);
- **[LOCAL]** runs on the owner's own machine, with no account;
- **[ACCOUNT]** acts on the owner's Expo or Apple account, and only the owner runs it.

Run every command from `apps/westayfit`.

**(A) Expo Go on the iPhone. Feasible only if Expo Go supports SDK 54.**
- This app is Expo SDK 54 (`expo` 54.0.37). Expo Go runs only projects on an SDK it supports. Sources conflict on whether the current App Store Expo Go is still SDK 54 or has moved to 57, so the owner checks the supported SDK in **Expo Go › Settings**. If it is not 54, this path is closed: the App Store offers only the current Expo Go.
- Put the staging values in the git-ignored `.env.development.local` (names in the table below). Get them in one of two ways:
  - from the Firebase web app config, `[RO] firebase apps:sdkconfig WEB --project <staging project>` (firebase-tools; not part of this repo, so not checked here);
  - or, if they are already in EAS, `[ACCOUNT] npx eas-cli@25.3.0 env:pull --environment development --path .env.development.local` (read-only on the account). Never pull into `.env.local` (see "How the backend is chosen").
- `[LOCAL] npx expo start --go`. The repo has `expo-dev-client`, so `--go` is required: without it the CLI serves the development client instead of Expo Go.
  - **If you are logged in to Expo** (`eas login` or `expo login`), Expo CLI fetches a development code-signing certificate for the linked project the first time Expo Go asks for the manifest. This is an account action on the owner's project (`@expo/cli` `utils/codesigning.js`, `fetchAndCacheNewDevelopmentCodeSigningInfoAsync`).
  - **Logged out, it works without one**: the CLI skips signing when no user is signed in.
- Use the default LAN connection, with the iPhone on the same Wi-Fi, and scan the QR with the iPhone Camera. **Do not add `--tunnel` by default:** a tunnel exposes the dev server through a third-party service.
- What differs in Expo Go: the camera rep counter's native module (`wsf-pose-camera`) is not in Expo Go. The app fails closed to the manual count (`cameraCounterSupported()` is false), and no MediaPipe is present at all.

**(B) EAS iOS Simulator build. [ACCOUNT, owner]**
- First, `[RO] npx eas-cli@25.3.0 env:list preview --format short` must list all six `EXPO_PUBLIC_WSF_STAGING_*` names. eas-cli never runs the refusal locally, so a missing value otherwise shows up only on the worker, after the upload.
- `[ACCOUNT] npx eas-cli@25.3.0 build -p ios --profile preview-simulator`.
- No Apple account is needed: a simulator build is not signed for devices. It uses 1 of the 15 free iOS builds.
- The EAS `preview` environment must hold the six staging values; the build refuses at config time otherwise.
- It runs only in the Xcode iOS Simulator on a Mac: `[ACCOUNT] npx eas-cli@25.3.0 build:run -p ios --latest --profile preview-simulator` (read-only on the account). **It cannot be installed on an iPhone.**

**(C) Local Simulator build on a Mac. [LOCAL]**
- `[LOCAL] npx expo run:ios`. This needs Xcode and its Simulator, and no EAS and no Apple account.
- It is a Debug build: its JavaScript comes from the local dev server, with `.env.development.local` as in (A).

**(D) A physical iPhone through Xcode's free Personal Team, on a Mac. [ACCOUNT, owner]**
- Sign in to Xcode › Settings › Accounts with the owner's Apple ID. Xcode creates a free development certificate under that Apple ID; that is the account action.
- `[LOCAL] npx expo prebuild -p ios`, then open `ios/*.xcworkspace` and choose the Personal Team under Signing & Capabilities. If `com.westayfit.app` cannot be registered there, use a personal bundle id for this local build only, and commit nothing from `ios/`.
- Turn on Developer Mode on the iPhone (Settings › Privacy & Security › Developer Mode).
- Then do one of these:
  - `[LOCAL] npx expo run:ios --device`: a Debug build that needs the Mac's dev server on the same Wi-Fi, with `.env.development.local` as in (A).
  - Or `[LOCAL] npx expo run:ios --device --configuration Release`: this embeds the JavaScript. A production-mode build reads `.env.production.local` or `.env.local`, not `.env.development.local`, and either of those files would also leak into `npm run build:web`. So pass the values in the shell for that one command instead of in a file.
- Free-provisioning limits, as Apple applies them (not verifiable from this sandbox): the profile expires after 7 days, at most 3 apps per device.

**(E) EAS internal distribution (`preview` or `development` on an iPhone). Blocked.**
- Ad hoc provisioning needs the paid membership. Owner action 4 above stays blocked until the membership shows Active (it is Pending).

**(F) This sandbox. No iOS compile.**
- It runs on Linux, with no Xcode. Evidence here is limited to JavaScript export, `expo prebuild --no-install` and autolinking resolution.

**Not authorized:** any third-party signing or sideloading service that asks for the Apple ID password.

**The camera module on iOS preview builds (PRV-1).** Every iOS build made from the preview branch `claude/wsf-native-preview-ios-1` omits `wsf-pose-camera` (`expo.autolinking.ios.exclude` in `apps/westayfit/package.json`). That covers paths B, C and D and any development client built from it. Such a build does not compile the module's Swift or link MediaPipe, and the app falls back to the manual count. Android builds still link the module.

### Where each variable must exist, per path (names only; never commit a value)
| Variable | (A) Expo Go | (B) EAS Simulator build | (C) Local Simulator | (D) Personal Team device |
|---|---|---|---|---|
| `EXPO_PUBLIC_WSF_ENV` | `.env.development.local` | `eas.json` (`preview`, inherited) | `.env.development.local` | `.env.development.local` (Debug) or the shell (Release) |
| `EXPO_PUBLIC_WSF_AUTH_ENABLED` | `.env.development.local` | `eas.json` (`preview`, inherited) | `.env.development.local` | as above |
| `EXPO_PUBLIC_WSF_STAGING_API_KEY` | `.env.development.local` | EAS `preview` environment | `.env.development.local` | as above |
| `EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN` | same | same | same | same |
| `EXPO_PUBLIC_WSF_STAGING_PROJECT_ID` | same | same | same | same |
| `EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET` | same | same | same | same |
| `EXPO_PUBLIC_WSF_STAGING_SENDER_ID` | same | same | same | same |
| `EXPO_PUBLIC_WSF_STAGING_APP_ID` | same | same | same | same |
| `EXPO_PUBLIC_WSF_INVITE_HOSTS` (#642; unset today) | `.env.development.local`, optional | EAS `preview` environment, optional | `.env.development.local`, optional | as above, optional |
| `EXPO_PUBLIC_WSF_USE_EMULATORS` | **absent** | **absent** (no `preview*` profile sets it) | **absent** | **absent** |
| `EXPO_PUBLIC_WSF_CRASH_HARNESS` | absent | **absent** (no `preview*` profile sets it) | absent | absent |

## Device checks to add to map Appendix C (owner, with the build id)
- **iOS staging (NB-5):** open MOVE, the contribution sheet and Settings over the tabs. The repeated staging strip travels with each modal's presentation (it slides up with the sheet and in from the side with Settings) and should read as the same strip the screen behind it carries. On the first frame, no screen below the strip should jump down by the status-bar height and back.
- **Pixel, Android 15 (NB-6):** with the member menu open, tap the bottom tab bar and the area between the menu and it. The menu closes and no tab is selected, including the strip of the bar below the window's reported height.
- **Signed-in tabs (#641 F1):** on a notched iPhone, a community's challenge page and its join gate start directly under the top bar, with no second gap and with dark status icons over the cream bar.

## What a run proves
- **Build success:** a binary exists.
- **Install and launch on a device:** DEVICE VERIFIED for launch only.

Neither proves camera accuracy, store readiness or production behaviour.

## Known gaps carried forward
- **No app icon or splash defined.** Binaries get the Expo placeholder icon. This belongs to the visual lane, using the approved WE-on-navy brand asset.
- **`@react-navigation/bottom-tabs@7.18.18`** is flagged by `expo install --check` (expected `^7.4.0`). It is unchanged since base and tracked separately.
- **The monorepo upload is about 108 MB per build.** A repo-root `.easignore` would shrink it, but it replaces `.gitignore` for EAS, so it needs care. Deferred.
