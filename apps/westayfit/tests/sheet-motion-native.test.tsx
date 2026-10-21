import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, createRef, forwardRef, StrictMode, useImperativeHandle, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Easing, Pressable, Text, View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MO-02 — native sheet motion (src/ui/sheetMotionNative.tsx), the native exit
 * in useSheetExit (src/ui/sheetMotion.ts), and MOVE's resolver using both
 * (app/move/index.tsx, presented with `animation: 'none'` by app/_layout.tsx).
 *
 * Under vitest react-native-web serves AnimatedMock (every animation completes
 * at once), so `Animated` is a controllable fake here: each value records what
 * it is set to, each timing its config, whether it started or stopped, and it
 * finishes only when the test says so. Platform.OS is switchable. What is
 * tested is the decision -- values, durations, easings, driver, hand-off,
 * reduced and unknown preferences, the exit's wait and its guards -- not
 * react-native-web's player. The web keeps its CSS motion and its DOM.
 */

type FakeTiming = {
  value: { v: number };
  config: { toValue: number; duration: number; easing: (t: number) => number; useNativeDriver: boolean };
  started: boolean;
  stopped: boolean;
  finish: () => void;
};
type Interp = { kind: 'interp'; of: { v: number }; cfg: { inputRange: number[]; outputRange: number[] } };

const fx = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  values: [] as Array<{ v: number }>,
  timings: [] as FakeTiming[],
  styles: {} as Record<string, unknown>,
  props: {} as Record<string, Record<string, unknown>>,
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
    interpolate(cfg: Interp['cfg']): Interp {
      return { kind: 'interp', of: this, cfg };
    }
  }
  const timing = (value: { v: number }, config: FakeTiming['config']) => {
    let done: ((r: { finished: boolean }) => void) | undefined;
    const t: FakeTiming = {
      value,
      config,
      started: false,
      stopped: false,
      finish: () => {
        if (t.stopped) return;
        value.v = config.toValue;
        done?.({ finished: true });
      },
    };
    fx.timings.push(t);
    return {
      start: (cb?: (r: { finished: boolean }) => void) => {
        t.started = true;
        done = cb;
      },
      stop: () => {
        t.stopped = true;
      },
    };
  };
  // The animated hosts: a div that records its style and pointerEvents.
  const host = (kind: string) =>
    React.forwardRef(function AnimatedHost(
      props: { testID?: string; children?: ReactNode; pointerEvents?: string; onPress?: () => void; style?: unknown },
      ref: React.Ref<HTMLDivElement>,
    ) {
      fx.styles[props.testID ?? kind] = props.style;
      fx.props[props.testID ?? kind] = props as Record<string, unknown>;
      return React.createElement(
        'div',
        {
          ref,
          'data-testid': props.testID,
          'data-animated': kind,
          'data-pointer-events': props.pointerEvents ?? '',
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
    },
    Animated: { ...actual.Animated, Value, timing, View: AnimatedView, createAnimatedComponent: () => AnimatedPressable },
  };
});

