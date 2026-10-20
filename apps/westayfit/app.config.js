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

// Same rule as src/firebase.ts isEmulatorFlagOn.
function isEmulatorFlagOn(raw) {
  return raw === '1' || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
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
  }
  return config;
};
