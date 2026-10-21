import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-1 (MF-13). The keyboard's Go (native) and Enter (web:
 * react-native-web turns Enter into onSubmitEditing) called onSubmit directly,
 * past the guards that existed only on the buttons: a 6-7 character password
 * created an account, and two quick presses submitted twice. The guards now
 * live in onSubmit on sign-up, sign-in and reset-password.
 *
 * DELIBERATELY BOTH PLATFORMS: this is a named web change too. The screens
 * are rendered whole with react-native-web in jsdom, and Enter is pressed on
 * the inputs exactly as a browser would deliver it.
 */

vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
const replace = vi.fn();
vi.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => replace(...a), push: vi.fn() },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setParams: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
const createUser = vi.fn();
const signIn = vi.fn();
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a: unknown[]) => createUser(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => signIn(...a),
  updateProfile: () => Promise.resolve(),
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: () => Promise.resolve({ exists: () => true }),
}));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}), getFirebaseFirestore: () => ({}), wsfIsStaging: false }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: () => Promise.resolve({ sent: true }) }));
const requestReset = vi.fn();
vi.mock('../src/passwordResetEmail', () => ({ requestPasswordResetEmail: (...a: unknown[]) => requestReset(...a) }));

const { default: SignUp } = await import('../app/signup');
const { default: SignIn } = await import('../app/signin');
const { default: ResetPassword } = await import('../app/reset-password');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  replace.mockReset();
  createUser.mockReset();
  signIn.mockReset();
  requestReset.mockReset();
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
function input(testID: string): HTMLInputElement {
  const el = container.querySelector(`[data-testid="${testID}"]`) as HTMLElement | null;
  expect(el, testID).not.toBeNull();
  const found = el!.tagName === 'INPUT' ? el : el!.querySelector('input');
  expect(found, `${testID} input`).not.toBeNull();
  return found as HTMLInputElement;
}
function type(testID: string, value: string): void {
  const el = input(testID);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Enter, as a browser delivers it; react-native-web turns it into onSubmitEditing. */
function enter(testID: string): void {
  input(testID).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
async function render(node: ReactNode): Promise<void> {
  act(() => {
    root.render(node);
  });
  await flush();
}
const text = () => container.textContent ?? '';

describe('W16-1 / MF-13: sign-up', () => {
  it('(1) Enter with a 7-character password creates nothing, and the rule is still shown', async () => {
    createUser.mockResolvedValue({ user: { uid: 'u1' } });
    await render(<SignUp />);
    type('wsf-signup-displayName', 'Alex');
    type('wsf-signup-email', 'alex@example.com');
    type('wsf-signup-password', '1234567');
    act(() => enter('wsf-signup-password'));
    await flush();
    expect(createUser).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="wsf-signup-password-hint"]')!.textContent).toContain('At least 8 characters');
  });

  it('Enter with a missing name or address creates nothing either', async () => {
    await render(<SignUp />);
    type('wsf-signup-email', 'alex@example.com');
    type('wsf-signup-password', '12345678');
    act(() => enter('wsf-signup-password'));
    await flush();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('(2) two Enters in one tick with valid fields create exactly one account', async () => {
    let finish!: (v: unknown) => void;
    createUser.mockImplementation(() => new Promise((res) => (finish = res)));
    await render(<SignUp />);
    type('wsf-signup-displayName', 'Alex');
    type('wsf-signup-email', 'alex@example.com');
    type('wsf-signup-password', '12345678');
    act(() => {
      enter('wsf-signup-password');
      enter('wsf-signup-password');
    });
    await flush();
    expect(createUser).toHaveBeenCalledTimes(1);
    await act(async () => finish({ user: { uid: 'u1' } }));
    await flush();
    expect(text()).not.toMatch(/already in use|already exists/i);
  });

  it('a failed attempt releases the latch: the next Enter tries again', async () => {
    createUser.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }));
    createUser.mockResolvedValueOnce({ user: { uid: 'u1' } });
    await render(<SignUp />);
    type('wsf-signup-displayName', 'Alex');
    type('wsf-signup-email', 'alex@example.com');
    type('wsf-signup-password', '12345678');
    act(() => enter('wsf-signup-password'));
    await flush();
    act(() => enter('wsf-signup-password'));
    await flush();
    expect(createUser).toHaveBeenCalledTimes(2);
  });
});

