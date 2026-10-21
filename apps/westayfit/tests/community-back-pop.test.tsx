import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-6 (MF-10). On a phone, Members' ‹ and the challenge's
 * "Back to community" pushed a SECOND community screen (scroll and figures
 * lost). Natively, Members goes back when there is something to go back to
 * (else opens the community), and the challenge dismisses to the community
 * already in the stack. The web keeps replace and the links with their hrefs.
 * Routes rendered whole (react-native-web, jsdom); the router is mocked.
 */

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));
const AUTH = { ready: true, user: { uid: 'u1' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));
const listChallenge = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) =>
    name === 'wsfListChallenge' ? (...a: unknown[]) => listChallenge(...a) : () => new Promise(() => {}),
}));
const router = { replace: vi.fn(), back: vi.fn(), push: vi.fn(), dismissTo: vi.fn(), canGoBack: vi.fn(() => true) };
vi.mock('expo-router', () => ({
  router,
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({ groupId: 'g1' }),
  useNavigation: () => ({ setParams: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

const { default: Members } = await import('../app/(tabs)/(home)/community/[groupId]/members');
const { default: Challenge } = await import('../app/(tabs)/(home)/community/[groupId]/challenge');

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  for (const f of [router.replace, router.back, router.push, router.dismissTo]) f.mockReset();
  router.canGoBack.mockReset();
  router.canGoBack.mockReturnValue(true);
  listChallenge.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
async function render(node: ReactNode): Promise<void> {
  act(() => {
    root.render(node);
  });
  await flush();
}
const press = (el: HTMLElement) => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const READY = {
  data: {
    challenge: { id: 'c1', title: 'Spring steps', status: 'active', goalTarget: 100 },
    moves: [],
    myCheckedInMoveIds: [],
    totals: { participantCount: 3, completedCount: 7, goalTarget: 100 },
  },
};
const NONE = { data: { challenge: null, moves: [], myCheckedInMoveIds: [], totals: { participantCount: 0, completedCount: 0, goalTarget: null } } };

describe("W16-6 / MF-10: Members' ‹", () => {
  it.each(['ios', 'android'])('%s with a screen below goes back to it, never replaces', async (platform) => {
    (Platform as { OS: string }).OS = platform;
    await render(<Members />);
    press(byId('wsf-members-back')!);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('native with nothing below (a cold deep link) opens the community', async () => {
    (Platform as { OS: string }).OS = 'ios';
    router.canGoBack.mockReturnValue(false);
    await render(<Members />);
    press(byId('wsf-members-back')!);
    expect(router.replace).toHaveBeenCalledWith('/community/g1');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('web still replaces, whatever the history', async () => {
    await render(<Members />);
    press(byId('wsf-members-back')!);
    expect(router.replace).toHaveBeenCalledWith('/community/g1');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.canGoBack).not.toHaveBeenCalled();
  });
});

describe('W16-6 / MF-10: the challenge\'s "Back to community"', () => {
  it.each([
    ['the challenge chrome', () => listChallenge.mockResolvedValue(READY), 'wsf-challenge-back'],
    ['no active challenge', () => listChallenge.mockResolvedValue(NONE), 'wsf-challenge-none-back'],
    ['the error state', () => listChallenge.mockRejectedValue(Object.assign(new Error('x'), { code: 'functions/unavailable' })), 'wsf-challenge-error-back'],
  ])('native, %s: dismisses to the community already in the stack, once', async (_l, setup, testID) => {
    (Platform as { OS: string }).OS = 'ios';
    setup();
    await render(<Challenge />);
    const back = byId(testID);
    expect(back, testID).not.toBeNull();
    expect(back!.closest('a')).toBeNull();
    press(back!);
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith('/community/g1');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['the challenge chrome', () => listChallenge.mockResolvedValue(READY)],
    ['no active challenge', () => listChallenge.mockResolvedValue(NONE)],
    ['the error state', () => listChallenge.mockRejectedValue(Object.assign(new Error('x'), { code: 'functions/unavailable' }))],
  ])('web, %s: still a link to /community/g1', async (_l, setup) => {
    setup();
    await render(<Challenge />);
    const anchors = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent?.includes('Back to community'));
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.getAttribute('href')).toBe('/community/g1');
    expect(byId('wsf-challenge-none-back')).toBeNull();
    expect(byId('wsf-challenge-error-back')).toBeNull();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});
