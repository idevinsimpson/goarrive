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

// Auth is required unless a run explicitly declares it does not use Auth.
// A missing or remote Auth target must not pass preflight: several callables
// mint links and read tokens through the Admin Auth SDK, and without the
// emulator host those calls address the real service.
//
// WSF_TEST_DECLARE_NO_AUTH=1 is the declared Firestore-only escape hatch. It
// means "this run does not use Auth" — it is NOT a statement that Auth was
// verified, and nothing may describe it as one.
const declaredNoAuth = process.env.WSF_TEST_DECLARE_NO_AUTH === '1';
const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!declaredNoAuth) {
  if (!auth) {
    refuse(
      'FIREBASE_AUTH_EMULATOR_HOST is not set. Set it, or declare a Firestore-only ' +
        'run with WSF_TEST_DECLARE_NO_AUTH=1 — which asserts nothing about Auth.'
    );
  }
  if (!LOOPBACK.test(auth)) {
    refuse(`FIREBASE_AUTH_EMULATOR_HOST "${auth}" is not a loopback address.`);
  }
}

// An unset email key is not proof that no external request is possible — it
// is one variable. So the harness BLOCKS them: any fetch to a non-loopback
// host throws. That covers the email sender, any SDK that falls back to HTTP,
// and anything added later that nobody remembered to check.
if (process.env.WSF_EMAIL_API_KEY) {
  refuse('WSF_EMAIL_API_KEY is set. Tests must not be able to send real email.');
}

const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|::1|0\.0\.0\.0)$/;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let host = '';
    try {
      host = new URL(raw).hostname;
    } catch {
      host = '';
    }
    if (host && !LOOPBACK_HOST.test(host)) {
      throw new Error(
        `WSF TEST BLOCKED AN EXTERNAL REQUEST to ${host}. The local harness only permits ` +
          `loopback destinations. If a test needs this, it needs an emulator, not the internet.`
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

// eslint-disable-next-line no-console
console.info(
  `WSF test isolation OK — project ${project}, firestore ${firestore}, ` +
    `auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '<unset>'}`
);
