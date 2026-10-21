import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MOTION-1 review item 11 — TogetherCompletion on the WEB, rendered
 * into jsdom through react-native-web (Platform.OS is 'web'), with the real
 * reduced-motion hook reading a fake matchMedia and the real web driver
 * (`runTogetherMotion`). jsdom has no 2D canvas or Web Animations, so the
 * driver's timers, frames and canvas element run while its drawing is skipped.
 *
 * It proves the web path the native work must not have changed: the one
 * decision, the 3,400 ms settle, reduced motion mid-play, a static remount,
 * nothing left running after unmount, and no native layer or announcement.
 */

const media = vi.hoisted(() => ({ reduced: false, listeners: new Set<() => void>() }));
const announced = vi.hoisted(() => [] as string[]);

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: (m: string) => {
        announced.push(m);
      },
    },
  };
});

import { togetherPresentation, type ContributeReceipt } from '../src/contributionFlow';
import { percentLabel, totalOfTargetLabel } from '../src/ui/progressFormat';
import { TogetherCompletion } from '../src/ui/TogetherCompletion';
import { TOGETHER_TIMING } from '../src/ui/togetherMotion';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let getContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  media.reduced = false;
  media.listeners.clear();
  announced.length = 0;
  (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = () => ({
    get matches() {
      return media.reduced;
    },
    addEventListener: (_: string, fn: () => void) => media.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => media.listeners.delete(fn),
  });
  // jsdom has no 2D canvas; the driver skips drawing when there is no context.
  getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof getContext;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLCanvasElement.prototype.getContext = getContext;
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.useRealTimers();
});

const receipt: ContributeReceipt = {
  addedCount: 20,
  ownCredit: 20,
  alreadyRecorded: false,
  sharedTotal: 3720,
  target: 5000,
  unit: 'squats',
  status: 'active',
};

function render(fresh: boolean) {
  const p = togetherPresentation(receipt, { communityName: 'Fixture Community', fresh, sharedBefore: 3700, beforeTarget: 5000 });
  act(() => {
    root.render(
      <TogetherCompletion
        presentation={p}
        eyebrow="Recorded"
        amountText="+20"
        unit="squats"
        shared={{ total: 3720, target: 5000, unit: 'squats', status: 'active' }}
        context={{ communityName: 'Fixture Community', goalTitle: '5,000 squats' }}
        ownCredit={null}
        standing={null}
        actions={null}
        fresh={fresh}
        onFreshConsumed={() => undefined}
        announce
        onAnnounced={() => undefined}
        windowWidth={390}
        windowHeight={844}
      />
    );
  });
}

const el = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const phase = () => el('wsf-together')?.getAttribute('data-together-phase');
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const confirmedLabel = `${totalOfTargetLabel(3720, 5000, 'squats')}, ${percentLabel(3720, 5000)} filled`;

describe('web Together: the path the native work did not change', () => {
  it('plays at mount, draws on its canvas, and settles at 3,400 ms with the canvas gone', () => {
    render(true);
    expect(phase()).toBe('playing');
    expect(el('wsf-together-canvas')).not.toBeNull();
    expect(el('wsf-contribute-we')?.getAttribute('aria-label')).toBe(confirmedLabel);
    advance(TOGETHER_TIMING.settleMs - 1);
    expect(phase()).toBe('playing');
    advance(1);
    expect(phase()).toBe('settled');
    expect(el('wsf-together-canvas')).toBeNull();
    expect(el('wsf-contribute-we')?.getAttribute('aria-label')).toBe(confirmedLabel);
  });

  it('reduced motion switched on mid-play settles at once, and switching it off replays nothing', () => {
    render(true);
    advance(900);
    expect(phase()).toBe('playing');
    act(() => {
      media.reduced = true;
      media.listeners.forEach((fn) => fn());
    });
    expect(phase()).toBe('settled');
    expect(el('wsf-together-canvas')).toBeNull();
    act(() => {
      media.reduced = false;
      media.listeners.forEach((fn) => fn());
    });
    advance(5000);
    expect(phase()).toBe('settled');
  });

  it('reduced motion at mount: settled from the first frame', () => {
    media.reduced = true;
    render(true);
    expect(phase()).toBe('settled');
    expect(el('wsf-together-canvas')).toBeNull();
  });

  it('a remount without freshness is static', () => {
    render(true);
    act(() => root.unmount());
    root = createRoot(container);
    render(false);
    expect(phase()).toBe('settled');
    expect(el('wsf-together')?.getAttribute('data-together-animate')).toBe('static');
    expect(el('wsf-together-canvas')).toBeNull();
  });

  it('unmount mid-play leaves no timer, frame or canvas behind', () => {
    render(true);
    advance(1600); // inside the fill tween
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('[data-testid="wsf-together-canvas"]')).toBeNull();
    root = createRoot(container);
  });

  it('never renders the native layer, never pends, and never announces (the web has its live region)', () => {
    render(true);
    expect(el('wsf-together-native-layer')).toBeNull();
    expect(phase()).not.toBe('pending');
    advance(TOGETHER_TIMING.settleMs);
    expect(el('wsf-together-native-layer')).toBeNull();
    expect(announced).toEqual([]);
  });
});