const nav = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
  listeners: {} as Record<string, Array<() => void>>,
  focused: true,
  back: [] as string[],
}));
function freshNavigation() {
  nav.listeners = {};
  nav.focused = true;
  nav.current = {
    addListener: (event: string, cb: () => void) => {
      (nav.listeners[event] ??= []).push(cb);
      return () => {
        nav.listeners[event] = (nav.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
    isFocused: () => nav.focused,
    dispatch: () => nav.back.push('dispatch'),
  };
}
const emit = (event: string) => act(() => (nav.listeners[event] ?? []).slice().forEach((cb) => cb()));

vi.mock('expo-router', async () => {
  const React = await import('react');
  return {
    useNavigation: () => nav.current,
    router: {
      back: () => nav.back.push('back'),
      canGoBack: () => true,
      replace: (href: string) => nav.back.push(`replace ${href}`),
      dismissTo: (href: string) => nav.back.push(`dismissTo ${href}`),
    },
    Link: ({ children }: { children?: ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});

// MOVE's resolver, rendered at rest (not signed in yet): just its sheet.
const pref = vi.hoisted(() => ({ current: { reduced: false, known: true, failed: false } }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotionPreference: () => pref.current,
  useReducedMotion: () => pref.current.reduced,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// W14-5: modalPanelA11y routed as Metro resolves its twins (its values: focus-return-native).
vi.mock('../src/ui/modalA11y', () => ({
  get modalPanelA11y() {
    return fx.os === 'ios' ? { accessibilityViewIsModal: true } : {};
  },
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: false, user: null }) }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 0,
  peekGoals: () => null,
  peekMyCommunities: () => null,
  readGoals: () => new Promise(() => undefined),
  readMyCommunities: () => new Promise(() => undefined),
}));
vi.mock('../src/currentCommunity', () => ({
  resolveCurrentCommunity: () => null,
  currentCommunityReady: () => Promise.resolve(),
}));

import MoveResolver from '../app/move/index';
import {
  SHEET_IN_MS,
  SHEET_OUT_MS,
  ensureSheetMotionCss,
  sheetData,
  sheetHoldsStill,
  useSheetExit,
  SCRIM_PROPS,
  type SheetPhase,
} from '../src/ui/sheetMotion';
import * as nativeModule from '../src/ui/sheetMotionNative';
import {
  SCRIM_IN_EASING,
  SHEET_IN_EASING,
  SHEET_OUT_EASING,
  SHEET_PREFERENCE_WAIT_MS,
  SHEET_RISE_PX,
  SIDE_SHIFT_PX,
  SheetPanel,
  SheetScrim,
} from '../src/ui/sheetMotionNative';
import * as webStub from '../src/ui/sheetMotionNative.web';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fx.os = 'ios';
  fx.values.length = 0;
  fx.timings.length = 0;
  fx.styles = {};
  fx.props = {};
  nav.back = [];
  pref.current = { reduced: false, known: true, failed: false };
  freshNavigation();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

type Pref = { reduced: boolean; known: boolean; failed: boolean };
const KNOWN: Pref = { reduced: false, known: true, failed: false };
const UNKNOWN: Pref = { reduced: false, known: false, failed: false };
const REDUCED: Pref = { reduced: true, known: true, failed: false };
const FAILED: Pref = { reduced: false, known: false, failed: true };

function Sheet({ phase, preference, handoff, part }: { phase: SheetPhase; preference: Pref; handoff?: boolean; part?: 'panel' | 'side' }) {
  return (
    <>
      <SheetScrim testID="scrim" phase={phase} preference={preference} handoff={handoff} onPress={() => undefined} />
      <SheetPanel testID="panel" phase={phase} preference={preference} handoff={handoff} part={part}>
        <Text>inside</Text>
      </SheetPanel>
    </>
  );
}
const show = (props: Parameters<typeof Sheet>[0]) => act(() => root.render(<Sheet {...props} />));
// Scrim first, then panel: the order they mount in.
const scrimValue = () => fx.values[0]!;
const panelValue = () => fx.values[1]!;
const timingsOf = (value: { v: number }) => fx.timings.filter((t) => t.value === value);
const css = (n: number) => String(n).replace(/^0\./, '.');
const bezierAt = (b: readonly number[], t: number) => Easing.bezier(b[0]!, b[1]!, b[2]!, b[3]!)(t);
const expectEasing = (fn: (t: number) => number, b: readonly number[]) => {
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(fn(t)).toBeCloseTo(bezierAt(b, t), 6);
};
const motionStyle = (testID: string) => {
  const style = fx.styles[testID] as unknown[];
  return style[style.length - 1] as { opacity: unknown; transform?: Array<Record<string, Interp>> };
};

describe('the numbers are the web’s', () => {
  it('240 ms in, 180 ms out, 28 pt rise, 32 pt side shift, the same curves the web CSS plays', () => {
    expect(SHEET_IN_MS).toBe(240);
    expect(SHEET_OUT_MS).toBe(180);
    expect(SHEET_RISE_PX).toBe(28);
    expect(SIDE_SHIFT_PX).toBe(32);
    fx.os = 'web';
    ensureSheetMotionCss();
    const text = document.getElementById('wsf-sheet-motion')!.textContent!;
    expect(text).toContain(`translateY(${SHEET_RISE_PX}px)`);
    expect(text).toContain(`translateX(${SIDE_SHIFT_PX}px)`);
    expect(text).toContain(`wsf-sheet-in ${SHEET_IN_MS}ms cubic-bezier(${SHEET_IN_EASING.map(css).join(',')})`);
    expect(text).toContain(`wsf-sheet-out ${SHEET_OUT_MS}ms cubic-bezier(${SHEET_OUT_EASING.map(css).join(',')})`);
    // CSS `ease-out` is cubic-bezier(0, 0, .58, 1).
    expect(text).toContain(`wsf-scrim-in ${SHEET_IN_MS}ms ease-out`);
    expect(SCRIM_IN_EASING).toEqual([0, 0, 0.58, 1]);
  });
});

describe('a native sheet comes in', () => {
  it('the scrim fades in place and the panel rises 28 pt, 240 ms, on the native driver', () => {
    show({ phase: 'in', preference: KNOWN });
    expect(scrimValue().v).toBe(0);
    expect(panelValue().v).toBe(0);
    const [scrimRun] = timingsOf(scrimValue());
    const [panelRun] = timingsOf(panelValue());
    expect(scrimRun!.started && panelRun!.started).toBe(true);
    expect(scrimRun!.config).toMatchObject({ toValue: 1, duration: 240, useNativeDriver: true });
    expect(panelRun!.config).toMatchObject({ toValue: 1, duration: 240, useNativeDriver: true });
    expectEasing(scrimRun!.config.easing, SCRIM_IN_EASING);
    expectEasing(panelRun!.config.easing, SHEET_IN_EASING);
    // The scrim only fades -- it never travels; the panel fades and rises.
    expect(motionStyle('scrim')).toEqual({ opacity: scrimValue() });
    const panel = motionStyle('panel');
    expect(panel.opacity).toBe(panelValue());
    expect(panel.transform![0]!.translateY).toEqual({
      kind: 'interp',
      of: panelValue(),
      cfg: { inputRange: [0, 1], outputRange: [28, 0] },
    });
    scrimRun!.finish();
    panelRun!.finish();
    expect(scrimValue().v).toBe(1);
    expect(panelValue().v).toBe(1);
  });

  it('a side panel comes in from 32 pt to the right', () => {
    show({ phase: 'in', preference: KNOWN, part: 'side' });
    expect(motionStyle('panel').transform![0]!.translateX!.cfg.outputRange).toEqual([32, 0]);
  });

  it('a hand-off: the scrim mounts at full opacity and does not fade again; the panel still rises', () => {
    show({ phase: 'in', preference: KNOWN, handoff: true });
    expect(scrimValue().v).toBe(1);
    expect(timingsOf(scrimValue())).toHaveLength(0);
    expect(timingsOf(panelValue())).toHaveLength(1);
  });

  it('reduced motion: no travel at all, both at rest from the first frame', () => {
    show({ phase: 'in', preference: REDUCED });
    expect(fx.timings).toHaveLength(0);
    expect(scrimValue().v).toBe(1);
    expect(panelValue().v).toBe(1);
  });

  it('a preference that failed to read: no travel', () => {
    show({ phase: 'in', preference: FAILED });
    expect(fx.timings).toHaveLength(0);
    expect(panelValue().v).toBe(1);
  });

  it('a preference not heard yet: it holds, unseen, and travels only once the answer allows it', () => {
    show({ phase: 'in', preference: UNKNOWN });
    expect(fx.timings).toHaveLength(0);
    expect(panelValue().v).toBe(0);
    show({ phase: 'in', preference: KNOWN });
    expect(timingsOf(panelValue())).toHaveLength(1);
    expect(timingsOf(scrimValue())).toHaveLength(1);
  });

  it('a preference not heard yet whose read then fails: at rest at once, no travel', () => {
    show({ phase: 'in', preference: UNKNOWN });
    show({ phase: 'in', preference: FAILED });
    expect(fx.timings).toHaveLength(0);
    expect(panelValue().v).toBe(1);
    expect(scrimValue().v).toBe(1);
  });

  it('a preference not heard yet that answers “reduced”: at rest, no travel', () => {
    show({ phase: 'in', preference: UNKNOWN });
    show({ phase: 'in', preference: REDUCED });
    expect(fx.timings).toHaveLength(0);
    expect(panelValue().v).toBe(1);
    expect(scrimValue().v).toBe(1);
  });

  it('a preference that never answers: at rest after the wait, with no travel', () => {
    vi.useFakeTimers();
    show({ phase: 'in', preference: UNKNOWN });
    act(() => vi.advanceTimersByTime(SHEET_PREFERENCE_WAIT_MS - 1));
    expect(panelValue().v).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(panelValue().v).toBe(1);
    expect(scrimValue().v).toBe(1);
    expect(fx.timings).toHaveLength(0);
    // A late answer does not start a travel after the fact.
    show({ phase: 'in', preference: KNOWN });
    expect(fx.timings).toHaveLength(0);
  });

  it('reduced motion turned on mid-entry ends it at rest', () => {
    show({ phase: 'in', preference: KNOWN });
    show({ phase: 'in', preference: REDUCED });
    expect(timingsOf(panelValue())[0]!.stopped).toBe(true);
    expect(panelValue().v).toBe(1);
  });

  it('React StrictMode (development) re-runs the entry’s effect: the sheet ends at rest, never stuck transparent (RV10-634-N1)', () => {
    act(() =>
      root.render(
        <StrictMode>
          <Sheet phase="in" preference={KNOWN} />
        </StrictMode>,
      ),
    );
    // Whatever StrictMode's re-run left behind is stopped, and both parts are at rest.
    expect(fx.timings.length).toBeGreaterThan(0);
    expect(fx.timings.every((t) => t.stopped || t.value.v === 1)).toBe(true);
    expect((motionStyle('scrim').opacity as { v: number }).v).toBe(1);
    expect((motionStyle('panel').opacity as { v: number }).v).toBe(1);
  });

  it('unmounting mid-entry stops it', () => {
    show({ phase: 'in', preference: KNOWN });
    const runs = fx.timings.slice();
    act(() => root.unmount());
    expect(runs.every((r) => r.stopped)).toBe(true);
    root = createRoot(container);
  });
});

describe('a native sheet goes out', () => {
  it('both reverse over 180 ms, cubic-bezier(.4,0,1,1); the panel takes no presses while it leaves', () => {
    show({ phase: 'in', preference: KNOWN });
    fx.timings.forEach((t) => t.finish());
    show({ phase: 'out', preference: KNOWN });
    const out = fx.timings.slice(2);
    expect(out).toHaveLength(2);
    for (const run of out) {
      expect(run.config).toMatchObject({ toValue: 0, duration: 180, useNativeDriver: true });
      expectEasing(run.config.easing, SHEET_OUT_EASING);
    }
    expect(container.querySelector('[data-testid="panel"]')!.getAttribute('data-pointer-events')).toBe('none');
    // A re-render during the exit does not restart it.
    show({ phase: 'out', preference: { ...KNOWN } });
    expect(fx.timings).toHaveLength(4);
  });

  it('blurred mid-exit (`rest`): stopped, back at rest, and pressable again', () => {
    show({ phase: 'in', preference: KNOWN });
    show({ phase: 'out', preference: KNOWN });
    show({ phase: 'rest', preference: KNOWN });
    expect(timingsOf(panelValue()).filter((t) => t.config.toValue === 0)[0]!.stopped).toBe(true);
    expect(panelValue().v).toBe(1);
    expect(scrimValue().v).toBe(1);
    expect(container.querySelector('[data-testid="panel"]')!.getAttribute('data-pointer-events')).toBe('');
  });

  it('reduced motion turned on mid-exit ends it at once: gone', () => {
    show({ phase: 'in', preference: KNOWN });
    show({ phase: 'out', preference: KNOWN });
    show({ phase: 'out', preference: REDUCED });
    expect(timingsOf(panelValue()).filter((t) => t.config.toValue === 0)[0]!.stopped).toBe(true);
    expect(panelValue().v).toBe(0);
  });
});

describe('the web keeps its own element and its CSS', () => {
  const scrimProps = { style: { flex: 1 }, testID: 'scrim', onPress: () => undefined, ...SCRIM_PROPS, ...(sheetData('scrim', 'in') as object) };
  const panelProps = { style: { padding: 4 }, testID: 'panel', ...(sheetData('panel', 'in') as object) };
  const html = (node: ReactNode) => {
    act(() => root.render(node));
    return container.innerHTML;
  };

  it('vitest’s copy on Platform web: the plain Pressable and View, the same DOM, no motion', () => {
    fx.os = 'web';
    const plain = html(
      <>
        <Pressable {...scrimProps} />
        <View {...panelProps}>
          <Text>inside</Text>
        </View>
      </>,
    );
    const wrapped = html(
      <>
        <SheetScrim {...scrimProps} phase="in" preference={KNOWN} />
        <SheetPanel {...panelProps} phase="in" preference={KNOWN}>
          <Text>inside</Text>
        </SheetPanel>
      </>,
    );
    expect(wrapped).toBe(plain);
    expect(wrapped).toContain('data-wsf-sheet-panel="in"');
    expect(fx.timings).toHaveLength(0);
  });

  it('the web build’s stub (sheetMotionNative.web.ts): no style, and the same DOM', () => {
    fx.os = 'web';
    expect(webStub.useNativeSheetMotion('panel', 'in', { preference: KNOWN })).toBeNull();
    const plain = html(
      <>
        <Pressable {...scrimProps} />
        <View {...panelProps} />
      </>,
    );
    const ref = createRef<View>();
    const stubbed = html(
      <>
        <webStub.SheetScrim {...scrimProps} phase="out" preference={REDUCED} handoff />
        <webStub.SheetPanel {...panelProps} ref={ref} phase="out" preference={REDUCED} part="side" />
      </>,
    );
    expect(stubbed).toBe(plain);
    expect(ref.current).toBe(container.querySelector('[data-testid="panel"]'));
  });

  it('the stub offers what screens import from the native module', () => {
    expect(Object.keys(webStub).sort()).toEqual(['SheetPanel', 'SheetScrim', 'useNativeSheetMotion', 'useSideSwipeToClose']);
    for (const name of Object.keys(webStub)) expect(nativeModule).toHaveProperty(name);
  });
});

type ExitHandle = ReturnType<typeof useSheetExit>;
const ExitProbe = forwardRef<ExitHandle, { still: boolean; withNativeParts: boolean }>(function ExitProbe({ still, withNativeParts }, ref) {
  const sheet = useSheetExit(still);
  useImperativeHandle(ref, () => sheet);
  return (
    <>
      <Text testID="phase">{sheet.phase}</Text>
      {withNativeParts ? <SheetPanel testID="panel" phase={sheet.phase} preference={KNOWN} /> : null}
    </>
  );
});
function mountExit(props: { still?: boolean; withNativeParts?: boolean } = {}) {
  const ref = createRef<ExitHandle>();
  const render = (p: { still?: boolean; withNativeParts?: boolean }) =>
    act(() => root.render(<ExitProbe ref={ref} still={p.still ?? false} withNativeParts={p.withNativeParts ?? true} />));
  render(props);
  const went: number[] = [];
  return {
    exit: () => act(() => ref.current!.exit(() => went.push(Date.now()))),
    went,
    phase: () => container.querySelector('[data-testid="phase"]')!.textContent,
    render,
  };
}

describe('useSheetExit on iOS and Android', () => {
  it('a sheet that plays its exit: navigation only after 180 ms, and a second Close is ignored', () => {
    vi.useFakeTimers();
    const s = mountExit();
    s.exit();
    expect(s.phase()).toBe('out');
    s.exit(); // a second Close during the exit
    act(() => vi.advanceTimersByTime(SHEET_OUT_MS - 1));
    expect(s.went).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(s.went).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(s.went).toHaveLength(1);
  });

  it('blurred during the exit: cancelled, never navigates, back at rest', () => {
    vi.useFakeTimers();
    const s = mountExit();
    s.exit();
    emit('blur');
    act(() => vi.advanceTimersByTime(1000));
    expect(s.went).toHaveLength(0);
    expect(s.phase()).toBe('rest');
  });

  it('the timer fires but the sheet is no longer in front (its blur not delivered yet): no navigation, back at rest, and a later Close works', () => {
    vi.useFakeTimers();
    const s = mountExit();
    s.exit();
    nav.focused = false;
    act(() => vi.advanceTimersByTime(SHEET_OUT_MS));
    expect(s.went).toHaveLength(0);
    // Abandoned as a blur would: visible and pressable again, not stuck mid-exit (RV10-634-N2).
    expect(s.phase()).toBe('rest');
    expect(container.querySelector('[data-testid="panel"]')!.getAttribute('data-pointer-events')).toBe('');
    emit('blur'); // the late blur changes nothing
    expect(s.phase()).toBe('rest');
    nav.focused = true; // in front again
    s.exit();
    expect(s.phase()).toBe('out');
    act(() => vi.advanceTimersByTime(SHEET_OUT_MS));
    expect(s.went).toHaveLength(1);
  });

  it('reduced motion, or a preference not heard yet: no wait, no exit phase', () => {
    vi.useFakeTimers();
    for (const still of [sheetHoldsStill(REDUCED), sheetHoldsStill(UNKNOWN)]) {
      freshNavigation();
      const s = mountExit({ still });
      s.exit();
      expect(s.went).toHaveLength(1);
      expect(s.phase()).toBe('in');
      act(() => root.unmount());
      root = createRoot(container);
    }
    expect(fx.timings.filter((t) => t.config.toValue === 0)).toHaveLength(0);
  });

  it('a sheet with no native exit yet (the contribution sheet, Settings): navigates at once, as before', () => {
    const s = mountExit({ withNativeParts: false });
    s.exit();
    expect(s.went).toHaveLength(1);
  });

  it('once the native parts unmount, the screen no longer waits', () => {
    const s = mountExit();
    s.render({ withNativeParts: false });
    s.exit();
    expect(s.went).toHaveLength(1);
  });

  it('sheetHoldsStill: only `reduced` on the web; reduced or not yet heard on native', () => {
    fx.os = 'web';
    expect(sheetHoldsStill(UNKNOWN)).toBe(false);
    expect(sheetHoldsStill(REDUCED)).toBe(true);
    expect(sheetHoldsStill(KNOWN)).toBe(false);
    for (const os of ['ios', 'android'] as const) {
      fx.os = os;
      expect(sheetHoldsStill(UNKNOWN)).toBe(true);
      expect(sheetHoldsStill(FAILED)).toBe(true);
      expect(sheetHoldsStill(REDUCED)).toBe(true);
      expect(sheetHoldsStill(KNOWN)).toBe(false);
    }
  });
});

describe('useSheetExit on the web is unchanged', () => {
  it('waits 180 ms with or without native parts; reduced motion goes at once', () => {
    vi.useFakeTimers();
    fx.os = 'web';
    for (const withNativeParts of [false, true]) {
      freshNavigation();
      const s = mountExit({ withNativeParts });
      s.exit();
      expect(s.phase()).toBe('out');
      act(() => vi.advanceTimersByTime(SHEET_OUT_MS - 1));
      expect(s.went).toHaveLength(0);
      act(() => vi.advanceTimersByTime(1));
      expect(s.went).toHaveLength(1);
      act(() => root.unmount());
      root = createRoot(container);
    }
    freshNavigation();
    const r = mountExit({ still: true });
    r.exit();
    expect(r.went).toHaveLength(1);
  });
});

describe('MOVE’s resolver', () => {
  const closeParentChildren = () => container.querySelector('[data-testid="wsf-move-close"]')!.parentElement!.children.length;

  it('on iOS and Android: the animated scrim and panel, no grabber, and Close waits for the 180 ms exit', () => {
    vi.useFakeTimers();
    for (const os of ['ios', 'android'] as const) {
      fx.os = os;
      fx.timings.length = 0;
      freshNavigation();
      nav.back = [];
      act(() => root.render(<MoveResolver />));
      expect(container.querySelector('[data-testid="wsf-move-scrim"]')!.getAttribute('data-animated')).toBe('pressable');
      expect(container.querySelector('[data-testid="wsf-move-sheet"]')!.getAttribute('data-animated')).toBe('view');
      expect(closeParentChildren()).toBe(1); // Close only: no grabber
      // W14-5 (INT-17): VoiceOver stays in the sheet on iOS; nothing on Android.
      if (os === 'ios') expect(fx.props['wsf-move-sheet']).toMatchObject({ accessibilityViewIsModal: true });
      else expect(fx.props['wsf-move-sheet']).not.toHaveProperty('accessibilityViewIsModal');
      expect(fx.timings.filter((t) => t.config.toValue === 1)).toHaveLength(2); // scrim fade + panel rise
      act(() => (container.querySelector('[data-testid="wsf-move-scrim"]') as HTMLElement).click());
      act(() => (container.querySelector('[data-testid="wsf-move-scrim"]') as HTMLElement).click());
      expect(fx.timings.filter((t) => t.config.toValue === 0)).toHaveLength(2);
      act(() => vi.advanceTimersByTime(SHEET_OUT_MS - 1));
      expect(nav.back).toEqual([]);
      act(() => vi.advanceTimersByTime(1));
      expect(nav.back).toEqual(['back']);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('on iOS with reduced motion: no travel, and Close goes at once', () => {
    pref.current = REDUCED;
    act(() => root.render(<MoveResolver />));
    expect(fx.timings).toHaveLength(0);
    act(() => (container.querySelector('[data-testid="wsf-move-scrim"]') as HTMLElement).click());
    expect(nav.back).toEqual(['back']);
  });

  it('on the web: the grabber is drawn, and the scrim and panel are the plain elements with their CSS phase', () => {
    fx.os = 'web';
    act(() => root.render(<MoveResolver />));
    expect(closeParentChildren()).toBe(2); // grabber + Close
    const panel = container.querySelector('[data-testid="wsf-move-sheet"]')!;
    expect(panel.getAttribute('data-animated')).toBeNull();
    expect(panel.getAttribute('data-wsf-sheet-panel')).toBe('in');
    expect(container.querySelector('[data-testid="wsf-move-scrim"]')!.getAttribute('data-wsf-sheet-scrim')).toBe('in');
    expect(fx.timings).toHaveLength(0);
  });
});

describe('app/_layout.tsx presents MOVE without the stack’s travel', () => {
  const layout = readFileSync(nodePath.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
  const screen = (name: string) => {
    const start = layout.indexOf(`name="${name}"`);
    expect(start).toBeGreaterThan(-1);
    return layout.slice(start, layout.indexOf('/>', start));
  };

  it('move/index: a transparent modal with `animation: none` on every platform (the sheet moves itself)', () => {
    const block = screen('move/index');
    expect(block).toContain("presentation: 'transparentModal'");
    expect(block).toMatch(/animation: 'none',/);
    expect(block).not.toContain('slide_from_bottom');
  });

  it('the contribution sheet keeps the stack’s travel until its screen swaps; Settings moves itself (W14-5)', () => {
    expect(screen('contribute/[goalId]')).toContain("animation: reduced ? 'none' : 'slide_from_bottom'");
    expect(screen('settings')).toMatch(/animation: 'none',/);
  });
});
