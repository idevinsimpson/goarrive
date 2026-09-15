/**
 * Runs before every callable/rules test file, via `setupFiles` in the Jest
 * configs. This is the enforcement point: an exported helper nothing calls
 * enforces nothing, so the check lives where the tests actually start.
 *
 * It refuses the run — before any application request is made — unless:
 *   - the project is the demo-prefixed local project, and
 *   - the Firestore emulator host is loopback.
 *
 * A `demo-` prefixed project id is the only id Firebase guarantees never
 * reaches a real backend. `goarrive-test` was not one; it would have attempted
 * real service calls for anything not emulated.
 */
const DEMO_PROJECT = 'demo-wsf-local';
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

function refuse(problem: string): never {
  throw new Error(
    [
      'WSF TEST RUN REFUSED — emulator isolation is not established.',
      `  ${problem}`,
      `  project      : ${process.env.GCLOUD_PROJECT ?? '<unset>'}`,
      `  firestore    : ${process.env.FIRESTORE_EMULATOR_HOST ?? '<unset>'}`,
      `  auth         : ${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '<unset>'}`,
      '  These tests will not fall back to live Firebase services.',
    ].join('\n')
  );
}

const project = process.env.GCLOUD_PROJECT;
if (!project) refuse('GCLOUD_PROJECT is not set.');
if (project !== DEMO_PROJECT) {
  refuse(`GCLOUD_PROJECT is "${project}", not the demo project "${DEMO_PROJECT}".`);
}
if (!project.startsWith('demo-')) {
  refuse(`project "${project}" is not demo-prefixed, so Firebase does not guarantee it stays offline.`);
}

const firestore = process.env.FIRESTORE_EMULATOR_HOST;
if (!firestore) refuse('FIRESTORE_EMULATOR_HOST is not set.');
if (!LOOPBACK.test(firestore)) {
  refuse(`FIRESTORE_EMULATOR_HOST "${firestore}" is not a loopback address.`);
}

// No live email. The WSF email sender reads a secret; leaving it unset means a
// test can never reach a real provider, and asserting it here makes that a
// property of the run rather than an accident.
if (process.env.WSF_EMAIL_API_KEY) {
  refuse('WSF_EMAIL_API_KEY is set. Tests must not be able to send real email.');
}

// eslint-disable-next-line no-console
console.info(
  `WSF test isolation OK — project ${project}, firestore ${firestore}, ` +
    `auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '<unset>'}`
);
