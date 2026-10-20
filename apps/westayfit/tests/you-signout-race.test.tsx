import { act, createElement, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-1 (MF-03): the You tab stays mounted across a sign-out,
 * so a read still in flight when the account goes away must never draw that
 * account afterwards — not on the signed-out card, and not under the next
 * account's email, not even for one frame.
 *
 * The route is rendered whole (react-native-web in jsdom) with its reads
 * held open by hand, so each test chooses exactly when an answer lands
 * relative to the sign-out or the account switch. Every frame the view is
 * handed is recorded, so a leak that lasts one render is still caught.
 */

vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

type User = { uid: string; email: string };
type Auth = { ready: boolean; user: User | null };
let auth: Auth = { ready: true, user: null };
const authListeners = new Set<() => void>();
function setAuth(next: Auth): void {
  auth = next;
  for (const l of authListeners) l();
}
vi.mock('../src/auth', () => ({
  useWsfAuth: () =>
    useSyncExternalStore(
      (l: () => void) => {
        authListeners.add(l);
        return () => authListeners.delete(l);
      },
      () => auth,
    ),
}));
vi.mock('../src/firebase', () => ({ getFirebaseAuth: () => ({}) }));
vi.mock('firebase/auth', () => ({ signOut: () => Promise.resolve() }));

// A focused tab: the focus callback runs on mount and again whenever it changes.
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every read the route issues, held open until the test answers it. */
type Pending = { uid: string; key: string; d: Deferred<unknown> };
let pending: Pending[] = [];
function hold(uid: string, key: string): Promise<unknown> {
  const d = deferred<unknown>();
  pending.push({ uid, key, d });
  return d.promise;
}
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMemberProfile: (uid: string) => hold(uid, 'profile'),
  readMyCommunities: (uid: string) => hold(uid, 'communities'),
  readGoals: (uid: string, groupId: string) => hold(uid, `goals:${groupId}`),
  readOwnCredit: (uid: string, goalId: string) => hold(uid, `own:${goalId}`),
}));

/** Every state the view is handed, in order, with the email beside it. */
type Frame = { state: { kind: string }; email: string | null };
let frames: Frame[] = [];
vi.mock('../src/ui/YouParityView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/YouParityView')>();
  return {
    ...real,
    YouParityView: (props: Parameters<typeof real.YouParityView>[0]) => {
      frames.push({ state: props.state, email: props.email });
      return createElement(real.YouParityView, props);
    },
  };
});

const { default: You } = await import('../app/(tabs)/you');

const A: User = { uid: 'uid-a', email: 'a@example.com' };
const B: User = { uid: 'uid-b', email: 'b@example.com' };
/** Each account's facts, written so any one of them in a frame is unmistakable. */
const FACTS = {
  [A.uid]: {
    name: 'Alex Account-A',
    community: { groupId: 'grp-a', displayName: 'Oak Grove A-Community', role: 'champion', memberCount: 23 },
    goal: { goalId: 'goal-a', title: 'Squats of account A', target: 500, unit: 'squats', status: 'active', sharedTotal: 241 },
    own: 77,
  },
  [B.uid]: {
    name: 'Blake Account-B',
    community: { groupId: 'grp-b', displayName: 'Harbor B-Community', role: 'member', memberCount: 9 },
    goal: { goalId: 'goal-b', title: 'Lunges of account B', target: 300, unit: 'lunges', status: 'active', sharedTotal: 40 },
    own: 12,
  },
};
const A_MARKS = ['Alex Account-A', 'Oak Grove A-Community', 'Squats of account A', 'goal-a', 'grp-a'];

