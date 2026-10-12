import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callableCode,
  classifyCreateFailure,
  forgetUnacknowledgedCreate,
  nameLongMessage,
  rememberUnacknowledgedCreate,
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
vi.mock('../src/firebase', () => ({
  getFirebaseFunctions: () => ({}),
  // The live signed-in user, which R1 reads when a confirmation arrives.
  getFirebaseAuth: () => ({ currentUser: authUser ? { uid: authUser.uid } : null }),
}));
/** Sign-in listeners the route registers; tests call them to sign out or switch. */
const signInListeners: ((u: { uid: string } | null) => void)[] = [];
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, listener: (u: { uid: string } | null) => void) => {
    signInListeners.push(listener);
    listener(authUser ? { uid: authUser.uid } : null);
    return () => {};
  },
}));
/** The device's signed-in account changes: what the route sees, and what it is told. */
function signInAs(uid: string | null): void {
  authUser = uid ? { uid, emailVerified: true } : null;
  for (const listener of signInListeners) listener(authUser ? { uid: authUser.uid } : null);
}

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
  // R1's note is module memory, like the real page's; each test starts clean.
  forgetUnacknowledgedCreate();
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

  /** Everything the route controls about how the field looks. */
  const look = (id: string): string => {
    const el = byTestId(id);
    if (!el) throw new Error(`${id} is not rendered`);
    return `${el.className}|${el.getAttribute('style') ?? ''}`;
  };

  /*
    NEVER COLOUR ALONE (Director `5802873607`). This used to be "inserts no
    sentence on blur, only marks the field", and it asserted only the first
    half. The ruling makes the second half wrong: a red border with no
    sentence beside it is a message told in colour only. So the blur must
    leave the field EXACTLY as it was. Fails on 7f37e2a, whose blur added the
    invalid styling.
  */
  it('changes nothing on blur: no sentence, and the field looks exactly as it did', () => {
    render();
    type('wsf-start-name', 'H');
    const before = look('wsf-start-name');
    blur('wsf-start-name');
    expect(byTestId('wsf-start-name-error'), 'the blur inserted a sentence above the button').toBeNull();
    expect(look('wsf-start-name'), 'the blur restyled the field with no sentence beside it').toBe(before);
  });

  it('the press that finds it short shows the sentence, marks the field and puts focus on it', async () => {
    render();
    // The invalid look, read from a state whose sentence always shows: a name
    // over the ceiling. The press must produce exactly that, not merely some
    // change.
    type('wsf-start-name', 'x'.repeat(81));
    const invalid = look('wsf-start-name');
    type('wsf-start-name', 'H');
    blur('wsf-start-name');
    expect(look('wsf-start-name'), 'the short name was marked before any press').not.toBe(invalid);
    await click('wsf-start-submit');
    expect(byTestId('wsf-start-name-error')?.textContent).toBe('Give your community a name.');
    expect(look('wsf-start-name'), 'the press explained the name but did not mark the field').toBe(invalid);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('wsf-start-name');
    expect(callable).not.toHaveBeenCalled();
  });
});

