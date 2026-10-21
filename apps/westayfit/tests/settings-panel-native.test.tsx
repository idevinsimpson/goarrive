import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Easing, StyleSheet, View as RNView } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MO-03 (W14-5) — Settings over the member tabs, on iOS and Android: the side
 * panel's own motion (SheetScrim / SheetPanel part="side",
 * src/ui/sheetMotionNative.tsx), the swipe that closes it, the lift token
 * (src/ui/lift.ts) and modal containment (src/ui/modalA11y.ts). The real
 * screen is rendered; its data sections are stubbed.
 *
 * `Animated` is a controllable fake (react-native-web serves AnimatedMock in
 * vitest), PanResponder records the config it is given, Platform.OS is
 * switchable, and every plain View with a testID records its props. The lift
 * and modal tokens are routed per platform as Metro resolves their twins
 * (their values are tested in lift-tokens and focus-return-native); here they
 * are sentinels, so a test can see the screen spread exactly the token.
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
  animated: {} as Record<string, Record<string, any>>,
  plain: {} as Record<string, Record<string, any>>,
  pan: null as null | Record<string, (...args: any[]) => any>,
  pref: { reduced: false, known: true, failed: false },
  back: [] as string[],
}));

const LIFT = vi.hoisted(() => ({
  ios: Object.freeze({ boxShadow: 'IOS-PANEL-LIFT' }),
  android: Object.freeze({ elevation: 12 }),
  web: Object.freeze({}),
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
  const host = (kind: string) =>
    React.forwardRef(function AnimatedHost(props: Record<string, any>, ref: React.Ref<HTMLDivElement>) {
      fx.animated[props.testID ?? kind] = props;
      return React.createElement(
        'div',
        { ref, 'data-testid': props.testID, 'data-animated': kind, onClick: () => props.onPress?.() },
        props.children,
      );
    });
  const View = React.forwardRef(function RecordedView(props: Record<string, any>, ref) {
    if (typeof props.testID === 'string') fx.plain[props.testID] = props;
    return React.createElement(actual.View, { ...props, ref });
  });
  return {
    ...actual,
    View,
    Platform: {
      ...actual.Platform,
      get OS() {
        return fx.os;
      },
      select: (o: Record<string, unknown>) =>
        fx.os in o ? o[fx.os] : fx.os !== 'web' && 'native' in o ? o.native : o.default,
    },
    Animated: { ...actual.Animated, Value, timing, View: host('view'), createAnimatedComponent: () => host('pressable') },
    PanResponder: {
      create: (config: Record<string, (...args: any[]) => any>) => {
        fx.pan = config;
        const handler = () => undefined;
        return {
          panHandlers: {
            onMoveShouldSetResponder: handler,
            onMoveShouldSetResponderCapture: handler,
            onStartShouldSetResponder: handler,
            onStartShouldSetResponderCapture: handler,
            onResponderGrant: handler,
            onResponderMove: handler,
            onResponderRelease: handler,
            onResponderTerminate: handler,
            onResponderTerminationRequest: handler,
          },
        };
      },
    },
  };
});

// One navigation object per screen, as the navigator gives (the native sheet
// parts claim it, and useSheetExit asks about the same object).
const nav = vi.hoisted(() => {
  const state = { listeners: {} as Record<string, Array<() => void>> };
  const navigation = {
    getState: () => ({ index: 1, routes: [{ key: 'tabs', name: '(tabs)' }, { key: 'settings-1', name: 'settings' }] }),
    addListener: (event: string, cb: () => void) => {
      (state.listeners[event] ??= []).push(cb);
      return () => {
        state.listeners[event] = (state.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
    isFocused: () => true,
  };
  return Object.assign(state, { navigation });
});
vi.mock('expo-router', () => ({
  useNavigation: () => nav.navigation,
  router: {
    back: () => fx.back.push('back'),
    canGoBack: () => true,
    replace: (href: string) => fx.back.push(`replace ${href}`),
  },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: { uid: 'u1' } }) }));
// No backend is ever configured here. On an integrated tree Settings reaches
// the state lane's session modules (kioskSession → postAuthDestination →
// firebase), whose native configuration refuses at load without one.
vi.mock('../src/firebase', () => ({
  getFirebaseApp: () => ({}),
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfIsStaging: false,
  wsfUsingEmulators: false,
  wsfFirebaseProjectId: 'test-project',
}));
vi.mock('../src/movement-camera/MoveCameraSettingsSection', () => ({ MoveCameraSettingsSection: () => null }));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({ CommunityPrivacyControls: () => null }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => fx.pref.reduced,
  useReducedMotionPreference: () => fx.pref,
}));
vi.mock('../src/ui/lift', () => ({
  get lift() {
    return { panel: LIFT[fx.os], tabBar: {}, knob: {} };
  },
}));
vi.mock('../src/ui/modalA11y', () => ({
  get modalPanelA11y() {
    return fx.os === 'ios' ? { accessibilityViewIsModal: true } : {};
  },
}));

