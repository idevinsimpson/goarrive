import { afterEach, describe, expect, it, vi } from 'vitest';

import { REPLAY_OFFLINE_NOTICE, refreshSignIn, SIGN_IN_REFRESH_TIMEOUT_MS } from '../src/contributionFlow';

/**
 * W13-2 (ST-06): refreshing the sign-in before a replay, classified. The
 * classifier decides whether a replay goes ('ok'), is held as offline, or is
 * held as signed out — and only Auth's own "this session is over" codes may
 * say signed out.
 */
const authWith = (getIdToken: (force?: boolean) => Promise<string>) => ({ currentUser: { getIdToken: vi.fn(getIdToken) } });
const failing = (code: string) => authWith(async () => {
  throw Object.assign(new Error(code), { code });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshSignIn', () => {
  it('a fresh token is ok, and the refresh is forced', async () => {
    const auth = authWith(async () => 'token');
    expect(await refreshSignIn(auth, 1_000)).toBe('ok');
    expect(auth.currentUser.getIdToken).toHaveBeenCalledWith(true);
  });

  it('no signed-in user is signed out', async () => {
    expect(await refreshSignIn({ currentUser: null }, 1_000)).toBe('signedOut');
  });

  for (const code of ['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token', 'auth/user-not-found']) {
    it(`${code} is signed out`, async () => {
      expect(await refreshSignIn(failing(code), 1_000)).toBe('signedOut');
    });
  }

  it('a network failure is offline, not signed out', async () => {
    expect(await refreshSignIn(failing('auth/network-request-failed'), 1_000)).toBe('offline');
  });

  it('any other failure is not proof of a sign-out: offline', async () => {
    expect(await refreshSignIn(failing('auth/internal-error'), 1_000)).toBe('offline');
    expect(await refreshSignIn(authWith(async () => Promise.reject(new Error('no code'))), 1_000)).toBe('offline');
  });

  it('no answer within the bound is offline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let answer: unknown = 'waiting';
    void refreshSignIn(authWith(() => new Promise<string>(() => undefined)), SIGN_IN_REFRESH_TIMEOUT_MS).then((r) => (answer = r));
    await vi.advanceTimersByTimeAsync(SIGN_IN_REFRESH_TIMEOUT_MS - 10);
    expect(answer).toBe('waiting');
    await vi.advanceTimersByTimeAsync(20);
    expect(answer).toBe('offline');
  });

  it('the offline line is the app’s existing connection sentence (no new copy)', () => {
    expect(REPLAY_OFFLINE_NOTICE).toBe('We couldn’t reach the server. Check your connection and try again.');
  });
});
