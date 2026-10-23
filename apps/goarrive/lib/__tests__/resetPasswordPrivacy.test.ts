import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterResetPasswordTelemetry } from '../resetPasswordPrivacy';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('reset password telemetry privacy', () => {
  it('preserves ordinary events, including diagnostics about password validation', () => {
    const event = { message: 'Password validation failed', request: { url: 'https://example.test/login' } };
    expect(filterResetPasswordTelemetry(event)).toBe(event);
  });

  it.each([
    '/reset-password',
    '/reset-password/',
    '/reset-password.html',
    '/reset-password?mode=resetPassword&oobCode=synthetic-code-not-valid',
    '/anything?oobCode=synthetic-code-not-valid',
  ])('drops all telemetry while the current page is %s', (path) => {
    vi.stubGlobal('window', { location: { href: `https://example.test${path}` } });
    expect(filterResetPasswordTelemetry({ message: 'Unrelated error' })).toBeNull();
  });

  it.each([
    { request: { url: 'https://example.test/reset-password?oobCode=synthetic-code-not-valid' } },
    { category: 'navigation', data: { from: '/reset-password', to: '/login' } },
    { category: 'navigation', data: { from: '/login', to: '/anything?oobCode=synthetic-code-not-valid' } },
    { spans: [{ data: { url: 'https://example.test/?oobCode=synthetic-code-not-valid' } }] },
    { extra: { link: encodeURIComponent('https://example.test/reset-password?oobCode=synthetic-code-not-valid') } },
    { extra: { link: encodeURIComponent(encodeURIComponent('/anything?oobCode=synthetic-code-not-valid')) } },
    { extra: { oobCode: 'synthetic-code-not-valid' } },
    { extra: { newPassword: 'synthetic-password-not-used' } },
    new Error('Failed https://example.test/?oobCode=synthetic-code-not-valid'),
  ])('drops nested reset credentials even after leaving the page (%#)', (record) => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/login' } });
    expect(filterResetPasswordTelemetry(record)).toBeNull();
  });

  it('works without browser globals and safely handles circular records', () => {
    vi.stubGlobal('window', undefined);
    const event: { message: string; extra?: unknown } = { message: 'Ordinary native error' };
    event.extra = event;
    expect(filterResetPasswordTelemetry(event)).toBe(event);
  });

  it('fails closed if an unexpected diagnostic property cannot be read', () => {
    const event = Object.defineProperty({}, 'extra', {
      enumerable: true,
      get: () => { throw new Error('Synthetic getter failure'); },
    });
    expect(filterResetPasswordTelemetry(event)).toBeNull();
  });

  it('wires the same guard into breadcrumbs, errors, and transactions', async () => {
    const init = vi.fn();
    vi.doMock('@sentry/react-native', () => ({ init }));
    vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', 'https://synthetic.invalid/1');
    vi.stubGlobal('__DEV__', false);
    const { initSentry } = await import('../sentry');
    initSentry();
    const options = init.mock.calls[0][0];
    const record = { request: { url: '/reset-password?oobCode=synthetic-code-not-valid' } };
    expect(options.beforeBreadcrumb(record)).toBeNull();
    expect(options.beforeSend(record)).toBeNull();
    expect(options.beforeSendTransaction(record)).toBeNull();
    vi.doUnmock('@sentry/react-native');
  });
});
