import React, { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordScreen from '../../app/(auth)/reset-password';

const mocks = vi.hoisted(() => ({
  params: {} as Record<string, string | string[] | undefined>,
  replace: vi.fn(), verify: vi.fn(), confirm: vi.fn(), auth: {},
}));
vi.mock('expo-router', () => ({ router: { replace: mocks.replace }, useLocalSearchParams: () => mocks.params }));
vi.mock('expo-router/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('../../lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('firebase/auth', () => ({ verifyPasswordResetCode: mocks.verify, confirmPasswordReset: mocks.confirm }));

// Expo resolves this static asset in production; Node does not load PNG modules.
const require = createRequire(import.meta.url);
const originalPngLoader = require.extensions['.png'];
require.extensions['.png'] = (module) => { module.exports = 'test-logo'; };
afterAll(() => {
  if (originalPngLoader) require.extensions['.png'] = originalPngLoader;
  else delete require.extensions['.png'];
});

let root: Root;
let host: HTMLDivElement;
const fakePassword = 'Synthetic-test-password-only!';
const text = () => host.textContent ?? '';
const button = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const input = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function render() { await act(async () => { root.render(<ResetPasswordScreen />); }); }
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function type(label: string, value: string) {
  await act(async () => {
    const field = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function fill(password = fakePassword, confirmation = password) {
  await type('New password', password);
  await type('Confirm new password', confirmation);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Fail closed if this mocked suite ever tries to reach a real provider.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in reset tests'); }));
  mocks.params = { mode: 'resetPassword', oobCode: 'synthetic-reset-code' };
  mocks.verify.mockResolvedValue('synthetic@example.invalid');
  mocks.confirm.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('public password reset route (mock Firebase only)', () => {
  it('hydrates query-free exported HTML opened with a reset query without regenerating the tree', async () => {
    await act(async () => { root.unmount(); });
    mocks.params = {};
    host.innerHTML = renderToString(<ResetPasswordScreen />);
    expect(text()).toContain('Checking your reset link');
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.params = { mode: 'resetPassword', oobCode: 'synthetic-hydration-code' };
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(host, <ResetPasswordScreen />, { onRecoverableError: error => recoverableErrors.push(error) });
    });
    expect(recoverableErrors).toEqual([]);
    expect(input('New password')).not.toBeNull();
    expect(mocks.verify).toHaveBeenCalledWith(mocks.auth, 'synthetic-hydration-code');
  });

  it.each([
    {},
    { mode: 'resetPassword' },
    { mode: 'resetPassword', oobCode: '' },
    { mode: 'resetPassword', oobCode: ['synthetic-one', 'synthetic-two'] },
  ])('rejects missing/ambiguous codes without contacting Firebase: %j', async params => {
    mocks.params = params;
    await render();
    expect(text()).toContain('missing or incomplete');
    expect(input('New password')).toBeNull();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it.each(['verifyEmail', 'recoverEmail', '', ['resetPassword', 'verifyEmail']])('rejects an unexpected action mode: %j', async mode => {
    mocks.params.mode = mode;
    await render();
    expect(text()).toContain('not a valid password reset link');
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('verifies before presenting the form and only confirms on a deliberate submission', async () => {
    const check = deferred<string>();
    mocks.verify.mockReturnValueOnce(check.promise);
    await render();
    expect(text()).toContain('Checking your reset link');
    expect(input('New password')).toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
    await act(async () => { check.resolve('synthetic@example.invalid'); });
    expect(mocks.verify).toHaveBeenCalledWith(mocks.auth, 'synthetic-reset-code');
    expect(text()).not.toContain('synthetic@example.invalid');
    expect(input('New password').type).toBe('password');
    await fill();
    await click('Update password');
    expect(mocks.confirm).toHaveBeenCalledWith(mocks.auth, 'synthetic-reset-code', fakePassword);
    expect(text()).toContain('Password updated');
    expect(input('New password')).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/expired-action-code', 'has expired'],
    ['auth/invalid-action-code', 'invalid or has already been used'],
    ['auth/user-disabled', 'invalid or has already been used'],
    ['auth/user-not-found', 'invalid or has already been used'],
  ])('handles unavailable links safely: %s', async (code, expected) => {
    mocks.verify.mockRejectedValueOnce({ code, message: 'sensitive synthetic detail' });
    await render();
    expect(text()).toContain(expected);
    expect(text()).not.toContain('sensitive synthetic detail');
    expect(input('New password')).toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('offers verification retry after an offline failure', async () => {
    mocks.verify.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await render();
    expect(text()).toContain('Check your connection');
    await click('Check reset link again');
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(input('New password')).not.toBeNull();
  });

  it.each([
    ['', '', 'Enter a new password'],
    ['      ', '      ', 'Enter a new password'],
    ['short', 'short', 'at least 6 characters'],
    [fakePassword, '', 'Confirm your new password'],
    [fakePassword, 'different synthetic password', 'do not match'],
  ])('validates password and confirmation without a write', async (password, confirmation, expected) => {
    await render();
    await fill(password, confirmation);
    await click('Update password');
    expect(text()).toContain(expected);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('prevents duplicate click/Enter submissions while the first write is pending', async () => {
    const write = deferred<void>();
    mocks.confirm.mockReturnValueOnce(write.promise);
    await render();
    await fill();
    await act(async () => {
      input('Confirm new password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      button('Update password').click();
      button('Update password').click();
    });
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(input('New password').readOnly).toBe(true);
    expect(button('Update password').getAttribute('aria-disabled')).toBe('true');
    await act(async () => { write.resolve(); });
    expect(text()).toContain('Password updated');
  });

  it.each(['auth/weak-password', 'auth/password-does-not-meet-requirements'])('allows correction after server policy rejection: %s', async code => {
    mocks.confirm.mockRejectedValueOnce({ code });
    await render();
    await fill();
    await click('Update password');
    expect(text()).toContain('stronger password');
    expect(input('New password').value).toBe('');
    expect(input('Confirm new password').value).toBe('');
    await fill();
    await click('Update password');
    expect(text()).toContain('Password updated');
  });

  it('handles a code used/expired after verification, without claiming success', async () => {
    mocks.confirm.mockRejectedValueOnce({ code: 'auth/invalid-action-code' });
    await render();
    await fill();
    await click('Update password');
    expect(text()).toContain('invalid or has already been used');
    expect(text()).not.toContain('Password updated');
    expect(input('New password')).toBeNull();
  });

  it('reports an uncertain network write without success, clears fields, and allows sign-in', async () => {
    mocks.confirm.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await render();
    await fill();
    await click('Update password');
    expect(text()).toContain('try signing in first');
    expect(text()).not.toContain('Password updated');
    expect(input('New password').value).toBe('');
    await click('Back to sign in');
    expect(mocks.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('does not treat a slow write as failure or unlock another submission', async () => {
    const write = deferred<void>();
    mocks.confirm.mockReturnValueOnce(write.promise);
    await render();
    await fill();
    vi.useFakeTimers();
    await click('Update password');
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(text()).toContain('do not submit again');
    expect(button('Update password').getAttribute('aria-disabled')).toBe('true');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve(); });
    expect(text()).toContain('Password updated');
  });

  it('ignores late verification when a newer link replaces it', async () => {
    const stale = deferred<string>();
    mocks.verify.mockReturnValueOnce(stale.promise);
    await render();
    mocks.params = {};
    await render();
    await act(async () => { stale.resolve('synthetic@example.invalid'); });
    expect(text()).toContain('missing or incomplete');
    expect(input('New password')).toBeNull();
  });

  it('ignores a late write after leaving the old link', async () => {
    const stale = deferred<void>();
    mocks.confirm.mockReturnValueOnce(stale.promise);
    await render();
    await fill();
    await click('Update password');
    mocks.params = {};
    await render();
    await act(async () => { stale.resolve(); });
    expect(text()).toContain('missing or incomplete');
    expect(text()).not.toContain('Password updated');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('rechecks the code on remount and refuses an already-used link', async () => {
    await render();
    await fill();
    await click('Update password');
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    mocks.verify.mockRejectedValueOnce({ code: 'auth/invalid-action-code' });
    await render();
    expect(text()).toContain('invalid or has already been used');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('ignores untrusted apiKey/continueUrl and returns only to the fixed sign-in route', async () => {
    mocks.params.apiKey = 'synthetic-untrusted-project';
    mocks.params.continueUrl = 'https://untrusted.example.invalid/';
    await render();
    await fill();
    await click('Update password');
    await click('Back to sign in');
    expect(mocks.verify).toHaveBeenCalledWith(mocks.auth, 'synthetic-reset-code');
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/(auth)/login');
  });
});