import SettingsScreen from '../app/settings';
import {
  SHEET_IN_EASING,
  SHEET_OUT_EASING,
  SHEET_PREFERENCE_WAIT_MS,
  SIDE_FLICK_MIN_PT,
  SIDE_FLICK_VX,
  SIDE_SWIPE_CLAIM_PT,
  SIDE_SWIPE_CLOSE_PT,
} from '../src/ui/sheetMotionNative';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  fx.os = 'ios';
  fx.values.length = 0;
  fx.timings.length = 0;
  fx.animated = {};
  fx.plain = {};
  fx.pan = null;
  fx.pref = { reduced: false, known: true, failed: false };
  fx.back = [];
  nav.listeners = {};
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const show = () => act(() => root.render(<SettingsScreen />));
const press = (testID: string) => act(() => (container.querySelector(`[data-testid="${testID}"]`) as HTMLElement).click());
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const motionOf = (testID: string) => {
  const style = fx.animated[testID]!.style as unknown[];
  return style[style.length - 1] as { opacity: { v: number }; transform?: Array<Record<string, Interp>> };
};
const bezierAt = (b: readonly number[], t: number) => Easing.bezier(b[0]!, b[1]!, b[2]!, b[3]!)(t);
const expectEasing = (fn: (t: number) => number, b: readonly number[]) => {
  for (const t of [0.1, 0.5, 0.9]) expect(fn(t)).toBeCloseTo(bezierAt(b, t), 6);
};
const ins = () => fx.timings.filter((t) => t.config.toValue === 1);
const outs = () => fx.timings.filter((t) => t.config.toValue === 0);

