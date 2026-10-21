import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, Text } from 'react-native';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-13 (INT-01 CS-4, the member part). Seven member routes
 * now export `ErrorBoundary = nativeErrorBoundary('screen')`, so on a phone a
 * render error there shows the contained screen fallback instead of ending
 * the process: Try again remounts the route, Go to Home is the way out, and
 * the error's own text is never shown (CS-6). You (app/(tabs)/you.tsx) exports
 * the 'tab' variant, as Progress does: it sits below the shell's top bar, so
 * its fallback adds no status-bar inset. The web module returns undefined, so
 * the web gets no boundary. Not here: join, verify-email, profile-setup and
 * settings.tsx (W14).
 *
 * The scan holds the eight files to the exact export. The render imports one
 * of them (reset-password) with the NATIVE fallback module and Platform.OS
 * 'ios', and wraps a throwing child the way expo-router wraps a route that
 * exports ErrorBoundary (`{ error, retry }`; the harness is
 * tests/crash-containment.test.tsx's, held there to the installed
 * expo-router source). No device.
 */

const APP_ROOT = join(__dirname, '..');
const ROUTES: [file: string, variant: 'screen' | 'tab'][] = [
  ['app/signin.tsx', 'screen'],
  ['app/signup.tsx', 'screen'],
  ['app/reset-password.tsx', 'screen'],
  ['app/goals/new.tsx', 'screen'],
  ['app/settings/privacy.tsx', 'screen'],
  ['app/go/[markerSlug].tsx', 'screen'],
  ['app/start-community.tsx', 'screen'],
  ['app/(tabs)/you.tsx', 'tab'],
];

describe('W16-13: the member routes export their boundary', () => {
  it.each(ROUTES)('%s exports ErrorBoundary = nativeErrorBoundary(%s), from RouteErrorFallback', (file, variant) => {
    const src = readFileSync(join(APP_ROOT, file), 'utf8');
    expect(src).toContain(`export const ErrorBoundary = nativeErrorBoundary('${variant}');`);
    expect(src).toMatch(/import \{ nativeErrorBoundary \} from '(\.\.\/)+src\/ui\/RouteErrorFallback';/);
    expect(src.match(/export const ErrorBoundary\b/g)).toHaveLength(1);
  });
});

// ---- the native render ----
const navigate = vi.fn();
vi.mock('../src/ui/RouteErrorFallback', async () => import('../src/ui/RouteErrorFallback.native'));
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return {
    initialWindowMetrics: { insets: { top: 47, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
    SafeAreaInsetsContext: createContext(null),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
vi.mock('expo-router', () => ({
  router: { navigate: (...a: unknown[]) => navigate(...a), replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false },
  Link: ({ children }: { children: ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ dispatch: vi.fn(), setParams: vi.fn() }),
  useFocusEffect: () => undefined,
}));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: () => Promise.resolve() }));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}), getFirebaseFunctions: () => ({}), wsfIsStaging: false }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
vi.mock('../src/passwordResetEmail', () => ({ requestPasswordResetEmail: () => Promise.resolve({ sent: true }) }));

// The route's export is computed at import, on the platform then current.
const OS = Platform.OS;
(Platform as { OS: string }).OS = 'ios';
const { ErrorBoundary } = await import('../app/reset-password');
const native = await import('../src/ui/RouteErrorFallback.native');
afterAll(() => {
  (Platform as { OS: string }).OS = OS;
});

/** expo-router's route wrapper, in miniature: on a throw it renders ErrorBoundary with { error, retry }. */
class Try extends Component<{ catch: ComponentType<{ error: Error; retry: () => Promise<void> }>; children?: ReactNode }, { error?: Error }> {
  state: { error?: Error } = { error: undefined };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () => new Promise<void>((resolve) => this.setState({ error: undefined }, () => resolve()));
  render() {
    const { catch: Fallback, children } = this.props;
    return this.state.error ? createElement(Fallback, { error: this.state.error, retry: this.retry }) : children;
  }
}

// An error whose text must never reach the screen.
const SECRET = 'Cannot read alex.rivera@example.com of undefined (reading "Harbor Walkers")';
// Throws while `broken` (React retries a failed render once before a
// boundary takes it, so a one-shot throw would never reach the fallback).
let mounts = 0;
let broken = true;
function FlakyRoute() {
  mounts += 1;
  if (broken) throw new Error(SECRET);
  return createElement(Text, { testID: 'wsf-flaky-route' }, 'the route');
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mounts = 0;
  broken = true;
  navigate.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("W16-13: a member route's boundary on a phone", () => {
  it("is the native screen boundary (the same one /move's 'screen' variant uses)", () => {
    expect(ErrorBoundary).toBeDefined();
    expect(ErrorBoundary).toBe(native.nativeErrorBoundary('screen'));
  });

  it('a throw shows the screen fallback, with Try again and Go to Home, and never the error text; Try again remounts the route', async () => {
    act(() => root.render(createElement(Try, { catch: ErrorBoundary! }, createElement(FlakyRoute))));
    expect(byId('wsf-route-error')).not.toBeNull();
    expect(byId('wsf-route-error-retry')!.textContent).toBe('Try again');
    expect(byId('wsf-route-error-home')!.textContent).toBe('Go to Home');
    expect(container.textContent).not.toContain('alex.rivera');
    expect(container.textContent).not.toContain('Harbor Walkers');
    expect(container.textContent).not.toContain('Cannot read');
    // Try again while it still throws: the fallback again, not a crash.
    let before = mounts;
    await act(async () => byId('wsf-route-error-retry')!.click());
    expect(mounts).toBeGreaterThan(before);
    expect(byId('wsf-route-error')).not.toBeNull();
    expect(container.textContent).not.toContain('alex.rivera');
    // Fixed: Try again remounts the route, which now renders.
    broken = false;
    before = mounts;
    await act(async () => byId('wsf-route-error-retry')!.click());
    expect(mounts).toBeGreaterThan(before);
    expect(byId('wsf-route-error')).toBeNull();
    expect(byId('wsf-flaky-route')!.textContent).toBe('the route');
  });
});