/*
  R1 — A COMMUNITY CREATED AFTER THE MEMBER LEFT (Director `5803218763`).

  M5 keeps a member who left mid-create where they went. The create can then
  land with nobody looking, and Home, read before the commit, still offers
  "Start a community". These tests stand a SECOND, fresh form beside the first
  (which stays mounted and hidden, as on the real stack) and require the
  confirmed community to be shown by name before a blank form can submit, and
  only to the account that made it. On e653330 the fresh form is blank.
*/
describe('R1: a community created after the member left', () => {
  const extras: { root: Root; container: HTMLDivElement }[] = [];

  afterEach(() => {
    for (const e of extras.splice(0)) {
      act(() => e.root.unmount());
      e.container.remove();
    }
  });

  type Screen = {
    q: (id: string) => HTMLElement | null;
    type: (id: string, value: string) => void;
    click: (id: string) => Promise<void>;
    text: () => string;
  };

  /** Another /start-community, mounted beside the first. */
  function openAnother(): Screen {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const r = createRoot(c);
    extras.push({ root: r, container: c });
    act(() => {
      r.render(<StartCommunity />);
    });
    const q = (id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return {
      q,
      type: (id, value) => {
        const el = q(id) as HTMLInputElement | null;
        if (!el) throw new Error(`${id} is not rendered`);
        act(() => {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
      },
      click: async (id) => {
        const el = q(id);
        if (!el) throw new Error(`${id} is not rendered`);
        await act(async () => {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      },
      text: () => c.textContent ?? '',
    };
  }

  /** The first form: press Create, leave, and let the create land. */
  async function createThenLeave(name = 'Left First', groupId = 'grp-first'): Promise<void> {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    render();
    type('wsf-start-name', name);
    await click('wsf-start-submit');
    focused = false; // "Back to home": still mounted, no longer in front.
    await act(async () => { settle({ data: { groupId } }); await Promise.resolve(); });
    focused = true; // whatever is opened next is in front
  }

  it('a fresh form for the same account shows that community by name, with Open, and no blank Create', async () => {
    await createThenLeave();
    const again = openAnother();
    expect(again.q('wsf-start-created'), 'the fresh form was blank: a silent second community').not.toBeNull();
    expect(again.q('wsf-start-open')?.textContent).toContain('Open Left First');
    expect(again.text()).toContain('Left First');
    expect(again.q('wsf-start-submit'), 'a blank Create was offered before the community was shown').toBeNull();
    expect(callable, 'showing it sent anything').toHaveBeenCalledTimes(1);
    expect(replace, 'the member was moved').not.toHaveBeenCalled();
  });

  it('says truthfully why it is showing the card, on the new form and on the one they left', async () => {
    await createThenLeave();
    // The form they left, as browser Back finds it (R1b).
    const left = byTestId('wsf-start-created')?.textContent ?? '';
    expect(left, 'the card claims an open that nothing attempted').not.toMatch(/couldn.t open it automatically/i);
    expect(left).toContain('It was created after you left this page.');
    const again = openAnother();
    const shown = again.q('wsf-start-created')?.textContent ?? '';
    expect(shown, 'the new form did not show the card at all').toContain('It was created after you left this page.');
  });

  it('is never shown to another account, and another account finding it drops it', async () => {
    await createThenLeave();
    authUser = { uid: 'member-2', emailVerified: true };
    const other = openAnother();
    expect(other.q('wsf-start-created'), 'another account was shown this community').toBeNull();
    expect(other.q('wsf-start-submit')).not.toBeNull();
    authUser = { uid: 'member-1', emailVerified: true };
    const back = openAnother();
    expect(back.q('wsf-start-created'), 'the note survived another account reading it').toBeNull();
  });

  it('is cleared by Open: the form after that is an ordinary blank one', async () => {
    await createThenLeave();
    const again = openAnother();
    await again.click('wsf-start-open');
    expect(replace).toHaveBeenCalledWith('/community/grp-first');
    const later = openAnother();
    expect(later.q('wsf-start-created')).toBeNull();
    expect(later.q('wsf-start-submit')).not.toBeNull();
  });

  it('a deliberate "Start another community" gives an empty form, and that second create goes', async () => {
    await createThenLeave();
    const again = openAnother();
    await again.click('wsf-start-another');
    expect((again.q('wsf-start-name') as HTMLInputElement | null)?.value).toBe('');
    callable.mockReturnValueOnce(Promise.resolve({ data: { groupId: 'grp-second' } }));
    again.type('wsf-start-name', 'Second On Purpose');
    await again.click('wsf-start-submit');
    expect(callable, 'the deliberate second create did not go').toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith('/community/grp-second');
    // And the note is gone: a third form is blank.
    expect(openAnother().q('wsf-start-created')).toBeNull();
  });

  it('on the form they left, "Start another community" releases the held guard, so Create works', async () => {
    await createThenLeave();
    await click('wsf-start-another');
    // The form that still held 'Left First' is the one where clearing matters.
    expect((byTestId('wsf-start-name') as HTMLInputElement | null)?.value, 'the old name was left in the form').toBe('');
    callable.mockReturnValueOnce(Promise.resolve({ data: { groupId: 'grp-again' } }));
    type('wsf-start-name', 'Back Then Again');
    await click('wsf-start-submit');
    expect(callable, 'Create was dead after a deliberate choice').toHaveBeenCalledTimes(2);
  });

  it('a form already open when the confirmation lands switches to the community before it can submit', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    render();
    type('wsf-start-name', 'Came Back Early');
    await click('wsf-start-submit');
    focused = false;
    const early = openAnother(); // opened while the first create is still out
    expect(early.q('wsf-start-submit')).not.toBeNull();
    await act(async () => { settle({ data: { groupId: 'grp-early' } }); await Promise.resolve(); });
    expect(early.q('wsf-start-created'), 'the open form stayed blank after the community was confirmed').not.toBeNull();
    expect(early.q('wsf-start-open')?.textContent).toContain('Open Came Back Early');
    expect(early.q('wsf-start-submit')).toBeNull();
    expect(callable, 'showing it sent anything').toHaveBeenCalledTimes(1);
  });

  it('a form whose own create is out is left to its own result', async () => {
    let settleFirst: (v: unknown) => void = () => {};
    let settleSecond: (v: unknown) => void = () => {};
    callable
      .mockReturnValueOnce(new Promise((r) => { settleFirst = r; }))
      .mockReturnValueOnce(new Promise((r) => { settleSecond = r; }));
    render();
    type('wsf-start-name', 'First Out');
    await click('wsf-start-submit');
    focused = false;
    const second = openAnother();
    second.type('wsf-start-name', 'Second Out');
    await second.click('wsf-start-submit');
    await act(async () => { settleFirst({ data: { groupId: 'grp-a' } }); await Promise.resolve(); });
    expect(second.q('wsf-start-created'), 'a form with its own create out was taken over').toBeNull();
    focused = true;
    await act(async () => { settleSecond({ data: { groupId: 'grp-b' } }); await Promise.resolve(); });
    expect(replace).toHaveBeenCalledWith('/community/grp-b');
  });

  it('a confirmation after the form is gone (browser Back) paints nothing, and the next form shows it', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    const gone = openAnother();
    gone.type('wsf-start-name', 'Gone Before');
    await gone.click('wsf-start-submit');
    const leaving = extras.pop()!;
    act(() => leaving.root.unmount());
    leaving.container.remove();
    await act(async () => { settle({ data: { groupId: 'grp-gone' } }); await Promise.resolve(); });
    expect(replace, 'the member was moved after the form was gone').not.toHaveBeenCalled();
    const next = openAnother();
    expect(next.q('wsf-start-created'), 'the next form was blank: the confirmation was lost with the form').not.toBeNull();
    expect(next.q('wsf-start-open')?.textContent).toContain('Open Gone Before');
  });

  it('only a confirmed create is carried: an unconfirmed one leaves the next form blank', async () => {
    let fail: (e: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((_, rej) => { fail = rej; }));
    render();
    type('wsf-start-name', 'Unknown Fate');
    await click('wsf-start-submit');
    focused = false;
    await act(async () => { fail(callableError('unavailable')); await Promise.resolve(); });
    focused = true;
    expect(openAnother().q('wsf-start-created')).toBeNull();
  });

  it('a press in the moment before the open form re-renders sends nothing and shows the community', async () => {
    const early = openAnother();
    early.type('wsf-start-name', 'Pressed Too Soon');
    // The first form's confirmation lands (as its own continuation would
    // record it) and, before React has shown it here, the member presses.
    rememberUnacknowledgedCreate({ uid: 'member-1', groupId: 'grp-race', displayName: 'Left Race' });
    await early.click('wsf-start-submit');
    expect(callable, 'the press sent a second create past the confirmed first').not.toHaveBeenCalled();
    expect(early.q('wsf-start-open')?.textContent).toContain('Open Left Race');
  });

  it('once shown on the screen in front, it is acknowledged: the next Start is an ordinary blank form', async () => {
    await createThenLeave();
    expect(openAnother().q('wsf-start-created')).not.toBeNull();
    const next = openAnother();
    expect(next.q('wsf-start-created'), 'the same card came back after the member had seen it').toBeNull();
    expect(next.q('wsf-start-submit')).not.toBeNull();
  });

  /*
    THE ACCOUNT BOUNDS, INCLUDING AN OLD REQUEST THAT COMPLETES AFTER AN
    ACCOUNT CHANGE (Director `5803485378`). The note is remembered only if the
    account that asked is still the one signed in when the confirmation
    arrives; any sign-out or account change drops a note already kept.
  */
  it('a confirmation that arrives after another account signed in is kept for nobody', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    render();
    type('wsf-start-name', 'Asked By One');
    await click('wsf-start-submit');
    focused = false;
    signInAs('member-2');
    act(() => {
      root.render(<StartCommunity />);
    });
    await act(async () => { settle({ data: { groupId: 'grp-one' } }); await Promise.resolve(); });
    // Back to the account that asked, with nothing opened in between: the old
    // request must not surface now as if it were current.
    signInAs('member-1');
    expect(openAnother().q('wsf-start-created'), 'the old request resurfaced for its account later').toBeNull();
    signInAs('member-2');
    expect(openAnother().q('wsf-start-created'), 'the new account was shown the old account’s community').toBeNull();
  });

  it('the same after the form is gone: a late confirmation for a signed-out account is kept for nobody', async () => {
    let settle: (v: unknown) => void = () => {};
    callable.mockReturnValueOnce(new Promise((r) => { settle = r; }));
    const gone = openAnother();
    gone.type('wsf-start-name', 'Gone Then Switched');
    await gone.click('wsf-start-submit');
    const leaving = extras.pop()!;
    act(() => leaving.root.unmount());
    leaving.container.remove();
    signInAs('member-2');
    await act(async () => { settle({ data: { groupId: 'grp-gone2' } }); await Promise.resolve(); });
    signInAs('member-1');
    expect(openAnother().q('wsf-start-created'), 'the old request resurfaced for its account later').toBeNull();
    signInAs('member-2');
    expect(openAnother().q('wsf-start-created'), 'the new account was shown the old account’s community').toBeNull();
  });

  it('signing out drops a note already kept, so it does not come back on the next sign-in', async () => {
    await createThenLeave();
    signInAs(null);
    signInAs('member-1');
    expect(openAnother().q('wsf-start-created'), 'the note outlived the sign-out').toBeNull();
  });

  it('another account signing in drops a note already kept, before any form is opened', async () => {
    await createThenLeave();
    signInAs('member-2');
    signInAs('member-1');
    expect(openAnother().q('wsf-start-created'), 'the note outlived another account’s sign-in').toBeNull();
  });

  it('the navigation-failure card keeps its own copy and offers no second create', async () => {
    replace.mockImplementation(() => {
      throw new Error('router is not mounted');
    });
    await submitWith(Promise.resolve({ data: { groupId: 'grp-stayed' } }));
    expect(byTestId('wsf-start-created')?.textContent).toContain('We couldn’t open it automatically.');
    expect(byTestId('wsf-start-another')).toBeNull();
    // The member stayed, so nothing is remembered for a later form.
    expect(openAnother().q('wsf-start-created')).toBeNull();
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
