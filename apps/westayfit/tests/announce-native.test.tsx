import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-18 (W12-7) — the shared announce helper. The native twin
 * (src/ui/announce.native.ts) is imported directly, because vitest does not
 * apply platform extensions; AccessibilityInfo and AppState are faked. The web
 * twin (src/ui/announce.ts) is what the web build and every other test load.
 */

const rn = vi.hoisted(() => ({
  state: 'active' as string,
  listeners: new Set<(s: string) => void>(),
  withOptions: true,
  calls: [] as Array<{ fn: 'withOptions' | 'plain'; message: string; options?: unknown }>,
  throws: false,
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  const AccessibilityInfo = {
    get announceForAccessibilityWithOptions() {
      if (!rn.withOptions) return undefined;
      return (message: string, options: unknown) => {
        rn.calls.push({ fn: 'withOptions', message, options });
        if (rn.throws) throw new Error('no screen reader bridge');
      };
    },
    announceForAccessibility: (message: string) => {
      rn.calls.push({ fn: 'plain', message });
    },
  };
  return {
    ...actual,
    AccessibilityInfo,
    AppState: {
      get currentState() {
        return rn.state;
      },
      addEventListener: (_type: string, handler: (s: string) => void) => {
        rn.listeners.add(handler);
        return { remove: () => rn.listeners.delete(handler) };
      },
    },
  };
});

import * as web from '../src/ui/announce';
import * as native from '../src/ui/announce.native';
import { liveRegion as nativeLiveRegion, useAnnounce } from '../src/ui/announce.native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  rn.state = 'active';
  rn.listeners.clear();
  rn.withOptions = true;
  rn.calls = [];
  rn.throws = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const spoken = { count: 0 };
function Probe({ message, k }: { message: string | null; k: string | number | null }) {
  useAnnounce(message, k, () => {
    spoken.count += 1;
  });
  return null;
}
const show = (message: string | null, k: string | number | null, strict = false) =>
  act(() => root.render(strict ? <StrictMode><Probe message={message} k={k} /></StrictMode> : <Probe message={message} k={k} />));
const app = (next: string) =>
  act(() => {
    rn.state = next;
    rn.listeners.forEach((h) => h(next));
  });
const said = () => rn.calls.map((c) => c.message);

beforeEach(() => {
  spoken.count = 0;
});

describe('native: speaks once per key', () => {
  it('queued, once, however often it re-renders or rewords the same key', () => {
    show('Saved. 25 squats.', 'r1');
    expect(rn.calls).toEqual([{ fn: 'withOptions', message: 'Saved. 25 squats.', options: { queue: true } }]);
    show('Saved. 25 squats.', 'r1');
    show('Saved: 25 squats', 'r1'); // a new wording, same announcement
    expect(said()).toEqual(['Saved. 25 squats.']);
    expect(spoken.count).toBe(1);
  });

  it('React StrictMode’s development re-run does not speak it twice', () => {
    show('Saved.', 'r1', true);
    expect(said()).toEqual(['Saved.']);
  });

  it('a new key is a new announcement', () => {
    show('Saved.', 'r1');
    show('Could not save.', 'r2');
    expect(said()).toEqual(['Saved.', 'Could not save.']);
    show('Saved.', 'r1'); // back to an earlier key after another: new again
    expect(said()).toEqual(['Saved.', 'Could not save.', 'Saved.']);
    expect(spoken.count).toBe(3);
  });

  it('nothing is owed without a key or a message; it is spoken when both arrive', () => {
    show('Saved.', null);
    show(null, 'r1');
    show('', 'r1');
    expect(rn.calls).toEqual([]);
    show('Saved.', 'r1');
    expect(said()).toEqual(['Saved.']);
  });
});

describe('native: only in the foreground', () => {
  it('waits while in the background (and while inactive) and speaks on the first active', () => {
    rn.state = 'background';
    show('Saved.', 'r1');
    expect(rn.calls).toEqual([]);
    app('inactive');
    expect(rn.calls).toEqual([]);
    app('active');
    expect(said()).toEqual(['Saved.']);
    // A later round trip does not speak it again.
    app('background');
    app('active');
    expect(said()).toEqual(['Saved.']);
    expect(spoken.count).toBe(1);
  });

  it('inactive at mount waits too', () => {
    rn.state = 'inactive';
    show('Saved.', 'r1');
    expect(rn.calls).toEqual([]);
    app('active');
    expect(said()).toEqual(['Saved.']);
  });

  it('speaks the latest message for the key; a new key while waiting replaces the old one', () => {
    rn.state = 'background';
    show('Saving…', 'r1');
    show('Saved.', 'r1');
    show('Could not save.', 'r2');
    app('active');
    expect(said()).toEqual(['Could not save.']);
    expect(rn.listeners.size).toBe(0);
  });

  it('`unknown` (before iOS reports a state) speaks at once', () => {
    rn.state = 'unknown';
    show('Saved.', 'r1');
    expect(said()).toEqual(['Saved.']);
  });
});

describe('native: cancelled on unmount', () => {
  it('a screen that goes away while waiting says nothing, and leaves no listener', () => {
    rn.state = 'background';
    show('Saved.', 'r1');
    expect(rn.listeners.size).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);
    expect(rn.listeners.size).toBe(0);
    app('active');
    expect(rn.calls).toEqual([]);
    expect(spoken.count).toBe(0);
  });
});

describe('native: posting', () => {
  it('falls back to the plain announcement where the queued one is missing', () => {
    rn.withOptions = false;
    show('Saved.', 'r1');
    expect(rn.calls).toEqual([{ fn: 'plain', message: 'Saved.' }]);
  });

  it('a failing announcement is swallowed: the screen is fine, and the key counts as spoken', () => {
    rn.throws = true;
    show('Saved.', 'r1');
    show('Saved.', 'r1');
    expect(said()).toEqual(['Saved.']);
    expect(spoken.count).toBe(1);
  });

  it('native liveRegion is empty: no live region beside the explicit announcement', () => {
    expect(nativeLiveRegion).toEqual({});
    expect(Object.isFrozen(nativeLiveRegion)).toBe(true);
  });
});

describe('the web twin', () => {
  it('liveRegion is aria-live="polite" (today’s attribute), and it reaches the DOM', () => {
    expect(web.liveRegion).toEqual({ 'aria-live': 'polite' });
    expect(Object.isFrozen(web.liveRegion)).toBe(true);
    act(() => root.render(<View testID="region" {...web.liveRegion} />));
    expect(container.querySelector('[data-testid="region"]')!.getAttribute('aria-live')).toBe('polite');
  });

  it('useAnnounce never calls AccessibilityInfo, never calls onSpoken, and subscribes to nothing', () => {
    function WebProbe({ k }: { k: string }) {
      web.useAnnounce('Saved.', k, () => {
        spoken.count += 1;
      });
      return null;
    }
    rn.state = 'background';
    act(() => root.render(<WebProbe k="r1" />));
    act(() => root.render(<WebProbe k="r2" />));
    app('active');
    expect(rn.calls).toEqual([]);
    expect(rn.listeners.size).toBe(0);
    expect(spoken.count).toBe(0);
  });

  it('both twins export the same names', () => {
    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
  });
});
