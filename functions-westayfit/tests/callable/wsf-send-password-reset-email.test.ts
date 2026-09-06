/**
 * wsfSendPasswordResetEmail — invalid-argument, missing-config, per-email
 * quota, and the whole enumeration case: an unknown email returns the same
 * success shape a real send does, and no Resend fetch fires.
 *
 * Runs against the Firestore + Auth emulators (gate1.sh adds `,auth` to the
 * callable step for this file). Auth emulator lets the "unknown email"
 * assertion be real: the Admin SDK's generatePasswordResetLink throws
 * auth/user-not-found for an account that was never created, exactly the path
 * the callable is designed to swallow.
 *
 * Run:
 *   cd functions-westayfit
 *   firebase emulators:exec --only firestore,auth --project goarrive-test \
 *     "npm run test:callable"
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { wsfSendPasswordResetEmail } from '../../src/index';

const CONFIG_KEYS = ['WSF_EMAIL_API_KEY', 'WSF_EMAIL_FROM', 'WSF_APP_URL'] as const;

function req(data: Record<string, unknown>) {
  return { auth: null, data, rawRequest: {} } as never;
}

function setConfig() {
  process.env.WSF_EMAIL_API_KEY = 'test-key';
  process.env.WSF_EMAIL_FROM = 'westayfit@example.test';
  process.env.WSF_APP_URL = 'https://example.test';
}

function clearConfig() {
  for (const k of CONFIG_KEYS) delete process.env[k];
}

async function clearQuota(emailHash: string) {
  await getFirestore()
    .doc(`wsfPasswordResetSends/${emailHash}`)
    .delete()
    .catch(() => undefined);
}

async function clearAuthEmulator() {
  const base = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
  const url = `${base}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/accounts`;
  await fetch(url, { method: 'DELETE' }).catch(() => undefined);
}

async function createAccount(email: string, password: string) {
  const app = getAdminAuth();
  await app.createUser({ email, password });
}

/**
 * sha256 hex prefix that hashEmailForQuota uses — kept in sync with the
 * callable's Firestore key so cleanups target the right doc. Duplicating the
 * one-liner beats exporting private machinery for a test.
 */
async function emailHash(email: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

describe('wsfSendPasswordResetEmail', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await clearAuthEmulator();
  });

  beforeEach(() => {
    setConfig();
    // Stub global fetch so a stray Resend POST would be observable and
    // couldn't reach the internet from a test box. Happy-path tests below
    // return { ok: true }; unknown-email tests assert this was never called.
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'stub' }),
    } as never);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const k of CONFIG_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k]!;
    }
  });

  it('rejects a missing email with invalid-argument', async () => {
    const caught: unknown = await wsfSendPasswordResetEmail
      .run(req({}))
      .catch((e) => e);
    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('invalid-argument');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with invalid-argument', async () => {
    const caught: unknown = await wsfSendPasswordResetEmail
      .run(req({ email: 'not-an-email' }))
      .catch((e) => e);
    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('invalid-argument');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to run unconfigured with failed-precondition, before any Firestore write', async () => {
    clearConfig();
    const email = `pw-reset-unconfigured-${Date.now()}@example.test`;
    const hash = await emailHash(email);
    // Sanity — start from a clean quota doc.
    await clearQuota(hash);

    const caught: unknown = await wsfSendPasswordResetEmail
      .run(req({ email }))
      .catch((e) => e);
    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('failed-precondition');
    expect((caught as HttpsError).message).toMatch(
      /WSF_EMAIL_API_KEY.*WSF_EMAIL_FROM.*WSF_APP_URL/
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    // The unconfigured path must not write the quota doc. Otherwise a caller
    // could burn someone's per-email quota on a build that literally cannot
    // send mail.
    const snap = await getFirestore().doc(`wsfPasswordResetSends/${hash}`).get();
    expect(snap.exists).toBe(false);
  });

  it('unknown email returns { accepted: true } and does not call Resend', async () => {
    const email = `pw-reset-unknown-${Date.now()}@example.test`;
    await clearQuota(await emailHash(email));

    const result = await wsfSendPasswordResetEmail.run(req({ email }));

    // The whole enumeration case: same shape as a real send.
    expect(result).toEqual({ accepted: true });
    // Never minted a link that got POSTed to Resend.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('per-email cooldown: a second request inside SEND_COOLDOWN_MS is refused', async () => {
    const email = `pw-reset-quota-${Date.now()}@example.test`;
    const hash = await emailHash(email);
    await clearQuota(hash);

    // First request establishes the marker. Uses the unknown-email path so
    // the test does not depend on Resend at all — the quota check runs
    // BEFORE the Auth call, so it fires either way.
    const first = await wsfSendPasswordResetEmail.run(req({ email }));
    expect(first).toEqual({ accepted: true });

    // Immediate retry inside the cooldown must throw resource-exhausted.
    const caught: unknown = await wsfSendPasswordResetEmail
      .run(req({ email }))
      .catch((e) => e);
    expect(caught).toBeInstanceOf(HttpsError);
    expect((caught as HttpsError).code).toBe('resource-exhausted');
  });

  it('known email mints a link and POSTs it to Resend, returning { accepted: true }', async () => {
    const email = `pw-reset-known-${Date.now()}@example.test`;
    await clearQuota(await emailHash(email));
    await createAccount(email, 'strongpassword');

    const result = await wsfSendPasswordResetEmail.run(req({ email }));
    expect(result).toEqual({ accepted: true });

    // Exactly one POST to Resend. Body carries the reset link (never asserted
    // exact — the Admin SDK mints a per-run oobCode — only that it points at
    // the retargeted handler, and that the recipient matches.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [urlArg, initArg] = fetchSpy.mock.calls[0]! as [
      string,
      { method: string; body: string; headers: Record<string, string> },
    ];
    expect(urlArg).toBe('https://api.resend.com/emails');
    expect(initArg.method).toBe('POST');
    const body = JSON.parse(initArg.body) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
    };
    expect(body.to).toEqual([email]);
    expect(body.subject).toMatch(/reset/i);
    expect(body.text).toContain('/__/auth/action?');
    expect(body.text).toContain('oobCode=');
  });

  it('never logs the email address on the failure paths', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // Force the provider to reject so the error-log path fires.
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as never);
      const email = `pw-reset-log-${Date.now()}@example.test`;
      await clearQuota(await emailHash(email));
      await createAccount(email, 'strongpassword');

      const caught: unknown = await wsfSendPasswordResetEmail
        .run(req({ email }))
        .catch((e) => e);
      expect(caught).toBeInstanceOf(HttpsError);
      expect((caught as HttpsError).code).toBe('internal');
      for (const call of errorSpy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(email);
        }
      }
    } finally {
      errorSpy.mockRestore();
    }
  });
});
