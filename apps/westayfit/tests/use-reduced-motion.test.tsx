import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MOTION-1 review item 8 — the reduced-motion hook.
 *
 * NATIVE branch: jsdom has no matchMedia, so the hook takes the native path;
 * AccessibilityInfo is replaced with a controllable fake (each query returns a
 * promise the test settles; change events are delivered by the test).
 *
 * WEB branch: a fake matchMedia proves the web path is synchronous, live, and
 * never asks AccessibilityInfo.
 *
 * The hook keeps a runtime-wide cache and epoch, so every test re-imports it
 * fresh (vi.resetModules) to start from a cold runtime.
 */

type Deferred = { resolve: (v: boolean) => void; reject: (e: unknown) => void };

const ax = vi.hoisted(() => ({
  queries: [] as Deferred[],
  handlers: new Set<(v: boolean) => void>(),
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      isReduceMotionEnabled: () =>
        new Promise<boolean>((resolve, reject) => {
          ax.queries.push({ resolve, reject });
        }),
      addEventListener: (_event: string, handler: (v: boolean) => void) => {
        ax.handlers.add(handler);
        return { remove: () => ax.handlers.delete(handler) };
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Pref = { reduced: boolean; known: boolean; failed: boolean };
type Hook = typeof import('../src/ui/useReducedMotion');

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function freshHook(): Promise<Hook> {
  vi.resetModules();
  return import('../src/ui/useReducedMotion');
}

/** Mounts one hook instance; `seen` holds every value it rendered, newest last. */
function mount(hook: Hook, which: 'preference' | 'boolean' = 'preference') {
  const seen: Pref[] = [];
  const bools: boolean[] = [];
  function Probe() {
    if (which === 'preference') seen.push(hook.useReducedMotionPreference());
    else bools.push(hook.useReducedMotion());
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  containers.push(container);
  roots.push(root);
  act(() => root.render(<Probe />));
  return { seen, bools, last: () => seen[seen.length - 1], unmount: () => act(() => root.unmount()) };
}

const answer = async (i: number, v: boolean) => act(async () => ax.queries[i].resolve(v));
const refuse = async (i: number) => act(async () => ax.queries[i].reject(new Error('unavailable')));
const change = (v: boolean) => act(() => ax.handlers.forEach((h) => h(v)));

beforeEach(() => {
  ax.queries = [];
  ax.handlers.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
});
afterEach(() => {
  for (const r of roots) {
    try {
      act(() => r.unmount());
    } catch {
      // already unmounted
    }
  }
  containers.forEach((c) => c.remove());
  containers = [];
  roots = [];
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('native: unknown until this mount’s own answer', () => {
  it('starts unknown, then knows the answer', async () => {
    const hook = await freshHook();
    const probe = mount(hook);
    expect(probe.last()).toEqual({ reduced: false, known: false, failed: false });
    expect(ax.queries).toHaveLength(1);
    await answer(0, true);
    expect(probe.last()).toEqual({ reduced: true, known: true, failed: false });
  });

  it('useReducedMotion(): an answer equal to the seeded value does not re-render (N3)', async () => {
    const hook = await freshHook();
    // Cold runtime: seeded false; the mount's own answer is false → still one render.
    const cold = mount(hook, 'boolean');
    await answer(0, false);
    expect(cold.bools).toEqual([false]);
    // Warm the cache with `true`, then a new boolean consumer: seeded true, answered true → one render.
    change(true);
    expect(cold.bools).toEqual([false, true]); // a real change does re-render
    const warm = mount(hook, 'boolean');
    expect(warm.bools).toEqual([true]);
    await answer(1, true);
    expect(warm.bools).toEqual([true]);
  });

  it('useReducedMotion() is the same answer as a boolean: false until answered, then the answer', async () => {
    const hook = await freshHook();
    const probe = mount(hook, 'boolean');
    expect(probe.bools).toEqual([false]);
    await answer(0, true);
    expect(probe.bools.at(-1)).toBe(true);
  });

  it('a rejected query reports a definite failure, which a later change event replaces', async () => {
    const hook = await freshHook();
    const probe = mount(hook);
    await refuse(0);
    expect(probe.last()).toEqual({ reduced: false, known: false, failed: true });
    change(false);
    expect(probe.last()).toEqual({ reduced: false, known: true, failed: false });
  });

  it('change events keep it live, and unmount stops listening', async () => {
    const hook = await freshHook();
    const probe = mount(hook);
    await answer(0, false);
    change(true);
    expect(probe.last()).toEqual({ reduced: true, known: true, failed: false });
    change(false);
    expect(probe.last()).toEqual({ reduced: false, known: true, failed: false });
    probe.unmount();
    expect(ax.handlers.size).toBe(0);
  });

  it('the cache seeds `reduced` on a new mount but does not certify it: `known` waits for that mount’s own answer', async () => {
    const hook = await freshHook();
    const a = mount(hook);
    await answer(0, true);
    expect(a.last().known).toBe(true);
    const b = mount(hook);
    // A reduced-motion user reads `true` from b's first render — so a caller holds still sooner…
    expect(b.seen[0]).toEqual({ reduced: true, known: false, failed: false });
    // …but b is not `known` until its own query answers.
    expect(ax.queries).toHaveLength(2);
    await answer(1, false);
    expect(b.last()).toEqual({ reduced: false, known: true, failed: false });
  });

  it('epoch: a late answer cannot overwrite a newer change — in state or in the cache', async () => {
    const hook = await freshHook();
    const a = mount(hook);
    change(true); // the person switches reduced motion on while the query is in flight
    expect(a.last()).toEqual({ reduced: true, known: true, failed: false });
    await answer(0, false); // the stale answer from before the change
    expect(a.last()).toEqual({ reduced: true, known: true, failed: false });
    // The cache kept the newer value too: a new mount is seeded with it.
    const b = mount(hook);
    expect(b.seen[0].reduced).toBe(true);
  });

  it('epoch: an answer after an unrelated later mount still applies when no change happened', async () => {
    const hook = await freshHook();
    const a = mount(hook);
    const b = mount(hook);
    await answer(1, false);
    await answer(0, false);
    expect(a.last()).toEqual({ reduced: false, known: true, failed: false });
    expect(b.last()).toEqual({ reduced: false, known: true, failed: false });
  });
});

describe('web: synchronous, live, unchanged', () => {
  function fakeMatchMedia(initial: boolean) {
    const listeners = new Set<() => void>();
    const mq = {
      matches: initial,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    (window as unknown as { matchMedia: (q: string) => typeof mq }).matchMedia = () => mq;
    return {
      set: (v: boolean) =>
        act(() => {
          mq.matches = v;
          listeners.forEach((fn) => fn());
        }),
      listeners,
    };
  }

  it('useReducedMotion() on the web: the media query on the first render, live, and silent when unchanged', async () => {
    const media = fakeMatchMedia(true);
    const hook = await freshHook();
    const probe = mount(hook, 'boolean');
    expect(probe.bools).toEqual([true]);
    media.set(true); // a change event with the same value: no re-render
    expect(probe.bools).toEqual([true]);
    media.set(false);
    expect(probe.bools).toEqual([true, false]);
    expect(ax.queries).toHaveLength(0);
    probe.unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is known on the first render from the media query, follows its changes, and never asks AccessibilityInfo', async () => {
    const media = fakeMatchMedia(true);
    const hook = await freshHook();
    const probe = mount(hook);
    expect(probe.seen[0]).toEqual({ reduced: true, known: true, failed: false });
    media.set(false);
    expect(probe.last()).toEqual({ reduced: false, known: true, failed: false });
    expect(ax.queries).toHaveLength(0);
    expect(ax.handlers.size).toBe(0);
    probe.unmount();
    expect(media.listeners.size).toBe(0);
  });
});
