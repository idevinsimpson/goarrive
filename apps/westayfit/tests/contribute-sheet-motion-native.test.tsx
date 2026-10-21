import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 3b (MO-02, contribute half). The contribution sheet plays the motion
 * lane's native sheet motion (src/ui/sheetMotionNative.tsx) on iOS and
 * Android: the scrim fades in place, the panel rises, Close waits out the
 * 180 ms exit, reduced motion has no travel and closes at once, and a MOVE
 * hand-off mounts the scrim already up. The web keeps its own elements and
 * CSS phase. Animated is the motion lane's controllable fake
 * (tests/sheet-motion-native.test.tsx): values and timings are recorded and
 * finish only when told. The route renders in jsdom with the callables
 * mocked at the network boundary; its two animated illustrations are stubbed.
 */
type FakeTiming = {
  value: { v: number };
  config: { toValue: number; duration: number; useNativeDriver: boolean };
  started: boolean;
  stopped: boolean;
};

const fx = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  values: [] as Array<{ v: number }>,
  timings: [] as FakeTiming[],
  styles: {} as Record<string, unknown>,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  class Value {
    v: number;
    constructor(v: number) {
      this.v = v;
      fx.values.push(this);
    }
    setValue(v: number) {
      this.v = v;
    }
    interpolate(cfg: unknown) {
      return { kind: 'interp', of: this, cfg };
    }
  }
  const timing = (value: { v: number }, config: FakeTiming['config']) => {
    const t: FakeTiming = { value, config, started: false, stopped: false };
    fx.timings.push(t);
    return {
      start: () => {
        t.started = true;
      },
      stop: () => {
        t.stopped = true;
      },
    };
  };
  const host = (kind: string) =>
    React.forwardRef(function AnimatedHost(
      props: { testID?: string; children?: ReactNode; pointerEvents?: string; onPress?: () => void; style?: unknown } & Record<string, unknown>,
      ref: React.Ref<HTMLDivElement>,
    ) {
      fx.styles[props.testID ?? kind] = props.style;
      return React.createElement(
        'div',
        {
          ref,
          'data-testid': props.testID,
          'data-animated': kind,
          'data-pointer-events': props.pointerEvents ?? '',
          role: props.role as string | undefined,
          'aria-modal': props['aria-modal'] as string | undefined,
          onClick: () => props.onPress?.(),
        },
        props.children,
      );
    });
  const AnimatedView = host('view');
  const AnimatedPressable = host('pressable');
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return fx.os;
      },
      select: (o: Record<string, unknown>) => (fx.os in o ? o[fx.os] : o.default),
    },
    Animated: { ...actual.Animated, Value, timing, View: AnimatedView, createAnimatedComponent: () => AnimatedPressable },
  };
});

