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
 * the staging-values check below applies only to builds that embed their JS.
 */
const STAGING_KEYS = [
  'EXPO_PUBLIC_WSF_STAGING_API_KEY',
  'EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN',
  'EXPO_PUBLIC_WSF_STAGING_PROJECT_ID',
  'EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET',
  'EXPO_PUBLIC_WSF_STAGING_SENDER_ID',
  'EXPO_PUBLIC_WSF_STAGING_APP_ID',
];

// Same rule as src/firebase.ts isEmulatorFlagOn.
function isEmulatorFlagOn(raw) {
  return raw === '1' || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

module.exports = ({ config }) => {
  const platform = process.env.EAS_BUILD_PLATFORM;
  if (platform === 'ios' || platform === 'android') {
    const env = (process.env.EXPO_PUBLIC_WSF_ENV || '').trim();
    const emulator = isEmulatorFlagOn(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS);
    if (env !== 'production' && env !== 'staging' && !emulator) {
      throw new Error(
        `WSF native build refused: EXPO_PUBLIC_WSF_ENV must be "staging" or "production" for an ${platform} build (got "${env}").`
      );
    }
    const profile = process.env.EAS_BUILD_PROFILE || '';
    const embedsJs = !profile.startsWith('development');
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
