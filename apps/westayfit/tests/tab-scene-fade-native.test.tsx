import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, useRef, type MutableRefObject, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MO-04 — the native tab fade (src/ui/TabSceneFade.native.tsx). Three mounted
 * tab scenes share the shell's `lastSelected` ref, as app/(tabs)/_layout.tsx
 * wires them. The web keeps TabSceneFade.tsx (its CSS fade), byte-identical.
 *
 * Under vitest, react-native-web serves AnimatedMock (every animation
 * completes at once), so this file gives `Animated` a controllable fake: each
 * value records what it is set to, and each timing records its config, whether
 * it was started or stopped, and finishes only when the test says so. What is
 * tested is the component's decision — values, duration, easing, driver, the
 * blur reset, stop on re-trigger and unmount — not react-native-web's player.
 */

type FakeTiming = {
  value: { v: number };
  config: { toValue: number; duration: number; easing: (t: number) => number; useNativeDriver: boolean };
  started: boolean;
  stopped: boolean;
  finish: () => void;
};
const fx = vi.hoisted(() => ({ values: [] as Array<{ v: number }>, timings: [] as FakeTiming[] }));

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
  const View = ({ testID, children }: { testID?: string; children?: ReactNode }) =>
    React.createElement('div', { 'data-testid': testID }, children);
  return { ...actual, Animated: { ...actual.Animated, Value, timing, View } };
});

// sheetMotion (where TAB_FADE_MS lives) imports expo-router.
vi.mock('expo-router', () => ({ useNavigation: () => ({ addListener: () => () => undefined }) }));

import { TAB_FADE_MS as SHEET_TAB_FADE_MS } from '../src/ui/sheetMotion';
import { TAB_FADE_EASING, TAB_FADE_FROM, TAB_FADE_MS, tabFadeOnSelect } from '../src/ui/tabFade';
import { TabSceneFade } from '../src/ui/TabSceneFade.native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fx.values.length = 0;
  fx.timings.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const TABS = ['home', 'community', 'progress'] as const;
type Tab = (typeof TABS)[number];

let shared: MutableRefObject<string | null> | null = null;
function Shell({ selected, reducedMotion = false }: { selected: Tab; reducedMotion?: boolean }) {
  const lastSelected = useRef<string | null>(null);
  shared = lastSelected;
  return (
    <>
      {TABS.map((tab) => (
        <TabSceneFade key={tab} routeKey={tab} selectedKey={selected} lastSelected={lastSelected} reducedMotion={reducedMotion}>
          <Text>{tab}</Text>
        </TabSceneFade>
      ))}
    </>
  );
}

const show = (selected: Tab, reducedMotion = false) => act(() => root.render(<Shell selected={selected} reducedMotion={reducedMotion} />));
/** Each scene's opacity value, in mount order. */
const opacity = (tab: Tab) => fx.values[TABS.indexOf(tab)].v;
const timingFor = (tab: Tab) => fx.timings.filter((t) => t.value === fx.values[TABS.indexOf(tab)]);

describe('the numbers and the decision', () => {
  it('0.35 → 1 over 140 ms, ease-out — the same 140 ms the web uses', () => {
    expect(TAB_FADE_FROM).toBe(0.35);
    expect(TAB_FADE_MS).toBe(140);
    expect(TAB_FADE_MS).toBe(SHEET_TAB_FADE_MS);
    expect(TAB_FADE_EASING).toEqual([0, 0, 0.58, 1]);
  });

  it('only a change of tab fades: not the first tab, not a reselect, never with reduced motion', () => {
    expect(tabFadeOnSelect({ previous: null, routeKey: 'home', reducedMotion: false })).toBe(false);
    expect(tabFadeOnSelect({ previous: 'home', routeKey: 'home', reducedMotion: false })).toBe(false);
    expect(tabFadeOnSelect({ previous: 'home', routeKey: 'community', reducedMotion: false })).toBe(true);
    expect(tabFadeOnSelect({ previous: 'home', routeKey: 'community', reducedMotion: true })).toBe(false);
  });

  it('runs on the native driver with exactly those values', () => {
    show('home');
    show('community');
    expect(fx.timings).toHaveLength(1);
    const { config, started } = fx.timings[0];
    expect(started).toBe(true);
    expect(config).toMatchObject({ toValue: 1, duration: 140, useNativeDriver: true });
    // Easing.bezier(0, 0, 0.58, 1): ease-out (fast start, slow end).
    expect(config.easing(0.5)).toBeGreaterThan(0.5);
    expect(config.easing(0)).toBeCloseTo(0, 5);
    expect(config.easing(1)).toBeCloseTo(1, 5);
  });
});

