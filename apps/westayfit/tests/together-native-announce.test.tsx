import { act, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MOTION-1 / W13 condition — on iOS and Android the Together receipt
 * is no longer inside a live region, so TogetherCompletion's own announcement
 * is the only way a screen-reader user hears it. It must fire EXACTLY ONCE per
 * receipt: never zero, never twice on re-render or remount, whether or not the
 * receipt moves, and not again when its props update.
 *
 * Both announcement entry points are recorded (`announceForAccessibility` and
 * `announceForAccessibilityWithOptions`); every count below is their total.
 * Platform.OS is switched per test between 'ios' and 'android'; the
 * reduced-motion answer, AppState and onLayout are controlled fakes.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as string,
  pref: { reduced: false, known: true, failed: false },
  appState: 'active' as string,
  calls: [] as Array<{ fn: string; message: string; options?: unknown }>,
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  const View = React.forwardRef<unknown, Record<string, any>>(function LaidOutView({ onLayout, ...rest }, ref) {
    React.useEffect(() => {
      onLayout?.({ nativeEvent: { layout: { x: 20, y: 140, width: 390, height: 420 } } });
    }, [onLayout]);
    return React.createElement(actual.View, { ...rest, ref });
  });
  return {
    ...actual,
    View,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => o[ctl.os] ?? o.native ?? o.default,
    },
    AppState: {
      get currentState() {
        return ctl.appState;
      },
      addEventListener: () => ({ remove: () => undefined }),
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: (message: string) => {
        ctl.calls.push({ fn: 'announceForAccessibility', message });
      },
      announceForAccessibilityWithOptions: (message: string, options: unknown) => {
        ctl.calls.push({ fn: 'announceForAccessibilityWithOptions', message, options });
      },
    },
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ctl.os = 'ios';
  ctl.pref = { reduced: false, known: true, failed: false };
  ctl.appState = 'active';
  ctl.calls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  // Let the remembered receipt clear (it is released in a microtask).
  await act(async () => undefined);
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

type Opts = { r?: ContributeReceipt; fresh?: boolean; sharedBefore?: number | null; amountText?: string };

function element(opts: Opts = {}) {
  const r = opts.r ?? receipt();
  const fresh = opts.fresh ?? true;
  const hasShared = r.sharedTotal != null;
  const p = togetherPresentation(r, {
    communityName: 'Fixture Community',
    fresh,
    sharedBefore: opts.sharedBefore === undefined ? 3700 : opts.sharedBefore,
    beforeTarget: 5000,
  });
  return (
    <TogetherCompletion
      presentation={p}
      eyebrow={r.alreadyRecorded ? 'Already recorded' : 'Recorded'}
      amountText={opts.amountText ?? (r.alreadyRecorded ? String(r.addedCount) : `+${r.addedCount}`)}
      unit="squats"
      shared={hasShared ? { total: r.sharedTotal!, target: r.target!, unit: r.unit!, status: r.status! } : null}
      context={hasShared ? { communityName: 'Fixture Community', goalTitle: '5,000 squats' } : null}
      ownCredit={null}
      standing={null}
      actions={null}
      fresh={fresh}
      onFreshConsumed={() => undefined}
      windowWidth={390}
      windowHeight={844}
    />
  );
}

const show = (node: ReactNode) => act(() => root.render(node));
const count = () => ctl.calls.length;
const phase = () => container.querySelector('[data-testid="wsf-together"]')?.getAttribute('data-together-phase');
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const flushMicrotasks = () => act(async () => undefined);

const ANNOUNCED = 'Recorded: +20 squats. Shared total: 3,720 of 5,000 squats.';

for (const os of ['ios', 'android']) {
  describe(`${os}: exactly one announcement per Together receipt`, () => {
    beforeEach(() => {
      ctl.os = os;
    });

    it('a fresh, moving receipt: once at mount, not again while it plays, settles or re-renders', () => {
      show(element());
      expect(phase()).toBe('playing');
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe(ANNOUNCED);
      show(element({ fresh: false })); // the owner clears freshness and re-renders
      advance(TOGETHER_TIMING.fillStartMs + 300); // the fill tween re-renders every frame
      expect(count()).toBe(1);
      advance(TOGETHER_TIMING.settleMs);
      expect(phase()).toBe('settled');
      show(element({ fresh: false }));
      expect(count()).toBe(1);
    });

    it('a replayed "already recorded" receipt: once, with its own words', () => {
      show(element({ r: receipt({ alreadyRecorded: true }) }));
      expect(phase()).toBe('settled');
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe('Already recorded: 20 squats. Shared total: 3,720 of 5,000 squats.');
      show(element({ r: receipt({ alreadyRecorded: true }) }));
      expect(count()).toBe(1);
    });

    describe('a receipt that plays no motion is announced exactly the same way', () => {
      it('reduced motion known at mount', () => {
        ctl.pref = { reduced: true, known: true, failed: false };
        show(element());
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
        expect(ctl.calls[0].message).toBe(ANNOUNCED);
      });

      it('reduced motion answered after mount (pending → settled)', () => {
        ctl.pref = { reduced: false, known: false, failed: false };
        show(element());
        expect(phase()).toBe('pending');
        expect(count()).toBe(1);
        ctl.pref = { reduced: true, known: true, failed: false };
        show(element({ fresh: false }));
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('a preference that never answers (settled at the start deadline)', () => {
        ctl.pref = { reduced: false, known: false, failed: false };
        show(element());
        advance(NATIVE_START_DEADLINE_MS);
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('a preference query that failed', () => {
        ctl.pref = { reduced: false, known: false, failed: true };
        show(element());
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('not fresh (reopened, reconciled)', () => {
        show(element({ fresh: false }));
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('no trusted before total', () => {
        show(element({ sharedBefore: null }));
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('the app in the background when the receipt arrives', () => {
        ctl.appState = 'background';
        show(element());
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('an own-only receipt (no shared total)', () => {
        show(element({ r: { addedCount: 20, ownCredit: 60, alreadyRecorded: false } }));
        expect(count()).toBe(1);
        expect(ctl.calls[0].message).toBe('Recorded: +20 squats.');
      });
    });

    it('props that update after mount without a new receipt (count, variant) do not announce again', () => {
      show(element());
      expect(count()).toBe(1);
      show(element({ amountText: '+25' })); // the count changes in place
      show(element({ r: receipt({ sharedTotal: 5015, crossedTarget: true }), fresh: false, sharedBefore: 4980 })); // the variant changes
      show(element({ r: receipt({ alreadyRecorded: true }), fresh: false }));
      advance(TOGETHER_TIMING.settleMs);
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe(ANNOUNCED);
    });

    it('a remount of the same receipt (the wrapper around it changes shape) does not announce again', () => {
      function Plain({ children }: { children: ReactNode }) {
        return <>{children}</>;
      }
      function Boxed({ children }: { children: ReactNode }) {
        return <section>{children}</section>;
      }
      show(<Plain>{element()}</Plain>);
      expect(count()).toBe(1);
      show(<Boxed>{element({ fresh: false })}</Boxed>); // unmount + mount in the same commit
      expect(container.querySelector('section [data-testid="wsf-together"]')).not.toBeNull();
      expect(count()).toBe(1);
      show(<Plain>{element({ fresh: false })}</Plain>);
      expect(count()).toBe(1);
    });

    it('React’s development double-invoke (StrictMode) does not announce twice', () => {
      show(<StrictMode>{element()}</StrictMode>);
      expect(count()).toBe(1);
    });

    it('a receipt that unmounts before it was ever shown (its render never committed) announces nothing', () => {
      const never = new Promise<never>(() => undefined);
      function Suspends(): never {
        throw never;
      }
      show(
        <Suspense fallback={null}>
          {element()}
          <Suspends />
        </Suspense>
      );
      expect(container.querySelector('[data-testid="wsf-together"]')).toBeNull();
      act(() => root.unmount());
      expect(count()).toBe(0);
      root = createRoot(container);
    });

    it('a receipt that unmounts right after it appears was announced once, and unmounting adds nothing', () => {
      show(element());
      act(() => root.unmount());
      expect(count()).toBe(1);
      root = createRoot(container);
    });

    it('a NEW receipt later is announced again — even with identical figures', async () => {
      show(element({ r: { addedCount: 20, ownCredit: 40, alreadyRecorded: false } }));
      act(() => root.unmount()); // "Add more": the receipt leaves
      await flushMicrotasks();
      root = createRoot(container);
      show(element({ r: { addedCount: 20, ownCredit: 60, alreadyRecorded: false } })); // the next one
      expect(count()).toBe(2);
    });

    it('a different receipt mounting in the same commit another left in is announced', () => {
      function Plain({ children }: { children: ReactNode }) {
        return <>{children}</>;
      }
      function Boxed({ children }: { children: ReactNode }) {
        return <section>{children}</section>;
      }
      show(<Plain>{element()}</Plain>);
      show(<Boxed>{element({ r: receipt({ addedCount: 15, sharedTotal: 3735 }), sharedBefore: 3720 })}</Boxed>);
      expect(count()).toBe(2);
      expect(ctl.calls[1].message).toBe('Recorded: +15 squats. Shared total: 3,735 of 5,000 squats.');
    });
  });
}

describe('how it is spoken', () => {
  it('queued behind current speech (announceForAccessibilityWithOptions, queue: true) — one call, no plain duplicate', async () => {
    for (const os of ['ios', 'android']) {
      ctl.os = os;
      ctl.calls = [];
      show(element());
      expect(ctl.calls).toEqual([{ fn: 'announceForAccessibilityWithOptions', message: ANNOUNCED, options: { queue: true } }]);
      act(() => root.unmount());
      await flushMicrotasks(); // the receipt has left; the next mount is a new receipt
      root = createRoot(container);
    }
  });

  it('the web never announces: its receipt container is a live region', () => {
    ctl.os = 'web';
    show(element());
    advance(TOGETHER_TIMING.settleMs);
    expect(count()).toBe(0);
  });
});
