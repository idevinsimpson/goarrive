import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native-web's AccessibilityInfo.addEventListener returns nothing under
// jsdom, so the shared reduced-motion hook cannot unsubscribe here. It is not
// under test; the view is.
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

import { YouParityView, type YouParityActions } from '../src/ui/YouParityView';
import type { YouGoal, YouState } from '../src/youParity';

/**
 * YOU-PARITY-1: the pure view rendered into jsdom through react-native-web.
 * It proves order, the own/shared split, the lifecycle pills, which "your
 * part" block shows, and that every control only calls its callback.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const text = (id: string) => byId(id)?.textContent ?? '';
/** Document order: a before b. */
const before = (a: string, b: string) =>
  Boolean(byId(a)!.compareDocumentPosition(byId(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);

const PROFILE = { displayName: 'Alex M.', memberSince: 'September 2026' };
const COMMUNITY = { displayName: 'Oak Grove Together', role: 'member', memberCount: 23 };
const LEAD: YouGoal = { goalId: 'lead', title: '500 squats together', unit: 'squats', target: 500, yourPart: 25, sharedTotal: 241, open: true };
const OTHER: YouGoal = { goalId: 'other', title: '150 squats this week', unit: 'squats', target: 150, yourPart: 20, sharedTotal: 155, open: true };

function render(state: YouState) {
  const actions: YouParityActions = {
    onSettings: vi.fn(),
    onSignOut: vi.fn(),
    onSignIn: vi.fn(),
    onCommunity: vi.fn(),
    onRetry: vi.fn(),
    onStartMoving: vi.fn(),
  };
  act(() => {
    root.render(<YouParityView state={state} email="alex@example.com" signingOut={false} actions={actions} />);
  });
  return actions;
}

const member = (over: Partial<Extract<YouState, { kind: 'member' }>> = {}): YouState => ({
  kind: 'member',
  profile: PROFILE,
  community: COMMUNITY,
  open: [LEAD, OTHER],
  finished: [],
  partial: false,
  eligible: true,
  ...over,
});

describe('YouParityView', () => {
  it('leads with the member story, in the reference order, and the account last', () => {
    render(member());
    expect(text('wsf-you-name')).toBe('Alex M.');
    expect(text('wsf-you-since')).toBe('Member since September 2026');
    expect(text('wsf-you-community')).toContain('Oak Grove Together');
    expect(text('wsf-you-community')).toContain('Member');
    expect(text('wsf-you-community')).toContain('23 members');
    for (const [a, b] of [
      ['wsf-you-identity', 'wsf-you-community'],
      ['wsf-you-community', 'wsf-you-lead'],
      ['wsf-you-lead', 'wsf-you-others'],
      ['wsf-you-others', 'wsf-you-account'],
      ['wsf-you-lead', 'wsf-you-email'],
    ] as const) {
      expect(before(a, b), `${a} before ${b}`).toBe(true);
    }
  });

  it('keeps the shared position and your exact part apart', () => {
    render(member());
    expect(text('wsf-you-lead-status')).toBe('OPEN');
    expect(text('wsf-you-lead-shared')).toBe('241 / 500 confirmed');
    expect(text('wsf-you-lead-own')).toBe('25 squats');
    expect(byId('wsf-you-lead-own')!.getAttribute('aria-label')).toBe('25 squats');
    expect(text('wsf-you-lead-own')).not.toContain('%');
    expect(text('wsf-you-lead')).toContain('Shared and yours are separate facts.');
  });

  it('lists other goals with their lifecycle, your part and the shared figure', () => {
    render(member({ finished: [{ ...OTHER, goalId: 'done', title: 'Old', open: false, sharedTotal: 360, target: 500 }] }));
    const others = text('wsf-you-others');
    expect(others).toContain('Other goals you helped');
    expect(others).toContain('150 squats this week');
    expect(others).toContain('REACHED · STILL OPEN');
    expect(others).toContain('CLOSED · UNFINISHED');
    expect(others).toContain('20 squats');
    expect(others).toContain('155 / 150 squats');
    expect(byId('wsf-you-row-lead')).toBeNull();
  });

  it('offers Start moving only when a goal is eligible, and only calls back', () => {
    const a = render(member({ open: [], eligible: true }));
    expect(text('wsf-you-nothing-yet')).toContain('Your first confirmed contribution can start here');
    act(() => byId('wsf-you-start-moving')!.click());
    expect(a.onStartMoving).toHaveBeenCalledTimes(1);
    expect(byId('wsf-you-lead')).toBeNull();
  });

  it('with nothing eligible there is no Start moving, and a way to the community', () => {
    const a = render(member({ open: [], eligible: false }));
    expect(byId('wsf-you-nothing-yet')!.getAttribute('data-state')).toBe('no-eligible-goal');
    expect(byId('wsf-you-start-moving')).toBeNull();
    act(() => byId('wsf-you-open-community')!.click());
    expect(a.onCommunity).toHaveBeenCalledTimes(1);
  });

  it('a failure keeps identity and community, guesses no amount, and retries by callback', () => {
    const a = render({ kind: 'failed', profile: PROFILE, community: COMMUNITY });
    expect(text('wsf-you-failed')).toContain('Contribution details unavailable');
    expect(text('wsf-you-community')).toContain('Oak Grove Together');
    expect(byId('wsf-you-lead-own')).toBeNull();
    expect(byId('wsf-you-member')).toBeNull();
    act(() => byId('wsf-you-retry')!.click());
    expect(a.onRetry).toHaveBeenCalledTimes(1);
    expect(byId('wsf-you-signout')).not.toBeNull();
  });

  it('Settings and Sign out are callbacks, not navigation it owns', () => {
    const a = render(member());
    act(() => byId('wsf-you-settings')!.click());
    act(() => byId('wsf-you-signout')!.click());
    expect(a.onSettings).toHaveBeenCalledTimes(1);
    expect(a.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('loading and signed out carry no identity handle and no name', () => {
    render({ kind: 'loading' });
    expect(byId('wsf-you-identity')).toBeNull();
    expect(byId('wsf-you-name')).toBeNull();
    render({ kind: 'signedOut' });
    expect(byId('wsf-you-identity')).toBeNull();
    expect(byId('wsf-you-name')).toBeNull();
    expect(byId('wsf-you-signin')).not.toBeNull();
  });

  it('several communities is not "none"', () => {
    render({ kind: 'pickCommunity', profile: PROFILE, count: 2 });
    expect(text('wsf-you-pick-community')).toContain('You are in 2 communities');
    expect(byId('wsf-you-no-community')).toBeNull();
  });

  it('admits a partial list', () => {
    render(member({ partial: true }));
    expect(byId('wsf-you-partial')).not.toBeNull();
  });
});