describe('iOS and Android: the side panel moves itself', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: comes in 32 pt from the right over 240 ms while the scrim fades in place; leaves in 180 ms, then closes`, () => {
      fx.os = os;
      show();
      const panel = motionOf('wsf-settings-panel');
      expect(panel.transform![0]!.translateX).toMatchObject({ cfg: { inputRange: [0, 1], outputRange: [32, 0] } });
      expect(motionOf('wsf-settings-scrim')).toEqual({ opacity: expect.anything() });
      expect(motionOf('wsf-settings-scrim').transform).toBeUndefined(); // the scrim never travels
      expect(ins()).toHaveLength(2);
      for (const run of ins()) expect(run.config).toMatchObject({ duration: 240, useNativeDriver: true });
      expectEasing(ins().find((t) => t.value === panel.opacity)!.config.easing, SHEET_IN_EASING);
      ins().forEach((t) => t.finish());

      press('wsf-settings-close');
      press('wsf-settings-close'); // a second Close during the exit
      expect(outs()).toHaveLength(2);
      for (const run of outs()) {
        expect(run.config).toMatchObject({ duration: 180, useNativeDriver: true });
        expectEasing(run.config.easing, SHEET_OUT_EASING);
      }
      advance(179);
      expect(fx.back).toEqual([]);
      advance(1);
      expect(fx.back).toEqual(['back']);
    });
  }

  it('reduced motion: no travel, and Close goes at once', () => {
    fx.pref = { reduced: true, known: true, failed: false };
    show();
    expect(fx.timings).toHaveLength(0);
    press('wsf-settings-close');
    expect(fx.back).toEqual(['back']);
  });

  for (const os of ['ios', 'android'] as const) {
    it(`${os}: a preference not heard yet: the panel is held unseen, and Close goes at once (no exit nobody sees; sheetHoldsStill, as MOVE) (RV12-634-F1)`, () => {
      fx.os = os;
      fx.pref = { reduced: false, known: false, failed: false };
      show();
      expect(fx.timings).toHaveLength(0);
      press('wsf-settings-close');
      expect(outs()).toHaveLength(0);
      expect(fx.back).toEqual(['back']);
    });

    it(`${os}: a preference whose read failed: at rest, no travel, and Close goes at once`, () => {
      fx.os = os;
      fx.pref = { reduced: false, known: false, failed: true };
      show();
      expect(fx.timings).toHaveLength(0);
      press('wsf-settings-close');
      expect(outs()).toHaveLength(0);
      expect(fx.back).toEqual(['back']);
    });

    it(`${os}: a preference that never answers: at rest after the wait, and Close still goes at once`, () => {
      fx.os = os;
      fx.pref = { reduced: false, known: false, failed: false };
      show();
      advance(SHEET_PREFERENCE_WAIT_MS);
      expect(motionOf('wsf-settings-panel').opacity.v).toBe(1);
      press('wsf-settings-close');
      expect(outs()).toHaveLength(0);
      expect(fx.back).toEqual(['back']);
    });
  }

  it('the web: a preference read is never pending there, so Close waits out the CSS exit exactly as before', () => {
    fx.os = 'web';
    fx.pref = { reduced: false, known: false, failed: false };
    show();
    press('wsf-settings-close');
    advance(179);
    expect(fx.back).toEqual([]);
    advance(1);
    expect(fx.back).toEqual(['back']);
  });

  it('Close reads the preference through sheetHoldsStill, as MOVE does; the bare boolean is gone', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../app/settings.tsx'), 'utf8');
    expect(src).toMatch(/useSheetExit\(sheetHoldsStill\(motionPreference\)\)/);
    expect(src).not.toMatch(/useReducedMotion\(\)/);
  });
});

describe('a rightward swipe closes it (native only)', () => {
  it('claims a clearly rightward drag (past 16 pt, more than twice as far across as down), and never a vertical scroll or a leftward drag', () => {
    expect(SIDE_SWIPE_CLAIM_PT).toBe(16);
    show();
    const claims = (g: { dx: number; dy: number }) => fx.pan!.onMoveShouldSetPanResponder!({}, g);
    expect(claims({ dx: 20, dy: 3 })).toBe(true);
    expect(claims({ dx: 17, dy: 0 })).toBe(true);
    expect(claims({ dx: 16, dy: 0 })).toBe(false);
    expect(claims({ dx: 5, dy: 0 })).toBe(false);
    expect(claims({ dx: 20, dy: 10 })).toBe(false);
    expect(claims({ dx: 21, dy: -10 })).toBe(true);
    expect(claims({ dx: 20, dy: 30 })).toBe(false);
    expect(claims({ dx: -40, dy: 0 })).toBe(false);
  });

  const release = (g: { dx: number; vx: number }) => act(() => fx.pan!.onPanResponderRelease!({}, { dy: 0, ...g }));

  it('released past 60 pt, or flicked past 30 pt, it closes through Close (the same 180 ms exit); short and slow, it stays', () => {
    expect(SIDE_SWIPE_CLOSE_PT).toBe(60);
    show();
    ins().forEach((t) => t.finish());
    release({ dx: 40, vx: 0.2 });
    release({ dx: 60, vx: 0 });
    expect(outs()).toHaveLength(0);
    release({ dx: 61, vx: 0 });
    expect(outs()).toHaveLength(2);
    advance(180);
    expect(fx.back).toEqual(['back']);
  });

  it('a fast flick past 30 pt closes it short of the distance', () => {
    expect(SIDE_FLICK_MIN_PT).toBe(30);
    show();
    ins().forEach((t) => t.finish());
    release({ dx: 31, vx: SIDE_FLICK_VX + 0.1 });
    advance(180);
    expect(fx.back).toEqual(['back']);
  });

  it('a flick no longer than a switch’s slide (24 pt or less, up to 30 pt) never closes it (RV12-634-F3)', () => {
    show();
    ins().forEach((t) => t.finish());
    for (const dx of [8, 16, 24, 30]) release({ dx, vx: 2 });
    release({ dx: 30, vx: SIDE_FLICK_VX + 0.1 });
    expect(outs()).toHaveLength(0);
    advance(1000);
    expect(fx.back).toEqual([]);
  });

  it('a leftward release never closes it, however fast the flick reads (RV12-634-F7)', () => {
    show();
    ins().forEach((t) => t.finish());
    release({ dx: -10, vx: 0.9 });
    release({ dx: -80, vx: 0.9 });
    release({ dx: 0, vx: 0.9 });
    expect(outs()).toHaveLength(0);
    advance(1000);
    expect(fx.back).toEqual([]);
  });

  it('the panel carries the swipe’s handlers on iOS and Android; on the web it has none', () => {
    for (const os of ['ios', 'android'] as const) {
      fx.os = os;
      show();
      expect(fx.animated['wsf-settings-panel']).toHaveProperty('onResponderRelease');
      expect(fx.animated['wsf-settings-panel']).toHaveProperty('onMoveShouldSetResponder');
      act(() => root.unmount());
      root = createRoot(container);
    }
    fx.os = 'web';
    show();
    const web = fx.plain['wsf-settings-panel']!;
    expect(Object.keys(web).filter((k) => /Responder/.test(k))).toEqual([]);
  });
});

describe('lift and containment', () => {
  it('the panel lifts with the platform’s token, after its own style (iOS boxShadow, Android elevation, web nothing)', () => {
    for (const os of ['ios', 'android'] as const) {
      fx.os = os;
      show();
      const style = fx.animated['wsf-settings-panel']!.style as unknown[];
      expect(style[0]).toEqual([expect.objectContaining({ maxWidth: 380, borderRadius: 8 }), LIFT[os]]);
      act(() => root.unmount());
      root = createRoot(container);
    }
    fx.os = 'web';
    show();
    expect(fx.plain['wsf-settings-panel']!.style).toEqual([expect.objectContaining({ maxWidth: 380 }), LIFT.web]);
  });

  it('VoiceOver stays in the panel on iOS (accessibilityViewIsModal); Android and the web get nothing new, and the web keeps aria-modal', () => {
    show();
    expect(fx.animated['wsf-settings-panel']).toMatchObject({ accessibilityViewIsModal: true, 'aria-modal': true });
    act(() => root.unmount());
    root = createRoot(container);
    fx.os = 'android';
    show();
    expect(fx.animated['wsf-settings-panel']).not.toHaveProperty('accessibilityViewIsModal');
    act(() => root.unmount());
    root = createRoot(container);
    fx.os = 'web';
    show();
    expect(fx.plain['wsf-settings-panel']).not.toHaveProperty('accessibilityViewIsModal');
    const el = container.querySelector('[data-testid="wsf-settings-panel"]')!;
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.getAttribute('role')).toBe('dialog');
  });

  it('the web panel element is the View it was: same attributes, same CSS phase, the empty token adding nothing', () => {
    fx.os = 'web';
    show();
    const actual = container.querySelector('[data-testid="wsf-settings-panel"]')!.cloneNode(false) as HTMLElement;
    // The panel as it stands in app/settings.tsx (st.panel), as literal values,
    // not read back from the screen (RV11-634-N1).
    const literal = StyleSheet.create({
      panel: {
        width: '100%',
        maxWidth: 380,
        height: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        overflow: 'hidden',
        shadowColor: '#081D36',
        shadowOpacity: 0.3,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 20 },
      },
    });
    const reference = document.createElement('div');
    const refRoot = createRoot(reference);
    act(() =>
      refRoot.render(
        <RNView
          style={literal.panel}
          testID="wsf-settings-panel"
          {...({ role: 'dialog', 'aria-modal': true, 'aria-label': 'Settings' } as Record<string, unknown>)}
          {...({ dataSet: { wsfSidePanel: 'in' } } as Record<string, unknown>)}
        />,
      ),
    );
    expect(actual.outerHTML).toBe((reference.firstElementChild!.cloneNode(false) as HTMLElement).outerHTML);
    expect(actual.getAttribute('data-wsf-side-panel')).toBe('in');
    act(() => refRoot.unmount());
  });
});

describe('app/_layout.tsx', () => {
  it('Settings over the tabs is presented without the stack’s travel (the panel moves itself)', () => {
    const layout = readFileSync(nodePath.resolve(__dirname, '../app/_layout.tsx'), 'utf8');
    const start = layout.indexOf('name="settings"');
    const block = layout.slice(start, layout.indexOf('/>', start));
    expect(block).toContain("presentation: 'transparentModal'");
    expect(block).toMatch(/animation: 'none',/);
    expect(block).not.toContain('slide_from_right');
  });
});
