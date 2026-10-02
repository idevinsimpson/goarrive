/**
 * wsfSendVerificationEmail — link retargeting, auth guards, and the refusal to
 * run unconfigured.
 *
 * The guard cases return or throw before any Firestore access. The send cases
 * (EMAIL-STAGING-REPAIR) run against the Firestore + Auth emulators, as the
 * reset suite does (gate1.sh runs the callable step under `firestore,auth`):
 *   firebase emulators:exec --only firestore,auth --project demo-wsf-local \
 *     "npm --prefix functions-westayfit run test:callable"
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { retargetActionLink, wsfSendVerificationEmail } from '../../src/index';

const HANDLER = 'https://goarrive.firebaseapp.com/__/auth/action';

/** Minimal shape of the v2 callable request the handler actually reads. */
function req(auth: unknown) {
  return { auth, data: undefined, rawRequest: {} } as never;
}

const CONFIG_KEYS = ['WSF_EMAIL_API_KEY', 'WSF_EMAIL_FROM', 'WSF_APP_URL'] as const;

function clearConfig() {
  for (const k of CONFIG_KEYS) delete process.env[k];
}

describe('retargetActionLink', () => {
  // The whole point: the oobCode and apiKey live in the query string, and the
  // link is worthless if either is altered. Only origin and path change.
  it('preserves the query string exactly and swaps only the handler', () => {
    const minted =
      'https://goarrive.web.app/reset-password?mode=verifyEmail&oobCode=ABC-123_xyz&apiKey=AIzaTEST&lang=en';
    const out = new URL(retargetActionLink(minted, HANDLER));

    expect(out.origin).toBe('https://goarrive.firebaseapp.com');
    expect(out.pathname).toBe('/__/auth/action');
    expect(out.searchParams.get('mode')).toBe('verifyEmail');
    expect(out.searchParams.get('oobCode')).toBe('ABC-123_xyz');
    expect(out.searchParams.get('apiKey')).toBe('AIzaTEST');
    expect(out.searchParams.get('lang')).toBe('en');
  });

  it('does not mangle percent-encoded parameters', () => {
    const minted =
      'https://goarrive.web.app/reset-password?mode=verifyEmail&oobCode=a%2Bb%2Fc%3D&continueUrl=https%3A%2F%2Fexample.com%2Fx%3Fy%3D1';
    const out = new URL(retargetActionLink(minted, HANDLER));
    expect(out.searchParams.get('oobCode')).toBe('a+b/c=');
    expect(out.searchParams.get('continueUrl')).toBe('https://example.com/x?y=1');
  });

  it('is idempotent — retargeting an already-correct link is a no-op', () => {
    const already = `${HANDLER}?mode=verifyEmail&oobCode=Z9`;
    expect(retargetActionLink(already, HANDLER)).toBe(already);
  });
});

