import { act, type ReactNode } from 'react';
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
  pref: { reduced: false, known: false, failed: false },
  appState: 'active' as string,
  /** When set, AppState.currentState reads these in turn (then appState). */
  appStateReads: [] as string[],
  appListeners: new Set<(state: string) => void>(),
  layout: { x: 20, y: 140, width: 390, height: 420 },
  announcements: [] as string[],
  throwOnBuild: false,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  // jsdom never lays out: report one frame on mount to whoever asked.
  const View = React.forwardRef<unknown, Record<string, any>>(function LaidOutView({ onLayout, ...rest }, ref) {
    React.useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { ...ctl.layout } } });
    }, [onLayout]);
    return React.createElement(actual.View, { ...rest, ref });
  });
  const AppState = {
    get currentState() {
      return ctl.appStateReads.length ? ctl.appStateReads.shift()! : ctl.appState;
    },
    addEventListener: (_type: string, handler: (state: string) => void) => {
      ctl.appListeners.add(handler);
      return { remove: () => ctl.appListeners.delete(handler) };
    },
  };
  const AccessibilityInfo = {
    ...actual.AccessibilityInfo,
    announceForAccessibility: (message: string) => {
      ctl.announcements.push(message);
    },
  };
  return {
    ...actual,
    View,
    AppState,
    AccessibilityInfo,
    Platform: { ...actual.Platform, OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.native ?? o.default },
  };
});

// The real native driver, with a switch to make building a run fail.
vi.mock('../src/ui/togetherMotionNative', async () => {
  const actual = (await vi.importActual('../src/ui/togetherMotionNative')) as Record<string, any>;
  return {
    ...actual,
    createNativeTogetherRun: (geom: unknown) => {
      if (ctl.throwOnBuild) throw new Error('cannot build the run');
      return actual.createNativeTogetherRun(geom);
    },
  };
});

vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => ctl.pref.reduced,
  useReducedMotionPreference: () => ({ ...ctl.pref }),
}));

import { Pressable, Text } from 'react-native';

import { togetherPresentation, type ContributeReceipt } from '../src/contributionFlow';
import { percentLabel, totalOfTargetLabel } from '../src/ui/progressFormat';
import { TogetherCompletion } from '../src/ui/TogetherCompletion';
import { TogetherNativeLayer } from '../src/ui/togetherMotionNative';
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
  ctl.pref = { reduced: false, known: false, failed: false };
  ctl.appState = 'active';
  ctl.appStateReads = [];
  ctl.appListeners.clear();
  ctl.layout = { x: 20, y: 140, width: 390, height: 420 };
  ctl.announcements = [];
  ctl.throwOnBuild = false;
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

function render(
  opts: {
    r?: ContributeReceipt;
    fresh?: boolean;
    sharedBefore?: number | null;
    onFreshConsumed?: () => void;
    actions?: ReactNode;
  } = {}
) {
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
        actions={opts.actions ?? null}
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
    ctl.pref = { reduced: true, known: true, failed: false };
    render({ fresh: false }); // the answer arrives (the owner has already cleared `fresh`)
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a not-reduced answer plays the ordinary motion, which settles at 3,400 ms and removes its layer', () => {
    render();
    ctl.pref = { reduced: false, known: true, failed: false };
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
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ r: receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015, crossedTarget: true }), sharedBefore: 4980 });
    expect(phase()).toBe('playing');
    expect(together().getAttribute('data-together-crossed')).toBe('true');
    expect(layer()).not.toBeNull();
    // The decorative layer is hidden from assistive technology.
    expect(layer()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('known reduced motion at mount settles immediately with the result and nothing moving', () => {
    ctl.pref = { reduced: true, known: true, failed: false };
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
  });

  it('reduced motion switched on mid-play settles for good; switching it off replays nothing', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    advance(800);
    expect(phase()).toBe('playing');
    ctl.pref = { reduced: true, known: true, failed: false };
    render({ fresh: false });
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    ctl.pref = { reduced: false, known: true, failed: false };
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
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ fresh: false });
    advance(5000);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });
});

describe('native Together: close, background and remount never celebrate again', () => {
  it('backgrounding mid-play settles at once; returning replays nothing', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
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
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ fresh: false });
    expect(phase()).toBe('settled');
  });

  it('a receipt that appears while the app is in the background never plays', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    ctl.appState = 'background';
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a remount after the owner consumed freshness, a reopen, or a retry already recorded is static', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
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
    ctl.pref = { reduced: false, known: true, failed: false };
    const { p } = render({ sharedBefore: null });
    expect(p.before).toBeNull();
    expect(phase()).toBe('settled');
    expect(together().getAttribute('data-together-animate')).toBe('static');
    expect(layer()).toBeNull();
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
  });

  it('unmount mid-play stops every animation, timer and frame', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    advance(1600);
    expect(phase()).toBe('playing');
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(ctl.appListeners.size).toBe(0);
    root = createRoot(container);
  });
});