/** Answers every open read for `uid` with that account's facts, then lets React settle. */
async function answerAll(uid: string, keys?: string[]): Promise<void> {
  const f = FACTS[uid]!;
  for (let round = 0; round < 5; round++) {
    const now = pending.filter((p) => p.uid === uid && (!keys || keys.includes(p.key)));
    if (now.length === 0) break;
    pending = pending.filter((p) => !now.includes(p));
    await act(async () => {
      for (const p of now) {
        if (p.key === 'profile') p.d.resolve({ displayName: f.name, createdAt: null });
        else if (p.key === 'communities') p.d.resolve({ items: [f.community] });
        else if (p.key.startsWith('goals:')) p.d.resolve({ goals: [f.goal] });
        else if (p.key.startsWith('own:')) p.d.resolve({ ownCredit: f.own, unit: f.goal.unit });
      }
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }
}

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const leaksA = (frame: Frame) => A_MARKS.some((m) => JSON.stringify(frame.state).includes(m));

function render(): void {
  act(() => {
    root.render(<You />);
  });
}
function signIn(user: User | null): void {
  act(() => setAuth({ ready: true, user }));
}

beforeEach(() => {
  pending = [];
  frames = [];
  auth = { ready: true, user: null };
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** The signed-out card alone: no band, name, role, amounts or account row. */
function expectOnlySignedOut(): void {
  expect(byId('wsf-you-signed-out')).not.toBeNull();
  for (const id of ['wsf-you-name', 'wsf-you-identity', 'wsf-you-community', 'wsf-you-member', 'wsf-you-lead', 'wsf-you-email', 'wsf-you-loading']) {
    expect(byId(id), id).toBeNull();
  }
  for (const m of A_MARKS) expect(container.textContent).not.toContain(m);
}

describe('You: a sign-out never leaves the previous account on screen (MF-03)', () => {
  it('draws the account normally while it is signed in (control)', async () => {
    setAuth({ ready: true, user: A });
    render();
    await answerAll(A.uid);
    expect(byId('wsf-you-name')?.textContent).toBe('Alex Account-A');
    expect(container.textContent).toContain('Oak Grove A-Community');
  });

  it('case 1: the first read lands after sign-out — only the signed-out card, and still 10 s later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setAuth({ ready: true, user: A });
    render();
    expect(pending.map((p) => p.key).sort()).toEqual(['communities', 'profile']);
    const mark = frames.length;
    signIn(null);
    await answerAll(A.uid);
    expectOnlySignedOut();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expectOnlySignedOut();
    const after = frames.slice(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((f) => f.state.kind === 'signedOut')).toBe(true);
  });

  it('case 1: a read further along (goals in flight) lands after sign-out and draws nothing', async () => {
    setAuth({ ready: true, user: A });
    render();
    await answerAll(A.uid, ['communities']);
    expect(pending.some((p) => p.key === 'goals:grp-a')).toBe(true);
    signIn(null);
    await answerAll(A.uid);
    expectOnlySignedOut();
  });

  it('a read for an ended session issues no further read for that account', async () => {
    setAuth({ ready: true, user: A });
    render();
    signIn(null);
    await answerAll(A.uid, ['communities', 'profile']);
    // The communities answer came back for a session that is over: the page
    // must not go on to ask for that account's goals or own parts.
    expect(pending.filter((p) => p.key.startsWith('goals:') || p.key.startsWith('own:'))).toEqual([]);
  });

  it('case 1: a fully drawn page is never handed the member screen once the user is gone, not even for a frame', async () => {
    setAuth({ ready: true, user: A });
    render();
    await answerAll(A.uid);
    expect(byId('wsf-you-name')).not.toBeNull();
    const mark = frames.length;
    signIn(null);
    const after = frames.slice(mark);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter(leaksA)).toEqual([]);
    expect(after.every((f) => f.state.kind === 'signedOut')).toBe(true);
    expectOnlySignedOut();
  });

  it('case 2: opened signed out (deep link to You) shows only the signed-out card from the first frame', async () => {
    render();
    expect(frames[0]?.state.kind).toBe('signedOut');
    expectOnlySignedOut();
    expect(pending).toEqual([]);
  });

  it("case 3: A's read lands after A signs out and B signs in — B never sees A's data", async () => {
    setAuth({ ready: true, user: A });
    render();
    await answerAll(A.uid, ['communities']);
    signIn(null);
    const mark = frames.length;
    signIn(B);
    await answerAll(A.uid);
    expect(frames.slice(mark).filter(leaksA)).toEqual([]);
    expect(byId('wsf-you-loading')).not.toBeNull();
    await answerAll(B.uid);
    expect(byId('wsf-you-name')?.textContent).toBe('Blake Account-B');
    expect(container.textContent).toContain('Harbor B-Community');
    expect(frames.slice(mark).filter(leaksA)).toEqual([]);
    for (const m of A_MARKS) expect(container.textContent).not.toContain(m);
  });

  it("case 3: a direct switch from a drawn A to B never shows A's page under B, not even for a frame", async () => {
    setAuth({ ready: true, user: A });
    render();
    await answerAll(A.uid);
    expect(byId('wsf-you-name')?.textContent).toBe('Alex Account-A');
    const mark = frames.length;
    signIn(B);
    const underB = frames.slice(mark);
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.filter(leaksA)).toEqual([]);
    for (const m of A_MARKS) expect(container.textContent).not.toContain(m);
    await answerAll(B.uid);
    expect(byId('wsf-you-name')?.textContent).toBe('Blake Account-B');
    expect(frames.slice(mark).filter(leaksA)).toEqual([]);
  });

  it("case 3: A's slow read lands after a direct switch to B and is dropped", async () => {
    setAuth({ ready: true, user: A });
    render();
    signIn(B);
    await answerAll(A.uid);
    for (const m of A_MARKS) expect(container.textContent).not.toContain(m);
    await answerAll(B.uid);
    expect(byId('wsf-you-name')?.textContent).toBe('Blake Account-B');
    expect(frames.filter((f) => f.email === B.email).filter(leaksA)).toEqual([]);
  });
});
