import { act, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-17 (W12-9) — the native focus helpers: focusReturn.native.ts (the
 * registry, the return on close, per-opener return, and the strict no-op with
 * nothing registered), modalA11y(.native).ts and stepHeadingFocus(.native).ts.
 * The native twins are imported directly (vitest applies no platform
 * extensions). AccessibilityInfo, findNodeHandle, InteractionManager, Platform
 * and the navigator are faked; timers are fake, so the iOS 400 ms is exact.
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
      select: (o: Record<string, unknown>) =>
        rn.os in o ? o[rn.os] : rn.os !== 'web' && 'native' in o ? o.native : o.default,
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

const nav = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
  listeners: {} as Record<string, Array<() => void>>,
  top: 'move/index',
}));
function freshNavigation() {
  nav.listeners = {};
  nav.current = {
    addListener: (event: string, cb: () => void) => {
      (nav.listeners[event] ??= []).push(cb);
      return () => {
        nav.listeners[event] = (nav.listeners[event] ?? []).filter((x) => x !== cb);
      };
    },
    getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: nav.top }] }),
  };
}
vi.mock('expo-router', () => ({ useNavigation: () => nav.current }));

import * as focusReturn from '../src/ui/focusReturn.native';
import { useStepHeadingFocus } from '../src/ui/stepHeadingFocus.native';
import * as stepHeadingWeb from '../src/ui/stepHeadingFocus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const unregister: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  rn.os = 'ios';
  rn.focused = [];
  rn.tasks = [];
  rn.interactionCalls = 0;
  nav.top = 'move/index';
  freshNavigation();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  unregister.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

const target = (testId: string, tag: number) => {
  const ref = { current: { tag } as unknown };
  unregister.push(focusReturn.registerFocusTarget(testId, ref));
  return ref;
};
const emit = (event: 'blur' | 'focus') => act(() => (nav.listeners[event] ?? []).slice().forEach((cb) => cb()));
/** The navigation settles: pending interaction tasks run. */
const interactionsDone = () =>
  act(() => {
    for (const t of rn.tasks.splice(0)) if (!t.cancelled) t.run();
  });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function Tabs() {
  const ref = useRef(null);
  focusReturn.useTabsFocusReturn(ref);
  return null;
}
function Sheet() {
  const ref = useRef(null);
  focusReturn.useSheetFocusReturn(ref);
  return null;
}
const mount = (node: React.ReactNode) => act(() => root.render(node));

describe('the registry', () => {
  it('a target registers by testID; unregistering removes only that registration', () => {
    const first = { current: { tag: 1 } };
    const second = { current: { tag: 2 } };
    const offFirst = focusReturn.registerFocusTarget('wsf-member-tab-move', first);
    const offSecond = focusReturn.registerFocusTarget('wsf-member-tab-move', second); // remounted
    offFirst(); // the old instance's cleanup runs late
    const cancel = focusReturn.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, []);
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([2]);
    cancel();
    offSecond();
    focusReturn.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, []);
    expect(rn.interactionCalls).toBe(1); // nothing registered any more: nothing scheduled
  });
});