describe('native Together: review follow-ups', () => {
  const weLabel = () => container.querySelector('[data-testid="wsf-contribute-we"]')?.getAttribute('aria-label');
  const confirmedLabel = `${totalOfTargetLabel(3720, 5000, 'squats')}, ${percentLabel(3720, 5000)} filled`;

  it('announces the confirmed amount and shared total once, at mount, and never again on re-render', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    expect(ctl.announcements).toEqual(['Recorded: +20 squats. Shared total: 3,720 of 5,000 squats.']);
    render({ fresh: false });
    advance(TOGETHER_TIMING.settleMs);
    expect(phase()).toBe('settled');
    expect(ctl.announcements).toHaveLength(1);
  });

  it('the WE’s accessible label is the confirmed figure in pending, playing and settled — never a tween value', () => {
    render();
    expect(phase()).toBe('pending');
    expect(weLabel()).toBe(confirmedLabel);
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ fresh: false });
    expect(phase()).toBe('playing');
    advance(TOGETHER_TIMING.fillStartMs + 300); // mid-tween
    expect(weLabel()).toBe(confirmedLabel);
    advance(TOGETHER_TIMING.settleMs);
    expect(phase()).toBe('settled');
    expect(weLabel()).toBe(confirmedLabel);
  });

  it('the receipt’s own actions work mid-play, and the decorative layer takes no touches', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    const onPress = vi.fn();
    const action = (
      <Pressable onPress={onPress} testID="action-done" accessibilityRole="button">
        <Text>Done</Text>
      </Pressable>
    );
    render({ actions: action });
    advance(1600);
    expect(phase()).toBe('playing');
    const layerStyle = getComputedStyle(layer() as Element);
    expect(layerStyle.pointerEvents).toBe('none');
    act(() => {
      (container.querySelector('[data-testid="action-done"]') as HTMLElement).click();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(phase()).toBe('playing'); // pressing an action does not disturb the motion…
    advance(TOGETHER_TIMING.settleMs);
    expect(phase()).toBe('settled'); // …which still settles on time
  });

  it('the layer is memoised on its run, so the fill tween does not re-render its views', () => {
    expect((TogetherNativeLayer as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('a near-zero layout is not a measurement: it never plays and settles at the deadline', () => {
    ctl.layout = { x: 0, y: 0, width: 0, height: 0 };
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    expect(phase()).toBe('playing'); // eligible, but nothing to play on yet
    expect(layer()).toBeNull();
    advance(NATIVE_START_DEADLINE_MS);
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('a preference query that definitely failed settles at once, without waiting for the deadline', () => {
    render();
    expect(phase()).toBe('pending');
    ctl.pref = { reduced: false, known: false, failed: true };
    render({ fresh: false });
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('already out of the foreground when the AppState subscription starts: settles immediately', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    // The mount-time decision reads 'active'; by the time the effect subscribes, the app is inactive.
    ctl.appStateReads = ['active'];
    ctl.appState = 'inactive';
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('pending → playing checks the foreground: an app that left silently does not start playing', () => {
    render();
    expect(phase()).toBe('pending');
    ctl.appState = 'background'; // no change event delivered
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ fresh: false });
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
  });

  it('plays the story it mounted with: a later presentation cannot change the crossing or the ratios', () => {
    // Mount as a crossing, still waiting on the preference…
    render({ r: receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015, crossedTarget: true }), sharedBefore: 4980 });
    expect(phase()).toBe('pending');
    // …then the owner re-renders with an ordinary presentation (props changed under the pending receipt).
    ctl.pref = { reduced: false, known: true, failed: false };
    render({ fresh: false });
    expect(phase()).toBe('playing');
    // The run is the crossing's: 28 pieces × (head + 2 trail chords) + glow + 3 waves.
    expect(layer()!.children.length).toBe(1 + 28 * 3 + 3);
  });

  it('a run that cannot be built settles at once with the confirmed receipt', () => {
    ctl.throwOnBuild = true;
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    expect(phase()).toBe('settled');
    expect(layer()).toBeNull();
    expect(text('wsf-contribute-shared-total')).toContain('3,720');
  });

  it('an ordinary run draws 24 pieces and 2 waves', () => {
    ctl.pref = { reduced: false, known: true, failed: false };
    render();
    expect(layer()!.children.length).toBe(1 + 24 * 3 + 2);
  });
});
