import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyCallableRefusal, isUnconfirmedRefusal, serverWroteMessage } from '../src/callableRefusal';

/**
 * NATIVE-MEMBER-1 F-9 (HB-02 case 1, and case 3's network half).
 *
 * Under the staging hold `wsfCommunityMembers` is refused before the function
 * runs, with no body. The SDK reports that as the bare code, with the code as
 * its message. Members must say the list is unavailable, never that the
 * account lacks permission or must sign in again; the function's own refusals
 * and the network sentence are unchanged.
 */

/** What `@firebase/functions` throws: `functions/<code>`, and the description as the message. */
const fnError = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });
const BODYLESS_403 = () => fnError('permission-denied', 'permission-denied');
const BODYLESS_401 = () => fnError('unauthenticated', 'unauthenticated');
const BODYLESS_404 = () => fnError('not-found', 'not-found');

describe('callableRefusal: who refused', () => {
  it('a body-less refusal carries no server sentence', () => {
    for (const e of [BODYLESS_403(), BODYLESS_401(), BODYLESS_404()]) {
      expect(serverWroteMessage(e)).toBe(false);
      expect(isUnconfirmedRefusal(e)).toBe(true);
    }
  });
  it('a body naming only the status, or an empty message, is body-less too', () => {
    expect(isUnconfirmedRefusal(fnError('permission-denied', 'PERMISSION_DENIED'))).toBe(true);
    expect(isUnconfirmedRefusal(fnError('unauthenticated', 'UNAUTHENTICATED'))).toBe(true);
    expect(isUnconfirmedRefusal(fnError('not-found', 'NOT_FOUND'))).toBe(true);
    expect(isUnconfirmedRefusal(fnError('permission-denied', ''))).toBe(true);
    expect(isUnconfirmedRefusal(fnError('permission-denied', '   '))).toBe(true);
    expect(isUnconfirmedRefusal(fnError('permission-denied', 'Permission-Denied'))).toBe(true);
  });
  // N4: the functions framework turns away an invalid or revoked ID token, or
  // a failed App Check, before the handler runs, with
  // HttpsError('unauthenticated', 'Unauthenticated'). Not the handler's words:
  // not confirmed, never "refused".
  it("the framework's token or App Check rejection is not confirmed, not refused", () => {
    for (const message of ['Unauthenticated', 'unauthenticated', ' Unauthenticated. ', 'UNAUTHENTICATED']) {
      const e = fnError('unauthenticated', message);
      expect(serverWroteMessage(e), message).toBe(false);
      expect(classifyCallableRefusal(e), message).toBe('notConfirmed');
      expect(isUnconfirmedRefusal(e), message).toBe(true);
    }
  });
  it('a front end or proxy reason phrase is not confirmed either', () => {
    for (const [code, message] of [
      ['unauthenticated', 'Unauthorized'],
      ['permission-denied', 'Forbidden'],
      ['permission-denied', 'Permission denied.'],
      ['permission-denied', 'permission_denied'],
      ['not-found', 'Not Found'],
      ['not-found', 'not found.'],
    ] as const) {
      expect(classifyCallableRefusal(fnError(code, message)), `${code} ${message}`).toBe('notConfirmed');
    }
  });
  it("every refusal the handlers write is 'refused' (functions-westayfit sentences)", () => {
    for (const [code, message] of [
      ['unauthenticated', 'Sign in first.'],
      ['unauthenticated', 'wsfSaveProfile requires an authenticated caller.'],
      ['permission-denied', 'Members only.'],
      ['not-found', 'Goal not found.'],
      ['not-found', 'Community not found.'],
      ['not-found', 'Move not found.'],
      ['not-found', 'Challenge not found.'],
    ] as const) {
      expect(classifyCallableRefusal(fnError(code, message)), message).toBe('refused');
    }
  });
  it('classifyCallableRefusal is null for anything that is not a refusal-coded callable failure', () => {
    expect(classifyCallableRefusal(fnError('internal', 'Something broke.'))).toBeNull();
    expect(classifyCallableRefusal(fnError('invalid-argument', 'Bad Request'))).toBeNull();
    expect(classifyCallableRefusal({ code: 'permission-denied', message: 'Forbidden' })).toBeNull();
    expect(classifyCallableRefusal(null)).toBeNull();
  });
  it("the function's own refusals are not", () => {
    for (const e of [
      fnError('permission-denied', 'Members only.'),
      fnError('unauthenticated', 'Sign in first.'),
      fnError('not-found', 'We couldn’t find that code.'),
    ]) {
      expect(serverWroteMessage(e)).toBe(true);
      expect(isUnconfirmedRefusal(e)).toBe(false);
    }
  });
  it('other codes, and anything that is not a callable error, are never a refusal', () => {
    expect(isUnconfirmedRefusal(fnError('internal', 'internal'))).toBe(false);
    expect(isUnconfirmedRefusal(fnError('unavailable', 'unavailable'))).toBe(false);
    expect(isUnconfirmedRefusal(fnError('failed-precondition', 'failed-precondition'))).toBe(false);
    // A Firestore refusal is not a callable's.
    const firestore = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    expect(isUnconfirmedRefusal(firestore)).toBe(false);
    expect(serverWroteMessage(firestore)).toBe(false);
    expect(isUnconfirmedRefusal({ code: 'xxxxxxxxxxnot-found', message: 'not-found' })).toBe(false);
    for (const e of [null, undefined, 'permission-denied', 403, {}, { code: 7 }, new Error('x')]) {
      expect(isUnconfirmedRefusal(e)).toBe(false);
      expect(serverWroteMessage(e)).toBe(false);
    }
  });
});