const nav = vi.hoisted(() => ({ back: [] as string[], listeners: {} as Record<string, Array<() => void>>, focused: true }));
const params = { value: { goalId: 'g1', mode: 'move' } as Record<string, string> };
vi.mock('expo-router', async () => {
  const React = await import('react');
  const navigation = {
    dispatch: () => nav.back.push('dispatch'),
    isFocused: () => nav.focused,
    addListener: (event: string, cb: () => void) => {
      (nav.listeners[event] ??= []).push(cb);
      return () => {
        nav.listeners[event] = (nav.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
    setOptions: () => undefined,
    // The contribution flow presented over the member's tabs: the sheet.
    getState: () => ({ index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]', params: params.value }] }),
  };
  const router = {
    back: () => nav.back.push('back'),
    canGoBack: () => true,
    replace: (href: string) => nav.back.push(`replace ${href}`),
    dismissTo: (href: string) => nav.back.push(`dismissTo ${href}`),
    push: (href: string) => nav.back.push(`push ${href}`),
    navigate: (href: string) => nav.back.push(`navigate ${href}`),
  };
  return {
    router,
    useRouter: () => router,
    useNavigation: () => navigation,
    usePathname: () => '/contribute/g1',
    useLocalSearchParams: () => params.value,
    useFocusEffect: () => undefined,
    Link: ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});
const pref = vi.hoisted(() => ({ current: { reduced: false, known: true, failed: false } }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotionPreference: () => pref.current,
  useReducedMotion: () => pref.current.reduced,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
vi.mock('../src/ui/LivingWeProgress', () => ({ LivingWeProgress: () => null }));
vi.mock('../src/ui/TogetherCompletion', () => ({ TogetherCompletion: () => null }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1' } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    if (name === 'wsfGoalPulse') return { data: { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' } };
    if (name === 'wsfMyContribution') return { data: { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' } };
    throw Object.assign(new Error('internal'), { code: 'functions/internal' });
  },
}));

const { clearMemberReads } = await import('../src/memberReads');
const { markSheetHandoff, SHEET_IN_MS, SHEET_OUT_MS } = await import('../src/ui/sheetMotion');
const { SHEET_RISE_PX } = await import('../src/ui/sheetMotionNative');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
/** The motion style a native part was given (the last entry of its style array). */
const motionOf = (testID: string) => {
  const style = fx.styles[testID] as unknown[];
  return style[style.length - 1] as { opacity: { v: number }; transform?: Array<Record<string, { cfg: { outputRange: number[] } }>> };
};
const timingsOf = (value: { v: number }) => fx.timings.filter((t) => t.value === value);

beforeEach(() => {
  fx.os = 'ios';
  fx.values.length = 0;
  fx.timings.length = 0;
  fx.styles = {};
  nav.back = [];
  nav.listeners = {};
  nav.focused = true;
  pref.current = { reduced: false, known: true, failed: false };
  params.value = { goalId: 'g1', mode: 'move' };
  clearMemberReads();
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('3b: the contribution sheet moves itself on iOS and Android', () => {
  it.each(['ios', 'android'] as const)('%s: the scrim fades in place and the panel rises 28 pt over 240 ms, on the native driver', async (os) => {
    fx.os = os;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-scrim')!.getAttribute('data-animated')).toBe('pressable');
    const panel = byId('wsf-contribute-sheet-panel')!;
    expect(panel.getAttribute('data-animated')).toBe('view');
    // The dialog semantics and testIDs ride along on the animated panel.
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(byId('wsf-contribute-close')).not.toBeNull();
    const scrim = motionOf('wsf-contribute-scrim');
    const rise = motionOf('wsf-contribute-sheet-panel');
    expect(scrim.transform).toBeUndefined();
    expect(rise.transform![0]!.translateY!.cfg.outputRange).toEqual([SHEET_RISE_PX, 0]);
    for (const value of [scrim.opacity, rise.opacity]) {
      const runs = timingsOf(value);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.config).toMatchObject({ toValue: 1, duration: SHEET_IN_MS, useNativeDriver: true });
      expect(runs[0]!.started).toBe(true);
    }
  });

  it('Close waits out the 180 ms exit (both parts reverse), then returns, once', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    vi.useFakeTimers();
    const scrim = motionOf('wsf-contribute-scrim').opacity;
    act(() => byId('wsf-contribute-close')!.click());
    act(() => byId('wsf-contribute-close')!.click());
    expect(timingsOf(scrim).filter((t) => t.config.toValue === 0)).toHaveLength(1);
    expect(timingsOf(scrim).find((t) => t.config.toValue === 0)!.config.duration).toBe(SHEET_OUT_MS);
    expect(byId('wsf-contribute-sheet-panel')!.getAttribute('data-pointer-events')).toBe('none');
    act(() => vi.advanceTimersByTime(SHEET_OUT_MS - 1));
    expect(nav.back).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(nav.back).toEqual(['back']);
  });

  it('reduced motion: no travel at all, and Close returns at once', async () => {
    pref.current = { reduced: true, known: true, failed: false };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    const scrim = motionOf('wsf-contribute-scrim').opacity;
    const panel = motionOf('wsf-contribute-sheet-panel').opacity;
    expect(timingsOf(scrim)).toHaveLength(0);
    expect(timingsOf(panel)).toHaveLength(0);
    expect(scrim.v).toBe(1);
    expect(panel.v).toBe(1);
    act(() => byId('wsf-contribute-close')!.click());
    expect(nav.back).toEqual(['back']);
  });

  it('a preference not heard yet: Close does not wait (no travel was promised)', async () => {
    pref.current = { reduced: false, known: false, failed: false };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => byId('wsf-contribute-close')!.click());
    expect(nav.back).toEqual(['back']);
  });

  it('a MOVE hand-off: the scrim is already up (opacity 1, no fade); the panel still rises', async () => {
    markSheetHandoff();
    act(() => root.render(<ContributeToGoal />));
    await settle();
    const scrim = motionOf('wsf-contribute-scrim').opacity;
    expect(scrim.v).toBe(1);
    expect(timingsOf(scrim)).toHaveLength(0);
    expect(timingsOf(motionOf('wsf-contribute-sheet-panel').opacity)).toHaveLength(1);
  });
});

describe('3b: the web keeps its own sheet', () => {
  it('the plain scrim and panel, with their CSS phase, dialog semantics and testIDs; nothing animated, and Close waits as before', async () => {
    fx.os = 'web';
    act(() => root.render(<ContributeToGoal />));
    await settle();
    const scrim = byId('wsf-contribute-scrim')!;
    const panel = byId('wsf-contribute-sheet-panel')!;
    expect(scrim.getAttribute('data-animated')).toBeNull();
    expect(panel.getAttribute('data-animated')).toBeNull();
    expect(scrim.getAttribute('data-wsf-sheet-scrim')).toBe('in');
    expect(panel.getAttribute('data-wsf-sheet-panel')).toBe('in');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(fx.timings).toHaveLength(0);
    vi.useFakeTimers();
    act(() => byId('wsf-contribute-close')!.click());
    expect(nav.back).toEqual([]);
    act(() => vi.advanceTimersByTime(SHEET_OUT_MS));
    expect(nav.back).toEqual(['back']);
  });
});
