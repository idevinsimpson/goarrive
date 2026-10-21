import { act, useEffect, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextInput } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-09): the root-stack screens this lane owns clear
 * the top inset on a phone and are unchanged on web. The shared helper is
 * mocked so a case can be "a phone with a 47 pt inset" or "web (0)"; the
 * helper itself and its native behaviour are tested in iphone-top.test.tsx.
 * No device.
 */

const inset = { top: 0 };
vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => inset.top,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: ({ tone }: { tone: string }) => <span data-testid="screen-status-bar" data-tone={tone} />,
}));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setParams: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}), wsfIsStaging: false }));
const auth = { ready: true, user: null as null | { uid: string; email: string; displayName: string } };
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => auth }));
vi.mock('../src/currentCommunity', () => ({ resolveCurrentCommunity: () => null, useCurrentCommunityReady: () => true }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  readMyCommunities: () => new Promise(() => undefined),
  readGoals: () => new Promise(() => undefined),
}));

const { FormShell, QuietShell } = await import('../src/AuthFormPrimitives');
const { default: Health } = await import('../app/health');
const { default: Home } = await import('../app/(tabs)/(home)/index');

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
/** The element carrying a given inline paddingTop, if any. */
const withPaddingTop = (px: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).filter((e) => e.style.paddingTop === px);

beforeEach(() => {
  inset.top = 0;
  auth.ready = true;
  auth.user = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderBoth(node: () => ReactElement): { web: string; phone: string } {
  inset.top = 0;
  act(() => root.render(node()));
  const web = container.innerHTML;
  act(() => root.unmount());
  root = createRoot(container);
  inset.top = 47;
  act(() => root.render(node()));
  return { web, phone: container.innerHTML };
}

describe('INT-09: identity forms (FormShell, QuietShell)', () => {
  it('FormShell: the navy field runs behind the status bar and its wordmark and step chip start below it, under light icons', () => {
    renderBoth(() => (
      <FormShell heading="Sign in" step="Step 1 of 2" testID="wsf-signin">
        <TextInput testID="wsf-signin-email" />
      </FormShell>
    ));
    const field = byId('wsf-form-wordmark')!.parentElement!.parentElement!;
    expect(field.style.paddingTop).toBe(`${28 + 47}px`);
    expect(byId('wsf-form-step')).not.toBeNull();
    expect(byId('screen-status-bar')!.dataset.tone).toBe('navy');
  });

  it('FormShell on web (inset 0): no padding override; only the status-bar element (nothing on web) differs', () => {
    inset.top = 0;
    act(() => root.render(<FormShell heading="Sign in" testID="wsf-signin"><TextInput /></FormShell>));
    const field = byId('wsf-form-wordmark')!.parentElement!.parentElement!;
    expect(field.style.paddingTop).toBe('');
    expect(withPaddingTop(`${28 + 47}px`)).toHaveLength(0);
  });

  it('QuietShell: the cream page starts below the status bar; web unchanged', () => {
    const { web } = renderBoth(() => <QuietShell heading="Check your email" body="Sent." testID="wsf-quiet" />);
    expect(withPaddingTop(`${22 + 47}px`)).toHaveLength(1);
    expect(web).not.toContain('padding-top: 69px');
    expect(byId('screen-status-bar')).toBeNull();
  });
});

describe('INT-09: Build details and signed-out Home', () => {
  it('/health starts below the status bar on a phone, and is unchanged on web', () => {
    const { web, phone } = renderBoth(() => <Health />);
    expect(withPaddingTop(`${16 + 47}px`)).toHaveLength(1);
    expect(web).not.toContain('padding-top: 63px');
    expect(phone).not.toBe(web);
  });

  it('signed-out Home: the hero and every control sit below the status bar; web unchanged', () => {
    const { web } = renderBoth(() => <Home />);
    expect(byId('wsf-home-signed-out')).not.toBeNull();
    expect(withPaddingTop(`${16 + 47}px`)).toHaveLength(1);
    expect(web).not.toContain('padding-top: 63px');
  });

  it('Home while auth settles: "Loading…" is not under the status bar', () => {
    auth.ready = false;
    renderBoth(() => <Home />);
    expect(byId('wsf-home-loading')).not.toBeNull();
    expect(withPaddingTop(`${16 + 47}px`)).toHaveLength(1);
  });

  it('signed-in Home: the member top bar already clears it, so the page adds nothing (no doubled gap)', () => {
    auth.user = USER;
    renderBoth(() => <Home />);
    expect(withPaddingTop(`${16 + 47}px`)).toHaveLength(0);
  });
});
