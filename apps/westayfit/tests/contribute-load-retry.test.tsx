import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-04 case 4, contribute half; INT-12 case 5): the
 * contribution screen's load error offers Try again, which loads the goal
 * again in place with fresh reads; and the 2 s pulse poll sends nothing while
 * the app is in the background, starting again on return. The route rendered
 * into jsdom with the callables mocked at the network boundary (the real
 * member-read layer in between). No device.
 */

const params = { value: { goalId: 'g1' } as Record<string, string> };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
const navigation = {
  dispatch: vi.fn(),
  isFocused: () => true,
  addListener: () => () => undefined,
  setOptions: vi.fn(),
  getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: 'contribute/[goalId]' }] }),
};
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => navigation,
  usePathname: () => '/contribute/g1',
  useLocalSearchParams: () => params.value,
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
// INT-09: "a phone with a 47 pt inset" or "web (0)", per case.
const inset = { top: 0 };
vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => inset.top,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: ({ tone }: { tone: string }) => <span data-testid="screen-status-bar" data-tone={tone} />,
}));
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: true,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
const calls: string[] = [];
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    calls.push(name);
    const answer = answers[name];
    if (!answer) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { data: await answer() };
  },
}));

const { clearMemberReads } = await import('../src/memberReads');
const { signOut } = await import('firebase/auth');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const PULSE = { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' };
const OFFLINE = () => Promise.reject(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));
const count = (name: string) => calls.filter((c) => c === name).length;

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
/** One poll interval at a time, letting each request answer (the poll skips a tick while one is out). */
const pollFor = async (ms: number) => {
  for (let t = 0; t < ms; t += 2_000) {
    await act(async () => vi.advanceTimersByTime(2_000));
    await settle();
  }
};

beforeEach(() => {
  inset.top = 0;
  params.value = { goalId: 'g1' };
  clearMemberReads();
  calls.length = 0;
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfMyContribution = async () => MINE;
  os = Platform.OS;
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('contribute load error (INT-04 case 4)', () => {
  it('offers Try again, which loads the goal again in place, with fresh reads', async () => {
    answers.wsfGoalPulse = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-load-error')).not.toBeNull();
    expect(byId('wsf-contribute-load-retry')!.textContent).toBe('Try again');
    expect(byId('wsf-contribute-home')).not.toBeNull();
    expect(count('wsfGoalPulse')).toBe(1);
    expect(count('wsfMyContribution')).toBe(1);

    answers.wsfGoalPulse = async () => PULSE;
    await act(async () => byId('wsf-contribute-load-retry')!.click());
    await settle();
    expect(byId('wsf-contribute-load-error')).toBeNull();
    expect(byId('wsf-contribute-goal-title') ?? byId('wsf-contribute-entry-screen') ?? byId('wsf-contribute-move-screen')).not.toBeNull();
    // Fresh: both reads asked the server again (the own part's settled answer was not reused).
    expect(count('wsfGoalPulse')).toBe(2);
    expect(count('wsfMyContribution')).toBe(2);
    // In place: nothing navigated.
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('still offline: Try again tries again and says so again', async () => {
    answers.wsfGoalPulse = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await act(async () => byId('wsf-contribute-load-retry')!.click());
    await settle();
    expect(byId('wsf-contribute-load-error')).not.toBeNull();
    expect(count('wsfGoalPulse')).toBe(2);
  });
});

describe('the pulse poll and the background (INT-12 case 5)', () => {
  it('Android: no wsfGoalPulse while backgrounded; the poll starts again on return', async () => {
    (Platform as { OS: string }).OS = 'android';
    let handler: ((s: string) => void) | null = null;
    vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
      handler = h;
      return { remove: () => (handler = null) };
    }) as never);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(count('wsfGoalPulse')).toBe(1);
    // Foreground: the poll asks every 2 s.
    await pollFor(4_000);
    expect(count('wsfGoalPulse')).toBe(3);
    // Background for five minutes: nothing goes out.
    act(() => handler!('background'));
    await pollFor(5 * 60_000);
    expect(count('wsfGoalPulse')).toBe(3);
    // Back in front: the poll runs again, and its first tick is the one refresh.
    act(() => handler!('active'));
    await settle();
    expect(count('wsfGoalPulse')).toBe(3);
    await pollFor(2_000);
    expect(count('wsfGoalPulse')).toBe(4);
    // Control Center or the app switcher (inactive) is still in front: the poll goes on.
    act(() => handler!('inactive'));
    await pollFor(2_000);
    expect(count('wsfGoalPulse')).toBe(5);
  });

  it('web: a hidden tab keeps polling as before (AppState is not consulted)', async () => {
    const spy = vi.spyOn(AppState, 'addEventListener');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await pollFor(4_000);
    expect(count('wsfGoalPulse')).toBe(3);
    expect(spy.mock.calls.filter((c) => c[0] === 'change')).toHaveLength(0);
  });
});

describe('the page mode and the top of the screen (INT-09)', () => {
  const paddedTo = (px: string) => Array.from(container.querySelectorAll<HTMLElement>('*')).filter((e) => e.style.paddingTop === px);

  it('"Already moved?" (page mode) starts below the status bar on a phone, with cream icons', async () => {
    inset.top = 47;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-load-error')).toBeNull();
    expect(paddedTo(`${16 + 47}px`)).toHaveLength(1);
    expect(byId('screen-status-bar')!.dataset.tone).toBe('cream');
  });

  it('web (inset 0): no padding override', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(paddedTo(`${16 + 47}px`)).toHaveLength(0);
    expect(paddedTo('16px')).toHaveLength(0);
  });

  it('the navy receipt (dark tone) asks for light icons', () => {
    const src = readFileSync(join(__dirname, '..', 'app/contribute/[goalId].tsx'), 'utf8');
    expect(src).toContain("<ScreenStatusBar tone={tone === 'dark' ? 'navy' : 'cream'} />");
  });
});