describe('wsfSendVerificationEmail guards', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of CONFIG_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(wsfSendVerificationEmail.run(req(null))).rejects.toBeInstanceOf(HttpsError);
  });

  it('rejects an account with no email address', async () => {
    const p = wsfSendVerificationEmail.run(req({ uid: 'u1', token: {} }));
    await expect(p).rejects.toThrow(/no email address/i);
  });

  // Not an error worth alarming anyone about — they are already done.
  it('short-circuits when the address is already verified', async () => {
    const result = await wsfSendVerificationEmail.run(
      req({ uid: 'u1', token: { email: 'a@example.com', email_verified: true } })
    );
    expect(result).toEqual({ sent: false, reason: 'already-verified' });
  });

  // The guard that matters most: a guessed sender fails DMARC and burns the
  // real domain's reputation on the way out, so refusing to run beats
  // defaulting to anything.
  it('refuses to run unconfigured, and names every missing key', async () => {
    clearConfig();
    const p = wsfSendVerificationEmail.run(
      req({ uid: 'u1', token: { email: 'a@example.com', email_verified: false } })
    );
    await expect(p).rejects.toThrow(/WSF_EMAIL_API_KEY.*WSF_EMAIL_FROM.*WSF_APP_URL/);
  });

  it('still refuses when only the sender is missing', async () => {
    clearConfig();
    process.env.WSF_EMAIL_API_KEY = 'test-key';
    process.env.WSF_APP_URL = 'https://example.test';
    const p = wsfSendVerificationEmail.run(
      req({ uid: 'u1', token: { email: 'a@example.com', email_verified: false } })
    );
    await expect(p).rejects.toThrow(/WSF_EMAIL_FROM/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL-STAGING-REPAIR: the send path, its quota accounting and its failures.
// Staging field test: "Didn't send", then a resend refused as resource-exhausted
// although nothing had left — the quota was spent before anything was sent.
// ─────────────────────────────────────────────────────────────────────────────

describe('wsfSendVerificationEmail send path (emulators)', () => {
  const saved = { ...process.env };
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.WSF_EMAIL_API_KEY = 'test-key';
    process.env.WSF_EMAIL_FROM = 'westayfit@example.test';
    process.env.WSF_APP_URL = 'https://example.test';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'stub' }) } as never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(getAdminAuth(), 'generateEmailVerificationLink').mockResolvedValue('https://example.test/verify?mode=verifyEmail&oobCode=STUB-CODE&apiKey=STUB');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
    jest.restoreAllMocks();
    for (const k of CONFIG_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /**
   * An unverified caller (the shape its ID token gives) with a clean quota. Link minting is stubbed with a fixed
   * minted link: what these cases test is the quota accounting and failure handling around it, and the reset suite's
   * beforeAll clears every Auth-emulator account, which would race a real account created here when suites run in
   * parallel. The real Admin call is exercised by the reset suite.
   */
  async function member(tag: string) {
    const email = `verify-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const uid = `uid-${tag}-${Math.random().toString(36).slice(2, 10)}`;
    await getFirestore().doc(`wsfVerificationSends/${uid}`).delete().catch(() => undefined);
    return { email, uid, call: () => wsfSendVerificationEmail.run(req({ uid, token: { email, email_verified: false } })) };
  }
  const quotaDoc = async (uid: string) => (await getFirestore().doc(`wsfVerificationSends/${uid}`).get()).data();
  const noAddressLogged = (email: string) => {
    for (const call of errorSpy.mock.calls) for (const arg of call) expect(String(arg)).not.toContain(email);
  };

  it('success: mints the link, POSTs it once to the caller\'s own address, and keeps the cooldown', async () => {
    const m = await member('ok');
    await expect(m.call()).resolves.toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(init.body) as { to: string[]; text: string };
    expect(body.to).toEqual([m.email]);
    // The minted link is retargeted at the action handler with its query string intact.
    expect(body.text).toContain('/__/auth/action?mode=verifyEmail&oobCode=STUB-CODE&apiKey=STUB');
    expect(getAdminAuth().generateEmailVerificationLink).toHaveBeenCalledWith(m.email, { url: 'https://example.test', handleCodeInApp: false });
    expect((await quotaDoc(m.uid))?.lastSentAt).toEqual(expect.any(Number));
    expect((await quotaDoc(m.uid))?.countToday).toBe(1);
    // A second request inside the cooldown is refused, and nothing is sent.
    const caught = (await m.call().catch((e) => e)) as HttpsError;
    expect(caught.code).toBe('resource-exhausted');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('provider rejection: internal, no "sent" result, the cooldown is given back, and an immediate retry sends', async () => {
    const m = await member('reject');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 403 } as never);
    const caught = (await m.call().catch((e) => e)) as HttpsError;
    expect(caught).toBeInstanceOf(HttpsError);
    expect(caught.code).toBe('internal');
    expect(errorSpy).toHaveBeenCalledWith('[wsfSendVerificationEmail] provider rejected send', 403);
    const after = await quotaDoc(m.uid);
    expect(after?.lastSentAt).toBeUndefined();
    expect(after?.countToday).toBe(1);
    // The field-test failure: this retry used to be refused as resource-exhausted.
    await expect(m.call()).resolves.toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    noAddressLogged(m.email);
  });

  it('a network failure is classified as status 0, released, and retryable', async () => {
    const m = await member('network');
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(((await m.call().catch((e) => e)) as HttpsError).code).toBe('internal');
    expect(errorSpy).toHaveBeenCalledWith('[wsfSendVerificationEmail] provider rejected send', 0);
    await expect(m.call()).resolves.toEqual({ sent: true });
    noAddressLogged(m.email);
  });

  it('Admin link-minting failure: internal with the code only, nothing POSTed, released and retryable', async () => {
    const m = await member('admin');
    (getAdminAuth().generateEmailVerificationLink as unknown as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error(`continue URL refused for ${m.email}`), { code: 'auth/unauthorized-continue-uri' }));
    expect(((await m.call().catch((e) => e)) as HttpsError).code).toBe('internal');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[wsfSendVerificationEmail] Admin SDK failed', 'auth/unauthorized-continue-uri');
    noAddressLogged(m.email);
    await expect(m.call()).resolves.toEqual({ sent: true });
  });

  it('a slow failed attempt never releases a NEWER reservation (no cooldown bypass)', async () => {
    const m = await member('newer');
    const ref = getFirestore().doc(`wsfVerificationSends/${m.uid}`);
    const newer = Date.now() + 120_000;
    // While this attempt is in flight past the cooldown, another request reserves; then this attempt fails.
    fetchSpy.mockImplementationOnce(async () => { await ref.set({ lastSentAt: newer }, { merge: true }); return { ok: false, status: 503 } as never; });
    expect(((await m.call().catch((e) => e)) as HttpsError).code).toBe('internal');
    expect((await quotaDoc(m.uid))?.lastSentAt).toBe(newer);
  });

  it('failed attempts still count toward the daily cap, so failures cannot hammer the provider', async () => {
    const m = await member('cap');
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as never);
    for (let i = 0; i < 10; i += 1) expect(((await m.call().catch((e) => e)) as HttpsError).code).toBe('internal');
    const capped = (await m.call().catch((e) => e)) as HttpsError;
    expect(capped.code).toBe('resource-exhausted');
    expect(capped.message).toMatch(/today/);
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  it('concurrent requests: the reservation is atomic, exactly one sends', async () => {
    const m = await member('race');
    fetchSpy.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 150)); return { ok: true, status: 200 } as never; });
    const results = await Promise.allSettled([m.call(), m.call(), m.call()]);
    const sent = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as HttpsError).code);
    expect(sent).toHaveLength(1);
    expect(refused).toEqual(['resource-exhausted', 'resource-exhausted']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('the address comes from the token only: a body address is ignored', async () => {
    const m = await member('relay');
    await expect(wsfSendVerificationEmail.run({ auth: { uid: m.uid, token: { email: m.email, email_verified: false } }, data: { email: 'victim@example.test' }, rawRequest: {} } as never)).resolves.toEqual({ sent: true });
    expect((JSON.parse((fetchSpy.mock.calls[0] as [string, { body: string }])[1].body) as { to: string[] }).to).toEqual([m.email]);
  });
});
