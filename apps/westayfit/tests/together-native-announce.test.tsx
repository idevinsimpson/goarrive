import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, StrictMode, Suspense, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MOTION-1 / W13 condition — on iOS and Android the Together receipt
 * is no longer inside a live region, so TogetherCompletion's own announcement
 * is the only way a screen-reader user hears it. It must fire EXACTLY ONCE per
 * receipt: never zero, never twice on re-render or remount, whether or not the
 * receipt moves, and not again when its props update.
 *
 * Identity is the owner's (review A1): the receipt says whether it is still
 * owed an announcement (`announce`) and is told when it has been spoken
 * (`onAnnounced`). `Owner` below wires those exactly as
 * app/contribute/[goalId].tsx does — one ref per screen, holding the receipt
 * object that was announced — and a source check pins that wiring.
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
  appListeners: new Set<(state: string) => void>(),
  calls: [] as Array<{ fn: string; message: string; options?: unknown }>,
  told: 0,
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
      addEventListener: (_type: string, handler: (state: string) => void) => {
        ctl.appListeners.add(handler);
        return { remove: () => ctl.appListeners.delete(handler) };
      },
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
const extraRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  ctl.os = 'ios';
  ctl.pref = { reduced: false, known: true, failed: false };
  ctl.appState = 'active';
  ctl.appListeners.clear();
  ctl.calls = [];
  ctl.told = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const extra of extraRoots.splice(0)) {
    act(() => extra.root.unmount());
    extra.container.remove();
  }
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

type OwnerProps = {
  /** The receipt object the screen holds (its `lastResult`); null shows no receipt. */
  r: ContributeReceipt | null;
  fresh?: boolean;
  sharedBefore?: number | null;
  amountText?: string;
  goalTitle?: string;
  /** The wrapper around the receipt; changing it remounts the receipt (not the owner). */
  shape?: 'plain' | 'boxed';
};

/** The contribute screen's wiring: one ref, holding the receipt object that was announced. */
function Owner({ r, fresh = true, sharedBefore, amountText, goalTitle = '5,000 squats', shape = 'plain' }: OwnerProps) {
  const announcedReceiptRef = useRef<ContributeReceipt | null>(null);
  if (!r) return null;
  const hasShared = r.sharedTotal != null;
  const p = togetherPresentation(r, {
    communityName: 'Fixture Community',
    fresh,
    sharedBefore: sharedBefore === undefined ? 3700 : sharedBefore,
    beforeTarget: 5000,
  });
  const node = (
    <TogetherCompletion
      presentation={p}
      eyebrow={r.alreadyRecorded ? 'Already recorded' : 'Recorded'}
      amountText={amountText ?? (r.alreadyRecorded ? String(r.addedCount) : `+${r.addedCount}`)}
      unit="squats"
      shared={hasShared ? { total: r.sharedTotal!, target: r.target!, unit: r.unit!, status: r.status! } : null}
      context={hasShared ? { communityName: 'Fixture Community', goalTitle } : null}
      ownCredit={null}
      standing={null}
      actions={null}
      fresh={fresh}
      onFreshConsumed={() => undefined}
      announce={announcedReceiptRef.current !== r}
      onAnnounced={() => {
        announcedReceiptRef.current = r;
        ctl.told += 1;
      }}
      windowWidth={390}
      windowHeight={844}
    />
  );
  return shape === 'boxed' ? <section>{node}</section> : node;
}

const show = (props: OwnerProps, target: Root = root) => act(() => target.render(<Owner {...props} />));
const count = () => ctl.calls.length;
const phase = () => container.querySelector('[data-testid="wsf-together"]')?.getAttribute('data-together-phase');
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const appGoes = (state: string) =>
  act(() => {
    ctl.appState = state;
    ctl.appListeners.forEach((h) => h(state));
  });
function secondRoot(): Root {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const r = createRoot(c);
  extraRoots.push({ root: r, container: c });
  return r;
}

const ANNOUNCED = 'Recorded: +20 squats. Shared total: 3,720 of 5,000 squats.';

