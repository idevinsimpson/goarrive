import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MOTION-1 — TogetherCompletion's native branch, rendered into jsdom
 * through react-native-web with Platform.OS reported as 'ios'. The mocks stand
 * in for what jsdom cannot give: the reduced-motion answer (controlled here),
 * AppState transitions, and onLayout (fired once on mount with a fixed frame).
 *
 * This proves the decision, the waits, the settles and the cleanup. It does
 * not prove how the motion looks on a device; nothing in vitest can.
 */

const ctl = vi.hoisted(() => ({
  pref: { reduced: false, known: false },
  appState: 'active' as string,
  appListeners: new Set<(state: string) => void>(),
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  // jsdom never lays out: report one frame on mount to whoever asked.
  const View = React.forwardRef<unknown, Record<string, any>>(function LaidOutView({ onLayout, ...rest }, ref) {
    React.useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { x: 20, y: 140, width: 390, height: 420 } } });
    }, [onLayout]);
    return React.createElement(actual.View, { ...rest, ref });
  });
  const AppState = {
    get currentState() {
      return ctl.appState;
    },
    addEventListener: (_type: string, handler: (state: string) => void) => {
      ctl.appListeners.add(handler);
      return { remove: () => ctl.appListeners.delete(handler) };
    },
  };
  return {
    ...actual,
    View,
    AppState,
    Platform: { ...actual.Platform, OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.native ?? o.default },
  };
});

vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => ctl.pref.reduced,
  useReducedMotionPreference: () => ({ ...ctl.pref }),
}));

import { togetherPresentation, type ContributeReceipt } from '../src/contributionFlow';
import { TogetherCompletion } from '../src/ui/TogetherCompletion';
import { TOGETHER_TIMING } from '../src/ui/togetherMotion';
import { NATIVE_START_DEADLINE_MS } from '../src/ui/togetherPhase';

// Tell React this is a test renderer so act() flushes effects without warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  // react-native-web has no native animated module and says so.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ctl.pref = { reduced: false, known: false };
  ctl.appState = 'active';
  ctl.appListeners.clear();
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

function receipt(over: Partial<ContributeReceipt> = {}): ContributeReceipt {
  return {
    addedCount: 20,
    ownCredit: 20,
    alreadyRecorded: false,
    sharedTotal: 3720,
    target: 5000,
    unit: 'squats',
    status: 'active',
    ...over,
  };
}
const freshOpts = { communityName: 'Fixture Community', fresh: true, sharedBefore: 3700, beforeTarget: 5000 };

function render(opts: { r?: ContributeReceipt; fresh?: boolean; sharedBefore?: number | null; onFreshConsumed?: () => void } = {}) {
  const r = opts.r ?? receipt();
  const fresh = opts.fresh ?? true;
  const p = togetherPresentation(r, {
    ...freshOpts,
    fresh,
    sharedBefore: opts.sharedBefore === undefined ? freshOpts.sharedBefore : opts.sharedBefore,
  });
  const onFreshConsumed = opts.onFreshConsumed ?? vi.fn();
  act(() => {
    root.render(
      <TogetherCompletion
        presentation={p}
        eyebrow={r.alreadyRecorded ? 'Already recorded' : 'Recorded'}
        amountText={r.alreadyRecorded ? String(r.addedCount) : `+${r.addedCount}`}
        unit="squats"
        shared={{ total: r.sharedTotal!, target: r.target!, unit: r.unit!, status: r.status! }}
        context={{ communityName: 'Fixture Community', goalTitle: '5,000 squats' }}
        ownCredit={null}
        standing={null}
        actions={null}
        fresh={fresh}
        onFreshConsumed={onFreshConsumed}
        windowWidth={390}
        windowHeight={844}
      />
    );
  });
  return { p, onFreshConsumed };
}

const together = () => container.querySelector('[data-testid="wsf-together"]') as HTMLElement;
const phase = () => together().getAttribute('data-together-phase');
const layer = () => container.querySelector('[data-testid="wsf-together-native-layer"]');
const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const appGoes = (state: string) =>
  act(() => {
    ctl.appState = state;
    ctl.appListeners.forEach((h) => h(state));
  });

