import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  `useFocusEffect` as the navigator runs it: the callback on focus, its cleanup
  on blur. `focused` lets a test blur the screen.
*/
let focused = true;
const focusListeners = new Set<(on: boolean) => void>();
vi.mock('expo-router', async () => {
  const { useEffect: useEff, useState } = await import('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      const [on, setOn] = useState(focused);
      useEff(() => {
        focusListeners.add(setOn);
        return () => {
          focusListeners.delete(setOn);
        };
      }, []);
      useEff(() => (on ? cb() : undefined), [on, cb]);
    },
  };
});

import {
  RESUME_MIN_AWAY_MS,
  RESUME_SETTLE_MS,
  createResumeWatcher,
  useResumeRefresh,
} from '../src/useResumeRefresh';

/**
 * NATIVE-INTEGRATOR-1 (INT-12, INT-04): member surfaces refresh when the member
 * comes back to the app; not on Control Center, not on a flick, not while
 * another screen is in front. No device: the state machine is driven with a
 * fake clock, and the hook through react-native-web's AppState.
 */

function clock() {
  let t = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let id = 0;
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      id += 1;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    cancel: (h: unknown) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    },
    pending: () => timers.length,
  };
}

describe('createResumeWatcher', () => {
  function setup(minAwayMs = RESUME_MIN_AWAY_MS) {
    const c = clock();
    const onResume = vi.fn();
    const w = createResumeWatcher({ onResume, minAwayMs: () => minAwayMs, now: c.now, schedule: c.schedule, cancel: c.cancel });
    return { c, onResume, w };
  }

  it('INT-12 case 1: back after a minute away refreshes once, after a short settle', () => {
    const { c, onResume, w } = setup();
    w.onChange('inactive');
    w.onChange('background');
    c.advance(60_000);
    w.onChange('active');
    expect(onResume).not.toHaveBeenCalled();
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('INT-12 case 6: Control Center (inactive only) triggers nothing, however long', () => {
    const { c, onResume, w } = setup();
    w.onChange('inactive');
    c.advance(10 * 60_000);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS * 2);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('a flick out and back under the minimum costs nothing; at the minimum it refreshes', () => {
    const { c, onResume, w } = setup();
    w.onChange('background');
    c.advance(RESUME_MIN_AWAY_MS - 1);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).not.toHaveBeenCalled();
    w.onChange('background');
    c.advance(RESUME_MIN_AWAY_MS);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('debounced: going back to the background before the settle cancels the refresh', () => {
    const { c, onResume, w } = setup();
    w.onChange('background');
    c.advance(60_000);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS - 1);
    w.onChange('background');
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).not.toHaveBeenCalled();
    expect(c.pending()).toBe(0);
  });

  it('time away counts from the first background, not a repeated one', () => {
    const { c, onResume, w } = setup();
    w.onChange('background');
    c.advance(RESUME_MIN_AWAY_MS - 5_000);
    w.onChange('background');
    c.advance(5_000);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('INT-04: a screen showing an error passes 0, so any return from the background retries', () => {
    const { c, onResume, w } = setup(0);
    w.onChange('background');
    c.advance(1);
    w.onChange('active');
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels a pending refresh', () => {
    const { c, onResume, w } = setup();
    w.onChange('background');
    c.advance(60_000);
    w.onChange('active');
    w.dispose();
    c.advance(RESUME_SETTLE_MS);
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe('useResumeRefresh', () => {
  let container: HTMLDivElement;
  let root: Root;
  let handlers: Array<(s: string) => void>;
  let removed: number;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    focused = true;
    handlers = [];
    removed = 0;
    vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
      handlers.push(h);
      return {
        remove: () => {
          removed += 1;
          handlers = handlers.filter((x) => x !== h);
        },
      };
    }) as never);
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

  function Screen({ onResume, minAwayMs }: { onResume: () => void; minAwayMs?: number }) {
    useResumeRefresh(onResume, minAwayMs === undefined ? {} : { minAwayMs });
    useEffect(() => undefined, []);
    return null;
  }

  const emit = (s: string) => act(() => handlers.forEach((h) => h(s)));

  it('listens while focused and refreshes on a return to the app', () => {
    const onResume = vi.fn();
    act(() => root.render(<Screen onResume={onResume} />));
    expect(handlers).toHaveLength(1);
    emit('background');
    act(() => vi.advanceTimersByTime(45_000));
    emit('active');
    act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('a blurred screen (another tab, or MOVE in front) stops listening and reads nothing', () => {
    const onResume = vi.fn();
    act(() => root.render(<Screen onResume={onResume} />));
    act(() => focusListeners.forEach((set) => set(false)));
    expect(handlers).toHaveLength(0);
    expect(removed).toBe(1);
    emit('background');
    act(() => vi.advanceTimersByTime(45_000));
    emit('active');
    act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('always calls the latest callback and minimum (the screen\'s current state decides)', () => {
    const first = vi.fn();
    const second = vi.fn();
    act(() => root.render(<Screen onResume={first} />));
    act(() => root.render(<Screen onResume={second} minAwayMs={0} />));
    emit('background');
    act(() => vi.advanceTimersByTime(10));
    emit('active');
    act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // One subscription for the whole life of the focus, not one per render.
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('unmounting removes the listener', () => {
    act(() => root.render(<Screen onResume={vi.fn()} />));
    act(() => root.unmount());
    expect(removed).toBe(1);
    root = createRoot(container);
  });
});
