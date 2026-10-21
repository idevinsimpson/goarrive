import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RV12-641-A3 (native). Progress stays mounted under MOVE and behind other
 * tabs. A revalidation that lands while it is out of sight can make its list
 * partial; the note then must not be spoken over the screen in front. The
 * real route (app/(tabs)/activity.tsx) with the shared helper's native twin,
 * its focus driven by hand, the member reads mocked at their boundary. No
 * device.
 */
vi.mock('../src/ui/announce', async () => import('../src/ui/announce.native'));
const focus = vi.hoisted(() => ({ now: true, listeners: new Set<() => void>() }));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  // Runs its callback while the screen is in front, and its cleanup when it leaves.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const [focused, setFocused] = useState(focus.now);
    useEffect(() => {
      const l = () => setFocused(focus.now);
      focus.listeners.add(l);
      return () => {
        focus.listeners.delete(l);
      };
    }, []);
    useEffect(() => (focused ? cb() : undefined), [focused, cb]);
  },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const USER = { uid: 'u1' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
const readGoals = vi.fn();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMyCommunities: async () => ({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together' }, { groupId: 'elm', displayName: 'Elm Street' }] }),
  readGoals: (...a: unknown[]) => readGoals(...a),
  readOwnCredit: async () => ({ ownCredit: 25, unit: 'squats' }),
}));

const { default: ActivityScreen } = await import('../app/(tabs)/activity');
const { PARTIAL_SENTENCE } = await import('../src/ui/ProgressParityView');

const GOAL = { goalId: 'g-a', title: '500 squats together', target: 500, unit: 'squats', status: 'active', sharedTotal: 120 };
let container: HTMLDivElement;
let root: Root;
let os: string;
let spoken: string[];
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
const setFocus = (now: boolean) => {
  focus.now = now;
  act(() => focus.listeners.forEach((l) => l()));
};

beforeEach(() => {
  os = Platform.OS;
  (Platform as { OS: string }).OS = 'ios';
  focus.now = true;
  focus.listeners.clear();
  spoken = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  (AccessibilityInfo as unknown as { announceForAccessibilityWithOptions: unknown }).announceForAccessibilityWithOptions = (m: string) => spoken.push(m);
  // Oak's goals read; Elm's fail, so the list is partial.
  readGoals.mockReset().mockImplementation(async (_uid: string, groupId: string) => {
    if (groupId === 'elm') throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { goals: [GOAL] };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.restoreAllMocks();
});

describe('RV12-641-A3: the partial note is spoken only while Progress is in front', () => {
  it('in front: spoken once', async () => {
    act(() => root.render(<ActivityScreen />));
    await settle();
    expect(byId('wsf-activity-partial')).not.toBeNull();
    expect(spoken).toEqual([PARTIAL_SENTENCE]);
  });

  it('out of sight when the list turns partial: nothing; then once when Progress is in front again, and not on a later return', async () => {
    focus.now = false;
    act(() => root.render(<ActivityScreen />));
    await settle();
    expect(byId('wsf-activity-partial')).not.toBeNull();
    expect(spoken).toEqual([]);
    setFocus(true);
    await settle();
    expect(spoken).toEqual([PARTIAL_SENTENCE]);
    setFocus(false);
    setFocus(true);
    await settle();
    expect(spoken).toEqual([PARTIAL_SENTENCE]);
  });

  it('the reviewer\'s case: a read started in front fails after the member has left: nothing over the other screen; once on return', async () => {
    let failElm!: () => void;
    readGoals.mockImplementation((_uid: string, groupId: string) =>
      groupId === 'elm'
        ? new Promise((_, reject) => (failElm = () => reject(Object.assign(new Error('internal'), { code: 'functions/internal' }))))
        : Promise.resolve({ goals: [GOAL] }),
    );
    act(() => root.render(<ActivityScreen />));
    await settle();
    // The member opens MOVE (or another tab) while Elm's read is still out.
    setFocus(false);
    await act(async () => failElm());
    await settle();
    expect(byId('wsf-activity-partial')).not.toBeNull();
    expect(spoken).toEqual([]);
    setFocus(true);
    await settle();
    expect(spoken).toEqual([PARTIAL_SENTENCE]);
  });
});
