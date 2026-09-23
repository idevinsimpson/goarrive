import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callableCode,
  classifyCreateFailure,
  nameLongMessage,
  nameProblem,
  usableGroupId,
  NAME_MAX_LENGTH,
} from '../src/startCommunityOutcome';

/**
 * `/start-community` — THE OUTCOMES, INCLUDING THE ONE THE BROWSER CANNOT STAGE.
 *
 * Most of this route is covered end to end in
 * `tests-e2e/sprint-w4-start-community-outcomes.spec.ts`, against the real
 * callable: ordinary success, a real create whose response is lost, a named
 * refusal, an invalid name, and two taps in one frame.
 *
 * ONE STATE IS NOT REACHABLE FROM A BROWSER TEST, and this file is where it is
 * covered instead. A confirmed create whose NAVIGATION fails cannot be staged
 * on web: breaking `history.replaceState` — whether it throws or silently does
 * nothing — does not keep the member on this screen, because Expo Router
 * unmounts the source screen from its own state before the history write
 * happens. Measured, not assumed: with the throwing patch installed, the page
 * error fires, the URL stays at `/start-community`, and `wsf-start` is already
 * gone from the DOM. So the browser can prove the safety property (no second
 * create) and this file proves the state itself.
 */

vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));

const replace = vi.fn();
/*
  A HAND-BUILT `expo-router`, not `importActual`. The real package ships
  untranspiled JSX that jsdom's loader refuses, and the route needs exactly two
  things from it: the imperative `router.replace`, and a `Link` that keeps its
  href where a test can read it.
*/
/**
 * Whether this screen is the focused one. "Back to home" is a push, so on the
 * real stack the form stays MOUNTED under Home but stops being FOCUSED — the
 * distinction M5 turns on. Tests flip this to stand the member somewhere else.
 */
let focused = true;
vi.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => replace(...a) },
  useNavigation: () => ({ isFocused: () => focused }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let authUser: { uid: string; emailVerified: boolean } | null = {
  uid: 'member-1',
  emailVerified: true,
};
vi.mock('../src/auth', () => ({
  useWsfAuth: () => ({ ready: true, user: authUser }),
}));

const callable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => callable }));

// Imported after the mocks so the component picks them up.
const { default: StartCommunity } = await import('../app/start-community');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  replace.mockReset();
  callable.mockReset();
  authUser = { uid: 'member-1', emailVerified: true };
  focused = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const byTestId = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function render(): void {
  act(() => {
    root.render(<StartCommunity />);
  });
}

