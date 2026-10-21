import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RV15-634-N1 — the crash fallback's Go to Home, per variant
 * (src/ui/RouteErrorFallback.native.tsx). A screen's and the contribution's
 * fallback sit on the ROOT stack, often as a modal over the tabs (Settings,
 * MOVE, the contribution sheet): navigate('/') pushed a second (tabs) above
 * the fallback, so those pop back to the tabs (dismissTo('/'), POP_TO), with
 * navigate as the fallback should that throw. A tab's fallback, and the
 * variants that stand in for a navigator, still navigate. No kiosk session
 * here (that path: tests/kiosk-escape-real-stack.test.tsx).
 */

const r = vi.hoisted(() => ({ calls: [] as string[], dismissThrows: false, markerThrows: false, unknown: false, returnGoal: null as string | null }));
vi.mock('expo-router', () => ({
  router: {
    navigate: (h: string) => r.calls.push(`navigate ${h}`),
    dismissTo: (h: string) => {
      if (r.dismissThrows) throw new Error('no navigator');
      r.calls.push(`dismissTo ${h}`);
    },
  },
}));
// The real module imports React Native internals jsdom cannot load.
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return { SafeAreaInsetsContext: createContext(null), initialWindowMetrics: null };
});
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({ currentUser: null }) }));
vi.mock('../src/kioskSession', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readKioskSession: () => {
    if (r.markerThrows) throw new Error('marker unreadable');
    return null;
  },
  // The storage layer's unknown state (RV17-641-N3); the real one is pinned in tests/kiosk-marker-unknown-real-stack.test.tsx.
  kioskSessionUnknown: () => r.unknown,
  readKioskReturnGoal: () => r.returnGoal,
}));

import { RouteErrorFallback, type FallbackVariant } from '../src/ui/RouteErrorFallback.native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  r.calls = [];
  r.dismissThrows = false;
  r.markerThrows = false;
  r.unknown = false;
  r.returnGoal = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function pressHome(variant: FallbackVariant): string[] {
  r.calls = [];
  act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={() => undefined} variant={variant} />));
  const home = container.querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement;
  expect(home.textContent).toBe('Go to Home');
  act(() => home.click());
  act(() => vi.runAllTimers());
  return r.calls;
}

describe('Go to Home, per variant (RV15-634-N1)', () => {
  it('a screen and the contribution pop back to the tabs (dismissTo /), never navigate', () => {
    for (const variant of ['screen', 'contribute'] as FallbackVariant[]) {
      expect([variant, pressHome(variant)]).toEqual([variant, ['dismissTo /']]);
    }
  });

  it('should dismissTo throw, they navigate instead', () => {
    r.dismissThrows = true;
    for (const variant of ['screen', 'contribute'] as FallbackVariant[]) {
      expect([variant, pressHome(variant)]).toEqual([variant, ['navigate /']]);
    }
  });

  it('a tab, and the variants that stand in for a navigator, navigate as before', () => {
    for (const variant of ['tab', 'root', 'shell', 'homeTab'] as FallbackVariant[]) {
      expect([variant, pressHome(variant)]).toEqual([variant, ['navigate /']]);
    }
  });
});

describe('RV16-641-N2, RV17-641-N3: a marker that cannot be read never fails open to Home', () => {
  it('the kiosk return still names the kiosk: "Back to the kiosk", and the press goes there', () => {
    r.markerThrows = true;
    r.returnGoal = 'g1';
    act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={() => undefined} variant="screen" />));
    const home = container.querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement;
    expect(home.textContent).toBe('Back to the kiosk');
    act(() => home.click());
    act(() => vi.runAllTimers());
    expect(r.calls).toEqual(['dismissTo /kiosk/g1']);
  });

  // RV17-641-N3: before, this pinned that it DID fail open (Go to Home). Now: Try again only.
  it('with no kiosk return either: no way out but Try again, on every variant; nothing is asked of the router', () => {
    r.markerThrows = true;
    expectTryAgainOnly();
  });

  it("the storage layer's unknown marker (read failed at launch, readKioskSession() null) with no kiosk return: Try again only", () => {
    r.unknown = true;
    expectTryAgainOnly();
  });

  it("the unknown marker with a kiosk return: that return still names the kiosk", () => {
    r.unknown = true;
    r.returnGoal = 'g1';
    act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={() => undefined} variant="screen" />));
    const home = container.querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement;
    expect(home.textContent).toBe('Back to the kiosk');
    act(() => home.click());
    act(() => vi.runAllTimers());
    expect(r.calls).toEqual(['dismissTo /kiosk/g1']);
  });

  it('the marker becomes unknown between render and press: the press goes nowhere, and the way out is gone', () => {
    act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={() => undefined} variant="screen" />));
    const home = container.querySelector('[data-testid="wsf-route-error-home"]') as HTMLElement;
    expect(home.textContent).toBe('Go to Home');
    r.unknown = true;
    act(() => home.click());
    act(() => vi.runAllTimers());
    expect(r.calls).toEqual([]);
    expect(container.querySelector('[data-testid="wsf-route-error-home"]')).toBeNull();
  });
});

/** Every variant: no way-out button, the body says Try again only, Try again retries, and nothing navigates. */
function expectTryAgainOnly(): void {
  for (const variant of ['screen', 'contribute', 'tab', 'root', 'shell', 'homeTab'] as FallbackVariant[]) {
    r.calls = [];
    let retries = 0;
    act(() => root.render(<RouteErrorFallback key={variant} error={new Error('x')} retry={() => void (retries += 1)} variant={variant} />));
    expect([variant, container.querySelector('[data-testid="wsf-route-error-home"]')]).toEqual([variant, null]);
    const body = container.querySelector('[data-testid="wsf-route-error-body"]')!.textContent;
    expect([variant, body]).toEqual([variant, variant === 'contribute' ? CONTRIBUTE_COPY : 'This screen hit a problem and stopped. Try again.']);
    act(() => (container.querySelector('[data-testid="wsf-route-error-retry"]') as HTMLElement).click());
    act(() => vi.runAllTimers());
    expect([variant, retries, r.calls]).toEqual([variant, 1, []]);
  }
}
const CONTRIBUTE_COPY =
  'This screen hit a problem and stopped. Anything you were adding is not confirmed: check Progress before you add it again.';