describe('the scene', () => {
  it('the first tab of a session does not fade', () => {
    show('home');
    expect(fx.timings).toHaveLength(0);
    expect(opacity('home')).toBe(1);
  });

  it('a change of tab starts the entering scene at 0.35 and fades it to 1; the leaving one is at 1', () => {
    show('home');
    show('community');
    expect(opacity('community')).toBe(0.35);
    expect(opacity('home')).toBe(1);
    timingFor('community')[0].finish();
    expect(opacity('community')).toBe(1);
  });

  it('reselecting the current tab, or coming back from MOVE or Settings, does not fade', () => {
    show('home');
    show('community');
    timingFor('community')[0].finish();
    const before = fx.timings.length;
    show('community'); // reselect / a re-render after a page, sheet or Settings closed
    show('community');
    expect(fx.timings).toHaveLength(before);
    expect(opacity('community')).toBe(1);
    expect(shared!.current).toBe('community');
  });

  it('reduced motion: an instant switch', () => {
    show('home', true);
    show('community', true);
    expect(fx.timings).toHaveLength(0);
    expect(opacity('community')).toBe(1);
  });

  it('a fast Home → Community → Progress within 140 ms leaves every scene at full opacity', () => {
    show('home');
    show('community'); // Community starts its fade…
    expect(opacity('community')).toBe(0.35);
    show('progress'); // …and the member moves on before it ends
    expect(timingFor('community')[0].stopped).toBe(true); // its fade is stopped…
    expect(opacity('community')).toBe(1); // …and the blurred scene is never left part-faded
    expect(opacity('progress')).toBe(0.35);
    timingFor('progress')[0].finish();
    for (const tab of TABS) expect(opacity(tab)).toBe(1);
  });

  it('reduced motion turned on mid-fade ends the fade at once', () => {
    show('home');
    show('community');
    expect(opacity('community')).toBe(0.35);
    show('community', true);
    expect(timingFor('community')[0].stopped).toBe(true);
    expect(opacity('community')).toBe(1);
  });

  it('returning to a scene mid-fade restarts its fade cleanly (the earlier run was stopped when it blurred)', () => {
    show('home');
    show('community');
    show('home'); // back to Home mid-fade: Home fades in, Community blurs
    show('community'); // and to Community again
    const runs = timingFor('community');
    expect(runs).toHaveLength(2);
    expect(runs[0].stopped).toBe(true);
    expect(runs[1].started).toBe(true);
    expect(opacity('community')).toBe(0.35);
  });

  it('unmounting mid-fade stops it', () => {
    show('home');
    show('community');
    const run = timingFor('community')[0];
    act(() => root.unmount());
    expect(run.stopped).toBe(true);
    root = createRoot(container);
  });
});

describe('the web keeps its own fade', () => {
  it('TabSceneFade.tsx is unchanged in shape: still the CSS phase attribute, no Animated', () => {
    const web = readFileSync(nodePath.resolve(__dirname, '../src/ui/TabSceneFade.tsx'), 'utf8');
    expect(web).toContain('wsfTabScene');
    expect(web).not.toMatch(/Animated/);
    expect(web).not.toContain('wsf-tab-scene-native');
  });
});
