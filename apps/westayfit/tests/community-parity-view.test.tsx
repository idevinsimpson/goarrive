import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-native-web's AccessibilityInfo.addEventListener returns nothing under
// jsdom, so the shared reduced-motion hook cannot unsubscribe here. It is not
// under test; the view is.
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));

import {
  anonymousRemainder,
  bannerSupport,
  canDrawLivingWe,
  effectiveTotal,
  goalFigures,
  goalMeta,
  goalPill,
  goalsCountFact,
  knownMemberCount,
  totalValue,
  validTarget,
  type CommunityParityProps,
  type DrawableGoal,
  type ParityGoal,
} from '../src/ui/communityParityTypes';
import { CommunityParityView } from '../src/ui/CommunityParityView';

/**
 * COMMUNITY-PRESENTATION-ACCELERATOR-1: the pure Community view and its rules.
 *
 * The rules are the Director's data mapping (#447 `5840935220`): a failed or
 * partial read is never shown as zero, the Goals fact counts only a fully
 * loaded collection, the anonymous remainder is derived only from a complete
 * visible set and a known member count, and Living WE needs a positive target
 * and a confirmed total. The render tests prove the reference's hierarchy and
 * that every control only calls its callback.
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
const before = (a: string, b: string) =>
  Boolean(byId(a)!.compareDocumentPosition(byId(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);
function click(id: string) {
  const el = byId(id);
  expect(el, `${id} is not on screen`).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const confirmed = (value: number) => ({ state: 'confirmed' as const, value });
const goal = (over: Partial<ParityGoal> = {}): ParityGoal => ({
  goalId: 'g1',
  title: '500 squats together',
  unit: 'squats',
  target: 500,
  total: confirmed(241),
  status: 'active',
  windowLabel: 'This week',
  ...over,
});
const drawable = (g: ParityGoal): DrawableGoal => {
  if (!canDrawLivingWe(g)) throw new Error('fixture goal has no instrument');
  return g;
};
const HISTORY = [
  goal({ goalId: 'apr', title: '1,000 squats in April', target: 1000, total: confirmed(1024), status: 'closed', windowLabel: 'April' }),
  goal({ goalId: 'mar', title: '800 squats in March', target: 800, total: confirmed(612), status: 'closed', windowLabel: 'March' }),
];
const NAMED = [
  { key: 'alex', displayName: 'Alex M.', role: 'member' },
  { key: 'jordan', displayName: 'Jordan P.', role: 'foundingChampion' },
];
const CHIPS = {
  state: 'loaded' as const,
  value: [
    { groupId: 'oak', displayName: 'Oak Grove Together' },
    { groupId: 'harbor', displayName: 'Harbor Lunch Crew' },
  ],
};

function props(over: Partial<CommunityParityProps> = {}): CommunityParityProps {
  return {
    groupId: 'oak',
    displayName: 'Oak Grove Together',
    groupType: 'familyFriends',
    joinPolicy: 'private',
    memberCount: 23,
    role: 'member',
    communities: CHIPS,
    goals: { state: 'loaded', value: { featured: goal(), otherOpen: [] } },
    history: { state: 'loaded', value: HISTORY },
    roster: { state: 'loaded', value: { named: NAMED, complete: false } },
    onSelectCommunity: vi.fn(),
    onJoin: vi.fn(),
    onStart: vi.fn(),
    onRetryCommunities: vi.fn(),
    onRetryGoals: vi.fn(),
    onRetryHistory: vi.fn(),
    onRetryRoster: vi.fn(),
    onShowMoreMembers: vi.fn(),
    ...over,
  };
}
function render(p: CommunityParityProps) {
  act(() => root.render(<CommunityParityView {...p} />));
  return p;
}

describe('the rules — unknown is never zero', () => {
  it('counts goals only from a fully loaded collection', () => {
    const p = props();
    expect(goalsCountFact(p.goals, p.history)).toBe(3);
    expect(goalsCountFact({ state: 'failed' }, p.history)).toBeNull();
    expect(goalsCountFact({ state: 'loading' }, p.history)).toBeNull();
    expect(goalsCountFact(p.goals, { state: 'failed' })).toBeNull();
    expect(goalsCountFact(p.goals, { state: 'loading' })).toBeNull();
    // History not part of the read at all is partial too: finished goals can
    // exist without their history fields, so the open goals alone are no count.
    expect(goalsCountFact(p.goals, { state: 'unavailable' })).toBeNull();
  });

  it('derives the anonymous remainder only from a complete visible set and a known count', () => {
    const complete = { state: 'loaded' as const, value: { named: NAMED, complete: true } };
    expect(anonymousRemainder(23, complete)).toBe(21);
    expect(anonymousRemainder(null, complete)).toBeNull();
    expect(anonymousRemainder(23, { state: 'loaded', value: { named: NAMED, complete: false } })).toBeNull();
    expect(anonymousRemainder(23, { state: 'failed' })).toBeNull();
    expect(anonymousRemainder(1, complete)).toBe(0);
  });

  it('fails closed on an impossible member count: unknown, never a count — and never clamped to zero (K-F1)', () => {
    const complete = { state: 'loaded' as const, value: { named: NAMED, complete: true } };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 2.5]) {
      expect(anonymousRemainder(bad, complete), String(bad)).toBeNull();
      expect(knownMemberCount(bad), String(bad)).toBeNull();
    }
    // A known count stays known; a known zero is a real zero, and -0 is that zero.
    expect(knownMemberCount(23)).toBe(23);
    expect(knownMemberCount(0)).toBe(0);
    expect(Object.is(knownMemberCount(-0), 0)).toBe(true);
    expect(knownMemberCount(null)).toBeNull();
    expect(anonymousRemainder(0, { state: 'loaded', value: { named: [], complete: true } })).toBe(0);
  });

  it('fails closed on an impossible figure: never NaN, Infinity or a negative — and never clamped to zero', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      for (const state of ['confirmed', 'lastKnown'] as const) {
        const g = goal({ total: { state, value: bad } });
        expect(effectiveTotal(g.total), `${state} ${bad}`).toEqual({ state: 'failed' });
        expect(totalValue(g.total)).toBeNull();
        expect(canDrawLivingWe(g)).toBe(false);
        expect(goalPill(g)).toEqual({ label: 'Unknown', tone: 'unknown' });
        expect(goalFigures(g)).toBe('Total can’t be confirmed right now');
      }
    }
    // Zero is a real figure, not an impossible one.
    expect(totalValue(confirmed(0))).toBe(0);
    expect(canDrawLivingWe(goal({ total: confirmed(0) }))).toBe(true);
    // A target is a target only when finite and positive.
    for (const badTarget of [Number.NaN, Number.POSITIVE_INFINITY, -500, 0]) {
      expect(validTarget(badTarget)).toBeNull();
      const g = goal({ target: badTarget });
      expect(canDrawLivingWe(g)).toBe(false);
      expect(goalFigures(g)).toBe('241 squats');
      expect(goalPill(g).label).toBe('Open');
    }
  });

  it('renders an impossible total as unknown: no Living WE, no number, no NaN on screen', () => {
    render(props({ goals: { state: 'loaded', value: { featured: goal({ total: confirmed(Number.NaN) }), otherOpen: [] } } }));
    expect(byId('wsf-parity-living-we')).toBeNull();
    expect(byId('wsf-parity-total')).toBeNull();
    expect(text('wsf-parity-period-unknown')).toContain('Progress unknown');
    expect(text('wsf-parity-period-status')).toBe('UNKNOWN');
    expect(container.textContent).not.toMatch(/NaN|Infinity|-\d/);
    render(props({ goals: { state: 'loaded', value: { featured: goal({ target: Number.POSITIVE_INFINITY }), otherOpen: [] } } }));
    expect(byId('wsf-parity-living-we')).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity|∞/);
  });

  it('draws Living WE only for a positive target and a confirmed figure', () => {
    expect(canDrawLivingWe(goal())).toBe(true);
    expect(canDrawLivingWe(goal({ total: { state: 'lastKnown', value: 241 } }))).toBe(true);
    expect(canDrawLivingWe(goal({ total: { state: 'failed' } }))).toBe(false);
    expect(canDrawLivingWe(goal({ total: { state: 'loading' } }))).toBe(false);
    expect(canDrawLivingWe(goal({ target: 0 }))).toBe(false);
    expect(canDrawLivingWe(goal({ target: null }))).toBe(false);
  });

  it('names the lifecycle in the reference words; reached and closed are separate facts', () => {
    expect(goalPill(goal()).label).toBe('Open');
    expect(goalPill(goal({ total: confirmed(530) })).label).toBe('Reached · still open');
    expect(goalPill(HISTORY[0]!)).toEqual({ label: 'Closed · reached', tone: 'closedReached' });
    expect(goalPill(HISTORY[1]!)).toEqual({ label: 'Closed · unfinished', tone: 'unfinished' });
    expect(goalPill(goal({ status: 'scheduled' })).label).toBe('Scheduled');
    expect(goalPill(goal({ total: { state: 'failed' } }))).toEqual({ label: 'Unknown', tone: 'unknown' });
    expect(goalPill(goal({ total: { state: 'lastKnown', value: 241 } })).label).toBe('Last known · not live');
    // A loading total keeps only the lifecycle it knows.
    expect(goalPill(goal({ total: { state: 'loading' } }))).toEqual({ label: 'Open', tone: 'pending' });
    expect(goalPill(goal({ total: { state: 'loading' }, status: 'closed' })).label).toBe('Closed');
  });

  it('keeps the confirmed overshoot and says how far short a closed goal ended', () => {
    expect(goalMeta(drawable(goal()))).toEqual({ strong: '48.2% complete', soft: '259 squats to go' });
    expect(goalMeta(drawable(HISTORY[0]!))).toEqual({ strong: 'Goal reached · +24 beyond', soft: 'Closed' });
    expect(goalMeta(drawable(HISTORY[1]!)).soft).toBe('Ended 188 short');
    expect(goalMeta(drawable(goal({ total: { state: 'lastKnown', value: 241 } }))).soft).toBe('Not live');
    expect(goalFigures(HISTORY[0]!)).toBe('1,024 of 1,000 squats');
    expect(goalFigures(goal({ total: { state: 'failed' } }))).toBe('Total can’t be confirmed right now');
    expect(goalFigures(goal({ total: { state: 'loading' } }))).toBe('Loading the total…');
    expect(goalFigures(goal({ total: { state: 'lastKnown', value: 241 } }))).toBe('241 of 500 squats · last known');
  });

  it('fills the banner slots with canonical words or leaves them out — never a place', () => {
    expect(bannerSupport('familyFriends', 'private')).toEqual({
      eyebrow: 'Family and friends',
      descriptor: 'Private community',
    });
    expect(bannerSupport('custom', 'inviteOnly')).toEqual({
      eyebrow: null,
      descriptor: 'Anyone with the link can join',
    });
    expect(bannerSupport(null, null)).toEqual({ eyebrow: null, descriptor: null });
  });
});

describe('the view — the reference hierarchy', () => {
  it('orders banner → facts → communities → this period → history → members', () => {
    render(props());
    const order = [
      'wsf-parity-banner',
      'wsf-parity-facts',
      'wsf-parity-switcher',
      'wsf-parity-period',
      'wsf-parity-history',
      'wsf-parity-roster',
    ];
    for (let i = 1; i < order.length; i += 1) expect(before(order[i - 1]!, order[i]!)).toBe(true);
    expect(text('wsf-parity-name')).toBe('Oak Grove Together');
    expect(text('wsf-parity-banner-eyebrow')).toBe('FAMILY AND FRIENDS');
    expect(text('wsf-parity-descriptor')).toBe('Private community');
    expect(text('wsf-parity-fact-members')).toBe('Members23');
    expect(text('wsf-parity-fact-role')).toBe('Your roleMember');
    expect(text('wsf-parity-fact-goals')).toBe('Goals3');
    expect(text('wsf-parity-period-title')).toBe('500 squats together');
    expect(text('wsf-parity-period-status')).toBe('OPEN');
    expect(text('wsf-parity-total')).toBe('241');
    expect(text('wsf-parity-meta-strong')).toBe('48.2% complete');
    expect(byId('wsf-parity-living-we')?.getAttribute('data-fill-ratio')).toBe('0.4820');
    expect(text('wsf-parity-history-apr')).toContain('CLOSED · REACHED');
    expect(text('wsf-parity-history-mar')).toContain('CLOSED · UNFINISHED');
    // No "(you)": the roster read carries no uid to say who the viewer is.
    expect(text('wsf-parity-member-alex')).toBe('AMAlex M.');
    expect(text('wsf-parity-member-jordan')).toContain('CHAMPION');
  });

  it('shows a fact whose read failed as not known — never zero, never a fabricated count', () => {
    const p = render(props({ memberCount: null, role: null, goals: { state: 'failed' } }));
    expect(text('wsf-parity-fact-members')).toBe('Members—');
    expect(text('wsf-parity-fact-role')).toBe('Your role—');
    expect(text('wsf-parity-fact-goals')).toBe('Goals—');
    expect(text('wsf-parity-roster-count')).toBe('Members');
    expect(byId('wsf-parity-goals-failed')).not.toBeNull();
    expect(byId('wsf-parity-living-we')).toBeNull();
    click('wsf-parity-goals-failed-retry');
    expect(p.onRetryGoals).toHaveBeenCalledTimes(1);
    expect(p.onRetryHistory).not.toHaveBeenCalled();
  });

  it('renders an impossible member count as not known: MEMBERS —, "Members", no remainder (K-F1)', () => {
    const complete = { state: 'loaded' as const, value: { named: NAMED, complete: true } };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 2.5]) {
      render(props({ memberCount: bad, roster: complete }));
      expect(text('wsf-parity-fact-members'), String(bad)).toBe('Members—');
      expect(text('wsf-parity-roster-count'), String(bad)).toBe('Members');
      expect(byId('wsf-parity-anonymous'), String(bad)).toBeNull();
      expect(container.textContent, String(bad)).not.toMatch(/NaN|Infinity|-\d/);
    }
    // Controls: a known count renders as itself, and a known zero is a real zero.
    render(props({ memberCount: 23, roster: complete }));
    expect(text('wsf-parity-fact-members')).toBe('Members23');
    expect(text('wsf-parity-roster-count')).toBe('23 people');
    expect(text('wsf-parity-anonymous')).toContain('21 members shown without names');
    for (const zero of [0, -0]) {
      render(props({ memberCount: zero, roster: { state: 'loaded', value: { named: [], complete: true } } }));
      expect(text('wsf-parity-fact-members'), String(zero)).toBe('Members0');
      expect(text('wsf-parity-roster-count'), String(zero)).toBe('0 people');
    }
  });

  it('a failed roster read keeps its heading, says so, and retries only the roster', () => {
    const p = render(props({ roster: { state: 'failed' } }));
    expect(text('wsf-parity-roster-count')).toBe('23 people');
    expect(text('wsf-parity-roster-failed')).toContain('Members couldn’t be loaded just now.');
    expect(byId('wsf-parity-anonymous')).toBeNull();
    click('wsf-parity-roster-failed-retry');
    expect(p.onRetryRoster).toHaveBeenCalledTimes(1);
    expect(p.onRetryGoals).not.toHaveBeenCalled();
  });

  it('a failed communities read is not "you belong to none": it says so and retries', () => {
    const p = render(props({ communities: { state: 'failed' } }));
    expect(container.querySelectorAll('[data-testid^="wsf-parity-chip-"]')).toHaveLength(0);
    expect(text('wsf-parity-communities-failed')).toContain('Your communities couldn’t be loaded just now.');
    expect(byId('wsf-parity-join')).not.toBeNull();
    click('wsf-parity-communities-failed-retry');
    expect(p.onRetryCommunities).toHaveBeenCalledTimes(1);
    render(props({ communities: { state: 'loading' } }));
    expect(byId('wsf-parity-communities-loading')).not.toBeNull();
  });

  it('keeps a failed history read apart from "no past goals"', () => {
    render(props({ history: { state: 'loaded', value: [] } }));
    expect(text('wsf-parity-history-empty')).toBe('No past goals yet.');
    const p = render(props({ history: { state: 'failed' } }));
    expect(byId('wsf-parity-history-failed')).not.toBeNull();
    expect(byId('wsf-parity-history-empty')).toBeNull();
    expect(text('wsf-parity-history')).not.toContain('No past goals');
    expect(text('wsf-parity-fact-goals')).toBe('Goals—');
    click('wsf-parity-history-failed-retry');
    expect(p.onRetryHistory).toHaveBeenCalledTimes(1);
  });

  it('renders no history rows, and no goal count, when history is not part of the read', () => {
    render(props({ history: { state: 'unavailable' } }));
    expect(byId('wsf-parity-history')).toBeNull();
    expect(text('wsf-parity-fact-goals')).toBe('Goals—');
  });

  it('says there is no active goal, with the Champion or member next step', () => {
    render(props({ goals: { state: 'loaded', value: { featured: null, otherOpen: [] } } }));
    expect(text('wsf-parity-period-title')).toBe('No active goal');
    expect(text('wsf-parity-no-goal')).toContain('Your Champion can start the next goal.');
    expect(byId('wsf-parity-living-we')).toBeNull();
    render(props({ role: 'foundingChampion', goals: { state: 'loaded', value: { featured: null, otherOpen: [] } } }));
    expect(text('wsf-parity-no-goal')).toContain('Set one up from Manage community in the menu.');
    // An unknown role makes no claim about who can start the next goal.
    render(props({ role: null, goals: { state: 'loaded', value: { featured: null, otherOpen: [] } } }));
    expect(text('wsf-parity-no-goal')).toBe('No shared target is being counted.');
  });

  it('labels the other open goals separately from the featured one', () => {
    const other = goal({ goalId: 'g2', title: '150 squats this week', target: 150, total: confirmed(155) });
    render(props({ goals: { state: 'loaded', value: { featured: goal(), otherOpen: [other] } } }));
    expect(byId('wsf-parity-also-open')?.getAttribute('aria-label')).toBe('Also open');
    expect(text('wsf-parity-also-open-g2')).toContain('155 of 150 squats');
    expect(text('wsf-parity-also-open-g2')).toContain('REACHED · STILL OPEN');
    expect(text('wsf-parity-fact-goals')).toBe('Goals4');
  });

  it('never draws Living WE or a number for a total that cannot be confirmed', () => {
    render(props({ goals: { state: 'loaded', value: { featured: goal({ total: { state: 'failed' } }), otherOpen: [] } } }));
    expect(byId('wsf-parity-living-we')).toBeNull();
    expect(byId('wsf-parity-total')).toBeNull();
    expect(text('wsf-parity-period-unknown')).toContain('Progress unknown');
    expect(text('wsf-parity-period-status')).toBe('UNKNOWN');
  });

  it('a loading total says it is loading — not unknown, not zero', () => {
    render(props({ goals: { state: 'loaded', value: { featured: goal({ total: { state: 'loading' } }), otherOpen: [] } } }));
    expect(byId('wsf-parity-living-we')).toBeNull();
    expect(text('wsf-parity-period-unknown')).toContain('Loading the total…');
    expect(text('wsf-parity-period-unknown')).not.toContain('can’t confirm');
    expect(text('wsf-parity-period-status')).toBe('OPEN');
  });

  it('a last-known figure is marked last known and never called confirmed', () => {
    render(props({ goals: { state: 'loaded', value: { featured: goal({ total: { state: 'lastKnown', value: 241 } }), otherOpen: [] } } }));
    expect(text('wsf-parity-goal-numbers')).toContain('/ 500 last known');
    expect(text('wsf-parity-goal-numbers')).not.toContain('confirmed');
    expect(text('wsf-parity-goal-numbers')).toContain('Not live');
    expect(text('wsf-parity-period-status')).toBe('LAST KNOWN · NOT LIVE');
  });

  it('the bar can read full only once the goal is reached', () => {
    const almost = goal({ target: 10000, total: confirmed(9996) });
    render(props({ goals: { state: 'loaded', value: { featured: almost, otherOpen: [] } } }));
    const width = (byId('wsf-parity-track-fill') as HTMLElement).style.width;
    expect(parseFloat(width)).toBeLessThan(100);
    render(props({ goals: { state: 'loaded', value: { featured: goal({ total: confirmed(500) }), otherOpen: [] } } }));
    expect((byId('wsf-parity-track-fill') as HTMLElement).style.width).toBe('100%');
  });

  it('read-only rows are plain rows; with onOpenGoal they are buttons whose names carry the figures', () => {
    render(props());
    expect(byId('wsf-parity-history-apr')).not.toBeNull();
    expect(byId('wsf-parity-history-apr')?.getAttribute('role')).toBeNull();
    expect(byId('wsf-parity-history-apr')?.getAttribute('aria-disabled')).toBeNull();
    const onOpenGoal = vi.fn();
    render(props({ onOpenGoal }));
    const featured = byId('wsf-parity-open-featured')!;
    expect(featured.getAttribute('role')).toBe('button');
    expect(featured.getAttribute('aria-label')).toBe(
      'Open 500 squats together. 241 of 500 squats, 48.2% complete',
    );
    expect(byId('wsf-parity-history-apr')?.getAttribute('aria-label')).toBe(
      'Open 1,000 squats in April. 1,024 of 1,000 squats, Closed · reached',
    );
    click('wsf-parity-history-mar');
    expect(onOpenGoal).toHaveBeenCalledWith('mar');
  });

  it('the name is the page heading and each section title is level 2', () => {
    render(props());
    expect(byId('wsf-parity-name')?.tagName).toBe('H1');
    expect(byId('wsf-parity-period-title')?.tagName).toBe('H2');
    expect(byId('wsf-parity-roster-count')?.tagName).toBe('H2');
  });

  it('adds the anonymous remainder only when the visible set is complete', () => {
    render(props());
    expect(byId('wsf-parity-anonymous')).toBeNull();
    expect(byId('wsf-parity-roster-more')).not.toBeNull();
    render(props({ memberCount: 4, roster: { state: 'loaded', value: { named: NAMED, complete: true } } }));
    expect(text('wsf-parity-anonymous')).toContain('2 members shown without names');
    expect(byId('wsf-parity-roster-more')).toBeNull();
  });

  it('only calls callbacks: another community, Join, Start; the current chip does nothing', () => {
    const p = render(props());
    click('wsf-parity-chip-oak');
    expect(p.onSelectCommunity).not.toHaveBeenCalled();
    click('wsf-parity-chip-harbor');
    expect(p.onSelectCommunity).toHaveBeenCalledWith('harbor');
    click('wsf-parity-join');
    click('wsf-parity-start');
    click('wsf-parity-roster-more');
    expect(p.onJoin).toHaveBeenCalledTimes(1);
    expect(p.onStart).toHaveBeenCalledTimes(1);
    expect(p.onShowMoreMembers).toHaveBeenCalledTimes(1);
  });

  it('adds no sample community to the chip row', () => {
    render(props({ communities: { state: 'loaded', value: [{ groupId: 'oak', displayName: 'Oak Grove Together' }] } }));
    const chips = container.querySelectorAll('[data-testid^="wsf-parity-chip-"]');
    expect(chips).toHaveLength(1);
  });
});