describe('#641 NB-1 and NB-2: what Try again re-reads, and the kiosk', () => {
  const LISTED = { goals: [{ goalId: 'g1', title: '500 squats together', status: 'active', target: 100, unit: 'squats', sharedTotal: 40 }] };
  const COMMUNITIES = { items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 3 }] };

  it('NB-1: with the community in the route, Try again re-reads the labels too (fresh) and shows the goal title and community name', async () => {
    params.value = { goalId: 'g1', groupId: 'oak' };
    answers.wsfGoalPulse = OFFLINE;
    answers.wsfListGoals = OFFLINE;
    answers.wsfMyCommunities = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-load-error')).not.toBeNull();
    expect(count('wsfListGoals')).toBe(1);
    expect(count('wsfMyCommunities')).toBe(1);

    answers.wsfGoalPulse = async () => PULSE;
    answers.wsfListGoals = async () => LISTED;
    answers.wsfMyCommunities = async () => COMMUNITIES;
    await act(async () => byId('wsf-contribute-load-retry')!.click());
    await settle();
    expect(byId('wsf-contribute-load-error')).toBeNull();
    expect(byId('wsf-contribute-goal-title')!.textContent).toBe('500 squats together');
    expect(byId('wsf-contribute-community')!.textContent).toContain('Oak Grove Together');
    expect(count('wsfListGoals')).toBe(2);
    expect(count('wsfMyCommunities')).toBe(2);
  });

  it('NB-1: the retried label reads are fresh: a list settled during the failed load is not reused', async () => {
    params.value = { goalId: 'g1', groupId: 'oak' };
    answers.wsfGoalPulse = OFFLINE;
    answers.wsfListGoals = async () => ({ goals: [{ ...LISTED.goals[0]!, title: 'An older title' }] });
    answers.wsfMyCommunities = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-load-error')).not.toBeNull();
    answers.wsfGoalPulse = async () => PULSE;
    answers.wsfListGoals = async () => LISTED;
    answers.wsfMyCommunities = async () => COMMUNITIES;
    await act(async () => byId('wsf-contribute-load-retry')!.click());
    await settle();
    expect(byId('wsf-contribute-goal-title')!.textContent).toBe('500 squats together');
    expect(count('wsfListGoals')).toBe(2);
  });

  it('NB-2: on a kiosk the load error offers Finish alone, and its 90-second deadline runs and ends the session', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    answers.wsfGoalPulse = OFFLINE;
    (signOut as unknown as { mockClear: () => void }).mockClear();
    router.dismissTo.mockClear();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-load-error')).not.toBeNull();
    expect(byId('wsf-contribute-load-retry')).toBeNull();
    expect(byId('wsf-kiosk-finish')).not.toBeNull();
    // The load error is a rest state: the deadline is on screen from 90 s ...
    expect(byId('wsf-kiosk-countdown')!.textContent).toBe('Finishing in 90 seconds');
    expect(signOut).not.toHaveBeenCalled();
    // ... and when nobody acts it finishes the session, once, back to the kiosk's start.
    for (let i = 0; i < 91; i += 1) await act(async () => vi.advanceTimersByTime(1_000));
    await settle();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith('/kiosk/g1');
  });
});
