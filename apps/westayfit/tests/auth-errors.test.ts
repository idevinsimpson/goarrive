import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { authErrorCode, authErrorMessage, isEmailAlreadyInUse } from '../src/authErrors';

const APP_ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(APP_ROOT, rel), 'utf-8');

/** Shaped like a real FirebaseError: a code plus the vendor-prefixed message. */
const fbError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code });

describe('auth error messages', () => {
  it('never shows a member the raw Firebase string', () => {
    for (const code of [
      'auth/email-already-in-use',
      'auth/too-many-requests',
      'auth/wrong-password',
      'auth/invalid-email',
      'auth/network-request-failed',
      'auth/some-code-we-have-not-mapped',
    ]) {
      const shown = authErrorMessage(fbError(code), 'Sign-up failed.');
      expect(shown, code).not.toContain('Firebase:');
      expect(shown, code).not.toMatch(/^Firebase/);
    }
  });

  // The one that matters most. WSF and GoArrive share an Auth pool, so every
  // existing GoArrive member and coach already owns their address here — and
  // they are the likeliest people to be handed a WSF invite. Telling them to
  // "create an account" is telling them to do the one thing that cannot work.
  it('tells an existing GoArrive user to sign in', () => {
    const shown = authErrorMessage(fbError('auth/email-already-in-use'), 'Sign-up failed.');
    expect(shown).toMatch(/sign in/i);
    expect(shown).toMatch(/GoArrive/);
    expect(isEmailAlreadyInUse(fbError('auth/email-already-in-use'))).toBe(true);
    expect(isEmailAlreadyInUse(fbError('auth/wrong-password'))).toBe(false);
  });

  it('explains the throttle instead of naming it', () => {
    const shown = authErrorMessage(fbError('auth/too-many-requests'), 'Send failed.');
    expect(shown).toMatch(/wait/i);
    expect(shown).not.toContain('too-many-requests');
  });

  it('keeps an unmapped code visible for us without leading with it', () => {
    const shown = authErrorMessage(fbError('auth/brand-new-code'), 'Sign-in failed.');
    expect(shown.startsWith('Sign-in failed.')).toBe(true);
    expect(shown).toContain('auth/brand-new-code');
  });

  it('falls back cleanly when there is no code at all', () => {
    expect(authErrorMessage(new Error('boom'), 'Sign-up failed.')).toBe('Sign-up failed.');
    expect(authErrorMessage('not an error', 'Sign-up failed.')).toBe('Sign-up failed.');
    expect(authErrorCode({})).toBeNull();
  });
});

describe('the auth screens all route errors through the mapper', () => {
  // A screen that forgets and falls back to e.message reintroduces the raw
  // vendor string on exactly the path nobody tests by hand.
  for (const screen of ['app/signup.tsx', 'app/signin.tsx', 'app/verify-email.tsx']) {
    it(`${screen} does not render e.message directly`, () => {
      const src = read(screen);
      expect(src).toContain('authErrorMessage');
      expect(src).not.toMatch(/setError\(\s*e instanceof Error \? e\.message/);
    });
  }
});
