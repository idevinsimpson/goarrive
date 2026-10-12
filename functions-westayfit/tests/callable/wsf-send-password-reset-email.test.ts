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
 *   firebase emulators:exec --only firestore,auth --project demo-wsf-local \
 *     "npm run test:callable"
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
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

      // W9 R1: a failed send answers exactly as an unknown address does.
      await expect(wsfSendPasswordResetEmail.run(req({ email }))).resolves.toEqual({ accepted: true });
      expect(errorSpy).toHaveBeenCalledWith('[wsfSendPasswordResetEmail] provider rejected send', 500);
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

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL-STAGING-REPAIR: failure accounting, concurrency and the enumeration
// write pattern. Staging field test: a reset request answered `internal` with
// no message; a failed attempt also used to strand the retry behind the cooldown.
// ─────────────────────────────────────────────────────────────────────────────

describe('wsfSendPasswordResetEmail failure accounting (emulators)', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    setConfig();
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'stub' }) } as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
    for (const k of CONFIG_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k]!;
    }
  });

  async function known(tag: string) {
    const email = `pw-acct-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    await clearQuota(await emailHash(email));
    await createAccount(email, 'strongpassword');
    return email;
  }
  const quotaDoc = async (email: string) => (await getFirestore().doc(`wsfPasswordResetSends/${await emailHash(email)}`).get()).data();
  const noAddressLogged = (email: string) => {
    for (const call of errorSpy.mock.calls) for (const arg of call) expect(String(arg)).not.toContain(email);
  };

  /**
   * W9 R1 (Director #365 5964370581). The reset callable is public, so a send
   * that failed downstream for a KNOWN address must be indistinguishable from
   * an UNKNOWN address: the same response, the same quota writes, and the same
   * answer to the immediate retry. Otherwise a failing provider names which
   * addresses have accounts, in the first answer or one request later.
   */
  const FAILURES: Array<[string, () => void, string, unknown[]]> = [
    ['provider 422 (definite rejection)', () => fetchSpy.mockResolvedValueOnce({ ok: false, status: 422 } as never), 'provider rejected send', [422]],
    ['provider 500', () => fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 } as never), 'provider rejected send', [500]],
    ['provider 503', () => fetchSpy.mockResolvedValueOnce({ ok: false, status: 503 } as never), 'provider rejected send', [503]],
    ['an ambiguous transport failure', () => fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed')), 'provider outcome unknown', []],
    ['Admin link minting (auth/internal-error)', () => {
      jest.spyOn(getAdminAuth(), 'generatePasswordResetLink')
        .mockRejectedValueOnce(Object.assign(new Error('internal error for pw-acct-x@example.test'), { code: 'auth/internal-error' }));
    }, 'Admin SDK failed', ['auth/internal-error']],
    ['Admin link minting (auth/insufficient-permission, the staging gate)', () => {
      jest.spyOn(getAdminAuth(), 'generatePasswordResetLink')
        .mockRejectedValueOnce(Object.assign(new Error('no permission'), { code: 'auth/insufficient-permission' }));
    }, 'Admin SDK failed', ['auth/insufficient-permission']],
    ['an unusable minted link', () => {
      jest.spyOn(getAdminAuth(), 'generatePasswordResetLink').mockResolvedValueOnce('not a link');
    }, 'action link unusable', []],
  ];

  for (const [name, arm, log, logArgs] of FAILURES) {
    it(`R1: ${name} for a known address is indistinguishable from an unknown address (response, quota writes, retry), and is still classified server-side`, async () => {
      const knownEmail = await known(`r1-${name.length}`);
      const unknownEmail = `pw-none-r1-${name.length}-${Date.now()}@example.test`;
      await clearQuota(await emailHash(unknownEmail));

      arm();
      const k = await wsfSendPasswordResetEmail.run(req({ email: knownEmail })).catch((e) => e);
      jest.restoreAllMocks();
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'stub' }) } as never);
      const u = await wsfSendPasswordResetEmail.run(req({ email: unknownEmail })).catch((e) => e);

      // 1. The same answer.
      expect(k).toEqual({ accepted: true });
      expect(u).toEqual({ accepted: true });
      // 2. The same quota writes: both keep the reservation and count the attempt.
      const [kq, uq] = [await quotaDoc(knownEmail), await quotaDoc(unknownEmail)];
      expect(Object.keys(kq ?? {}).sort()).toEqual(Object.keys(uq ?? {}).sort());
      expect([kq?.countToday, uq?.countToday]).toEqual([1, 1]);
      expect(kq?.lastSentAt).toEqual(expect.any(Number));
      expect(uq?.lastSentAt).toEqual(expect.any(Number));
      // 3. The same immediate retry: both refused as too soon, with the same message shape.
      const kr = (await wsfSendPasswordResetEmail.run(req({ email: knownEmail })).catch((e) => e)) as HttpsError;
      const ur = (await wsfSendPasswordResetEmail.run(req({ email: unknownEmail })).catch((e) => e)) as HttpsError;
      expect([kr.code, ur.code]).toEqual(['resource-exhausted', 'resource-exhausted']);
      expect(kr.message.replace(/\d+/g, 'N')).toBe(ur.message.replace(/\d+/g, 'N'));
      // The retries sent nothing.
      expect(fetchSpy).not.toHaveBeenCalled();
      noAddressLogged(knownEmail);
      noAddressLogged(unknownEmail);
    });

    it(`R1: ${name} is classified in the server log by code or status only`, async () => {
      const email = await known(`r1-log-${name.length}`);
      arm();
      await expect(wsfSendPasswordResetEmail.run(req({ email }))).resolves.toEqual({ accepted: true });
      expect(errorSpy).toHaveBeenCalledWith(`[wsfSendPasswordResetEmail] ${log}`, ...logArgs);
      for (const call of errorSpy.mock.calls) for (const arg of call) {
        expect(String(arg)).not.toContain(email);
        expect(String(arg)).not.toMatch(/oobCode|apiKey=|test-key/);
      }
    });
  }

  it('R1: a known address whose send fails never answers internal, so a failing provider is not an account oracle', async () => {
    const email = await known('r1-never-internal');
    fetchSpy.mockResolvedValue({ ok: false, status: 403 } as never);
    const r = await wsfSendPasswordResetEmail.run(req({ email })).catch((e) => e);
    expect(r).not.toBeInstanceOf(HttpsError);
    expect(r).toEqual({ accepted: true });
  });

  it('a bad action-handler config fails closed BEFORE reserving: classified, nothing minted or sent, no cooldown', async () => {
    const email = await known('handler');
    const mint = jest.spyOn(getAdminAuth(), 'generatePasswordResetLink');
    process.env.WSF_AUTH_ACTION_HANDLER = 'not a handler.example.test';
    try {
      const caught = (await wsfSendPasswordResetEmail.run(req({ email })).catch((e) => e)) as HttpsError;
      expect(caught.code).toBe('failed-precondition');
      expect(caught.message).toMatch(/WSF_AUTH_ACTION_HANDLER/);
      expect(caught.message).not.toContain('handler.example.test');
      expect(errorSpy).toHaveBeenCalledWith('[wsf mail] invalid config', 'WSF_AUTH_ACTION_HANDLER');
      for (const call of errorSpy.mock.calls) for (const arg of call) expect(String(arg)).not.toContain('handler.example.test');
      expect(mint).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await quotaDoc(email)).toBeUndefined();
    } finally {
      delete process.env.WSF_AUTH_ACTION_HANDLER;
    }
    noAddressLogged(email);
    await expect(wsfSendPasswordResetEmail.run(req({ email }))).resolves.toEqual({ accepted: true });
  });

  it('unknown address KEEPS the reservation exactly as a real send does (no existence signal in the quota writes)', async () => {
    const unknown = `pw-none-${Date.now()}@example.test`;
    await clearQuota(await emailHash(unknown));
    const real = await known('real');
    await expect(wsfSendPasswordResetEmail.run(req({ email: unknown }))).resolves.toEqual({ accepted: true });
    await expect(wsfSendPasswordResetEmail.run(req({ email: real }))).resolves.toEqual({ accepted: true });
    const [u, k] = [await quotaDoc(unknown), await quotaDoc(real)];
    expect(Object.keys(u ?? {}).sort()).toEqual(Object.keys(k ?? {}).sort());
    expect([u?.countToday, k?.countToday]).toEqual([1, 1]);
    expect(u?.lastSentAt).toEqual(expect.any(Number));
    expect(k?.lastSentAt).toEqual(expect.any(Number));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('failed attempts still count toward the daily cap (the cooldown is kept, so each attempt waits it out)', async () => {
    const email = await known('cap');
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as never);
    const ref = getFirestore().doc(`wsfPasswordResetSends/${await emailHash(email)}`);
    for (let i = 0; i < 10; i += 1) {
      await expect(wsfSendPasswordResetEmail.run(req({ email }))).resolves.toEqual({ accepted: true });
      // Stand in for the cooldown passing; the day and its count stay as written.
      await ref.update({ lastSentAt: Date.now() - 61_000 });
    }
    const capped = (await wsfSendPasswordResetEmail.run(req({ email })).catch((e) => e)) as HttpsError;
    expect(capped.code).toBe('resource-exhausted');
    expect(capped.message).toMatch(/today/);
    expect(fetchSpy).toHaveBeenCalledTimes(10);
    expect((await quotaDoc(email))?.countToday).toBe(10);
  });

  it('concurrent requests for one address: exactly one sends', async () => {
    const email = await known('race');
    fetchSpy.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 150)); return { ok: true, status: 200 } as never; });
    const results = await Promise.allSettled([1, 2, 3].map(() => wsfSendPasswordResetEmail.run(req({ email }))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as HttpsError).code)).toEqual(['resource-exhausted', 'resource-exhausted']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('the address is normalized before the quota key, so case variants share one quota', async () => {
    const email = await known('case');
    await expect(wsfSendPasswordResetEmail.run(req({ email }))).resolves.toEqual({ accepted: true });
    expect(((await wsfSendPasswordResetEmail.run(req({ email: email.toUpperCase() })).catch((e) => e)) as HttpsError).code).toBe('resource-exhausted');
  });
});
