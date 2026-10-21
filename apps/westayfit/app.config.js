/**
 * Build-time backend check for native EAS builds (NATIVE-BOOT-1 / NATIVE-BUILD-1).
 *
 * The app config itself stays in app.json; this only adds refusals. A phone
 * binary that does not name its backend would otherwise build fine and refuse
 * to start on the device (src/stagingEnv.ts nativeTargetProblem). Catching it
 * here fails the build instead. Web exports and local tooling are unaffected:
 * the checks run only when EAS builds for iOS or Android.
 *
 * Development-client builds embed no JavaScript: their JS (and its
 * EXPO_PUBLIC_* values) comes from the developer's local `npx expo start`, so
 * the staging-values check below applies only to builds that embed their JS,
 * and only a development client may rely on the emulator flag alone.
 */
const STAGING_KEYS = [
  'EXPO_PUBLIC_WSF_STAGING_API_KEY',
  'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
  'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
  'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
  'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
  'EXPO_PUBLIC_WSF_STAGING_APP_ID',
];

// The eas.json build profiles that produce a development client
// (developmentClient: true) and therefore embed no JavaScript. Any new
// developmentClient profile added to eas.json must be added here too. A profile
// missing from this list is treated as embedding its JS, the stricter check.
const DEV_CLIENT_PROFILES = ['development', 'development-simulator'];

// NATIVE-INTEGRATOR-1 (INT-10). The binary's own build stamp, carried in its
// app config (`extra.wsfBuild`) and read by src/nativeBuildInfo.native.ts, so
// the staging strip and Build details stop reading "build dev". The commit is
// the one EAS checked out; the time is when the config was evaluated during the
// build. Shaped like the web build's stamp (package.json `build:web`).
function buildStampOf(env, now) {
  const sha = typeof env.EAS_BUILD_GIT_COMMIT_HASH === 'string' ? env.EAS_BUILD_GIT_COMMIT_HASH.trim().toLowerCase() : '';
  return {
    commit: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : undefined,
    builtAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

// Same rule as src/firebase.ts isEmulatorFlagOn.
function isEmulatorFlagOn(raw) {
  return raw === '1' || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

// NATIVE-INTEGRATOR-1 (INT-11). The sign-in switch as src/featureFlags.ts reads
// it ('1' / 'true' is on), plus an explicit off ('0' / 'false'). Anything else,
// unset included, is not a decision.
function authFlagOf(raw) {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === '1' || v === 'true') return 'on';
  if (v === '0' || v === 'false') return 'off';
  return 'unset';
}

module.exports = ({ config }) => {
  const platform = process.env.EAS_BUILD_PLATFORM;
  if (platform === 'ios' || platform === 'android') {
    const env = (process.env.EXPO_PUBLIC_WSF_ENV || '').trim();
    const emulator = isEmulatorFlagOn(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS);
    const profile = process.env.EAS_BUILD_PROFILE || '';
    const embedsJs = !DEV_CLIENT_PROFILES.includes(profile);
    if (env !== 'production' && env !== 'staging') {
      // src/firebase.ts honours the emulator flag on native only in a __DEV__
      // binary, so a build that embeds its JS (a release build) never uses the
      // emulator and would refuse to start on the device.
      if (emulator && embedsJs) {
        throw new Error(
          `WSF native build refused: profile "${profile}" embeds its JavaScript, so EXPO_PUBLIC_WSF_USE_EMULATORS cannot ` +
            `name its backend (the emulator is used only by a development client). Set EXPO_PUBLIC_WSF_ENV to "staging" ` +
            `or "production" for this ${platform} build (got "${env}").`
        );
      }
      if (!emulator) {
        throw new Error(
          `WSF native build refused: EXPO_PUBLIC_WSF_ENV must be "staging" or "production" for an ${platform} build (got "${env}").`
        );
      }
    }
    // NATIVE-INTEGRATOR-1 (INT-01): the injected-throw test harness
    // (src/crashHarness.ts) is inert in production at runtime too; a
    // production build that names it is a mistake, so it does not build.
    if (env === 'production' && (process.env.EXPO_PUBLIC_WSF_CRASH_HARNESS || '').trim()) {
      throw new Error(
        `WSF native build refused: EXPO_PUBLIC_WSF_CRASH_HARNESS is set for a production ${platform} build. ` +
          `The injected-throw harness is for staging test builds only; unset it.`
      );
    }
    if (env === 'staging' && embedsJs) {
      const missing = STAGING_KEYS.filter((k) => !(process.env[k] || '').trim());
      if (missing.length) {
        throw new Error(
          `WSF native build refused: profile "${profile}" embeds its JavaScript with EXPO_PUBLIC_WSF_ENV=staging, ` +
            `but these staging values are missing from the EAS environment: ${missing.join(', ')}.`
        );
      }
    }
    // NATIVE-INTEGRATOR-1 (INT-11): a build that embeds its JS must say whether
    // sign-in is on. With EXPO_PUBLIC_WSF_AUTH_ENABLED unset the binary renders
    // "Accounts are opening soon" on every entry screen and the whole member
    // loop is unreachable (src/featureFlags.ts defaults it off: the launch
    // switch). Staging must have it on; production may switch it off, but only
    // by saying 0. A development client takes the flag from the local dev
    // server's environment, not this build's.
    if (embedsJs) {
      const raw = process.env.EXPO_PUBLIC_WSF_AUTH_ENABLED;
      const auth = authFlagOf(raw);
      if (auth === 'unset') {
        throw new Error(
          `WSF native build refused: profile "${profile}" embeds its JavaScript, but EXPO_PUBLIC_WSF_AUTH_ENABLED is not ` +
            `set to 1 or 0 (got "${raw === undefined ? '' : raw}"). This ${platform} build would ship with sign-in switched ` +
            `off. Set it to 1; only a production build may say 0.`
        );
      }
      if (auth === 'off' && env !== 'production') {
        throw new Error(
          `WSF native build refused: EXPO_PUBLIC_WSF_AUTH_ENABLED is off for a ${env} ${platform} build, which would ship ` +
            `with sign-in switched off and could not be tested. Set it to 1.`
        );
      }
    }
    return { ...config, extra: { ...(config.extra || {}), wsfBuild: buildStampOf(process.env, new Date()) } };
  }
  return config;
};