function type(id: string, value: string): void {
  const el = byTestId(id) as HTMLInputElement | null;
  if (!el) throw new Error(`${id} is not rendered`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(id: string): Promise<void> {
  const el = byTestId(id);
  if (!el) throw new Error(`${id} is not rendered`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A rejection shaped the way the callable SDK shapes one. */
function callableError(code: string, message = 'server text nobody should see'): Error {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

async function submitWith(result: Promise<unknown>, name = 'Harbor Walkers'): Promise<void> {
  callable.mockReturnValue(result);
  render();
  type('wsf-start-name', name);
  await click('wsf-start-submit');
}

describe('a confirmed create whose navigation fails', () => {
  it('offers the community instead of reporting a failure, when replace throws', async () => {
    replace.mockImplementation(() => {
      throw new Error('router is not mounted');
    });
    await submitWith(Promise.resolve({ data: { groupId: 'grp-1' } }));

    expect(byTestId('wsf-start-created-title')?.textContent).toBe('Your community is ready.');
    // A success: the failure hook every other suite keys on must be absent.
    expect(byTestId('wsf-start-error')).toBeNull();
    expect(byTestId('wsf-start-open')?.textContent).toContain('Open Harbor Walkers');
  });

  it('offers it when replace neither throws nor leaves, after the grace period', async () => {
    vi.useFakeTimers();
    // The web shape: the call returns cleanly and nothing happens.
    replace.mockImplementation(() => undefined);
    callable.mockReturnValue(Promise.resolve({ data: { groupId: 'grp-2' } }));
    render();
    type('wsf-start-name', 'Riverside Church');
    await click('wsf-start-submit');

    // Nothing yet: a navigation is allowed to take a moment.
    expect(byTestId('wsf-start-created-title')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(byTestId('wsf-start-created-title')?.textContent).toBe('Your community is ready.');
  });

  it('re-navigates with the id it kept, and never calls the callable again', async () => {
    replace.mockImplementation(() => {
      throw new Error('router is not mounted');
    });
    await submitWith(Promise.resolve({ data: { groupId: 'grp-3' } }));
    expect(callable).toHaveBeenCalledTimes(1);

    replace.mockReset();
    replace.mockImplementation(() => undefined);
    await click('wsf-start-open');
    expect(replace).toHaveBeenCalledWith('/community/grp-3');
    expect(callable, 'opening the community created another one').toHaveBeenCalledTimes(1);
  });
});

describe('an unconfirmed outcome', () => {
  it('says what it does not know, and points at the list rather than Home', async () => {
    await submitWith(Promise.reject(callableError('deadline-exceeded')));

    expect(byTestId('wsf-start-outcome-title')?.textContent).toBe(
      'We couldn’t confirm your community was created.',
    );
    const body = byTestId('wsf-start-error')?.textContent ?? '';
    expect(body).not.toContain('Nothing was created');
    expect(body).not.toContain('reach the server');
    expect(body).toContain('Check your communities');

    const check = byTestId('wsf-start-check-communities');
    expect(check).not.toBeNull();
    expect(check?.closest('a')?.getAttribute('href')).toBe('/?view=communities');
    expect(replace, 'the page navigated on its own').not.toHaveBeenCalled();
  });

  it('demotes the retry, names it a new community, and keeps the risk beside it', async () => {
    await submitWith(Promise.reject(callableError('unavailable')));
    expect(byTestId('wsf-start-submit')?.textContent).toContain('Start another community');
    expect(byTestId('wsf-start-retry-note')?.textContent).toContain('you will have two');
    expect(callable, 'the page retried by itself').toHaveBeenCalledTimes(1);
  });

  it('treats a success with no usable id as unconfirmed rather than a broken button', async () => {
    await submitWith(Promise.resolve({ data: { groupId: '  ' } }));
    expect(byTestId('wsf-start-outcome-title')?.textContent).toBe(
      'We couldn’t confirm your community was created.',
    );
    expect(byTestId('wsf-start-open')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('a named refusal', () => {
  it('says nothing was created, and leads to the profile without offering the same button', async () => {
    await submitWith(Promise.reject(callableError('failed-precondition')));

    expect(byTestId('wsf-start-outcome-title')?.textContent).toBe(
      'We couldn’t create your community.',
    );
    expect(byTestId('wsf-start-error')?.textContent).toBe(
      'Complete your profile before creating a community.',
    );
    expect(byTestId('wsf-start-profile')?.closest('a')?.getAttribute('href')).toBe(
      '/profile-setup',
    );
    expect(byTestId('wsf-start-submit'), 'the refused action is offered again').toBeNull();
  });

  it('keeps the form and its button for a refusal the member can clear', async () => {
    await submitWith(Promise.reject(callableError('resource-exhausted')));
    expect(byTestId('wsf-start-outcome-title')?.textContent).toBe(
      'We couldn’t create your community.',
    );
    expect(byTestId('wsf-start-submit')?.textContent).toContain('Create community');
  });

  it('never renders the server’s own words', async () => {
    await submitWith(Promise.reject(callableError('invalid-argument', 'displayName must be 2-80')));
    expect(container.textContent).not.toContain('displayName');
  });
});

describe('the account that asked', () => {
  it('drops a result that arrives after the account changed', async () => {
    let settle: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => {
      settle = resolve;
    });
    callable.mockReturnValue(held);
    render();
    type('wsf-start-name', 'Late Arrival');
    await click('wsf-start-submit');

    // The account changes while the create is still out.
    authUser = { uid: 'member-2', emailVerified: true };
    act(() => {
      root.render(<StartCommunity />);
    });
    await act(async () => {
      settle({ data: { groupId: 'grp-late' } });
      await Promise.resolve();
    });

    expect(byTestId('wsf-start-created-title')).toBeNull();
    expect(replace, 'the previous account’s community was opened').not.toHaveBeenCalled();
  });
});

describe('the classification, code by code', () => {
  it('reads the code and strips the callable prefix', () => {
    expect(callableCode({ code: 'functions/not-found' })).toBe('not-found');
    expect(callableCode({ code: 'unavailable' })).toBe('unavailable');
    expect(callableCode({ message: 'no code here' })).toBeNull();
    expect(callableCode(null)).toBeNull();
  });

  it.each(['unauthenticated', 'failed-precondition', 'invalid-argument', 'permission-denied', 'resource-exhausted'])(
    '%s is a refusal the server named',
    (code) => {
      const out = classifyCreateFailure(callableError(code));
      expect(out.kind).toBe('refused');
    },
  );

  /**
   * The heart of the change. Every one of these is consistent with a create
   * that LANDED, so none of them may be reported as a refusal.
   */
  it.each([
    'internal',
    'unavailable',
    'deadline-exceeded',
    'unknown',
    'cancelled',
    'aborted',
    'data-loss',
  ])('%s is unconfirmed, never a refusal', (code) => {
    expect(classifyCreateFailure(callableError(code)).kind).toBe('unconfirmed');
  });

  it('is unconfirmed when there is no code at all', () => {
    expect(classifyCreateFailure(new Error('network down')).kind).toBe('unconfirmed');
    expect(classifyCreateFailure(undefined).kind).toBe('unconfirmed');
  });

  it('sends only the profile precondition to the profile step', () => {
    const profile = classifyCreateFailure(callableError('failed-precondition'));
    expect(profile.kind === 'refused' && profile.recover).toBe('profile');
    const other = classifyCreateFailure(callableError('resource-exhausted'));
    expect(other.kind === 'refused' && other.recover).toBe('form');
  });
});

describe('the id the Open action would use', () => {
  it('accepts a plain id and rejects anything that is not one', () => {
    expect(usableGroupId('grp-1')).toBe('grp-1');
    expect(usableGroupId(' grp-1 ')).toBe('grp-1');
    expect(usableGroupId('')).toBeNull();
    expect(usableGroupId('   ')).toBeNull();
    expect(usableGroupId('a/b')).toBeNull();
    expect(usableGroupId('a?b')).toBeNull();
    expect(usableGroupId('a#b')).toBeNull();
    expect(usableGroupId(undefined)).toBeNull();
    expect(usableGroupId(42)).toBeNull();
  });
});

describe('the name, against what the server enforces', () => {
  it('matches the callable’s 2–80 window after trimming', () => {
    expect(nameProblem('')).toBe('short');
    expect(nameProblem(' a ')).toBe('short');
    expect(nameProblem('ab')).toBeNull();
    expect(nameProblem('x'.repeat(NAME_MAX_LENGTH))).toBeNull();
    expect(nameProblem(` ${'x'.repeat(NAME_MAX_LENGTH)} `)).toBeNull();
    expect(nameProblem('x'.repeat(NAME_MAX_LENGTH + 1))).toBe('long');
  });

  it('counts the name in the message, so the member knows what to cut', () => {
    expect(nameLongMessage(84)).toBe('Use 80 characters or fewer. This name is 84.');
  });
});

/*
  THE DUPLICATE GUARD, IN BOTH OF ITS WINDOWS — tests that fail on 5c28e45.

  The browser spec "two taps in one frame" passes because the button's own
  `disabled` prop swallows the later taps, so it never reached the ref. And
  nothing at all covered the window AFTER a confirmed create, where the old
  `finally` released the guard before navigation had landed. These two drive
  `onSubmit` directly, faster than a re-render can disable anything.
*/
describe('the duplicate guard', () => {
  it('two presses before any re-render send one create', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValue(new Promise((r) => { settle = r; }));
    render();
    type('wsf-start-name', 'Only Once');
    const submit = byTestId('wsf-start-submit')!;
    // Both inside ONE act: React has not re-rendered, so `disabled` cannot
    // be what stops the second — only the ref can.
    await act(async () => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(callable, 'a second create left while the first was open').toHaveBeenCalledTimes(1);
    await act(async () => { settle({ data: { groupId: 'grp-once' } }); await Promise.resolve(); });
  });

  /*
    TWO WINDOWS, BOTH OPEN ON 5c28e45, whose `finally` released the guard and
    re-enabled Create before the navigation had landed. Navigation here
    neither throws nor leaves, so the member is still looking at the form.
    Each test REQUIRES the button to be there and presses it; neither can pass
    by finding nothing to press.
  */
  async function confirmedAndStillHere(): Promise<void> {
    vi.useFakeTimers();
    replace.mockImplementation(() => undefined);
    callable.mockReturnValue(Promise.resolve({ data: { groupId: 'grp-held' } }));
    render();
    type('wsf-start-name', 'Held Guard');
    await click('wsf-start-submit');
    expect(callable).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/community/grp-held');
  }

  it('window 1 — right after confirmation, while the navigation lands, a second press sends nothing', async () => {
    await confirmedAndStillHere();
    // No time has passed: the create has returned and replace has been
    // called, and this is the transition a second tap falls into.
    await click('wsf-start-submit');
    expect(callable, 'a confirmed create was followed by a second one').toHaveBeenCalledTimes(1);
  });

  it('window 2 — late in the 1.5 s grace period, a second press sends nothing, then the created card', async () => {
    await confirmedAndStillHere();
    await act(async () => { vi.advanceTimersByTime(1400); });
    await click('wsf-start-submit');
    expect(callable, 'a confirmed create was followed by a second one').toHaveBeenCalledTimes(1);

    // Once the grace period ends, the form is the created card: Open, and no
    // Create to press.
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(byTestId('wsf-start-created-title')?.textContent).toBe('Your community is ready.');
    expect(byTestId('wsf-start-submit')).toBeNull();
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('a refusal releases the guard, so the member can correct and try again', async () => {
    callable.mockReturnValueOnce(Promise.reject(callableError('resource-exhausted')));
    render();
    type('wsf-start-name', 'Try Again');
    await click('wsf-start-submit');
    callable.mockReturnValueOnce(Promise.resolve({ data: { groupId: 'grp-second' } }));
    await click('wsf-start-submit');
    expect(callable).toHaveBeenCalledTimes(2);
  });
});

/*
  M5 — A MEMBER WHO LEFT IS NOT MOVED. Fails on 5c28e45, which checked only
  that the form was mounted.
*/
describe('leaving mid-create', () => {
  it('a late success does not navigate a member who is no longer on this screen', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValue(new Promise((r) => { settle = r; }));
    render();
    type('wsf-start-name', 'Left Early');
    await click('wsf-start-submit');

    // "Back to home" is a push: still mounted, no longer focused.
    focused = false;
    await act(async () => { settle({ data: { groupId: 'grp-left' } }); await Promise.resolve(); });

    expect(replace, 'the member was pulled into the community after they left').not.toHaveBeenCalled();
    // The create happened, so a return to this form finds Open, not a fresh
    // form that would make a second community.
    expect(byTestId('wsf-start-created-title')?.textContent).toBe('Your community is ready.');
    expect(byTestId('wsf-start-submit')).toBeNull();
  });

  it('a member who stayed is still taken to their community', async () => {
    await submitWith(Promise.resolve({ data: { groupId: 'grp-stayed' } }));
    expect(replace).toHaveBeenCalledWith('/community/grp-stayed');
  });
});

/*
  Q3 — LEAVING THE FIELD MOVES NOTHING. Fails on 5c28e45, whose blur inserted
  the sentence above the button.
*/
describe('leaving the name field short', () => {
  function blur(id: string): void {
    const el = byTestId(id);
    if (!el) throw new Error(`${id} is not rendered`);
    act(() => {
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('blur'));
    });
  }

  it('inserts no sentence on blur, only marks the field', () => {
    render();
    type('wsf-start-name', 'H');
    blur('wsf-start-name');
    expect(byTestId('wsf-start-name-error'), 'the blur inserted a sentence above the button').toBeNull();
  });

  it('the press that finds it short shows the sentence and puts focus on the field', async () => {
    render();
    type('wsf-start-name', 'H');
    blur('wsf-start-name');
    await click('wsf-start-submit');
    expect(byTestId('wsf-start-name-error')?.textContent).toBe('Give your community a name.');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('wsf-start-name');
    expect(callable).not.toHaveBeenCalled();
  });
});

/*
  M4 — THE UNVERIFIED GATE HAS A WAY OUT.
*/
describe('the unverified gate', () => {
  it('offers Back to home beside Verify email', () => {
    authUser = { uid: 'member-u', emailVerified: false };
    render();
    expect(byTestId('wsf-start-unverified-verify')).not.toBeNull();
    const back = byTestId('wsf-start-unverified-back');
    expect(back, 'the only way off the gate is to verify').not.toBeNull();
    expect(back?.closest('a')?.getAttribute('href')).toBe('/');
  });
});