describe('native Together: truth first, one decision, waits for the preference', () => {
  it('the exact amount and confirmed total are on screen from the first frame, whatever the phase', () => {
    render();
    expect(phase()).toBe('pending');
    expect(text('wsf-contribute-result-amount')).toBe('+20');
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
    expect(text('wsf-contribute-percent')).toBe('74.4% complete');
  });

  it('does not start before the reduced-motion answer; a reduced answer settles without ever playing', () => {
    const { onFreshConsumed } = render();
    expect(phase()).toBe('pending');
    expect(layer()).toBeNull();
    expect(onFreshConsumed).toHaveBeenCalledTimes(1);
    advance(100);
    expect(phase()).toBe('pending');
    expect(layer()).toBeNull();
    ctl.pref = { reduced: true, known: true };
    render({ fresh: false }); // the answer arrives (the owner has already cleared `fresh`)
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a not-reduced answer plays the ordinary motion, which settles at 3,400 ms and removes its layer', () => {
    render();
    ctl.pref = { reduced: false, known: true };
    render({ fresh: false }); // eligibility was read at mount; the cleared flag does not cancel it
    expect(phase()).toBe('playing');
    expect(layer()).not.toBeNull();
    expect(together().getAttribute('data-together-crossed')).toBe('false');
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
    advance(TOGETHER_TIMING.settleMs - 1);
    expect(phase()).toBe('playing');
    advance(1);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a known preference at mount plays at once; a crossing is marked as one', () => {
    ctl.pref = { reduced: false, known: true };
    render({ r: receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015, crossedTarget: true }), sharedBefore: 4980 });
    expect(phase()).toBe('playing');
    expect(together().getAttribute('data-together-crossed')).toBe('true');
    expect(layer()).not.toBeNull();
    // The decorative layer is hidden from assistive technology.
    expect(layer()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('known reduced motion at mount settles immediately with the result and nothing moving', () => {
    ctl.pref = { reduced: true, known: true };
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
  });

  it('reduced motion switched on mid-play settles for good; switching it off replays nothing', () => {
    ctl.pref = { reduced: false, known: true };
    render();
    advance(800);
    expect(phase()).toBe('playing');
    ctl.pref = { reduced: true, known: true };
    render({ fresh: false });
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    ctl.pref = { reduced: false, known: true };
    render({ fresh: false });
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('an answer that never comes settles at the start deadline instead of starting late', () => {
    render();
    advance(NATIVE_START_DEADLINE_MS - 1);
    expect(phase()).toBe('pending');
    advance(1);
    expect(phase()).toBe('settled');
    ctl.pref = { reduced: false, known: true };
    render({ fresh: false });
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });
});

describe('native Together: close, background and remount never celebrate again', () => {
  it('backgrounding mid-play settles at once; returning replays nothing', () => {
    ctl.pref = { reduced: false, known: true };
    render();
    advance(1700);
    expect(phase()).toBe('playing');
    appGoes('background');
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    appGoes('active');
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('backgrounding while still waiting for the preference settles too', () => {
    render();
    appGoes('background');
    expect(phase()).toBe('settled');
    ctl.pref = { reduced: false, known: true };
    render({ fresh: false });
    expect(phase()).toBe('settled');
  });

  it('a receipt that appears while the app is in the background never plays', () => {
    ctl.pref = { reduced: false, known: true };
    ctl.appState = 'background';
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a remount after the owner consumed freshness, a reopen, or a retry already recorded is static', () => {
    ctl.pref = { reduced: false, known: true };
    const consumed = vi.fn();
    render({ onFreshConsumed: consumed });
    expect(phase()).toBe('playing');
    expect(consumed).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    // Remount / reopen: the owner now passes fresh = false.
    root = createRoot(container);
    render({ fresh: false });
    expect(phase()).toBe('settled');
    expect(together().getAttribute('data-together-animate')).toBe('static');
    expect(layer()).toBeNull();
    act(() => root.unmount());
    // A retry the server reports as already recorded, even with a fresh flag.
    root = createRoot(container);
    render({ r: receipt({ alreadyRecorded: true }) });
    expect(phase()).toBe('settled');
    expect(text('wsf-contribute-result-amount')).toBe('20');
    expect(layer()).toBeNull();
  });

  it('no trusted before total: static, and the before is not invented', () => {
    ctl.pref = { reduced: false, known: true };
    const { p } = render({ sharedBefore: null });
    expect(p.before).toBeNull();
    expect(phase()).toBe('settled');
    expect(together().getAttribute('data-together-animate')).toBe('static');
    expect(layer()).toBeNull();
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
  });

  it('unmount mid-play stops every animation, timer and frame', () => {
    ctl.pref = { reduced: false, known: true };
    render();
    advance(1600);
    expect(phase()).toBe('playing');
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(ctl.appListeners.size).toBe(0);
    root = createRoot(container);
  });
});
