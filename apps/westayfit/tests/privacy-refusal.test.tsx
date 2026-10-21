import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 F-6 (MF-04 cases 1-3). A blocked `wsfSetCommunityVisibility`
 * answering with a body-less 403 or 404 used to make the privacy panel say
 * "You're no longer a member" and forget the community. Only the function's
 * own refusal ("Members only."), confirmed by a quiet re-read of the
 * memberships, may say that now.
 */

const AUTH = { ready: true, user: { uid: 'member-1' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));
const setVisibility = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => setVisibility }));
const readMyCommunities = vi.fn();
const forgetCommunity = vi.fn();
vi.mock('../src/memberReads', () => ({
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  forgetCommunity: (...a: unknown[]) => forgetCommunity(...a),
  peekMemberProfile: () => undefined,
}));

const { CommunityPrivacyControls } = await import('../src/ui/CommunityPrivacyControls');

const fnError = (code: string, message: string) => Object.assign(new Error(message), { code: `functions/${code}` });
const OAK = { groupId: 'oak', displayName: 'Oak Grove', role: 'member', memberCount: 3, nameVisibility: 'visible', activityVisibility: 'visible' };
const listed = (...items: unknown[]) => Promise.resolve({ items });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setVisibility.mockReset();
  readMyCommunities.mockReset();
  forgetCommunity.mockReset();
  window.localStorage.clear();
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
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
async function render(): Promise<void> {
  act(() => {
    root.render(<CommunityPrivacyControls />);
  });
  await flush();
}
async function toggleName(): Promise<void> {
  const el = byId('wsf-privacy-panel-name-oak');
  expect(el, 'the name switch is on screen').not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}
const NO_LONGER = /no longer a member/i;
const NOT_SAVED = 'That change wasn’t saved. The switches show your saved setting.';
const UNCONFIRMED = 'We couldn’t confirm that change. The switches show what’s saved now.';

describe('MF-04 case 1: a body-less refusal is a save that did not go through', () => {
  it.each([
    ['403', () => fnError('permission-denied', 'permission-denied')],
    ['404', () => fnError('not-found', 'not-found')],
    ['403 with a status-only body', () => fnError('permission-denied', 'PERMISSION_DENIED')],
    ['403 with a proxy reason phrase', () => fnError('permission-denied', 'Forbidden')],
    ['404 with a proxy reason phrase', () => fnError('not-found', 'Not Found.')],
  ])('a body-less %s says not saved, keeps the stored switch, never "no longer a member"', async (_l, make) => {
    readMyCommunities.mockImplementation(() => listed(OAK));
    setVisibility.mockRejectedValue(make());
    await render();
    expect(byId('wsf-privacy-panel-name-oak')!.getAttribute('aria-checked')).toBe('true');
    await toggleName();
    const error = byId('wsf-privacy-panel-error-oak');
    expect(error!.textContent).toContain(NOT_SAVED);
    expect(container.textContent).not.toMatch(NO_LONGER);
    // The switch stays on the stored value and the block keeps its switches.
    expect(byId('wsf-privacy-panel-name-oak')!.getAttribute('aria-checked')).toBe('true');
    expect(byId('wsf-privacy-panel-retry-oak')).not.toBeNull();
    // MF-04 case 2's trigger: the community is not forgotten, so the
    // Community tab keeps drawing it.
    expect(forgetCommunity).not.toHaveBeenCalled();
  });

  it('a body-less 403 is never the basis for the claim, even when the re-read no longer lists the community', async () => {
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementation(() => listed());
    setVisibility.mockRejectedValue(fnError('permission-denied', 'permission-denied'));
    await render();
    await toggleName();
    expect(container.textContent).not.toMatch(NO_LONGER);
    expect(forgetCommunity).not.toHaveBeenCalled();
  });

  it('a body-less 403 whose re-read also fails says unconfirmed', async () => {
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementation(() => Promise.reject(fnError('internal', 'internal')));
    setVisibility.mockRejectedValue(fnError('permission-denied', 'permission-denied'));
    await render();
    await toggleName();
    expect(byId('wsf-privacy-panel-error-oak')!.textContent).toContain(UNCONFIRMED);
    expect(container.textContent).not.toMatch(NO_LONGER);
    expect(forgetCommunity).not.toHaveBeenCalled();
  });
});

describe("MF-04 case 3: the function's own refusal, confirmed, still says so", () => {
  it('"Members only." and a re-read that no longer lists it: membership refused, community forgotten', async () => {
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementation(() => listed());
    setVisibility.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    await toggleName();
    expect(byId('wsf-privacy-panel-error-oak')!.textContent).toContain(
      'You’re no longer a member of Oak Grove, so this setting can’t be changed.',
    );
    expect(forgetCommunity).toHaveBeenCalledWith('member-1', 'oak');
    expect(forgetCommunity).toHaveBeenCalledTimes(1);
    // Its block stays, with the refusal said and no switches.
    expect(byId('wsf-privacy-panel-block-oak')).not.toBeNull();
    expect(byId('wsf-privacy-panel-name-oak')).toBeNull();
    // N5: ONE re-read after the refusal both confirms it and redraws the rows.
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
  });

  it('a server not-found, confirmed, is refused the same way', async () => {
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementation(() => listed());
    setVisibility.mockRejectedValue(fnError('not-found', 'Community not found.'));
    await render();
    await toggleName();
    expect(byId('wsf-privacy-panel-error-oak')!.textContent).toMatch(NO_LONGER);
    expect(forgetCommunity).toHaveBeenCalledTimes(1);
  });

  it('"Members only." that the re-read does NOT confirm is not said', async () => {
    readMyCommunities.mockImplementation(() => listed(OAK));
    setVisibility.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    await toggleName();
    expect(container.textContent).not.toMatch(NO_LONGER);
    expect(byId('wsf-privacy-panel-error-oak')!.textContent).toContain(NOT_SAVED);
    expect(forgetCommunity).not.toHaveBeenCalled();
    // N5: the same single re-read decides "not saved" too.
    expect(readMyCommunities).toHaveBeenCalledTimes(2);
  });

  it('"Members only." when the memberships cannot be re-read is not said either', async () => {
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementation(() => Promise.reject(fnError('unavailable', 'unavailable')));
    setVisibility.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    await toggleName();
    expect(container.textContent).not.toMatch(NO_LONGER);
    expect(byId('wsf-privacy-panel-error-oak')!.textContent).toContain(UNCONFIRMED);
    expect(forgetCommunity).not.toHaveBeenCalled();
  });

  it('a confirmation that lands after the panel has closed forgets nothing', async () => {
    let answer!: (v: unknown) => void;
    readMyCommunities.mockImplementationOnce(() => listed(OAK));
    readMyCommunities.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    readMyCommunities.mockImplementation(() => listed());
    setVisibility.mockRejectedValue(fnError('permission-denied', 'Members only.'));
    await render();
    await toggleName();
    expect(answer).toBeTypeOf('function');
    act(() => root.unmount());
    await act(async () => {
      answer({ items: [] });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(forgetCommunity).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it('a save that succeeds adopts the settled value (control)', async () => {
    readMyCommunities.mockImplementation(() => listed(OAK));
    setVisibility.mockResolvedValue({ data: { groupId: 'oak', name: 'private', activity: 'visible' } });
    await render();
    await toggleName();
    expect(byId('wsf-privacy-panel-name-oak')!.getAttribute('aria-checked')).toBe('false');
    expect(byId('wsf-privacy-panel-error-oak')).toBeNull();
  });
});
