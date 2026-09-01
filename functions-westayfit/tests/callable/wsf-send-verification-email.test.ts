/**
 * wsfSendVerificationEmail — link retargeting, auth guards, and the refusal to
 * run unconfigured.
 *
 * No emulator needed: every path asserted here returns or throws before any
 * Firestore access. Run:
 *   cd functions-westayfit && npm run test:callable
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';

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
