/**
 * Build-time backend check for native EAS builds (NATIVE-BOOT-1).
 *
 * The app config itself stays in app.json; this only adds a refusal. A phone
 * binary that does not name its backend would otherwise build fine and refuse
 * to start on the device (src/stagingEnv.ts nativeTargetProblem). Catching it
 * here fails the build instead. Web exports and local tooling are unaffected:
 * the check runs only when EAS builds for iOS or Android.
 */
module.exports = ({ config }) => {
  const platform = process.env.EAS_BUILD_PLATFORM;
  if (platform === 'ios' || platform === 'android') {
    const env = (process.env.EXPO_PUBLIC_WSF_ENV || '').trim();
    const emulator = ['1', 'true'].includes((process.env.EXPO_PUBLIC_WSF_USE_EMULATORS || '').trim().toLowerCase());
    if (env !== 'production' && env !== 'staging' && !emulator) {
      throw new Error(
        `WSF native build refused: EXPO_PUBLIC_WSF_ENV must be "staging" or "production" for an ${platform} build (got "${env}").`
      );
    }
  }
  return config;
};
