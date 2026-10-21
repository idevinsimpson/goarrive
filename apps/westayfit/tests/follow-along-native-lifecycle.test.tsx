import { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MO-05 — the follow-along round pauses when the native app goes to the
 * background, exactly as it does when a web tab is hidden; being only inactive
 * (iOS Control Center) does not pause it (the blur rule); and nothing accrues
 * for the interruption itself (a phone call).
 *
 * The real session hook and the real FollowAlongCard, rendered through
 * react-native-web with Platform.OS switched per test and AppState faked; Date
 * and timers are faked so seconds are exact. (No device: this proves the rule
 * and what the card says, not the OS's event timing.)
 */

const ctl = vi.hoisted(() => ({
  os: 'android' as string,
  appListeners: new Set<(state: string) => void>(),
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => o[ctl.os] ?? o.native ?? o.default,
    },
    AppState: {
      currentState: 'active',
      addEventListener: (_type: string, handler: (state: string) => void) => {
        ctl.appListeners.add(handler);
        return { remove: () => ctl.appListeners.delete(handler) };
      },
    },
  };
});

// This suite is about the ROUND's lifecycle, not the demo clip. The media slot
// is stubbed so the test does not depend on which MovementDemoMedia the tree
// carries (the poster-only one here, or the expo-video one once the media lane
// is merged, which imports expo-router and expo-video). The catalog is empty,
// so the card never renders the slot in these tests anyway.
vi.mock('../src/ui/MovementDemoMedia', () => ({ MovementDemoMedia: () => null }));

import { ACTIVE_LIFECYCLE, appLifecycleStep, INTERRUPTED_NOTICE, RING_BACKDATE_MS } from '../src/followAlong';
import { TICK_MS, useFollowAlongSession } from '../src/followAlongSession';
import { FollowAlongCard } from '../src/ui/FollowAlongCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
  ctl.os = 'android';
  ctl.appListeners.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** A host as the /move route wires it: it mints a round id on Start and drops it on Start over. */
function Host() {
  const [roundId, setRoundId] = useState<string | null>(null);
  const onRoundStart = useCallback(() => setRoundId((prev) => prev ?? 'round-1'), []);
  const onRoundReset = useCallback(() => setRoundId(null), []);
  const session = useFollowAlongSession({ unit: 'squats', roundId, onRoundStart, onRoundReset });
  return <FollowAlongCard session={session} testIDPrefix="fa" finishedAction={null} />;
}

const el = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const status = () => el('fa-status')?.textContent ?? '';
const notice = () => el('fa-interrupted')?.textContent ?? null;
const press = (id: string) => act(() => el(id)!.click());
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const app = (state: string) => act(() => ctl.appListeners.forEach((h) => h(state)));
/** Start, then run 3 s of countdown and 10 s of the round: 50 s left. */
function startAndRunTo50() {
  act(() => root.render(<Host />));
  press('fa-start');
  advance(3_000 + 10_000);
  expect(status()).toBe('50 left in this round');
}

describe('appLifecycleStep (pure)', () => {
  it('inactive alone never pauses; it remembers when the app first went inactive', () => {
    const a = appLifecycleStep(ACTIVE_LIFECYCLE, 'inactive', 1_000);
    expect(a).toEqual({ lifecycle: { inactiveSince: 1_000 }, pauseAt: null });
    const b = appLifecycleStep(a.lifecycle, 'inactive', 2_000);
    expect(b.lifecycle.inactiveSince).toBe(1_000);
    expect(appLifecycleStep(b.lifecycle, 'active', 3_000)).toEqual({ lifecycle: ACTIVE_LIFECYCLE, pauseAt: null });
  });

  it('background pauses, dated to the first inactive moment when there was one (nothing accrues for the call)', () => {
    expect(appLifecycleStep(ACTIVE_LIFECYCLE, 'background', 5_000).pauseAt).toBe(5_000);
    const ringing = appLifecycleStep(ACTIVE_LIFECYCLE, 'inactive', 1_000).lifecycle;
    expect(appLifecycleStep(ringing, 'background', 6_000)).toEqual({ lifecycle: ACTIVE_LIFECYCLE, pauseAt: 1_000 });
  });

  it('the backdate reaches back at most a ring-sized window (NB-2)', () => {
    expect(RING_BACKDATE_MS).toBe(30_000);
    const longInactive = appLifecycleStep(ACTIVE_LIFECYCLE, 'inactive', 0).lifecycle;
    expect(appLifecycleStep(longInactive, 'background', 120_000).pauseAt).toBe(120_000 - RING_BACKDATE_MS);
    const shortInactive = appLifecycleStep(ACTIVE_LIFECYCLE, 'inactive', 100_000).lifecycle;
    expect(appLifecycleStep(shortInactive, 'background', 120_000).pauseAt).toBe(100_000);
  });

  it('a late background event is capped one tick after the last tick', () => {
    expect(appLifecycleStep(ACTIVE_LIFECYCLE, 'background', 70_000, 10_000, TICK_MS).pauseAt).toBe(10_000 + TICK_MS);
    expect(appLifecycleStep(ACTIVE_LIFECYCLE, 'background', 10_100, 10_000, TICK_MS).pauseAt).toBe(10_100);
  });
});

describe('Android: Home for 60 s, then back', () => {
  it('shows "Paused · 50 left in this round" (Ns = 50) with the interrupted notice, and Resume continues the round', () => {
    startAndRunTo50();
    app('background');
    advance(60_000);
    app('active');
    expect(status()).toBe('Paused · 50 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
    expect(el('fa-finished')).toBeNull(); // not "That's the round"
    expect(el('fa-start')?.textContent).toBe('Resume');
    press('fa-start');
    expect(notice()).toBeNull();
    advance(1_000);
    expect(status()).toBe('49 left in this round');
  });

  it('a late background event (JavaScript suspended as the app left) does not charge the time away', () => {
    startAndRunTo50();
    // The OS suspends JavaScript: time passes with no ticks, then the event lands.
    vi.setSystemTime(Date.now() + 60_000);
    app('background');
    app('active');
    expect(status()).toBe('Paused · 50 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
  });

  it('a round not yet started, or already finished, is untouched by the background', () => {
    act(() => root.render(<Host />));
    app('background');
    app('active');
    expect(notice()).toBeNull();
    expect(status()).toBe('Not started · 60 seconds');
    press('fa-start');
    press('fa-stop'); // finished: "Stop and enter my reps"
    app('background');
    app('active');
    expect(el('fa-finished')).not.toBeNull();
    expect(notice()).toBeNull();
  });
});

describe('iOS', () => {
  beforeEach(() => {
    ctl.os = 'ios';
  });

  it('Control Center (inactive only) does not pause the round — the blur rule', () => {
    startAndRunTo50();
    app('inactive');
    advance(3_000);
    app('active');
    expect(status()).toBe('47 left in this round'); // still running; the 3 s counted as round time
    expect(notice()).toBeNull();
    expect(el('fa-pause')).not.toBeNull();
  });

  it('a phone call during the round pauses it, and nothing accrues for the call', () => {
    startAndRunTo50();
    app('inactive'); // the call rings
    advance(5_000);
    app('background'); // answered
    advance(60_000);
    app('active'); // hung up
    expect(status()).toBe('Paused · 50 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
  });

  it('a call that rings past the end of the round still pauses it when answered (NB-1)', () => {
    act(() => root.render(<Host />));
    press('fa-start');
    advance(3_000 + 50_000);
    expect(status()).toBe('10 left in this round');
    app('inactive'); // it rings…
    advance(20_000); // …for longer than the 10 s the round had left
    app('background'); // answered
    advance(60_000);
    app('active');
    expect(el('fa-finished')).toBeNull();
    expect(status()).toBe('Paused · 10 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
  });

  it('inactive past the end, then straight back (declined, Control Center): the round finishes, as the blur rule says', () => {
    act(() => root.render(<Host />));
    press('fa-start');
    advance(3_000 + 50_000);
    app('inactive');
    advance(20_000);
    app('active');
    expect(el('fa-finished')).not.toBeNull();
    expect(notice()).toBeNull();
    // And the clock was stopped on return: no tick is left running.
    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(el('fa-finished')).not.toBeNull();
  });

  it('Control Center left open, then Home: at most a ring-sized window is given back (NB-2)', () => {
    startAndRunTo50();
    app('inactive'); // Control Center open; the round keeps running (blur rule)
    advance(40_000);
    app('background'); // then Home
    app('active');
    // 40 s showed as gone; only the last 30 s count as the interruption.
    expect(status()).toBe('Paused · 40 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
  });

  it('a phone call during the countdown pauses it there, with nothing accrued', () => {
    act(() => root.render(<Host />));
    press('fa-start');
    advance(1_500);
    expect(status()).toBe('Starting in 2');
    app('inactive');
    advance(4_000);
    app('background');
    advance(30_000);
    app('active');
    expect(status()).toBe('Starting in 2');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
    expect(el('fa-start')?.textContent).toBe('Resume');
  });
});

describe('web is unchanged', () => {
  beforeEach(() => {
    ctl.os = 'web';
  });

  it('attaches no app-state listener, and a hidden tab still pauses through the document path', () => {
    startAndRunTo50();
    expect(ctl.appListeners.size).toBe(0);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    hidden.mockRestore();
    advance(60_000);
    expect(status()).toBe('Paused · 50 left in this round');
    expect(notice()).toBe(INTERRUPTED_NOTICE);
  });
});