describe('W16-1 / MF-13: sign-in', () => {
  it('(4) Enter with an empty password signs nobody in', async () => {
    await render(<SignIn />);
    type('wsf-signin-email', 'alex@example.com');
    act(() => enter('wsf-signin-password'));
    act(() => enter('wsf-signin-email'));
    await flush();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('regression (e35-auth-polish.spec.ts:130): a valid sign-in still submits on Enter, once', async () => {
    signIn.mockResolvedValue({ user: { uid: 'u1', emailVerified: true } });
    await render(<SignIn />);
    type('wsf-signin-email', 'alex@example.com');
    type('wsf-signin-password', 'correct horse');
    act(() => {
      enter('wsf-signin-password');
      enter('wsf-signin-password');
    });
    await flush();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith({}, 'alex@example.com', 'correct horse');
    expect(replace).toHaveBeenCalled();
  });
});

describe('W16-1 / MF-13: the latch is released after a failure', () => {
  it('sign-in: a wrong password, then Enter tries again', async () => {
    signIn.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/invalid-credential' }));
    signIn.mockResolvedValueOnce({ user: { uid: 'u1', emailVerified: true } });
    await render(<SignIn />);
    type('wsf-signin-email', 'alex@example.com');
    type('wsf-signin-password', 'wrong one');
    act(() => enter('wsf-signin-password'));
    await flush();
    act(() => enter('wsf-signin-password'));
    await flush();
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('reset: a network failure, then Enter tries again', async () => {
    requestReset.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/unavailable' }));
    requestReset.mockResolvedValueOnce(undefined);
    await render(<ResetPassword />);
    type('wsf-reset-email', 'alex@example.com');
    act(() => enter('wsf-reset-email'));
    await flush();
    act(() => enter('wsf-reset-email'));
    await flush();
    expect(requestReset).toHaveBeenCalledTimes(2);
  });
});

describe('W16-1 / MF-13: reset-password', () => {
  it('(3) Enter with an empty address requests nothing', async () => {
    await render(<ResetPassword />);
    act(() => enter('wsf-reset-email'));
    type('wsf-reset-email', '   ');
    act(() => enter('wsf-reset-email'));
    await flush();
    expect(requestReset).not.toHaveBeenCalled();
  });

  it('(3) after an "unconfigured" answer, Enter makes no new request', async () => {
    requestReset.mockRejectedValue(Object.assign(new Error('x'), { code: 'functions/failed-precondition' }));
    await render(<ResetPassword />);
    type('wsf-reset-email', 'alex@example.com');
    act(() => enter('wsf-reset-email'));
    await flush();
    expect(requestReset).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="wsf-reset-unconfigured"]')).not.toBeNull();
    act(() => enter('wsf-reset-email'));
    await flush();
    expect(requestReset).toHaveBeenCalledTimes(1);
  });

  it('two Enters in one tick request one link; once sent, Enter sends no other', async () => {
    let finish!: () => void;
    requestReset.mockImplementation(() => new Promise<void>((res) => (finish = res)));
    await render(<ResetPassword />);
    type('wsf-reset-email', 'alex@example.com');
    act(() => {
      enter('wsf-reset-email');
      enter('wsf-reset-email');
    });
    await flush();
    expect(requestReset).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await flush();
    expect(container.querySelector('[data-testid="wsf-reset-sent"]')).not.toBeNull();
    act(() => enter('wsf-reset-email'));
    await flush();
    expect(requestReset).toHaveBeenCalledTimes(1);
  });
});