describe('focus goes back when the flow closes', () => {
  it('iOS: MOVE closes → the MOVE button, after the navigation settles and about 400 ms', () => {
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    emit('blur'); // MOVE's resolver covers the tabs
    emit('focus'); // and closes
    expect(rn.focused).toEqual([]);
    interactionsDone();
    advance(399);
    expect(rn.focused).toEqual([]);
    advance(1);
    expect(rn.focused).toEqual([7]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Android: as soon as the navigation settles, with no timer', () => {
    rn.os = 'android';
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    emit('blur');
    emit('focus');
    interactionsDone();
    expect(rn.focused).toEqual([7]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Settings from the menu and from the You row each return to their own opener', () => {
    target('wsf-member-topbar-menu-button', 11);
    target('wsf-you-settings', 12);
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    nav.top = 'settings';
    focusReturn.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    focusReturn.armTabsFocusReturnTo('wsf-you-settings');
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([11, 12]);
  });

  it('a named opener is used once; covering by something that is not a flow arms nothing', () => {
    target('wsf-member-topbar-menu-button', 11);
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    nav.top = 'settings';
    focusReturn.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    nav.top = 'health'; // an ordinary page pushed over the tabs
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([11]);
    nav.top = 'move/index'; // then MOVE: its own opener, not the menu again
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([11, 7]);
  });

  it('a target that has unmounted by then is skipped', () => {
    const ref = target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    emit('blur');
    emit('focus');
    ref.current = null;
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([]);
  });
});

describe('pending focus is cancelled', () => {
  it('unmounting before the navigation settles cancels the task; after it, clears the timer', () => {
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    emit('blur');
    emit('focus');
    const [task] = rn.tasks;
    act(() => root.unmount());
    root = createRoot(container);
    expect(task!.cancelled).toBe(true);
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([]);

    mount(<Tabs />);
    emit('blur');
    emit('focus');
    interactionsDone(); // the 400 ms timer is now pending
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);
    expect(vi.getTimerCount()).toBe(0);
    advance(400);
    expect(rn.focused).toEqual([]);
  });

  it('covered again before it lands: cancelled', () => {
    target('wsf-member-tab-move', 7);
    mount(<Tabs />);
    emit('blur');
    emit('focus');
    interactionsDone();
    emit('blur'); // MOVE again, within the 400 ms
    advance(400);
    expect(rn.focused).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('NOTHING REGISTERED, NOTHING HAPPENS (what merging the kit changes before any site registers)', () => {
  it('every export is a strict no-op: no focus call, no interaction task, no timer', () => {
    focusReturn.armTabsFocusReturn();
    focusReturn.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    const cancel = focusReturn.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, [
      { selector: 'h1' },
    ]);
    cancel();
    mount(
      <>
        <Tabs />
        <Sheet />
      </>,
    );
    for (const top of ['move/index', 'contribute/[goalId]', 'settings']) {
      nav.top = top;
      emit('blur');
      emit('focus');
    }
    act(() => root.unmount());
    root = createRoot(container);
    mount(<Tabs />); // remount after a flow that replaced the tabs
    advance(10_000);
    expect(rn.focused).toEqual([]);
    expect(rn.interactionCalls).toBe(0);
    expect(rn.tasks).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the MOVE sheet’s half', () => {
  it('back from a goal’s flow: to the named row, else to the sheet’s Close', () => {
    target('wsf-move-close', 21);
    target('wsf-move-choose-g1', 22);
    mount(<Sheet />);
    focusReturn.armTabsFocusReturnTo('wsf-move-choose-g1');
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    emit('blur'); // nothing named this time
    emit('focus');
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([22, 21]);
  });

  it('a named row that is not registered falls back to Close', () => {
    target('wsf-move-close', 21);
    mount(<Sheet />);
    focusReturn.armTabsFocusReturnTo('wsf-move-choose-g9');
    emit('blur');
    emit('focus');
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([21]);
  });
});

describe('modalPanelA11y', () => {
  const load = async (os: 'ios' | 'android' | 'web', file: '../src/ui/modalA11y.native' | '../src/ui/modalA11y') => {
    rn.os = os;
    vi.resetModules();
    return (await import(file)).modalPanelA11y;
  };

  it('iOS: accessibilityViewIsModal; Android: nothing; the web twin: nothing', async () => {
    expect(await load('ios', '../src/ui/modalA11y.native')).toEqual({ accessibilityViewIsModal: true });
    expect(await load('android', '../src/ui/modalA11y.native')).toEqual({});
    expect(await load('web', '../src/ui/modalA11y')).toEqual({});
    expect(await load('ios', '../src/ui/modalA11y')).toEqual({}); // the web build's module, whatever the OS says
  });
});

describe('useStepHeadingFocus', () => {
  function Step({ step, tag = 31 }: { step: string | null; tag?: number }) {
    const heading = useRef<unknown>({ tag });
    useStepHeadingFocus(step, heading);
    return null;
  }
  function WebStep({ step }: { step: string }) {
    const heading = useRef<unknown>({ tag: 31 });
    stepHeadingWeb.useStepHeadingFocus(step, heading);
    return null;
  }

  it('not on the first mount; a step change focuses the new heading once it settles', () => {
    mount(<Step step="count" />);
    interactionsDone();
    advance(400);
    expect(rn.interactionCalls).toBe(0);
    mount(<Step step="review" />);
    interactionsDone();
    advance(399);
    expect(rn.focused).toEqual([]);
    advance(1);
    expect(rn.focused).toEqual([31]);
    mount(<Step step="review" />); // a re-render is not a step change
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31]);
    mount(<Step step="count" />); // back to the earlier step: a change again
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31, 31]);
  });

  it('React StrictMode’s development re-run of the mount is not a step change: nothing is focused on the first mount', () => {
    mount(
      <StrictMode>
        <Step step="count" />
      </StrictMode>,
    );
    interactionsDone();
    advance(400);
    expect(rn.interactionCalls).toBe(0);
    expect(rn.focused).toEqual([]);
    mount(
      <StrictMode>
        <Step step="review" />
      </StrictMode>,
    );
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31]);
  });

  it('a change before it lands cancels the earlier one; a null step is no step; unmount cancels', () => {
    mount(<Step step="count" />);
    mount(<Step step="review" />);
    mount(<Step step="receipt" />);
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31]);
    mount(<Step step={null} />);
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31]);
    mount(<Step step="count" />);
    act(() => root.unmount());
    root = createRoot(container);
    interactionsDone();
    advance(400);
    expect(rn.focused).toEqual([31]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the web twin never moves focus', () => {
    rn.os = 'web';
    mount(<WebStep step="count" />);
    mount(<WebStep step="review" />);
    advance(1000);
    expect(rn.interactionCalls).toBe(0);
    expect(rn.focused).toEqual([]);
  });
});
