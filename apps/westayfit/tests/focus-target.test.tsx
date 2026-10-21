import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-17 (W12-9, W14-K3) — src/ui/focusTarget(.native).ts, the shared files'
 * door to the native focus registry. The web twin is strict no-ops; the
 * native twin IS focusReturn.native's registry and accessibilityFocus's
 * focus helper, so a control registered through it is the one a closing flow
 * returns to. Both twins are imported directly (vitest applies no platform
 * extensions); AccessibilityInfo, findNodeHandle, InteractionManager and the
 * navigator are faked.
 */

const rn = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  focused: [] as unknown[],
  tasks: [] as Array<{ run: () => void; cancelled: boolean }>,
  interactionCalls: 0,
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return rn.os;
      },
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: (tag: unknown) => {
        rn.focused.push(tag);
      },
    },
    findNodeHandle: (instance: { tag?: number } | null) => instance?.tag ?? null,
    InteractionManager: {
      runAfterInteractions: (run: () => void) => {
        rn.interactionCalls += 1;
        const task = { run, cancelled: false };
        rn.tasks.push(task);
        return { cancel: () => (task.cancelled = true) };
      },
    },
  };
});

const nav = vi.hoisted(() => {
  const state = { listeners: {} as Record<string, Array<() => void>>, top: 'settings' };
  const navigation = {
    addListener: (event: string, cb: () => void) => {
      (state.listeners[event] ??= []).push(cb);
      return () => {
        state.listeners[event] = (state.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
    getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: state.top }] }),
  };
  return Object.assign(state, { navigation });
});
vi.mock('expo-router', () => ({ useNavigation: () => nav.navigation }));

import { focusAccessibilitySoon } from '../src/ui/accessibilityFocus';
import * as focusReturnNative from '../src/ui/focusReturn.native';
import * as web from '../src/ui/focusTarget';
import * as native from '../src/ui/focusTarget.native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  rn.os = 'ios';
  rn.focused = [];
  rn.tasks = [];
  rn.interactionCalls = 0;
  nav.listeners = {};
  nav.top = 'settings';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  cleanups.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

const settle = () =>
  act(() => {
    for (const t of rn.tasks.splice(0)) if (!t.cancelled) t.run();
    vi.advanceTimersByTime(400);
  });
const emit = (event: 'blur' | 'focus') => act(() => (nav.listeners[event] ?? []).slice().forEach((cb) => cb()));

function Tabs() {
  const ref = useRef(null);
  focusReturnNative.useTabsFocusReturn(ref);
  return null;
}

describe('the web twin: strict no-ops', () => {
  it('registering and focusing do nothing: no AccessibilityInfo call, no interaction task, no timer', () => {
    rn.os = 'web';
    const off = web.registerFocusTarget('wsf-member-topbar-menu-button', { current: { tag: 11 } });
    const cancel = web.focusSoon({ current: { tag: 11 } });
    expect(typeof off).toBe('function');
    expect(typeof cancel).toBe('function');
    off();
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(rn.focused).toEqual([]);
    expect(rn.interactionCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a target registered through the web twin never reaches the native registry', () => {
    cleanups.push(web.registerFocusTarget('wsf-member-tab-move', { current: { tag: 7 } }));
    focusReturnNative.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, []);
    settle();
    expect(rn.interactionCalls).toBe(0);
    expect(rn.focused).toEqual([]);
  });
});

describe('the native twin is the native registry and focus helper', () => {
  it('delegates: the very same functions', () => {
    expect(native.registerFocusTarget).toBe(focusReturnNative.registerFocusTarget);
    expect(native.focusSoon).toBe(focusAccessibilitySoon);
  });

  it('ONE registry, however it is reached: registered through focusTarget, armed through focusReturn, focus lands', () => {
    cleanups.push(native.registerFocusTarget('wsf-member-topbar-menu-button', { current: { tag: 11 } }));
    act(() => root.render(<Tabs />));
    focusReturnNative.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    emit('blur'); // Settings covers the tabs
    emit('focus'); // and closes
    settle();
    expect(rn.focused).toEqual([11]);
  });

  it('focusSoon moves focus once the navigation settles (about 400 ms on iOS), and cancels', () => {
    native.focusSoon({ current: { tag: 5 } });
    act(() => {
      for (const t of rn.tasks.splice(0)) t.run();
    });
    act(() => vi.advanceTimersByTime(399));
    expect(rn.focused).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(rn.focused).toEqual([5]);
    const cancel = native.focusSoon({ current: { tag: 6 } });
    cancel();
    settle();
    expect(rn.focused).toEqual([5]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('both twins', () => {
  it('export the same names with the same arity', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
    expect(Object.keys(web).sort()).toEqual(['focusSoon', 'registerFocusTarget']);
    expect(web.registerFocusTarget.length).toBe(native.registerFocusTarget.length);
    expect(web.focusSoon.length).toBe(native.focusSoon.length);
  });
});