for (const os of ['ios', 'android']) {
  describe(`${os}: exactly one announcement per Together receipt`, () => {
    beforeEach(() => {
      ctl.os = os;
    });

    it('a fresh, moving receipt: once at mount, not again while it plays, settles or re-renders', () => {
      const r = receipt();
      show({ r });
      expect(phase()).toBe('playing');
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe(ANNOUNCED);
      expect(ctl.told).toBe(1);
      show({ r, fresh: false }); // the owner clears freshness and re-renders
      advance(TOGETHER_TIMING.fillStartMs + 300); // the fill tween re-renders every frame
      expect(count()).toBe(1);
      advance(TOGETHER_TIMING.settleMs);
      expect(phase()).toBe('settled');
      show({ r, fresh: false });
      expect(count()).toBe(1);
      expect(ctl.told).toBe(1);
    });

    it('a replayed "already recorded" receipt: once, with its own words', () => {
      const r = receipt({ alreadyRecorded: true });
      show({ r });
      expect(phase()).toBe('settled');
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe('Already recorded: 20 squats. Shared total: 3,720 of 5,000 squats.');
      show({ r });
      expect(count()).toBe(1);
    });

    describe('a receipt that plays no motion is announced exactly the same way', () => {
      it('reduced motion known at mount', () => {
        ctl.pref = { reduced: true, known: true, failed: false };
        show({ r: receipt() });
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
        expect(ctl.calls[0].message).toBe(ANNOUNCED);
      });

      it('reduced motion answered after mount (pending → settled)', () => {
        const r = receipt();
        ctl.pref = { reduced: false, known: false, failed: false };
        show({ r });
        expect(phase()).toBe('pending');
        expect(count()).toBe(1);
        ctl.pref = { reduced: true, known: true, failed: false };
        show({ r, fresh: false });
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('a preference that never answers (settled at the start deadline)', () => {
        ctl.pref = { reduced: false, known: false, failed: false };
        show({ r: receipt() });
        advance(NATIVE_START_DEADLINE_MS);
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('a preference query that failed', () => {
        ctl.pref = { reduced: false, known: false, failed: true };
        show({ r: receipt() });
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('not fresh (reopened, reconciled)', () => {
        show({ r: receipt(), fresh: false });
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('no trusted before total', () => {
        show({ r: receipt(), sharedBefore: null });
        expect(phase()).toBe('settled');
        expect(count()).toBe(1);
      });

      it('an own-only receipt (no shared total)', () => {
        show({ r: { addedCount: 20, ownCredit: 60, alreadyRecorded: false } });
        expect(count()).toBe(1);
        expect(ctl.calls[0].message).toBe('Recorded: +20 squats.');
      });
    });

    it('props that update after mount without a new receipt (count, variant) do not announce again', () => {
      const r = receipt();
      show({ r });
      expect(count()).toBe(1);
      show({ r, amountText: '+25' }); // the count changes in place
      show({ r, fresh: false, sharedBefore: null }); // the variant inputs change
      advance(TOGETHER_TIMING.settleMs);
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe(ANNOUNCED);
    });

    it('a remount of the same receipt (the wrapper around it changes shape) does not announce again', () => {
      const r = receipt();
      show({ r, shape: 'plain' });
      expect(count()).toBe(1);
      show({ r, fresh: false, shape: 'boxed' }); // unmount + mount, same owner, same receipt
      expect(container.querySelector('section [data-testid="wsf-together"]')).not.toBeNull();
      expect(count()).toBe(1);
      show({ r, fresh: false, shape: 'plain' });
      expect(count()).toBe(1);
    });

    it('React’s development double-invoke (StrictMode) does not announce twice', () => {
      act(() =>
        root.render(
          <StrictMode>
            <Owner r={receipt()} />
          </StrictMode>
        )
      );
      expect(count()).toBe(1);
      expect(ctl.told).toBe(1);
    });

    it('a receipt that unmounts before it was ever shown (its render never committed) announces nothing', () => {
      const never = new Promise<never>(() => undefined);
      function Suspends(): never {
        throw never;
      }
      act(() =>
        root.render(
          <Suspense fallback={null}>
            <Owner r={receipt()} />
            <Suspends />
          </Suspense>
        )
      );
      expect(container.querySelector('[data-testid="wsf-together"]')).toBeNull();
      act(() => root.unmount());
      expect(count()).toBe(0);
      root = createRoot(container);
    });

    it('a receipt that unmounts right after it appears was announced once, and unmounting adds nothing', () => {
      show({ r: receipt() });
      act(() => root.unmount());
      expect(count()).toBe(1);
      root = createRoot(container);
    });

    it('a NEW receipt later is announced again — even with identical figures', () => {
      show({ r: { addedCount: 20, ownCredit: 40, alreadyRecorded: false } });
      show({ r: null }); // "Add more": the receipt leaves
      show({ r: { addedCount: 20, ownCredit: 60, alreadyRecorded: false } }); // the next one, same words
      expect(count()).toBe(2);
      expect(ctl.calls.map((c) => c.message)).toEqual(['Recorded: +20 squats.', 'Recorded: +20 squats.']);
    });
  });
}

describe('two receipts on screen at once (stacked contribute routes) — review A1', () => {
  it('goal B’s receipt with figures identical to goal A’s still mounted underneath is announced', () => {
    show({ r: receipt(), goalTitle: 'Goal A' });
    expect(count()).toBe(1);
    const second = secondRoot();
    show({ r: receipt(), goalTitle: 'Goal B' }, second); // a deep link stacks a second route
    expect(count()).toBe(2);
    expect(ctl.calls[1].message).toBe(ANNOUNCED);
  });

  it('a remount of A while B is up, and of B while A is up, announces neither again', () => {
    const rA = receipt();
    const rB = receipt({ addedCount: 15, sharedTotal: 3735 });
    show({ r: rA, shape: 'plain' });
    const second = secondRoot();
    show({ r: rB, sharedBefore: 3720 }, second);
    expect(count()).toBe(2);
    show({ r: rA, fresh: false, shape: 'boxed' }); // A remounts under B
    show({ r: rB, fresh: false, sharedBefore: 3720, shape: 'boxed' }, second); // B remounts over A
    expect(count()).toBe(2);
    expect(ctl.told).toBe(2);
  });

  it('two roots with the same figures mounting in the same tick are each announced once', () => {
    const second = secondRoot();
    act(() => {
      root.render(<Owner r={receipt()} goalTitle="Goal A" />);
      second.render(<Owner r={receipt()} goalTitle="Goal B" />);
    });
    expect(count()).toBe(2);
  });
});

describe('only while the app is active — review A2', () => {
  for (const notActive of ['background', 'inactive']) {
    it(`a receipt that appears while the app is ${notActive} waits for the first "active", then speaks once`, () => {
      ctl.appState = notActive;
      show({ r: receipt() });
      expect(phase()).toBe('settled'); // it does not move either
      expect(count()).toBe(0);
      expect(ctl.told).toBe(0);
      appGoes(notActive === 'background' ? 'inactive' : 'background');
      expect(count()).toBe(0);
      appGoes('active');
      expect(count()).toBe(1);
      expect(ctl.calls[0].message).toBe(ANNOUNCED);
      expect(ctl.told).toBe(1);
      appGoes('background');
      appGoes('active');
      expect(count()).toBe(1);
    });
  }

  it('unmounting before the app becomes active cancels it; that receipt shown again later is announced then', () => {
    const r = receipt();
    ctl.appState = 'background';
    show({ r, shape: 'plain' });
    act(() => root.unmount());
    appGoes('active');
    expect(count()).toBe(0);
    expect(ctl.told).toBe(0);
    expect(ctl.appListeners.size).toBe(0);
    root = createRoot(container);
    show({ r, fresh: false });
    expect(count()).toBe(1);
  });

  it('deferred under StrictMode: still one subscription and one call', () => {
    ctl.appState = 'background';
    act(() =>
      root.render(
        <StrictMode>
          <Owner r={receipt()} />
        </StrictMode>
      )
    );
    expect(ctl.appListeners.size).toBeGreaterThan(0);
    appGoes('active');
    expect(count()).toBe(1);
    expect(ctl.told).toBe(1);
  });
});

describe('how it is spoken, and who owns the identity', () => {
  it('queued behind current speech (announceForAccessibilityWithOptions, queue: true) — one call, no plain duplicate', () => {
    for (const os of ['ios', 'android']) {
      ctl.os = os;
      ctl.calls = [];
      show({ r: receipt() });
      expect(ctl.calls).toEqual([{ fn: 'announceForAccessibilityWithOptions', message: ANNOUNCED, options: { queue: true } }]);
      act(() => root.unmount());
      root = createRoot(container);
    }
  });

  it('the web never announces: its receipt container is a live region', () => {
    ctl.os = 'web';
    show({ r: receipt() });
    advance(TOGETHER_TIMING.settleMs);
    expect(count()).toBe(0);
  });

  it('TogetherCompletion keeps no announcement memory of its own; the contribute screen wires identity per receipt object', () => {
    const completion = readFileSync(nodePath.resolve(__dirname, '../src/ui/TogetherCompletion.tsx'), 'utf8');
    const code = completion.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // No module-level state between instances (the old figures-keyed slot is gone).
    expect(code).not.toMatch(/^let /m);
    expect(code).not.toMatch(/queueMicrotask/);
    const screen = readFileSync(nodePath.resolve(__dirname, '../app/contribute/[goalId].tsx'), 'utf8');
    expect(screen).toMatch(/const announcedReceiptRef = useRef<ContributeResult \| null>\(null\);/);
    expect(screen).toMatch(/announce=\{announcedReceiptRef\.current !== r\}/);
    expect(screen).toMatch(/onAnnounced=\{\(\) => \(announcedReceiptRef\.current = r\)\}/);
  });
});
