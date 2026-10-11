/**
 * KIOSK-LIVE-POSE-2: every live-pose suite talks to the Realtime Database, so
 * a run without a loopback database emulator is refused before any test
 * starts. It never falls back to the real `<project>-default-rtdb` instance,
 * and it is a refusal, not a skip.
 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;

if (!host || !LOOPBACK.test(host)) {
  throw new Error(
    [
      'WSF LIVE-POSE TEST RUN REFUSED — the Realtime Database emulator is not established.',
      `  database     : ${host ?? '<unset>'}`,
      '  Run inside `firebase emulators:exec --only firestore,auth,database`.',
    ].join('\n')
  );
}