// ---- the Members route ------------------------------------------------------

const replace = vi.fn();
vi.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => replace(...a) },
  useLocalSearchParams: () => ({ groupId: 'grp-1' }),
}));
// One stable object, as the real provider holds: the page's load effect keys on `user`.
const AUTH = { ready: true, user: { uid: 'member-1' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));
const members = vi.fn();
const mine = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (name === 'wsfCommunityMembers' ? members : mine),
}));

const { default: MembersScreen } = await import('../app/(tabs)/(home)/community/[groupId]/members');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  members.mockReset();
  mine.mockReset();
  mine.mockResolvedValue({ data: { items: [{ groupId: 'grp-1', displayName: 'Oak Grove', memberCount: 3 }] } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});
async function render(): Promise<void> {
  act(() => {
    root.render(<MembersScreen />);
  });
  await flush();
}
const UNAVAILABLE = 'The member list is temporarily unavailable. Try again later.';
const ACCOUNT_CLAIMS = [/can.t do that/i, /sign in/i, /permission/i, /not allowed/i, /no longer a member/i];

describe('Members under a transport block (HB-02 case 1)', () => {
  it.each([
    ['a body-less 403', BODYLESS_403],
    ['a body-less 401', BODYLESS_401],
    ['a body-less 404', BODYLESS_404],
    ['a status-only body', () => fnError('permission-denied', 'PERMISSION_DENIED')],
    ["the framework's token or App Check rejection (N4)", () => fnError('unauthenticated', 'Unauthenticated')],
    ['a proxy reason phrase (N4)', () => fnError('permission-denied', 'Forbidden')],
  ])('%s says the list is unavailable and claims nothing about the account', async (_l, make) => {
    members.mockRejectedValue(make());
    await render();
    const failed = byId('wsf-members-failed');
    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain(UNAVAILABLE);
    for (const claim of ACCOUNT_CLAIMS) expect(failed!.textContent).not.toMatch(claim);
    expect(byId('wsf-members-panel')).toBeNull();
  });

  it('Try again recovers once the hold lifts', async () => {
    members.mockRejectedValueOnce(BODYLESS_403());
    members.mockResolvedValueOnce({ data: { members: [{ displayName: 'Openly Named', role: 'member' }], nextCursor: null } });
    await render();
    expect(byId('wsf-members-failed')!.textContent).toContain(UNAVAILABLE);
    const retry = Array.from(container.querySelectorAll('[role="button"]')).find((b) => b.textContent === 'Try again')!;
    await act(async () => {
      (retry as HTMLElement).click();
    });
    await flush();
    expect(byId('wsf-members-failed')).toBeNull();
    expect(byId('wsf-members-panel')!.textContent).toContain('Openly Named');
  });
});

describe('what is unchanged', () => {
  it("the function's own refusal is still said as written", async () => {
    members.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    expect(byId('wsf-members-failed')!.textContent).toContain('Members only.');
    expect(byId('wsf-members-failed')!.textContent).not.toContain(UNAVAILABLE);
  });

  it('a server-written sign-in refusal is still said as written', async () => {
    members.mockRejectedValue(fnError('unauthenticated', 'Sign in first.'));
    await render();
    expect(byId('wsf-members-failed')!.textContent).toContain('Sign in first.');
  });

  it('case 3: network off shows the network sentence, and Try again recovers', async () => {
    members.mockRejectedValueOnce(fnError('internal', 'internal'));
    members.mockResolvedValueOnce({ data: { members: [{ displayName: 'Openly Named', role: 'member' }], nextCursor: null } });
    await render();
    expect(byId('wsf-members-failed')!.textContent).toContain('We couldn’t reach the server. Check your connection and try again.');
    const retry = Array.from(container.querySelectorAll('[role="button"]')).find((b) => b.textContent === 'Try again')!;
    await act(async () => {
      (retry as HTMLElement).click();
    });
    await flush();
    expect(byId('wsf-members-panel')!.textContent).toContain('Openly Named');
  });

  it('a list that loads is drawn as before', async () => {
    members.mockResolvedValue({ data: { members: [{ displayName: 'Openly Named', role: 'champion' }], nextCursor: null } });
    await render();
    expect(byId('wsf-members-panel')!.textContent).toContain('Openly Named');
    expect(byId('wsf-members-count')!.textContent).toContain('3');
  });
});
