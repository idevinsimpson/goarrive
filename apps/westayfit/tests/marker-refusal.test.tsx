import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarkerResolver, ResolvedMarker } from '../src/markerEntry';

/**
 * NATIVE-MEMBER-1 F-6, the same pattern on the marker screen (MF-04's fix
 * sketch; HB-01's native divergence). A body-less 401/403/404 from a blocked
 * `wsfResolveMarker` / `wsfJoinViaMarker` is not the function's answer: it
 * must not say "This code isn't active", "This account can't do that here"
 * or "sign in again". The function's own answers are unchanged.
 */

const AUTH = { ready: true, user: { uid: 'member-1', emailVerified: true } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));
vi.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { MarkerEntryScreen } = await import('../src/ui/MarkerEntryScreen');

const fnError = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });
const MARKER: ResolvedMarker = {
  markerSlug: 'flag-01',
  label: 'Flag 01',
  communityName: 'Oak Grove',
  goalId: 'goal-1',
  goalTitle: '500 squats',
  goalState: 'open',
  kioskMode: 'off',
  viewer: 'nonMember',
  communityGroupId: null,
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
async function render(resolver: MarkerResolver): Promise<void> {
  act(() => {
    root.render(<MarkerEntryScreen slug="flag-01" resolver={resolver} />);
  });
  await flush();
}
const resolverOf = (resolve: () => Promise<ResolvedMarker>, join = vi.fn()) => ({ resolve: vi.fn(resolve), join });
const FALSE_CLAIMS = [/isn.t active/i, /can.t do that/i, /sign in again/i];

describe('resolve', () => {
  it.each([
    ['403', () => fnError('permission-denied', 'permission-denied')],
    ['401', () => fnError('unauthenticated', 'unauthenticated')],
    ['404', () => fnError('not-found', 'not-found')],
    ["401 from the framework ('Unauthenticated', N4)", () => fnError('unauthenticated', 'Unauthenticated')],
    ["404 with a proxy reason phrase ('Not Found', N4)", () => fnError('not-found', 'Not Found')],
    ["403 with a proxy reason phrase ('Forbidden', N4)", () => fnError('permission-denied', 'Forbidden')],
  ])('a body-less %s shows the neutral retry, not a claim about the code or the account', async (_l, make) => {
    await render(resolverOf(() => Promise.reject(make())));
    expect(byId('wsf-marker-invalid')).toBeNull();
    expect(byId('wsf-marker-error')!.textContent).toContain('We couldn’t open this code. Try again.');
    for (const claim of FALSE_CLAIMS) expect(container.textContent).not.toMatch(claim);
    expect(byId('wsf-marker-retry')).not.toBeNull();
  });

  it("the function's own not-found is still \"This code isn't active\"", async () => {
    await render(resolverOf(() => Promise.reject(fnError('not-found', 'That code isn’t active.'))));
    expect(byId('wsf-marker-invalid')).not.toBeNull();
  });

  it('invalid-argument is still invalid, and the network sentence is unchanged', async () => {
    await render(resolverOf(() => Promise.reject(fnError('invalid-argument', 'invalid-argument'))));
    expect(byId('wsf-marker-invalid')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await render(resolverOf(() => Promise.reject(fnError('internal', 'internal'))));
    expect(byId('wsf-marker-error')!.textContent).toContain('We couldn’t reach the server.');
  });
});

describe('join', () => {
  async function pressJoin(): Promise<void> {
    await act(async () => {
      byId('wsf-marker-join-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
  }

  it('a body-less 403 on join stays on the join card with the neutral retry', async () => {
    const join = vi.fn(() => Promise.reject(fnError('permission-denied', 'permission-denied')));
    await render(resolverOf(() => Promise.resolve(MARKER), join));
    await pressJoin();
    expect(byId('wsf-marker-join-card')).not.toBeNull();
    expect(byId('wsf-marker-join-error')!.textContent).toBe('We couldn’t join you just now. Try again.');
    for (const claim of FALSE_CLAIMS) expect(container.textContent).not.toMatch(claim);
  });

  it('a body-less 404 on join does not turn the screen into "isn\'t active"', async () => {
    const join = vi.fn(() => Promise.reject(fnError('not-found', 'not-found')));
    await render(resolverOf(() => Promise.resolve(MARKER), join));
    await pressJoin();
    expect(byId('wsf-marker-invalid')).toBeNull();
    expect(byId('wsf-marker-join-error')!.textContent).toBe('We couldn’t join you just now. Try again.');
  });

  it("the function's own refusals are unchanged", async () => {
    const join = vi.fn(() => Promise.reject(fnError('failed-precondition', 'Verify your email before joining a community.')));
    await render(resolverOf(() => Promise.resolve(MARKER), join));
    await pressJoin();
    expect(byId('wsf-marker-join-error')!.textContent).toBe('Verify your email before joining a community.');
    const notFound = vi.fn(() => Promise.reject(fnError('not-found', 'That code isn’t active.')));
    act(() => root.unmount());
    root = createRoot(container);
    await render(resolverOf(() => Promise.resolve(MARKER), notFound));
    await pressJoin();
    expect(byId('wsf-marker-invalid')).not.toBeNull();
  });
});
