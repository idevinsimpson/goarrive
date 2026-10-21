import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-6 (INT-12): CommunityPresence's relative labels ("3m ago") move on.
 * A shared ticker re-renders them every 60 s while the app is in front and
 * once on the return to it, holds no timer in the background, and none once
 * no row is left. Fake timers drive the clock; AppState's listener is
 * captured at react-native's boundary. No device.
 */
const { MomentumRow, NOW_TICK_MS } = await import('../src/ui/CommunityPresence');

const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);
let container: HTMLDivElement;
let root: Root;
let appHandlers: Array<(s: string) => void>;
let removed: number;

const ROW = { displayName: 'Sam Lee', amount: 25, unit: 'squats', at: new Date(T0 - 10_000).toISOString() };
const label = () => container.querySelector('[data-testid="wsf-momentum-row"]')!.textContent;
const setApp = (state: string) => act(() => appHandlers.slice().forEach((h) => h(state)));

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  appHandlers = [];
  removed = 0;
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appHandlers.push(h);
    return {
      remove: () => {
        removed += 1;
        appHandlers = appHandlers.filter((x) => x !== h);
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

describe('W12-6: the momentum rows\' relative times move on', () => {
  it('while in front: the label advances every 60 s, from one shared timer', () => {
    act(() => root.render(<><MomentumRow row={ROW as never} first /><MomentumRow row={ROW as never} first={false} /></>));
    expect(label()).toContain('just now');
    expect(vi.getTimerCount()).toBe(1);
    expect(appHandlers).toHaveLength(1);
    act(() => vi.advanceTimersByTime(NOW_TICK_MS));
    expect(label()).toContain('1m ago');
    act(() => vi.advanceTimersByTime(2 * NOW_TICK_MS));
    expect(label()).toContain('3m ago');
  });

  it('in the background: no timer and no change; on the return, at once, then every 60 s again', () => {
    act(() => root.render(<MomentumRow row={ROW as never} first />));
    act(() => vi.advanceTimersByTime(NOW_TICK_MS));
    expect(label()).toContain('1m ago');
    setApp('background');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5 * NOW_TICK_MS));
    expect(label()).toContain('1m ago');
    setApp('active');
    expect(label()).toContain('6m ago');
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(NOW_TICK_MS));
    expect(label()).toContain('7m ago');
  });

  it('opened while in the background: no timer until the app is in front', () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    act(() => root.render(<MomentumRow row={ROW as never} first />));
    expect(vi.getTimerCount()).toBe(0);
    setApp('active');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('with no row left: no timer and no AppState listener', () => {
    act(() => root.render(<MomentumRow row={ROW as never} first />));
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.render(<div />));
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toBe(1);
    expect(appHandlers).toHaveLength(0);
  });
});
