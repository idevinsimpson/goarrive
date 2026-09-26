import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNKNOWN_SHARED, knownShared } from '../src/goalTruth';
import type { ProgressGoal, ProgressReceipt, ProgressState } from '../src/progressParity';
import { ProgressParityView, type ProgressParityActions } from '../src/ui/ProgressParityView';

/**
 * PROGRESS-PARITY-1: the pure view rendered into jsdom through
 * react-native-web. It proves the reference order, one total per unit, YOURS
 * and SHARED apart, the lifecycle pills, the honest receipt slot, which state
 * body shows, and that every control only calls its callback.
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

const OAK = { communityId: 'oak', community: 'Oak Grove Together' };
const g = (over: Partial<ProgressGoal>): ProgressGoal => ({
  goalId: 'x',
  title: 'Goal',
  ...OAK,
  unit: 'squats',
  yourPart: 1,
  target: 100,
  shared: knownShared(10),
  open: true,
  periodLabel: null,
  ...over,
});
const OAK_500 = g({ goalId: 'oak-500', title: '500 squats together', yourPart: 25, target: 500, shared: knownShared(241) });
const HARBOR_150 = g({
  goalId: 'harbor-150',
  title: '150 squats this week',
  communityId: 'harbor',
  community: 'Harbor Lunch Crew',
  yourPart: 20,
  target: 150,
  shared: knownShared(155),
});
const OAK_AUG = g({ goalId: 'oak-aug', title: '1,000 squats in August', yourPart: 60, target: 1000, shared: knownShared(1024), open: false });
const OAK_JUL = g({ goalId: 'oak-jul', title: '800 squats in July', yourPart: 40, target: 800, shared: knownShared(612), open: false });

const ready = (over: Partial<Extract<ProgressState, { kind: 'ready' }>> = {}): ProgressState => ({
  kind: 'ready',
  memberName: 'Alex M.',
  open: [OAK_500, HARBOR_150],
  finished: [OAK_AUG, OAK_JUL],
  partial: false,
  canStart: true,
  receipts: null,
  ...over,
});

function render(state: ProgressState) {
  const actions: ProgressParityActions = {
    onRetry: vi.fn(),
    onStartMoving: vi.fn(),
    onOpenCommunity: vi.fn(),
    onOpenReceipt: vi.fn(),
  };
  act(() => {
    root.render(<ProgressParityView state={state} actions={actions} />);
  });
  return actions;
}
const click = (id: string) => act(() => byId(id)!.click());

describe('ProgressParityView — populated, in the reference order', () => {
  it('private to you → title → totals → the clarification → receipts → goals', () => {
    render(ready());
    expect(container.textContent).toContain('PRIVATE TO YOU · ALEX M.');
    expect(text('wsf-activity-title')).toBe('Your progress');
    expect(text('wsf-activity-subtitle')).toBe('Your recorded contributions, by goal.');
    expect(before('wsf-activity-title', 'wsf-activity-totals')).toBe(true);
    expect(before('wsf-activity-totals', 'wsf-activity-privacy')).toBe(true);
    expect(before('wsf-activity-privacy', 'wsf-activity-receipts')).toBe(true);
    expect(before('wsf-activity-receipts', 'wsf-activity-goals')).toBe(true);
    expect(container.querySelectorAll('[data-testid="wsf-activity-privacy"]')).toHaveLength(1);
  });

  it('the exact recorded total leads, labelled with its unit', () => {
    render(ready());
    expect(byId('wsf-activity-total-0')!.getAttribute('aria-label')).toBe('145 squats recorded');
    expect(byId('wsf-activity-total-1')).toBeNull();
    expect(text('wsf-activity-summary')).toBe('Across 4 goals in 2 communities. Each unit stays separate.');
  });

  it('unlike units stay two totals and are never added', () => {
    render(
      ready({
        open: [g({ goalId: 'a', unit: 'squats', yourPart: 120 }), g({ goalId: 'b', unit: 'step-ups', yourPart: 45 })],
        finished: [],
      }),
    );
    expect(byId('wsf-activity-total-0')!.getAttribute('aria-label')).toBe('120 squats recorded');
    expect(byId('wsf-activity-total-1')!.getAttribute('aria-label')).toBe('45 step-ups recorded');
    expect(container.textContent).not.toContain('165');
  });

  it('each goal keeps YOURS and SHARED apart, with its lifecycle pill', () => {
    render(ready());
    expect(text('wsf-activity-goal-oak-500-yours')).toBe('YOURS25 squats');
    expect(text('wsf-activity-goal-oak-500-shared')).toBe('SHARED241 / 500 squats');
    expect(text('wsf-activity-goal-oak-500')).toContain('OPEN');
    expect(text('wsf-activity-goal-harbor-150')).toContain('REACHED · STILL OPEN');
    expect(text('wsf-activity-goal-harbor-150')).toContain('Harbor Lunch Crew');
    expect(text('wsf-activity-goal-oak-aug')).toContain('CLOSED · REACHED');
    expect(text('wsf-activity-goal-oak-jul')).toContain('CLOSED · UNFINISHED');
    // No share of the total, no rank, no position.
    expect(text('wsf-activity-goals')).not.toMatch(/%|#\d|your share|of the total/i);
  });

  it('the receipt slot is kept and says no dated receipts exist — no invented rows', () => {
    const actions = render(ready());
    expect(byId('wsf-activity-receipts-unavailable')).not.toBeNull();
    expect(container.querySelector('[data-testid^="wsf-activity-receipt-"]')).toBeNull();
    expect(actions.onOpenReceipt).not.toHaveBeenCalled();
  });

  it('a shared total that did not answer reads Unknown, never zero', () => {
    render(ready({ open: [], finished: [g({ goalId: 'u', open: false, shared: UNKNOWN_SHARED })] }));
    expect(text('wsf-activity-goal-u-shared')).toBe('SHAREDUnknown');
    expect(text('wsf-activity-goal-u')).toContain('CLOSED');
    expect(text('wsf-activity-goal-u')).not.toContain('REACHED');
    expect(text('wsf-activity-goal-u')).not.toContain('UNFINISHED');
  });
});

describe('ProgressParityView — period labels', () => {
  it('shows the period label exactly as given, never re-derived from a date', () => {
    render(ready({ open: [{ ...OAK_500, periodLabel: 'This week' }], finished: [] }));
    expect(text('wsf-activity-goal-oak-500')).toContain('Oak Grove Together · This week');
    render(ready({ open: [{ ...OAK_500, periodLabel: null }], finished: [] }));
    expect(text('wsf-activity-goal-oak-500')).not.toContain('Oak Grove Together ·');
  });
});

describe('ProgressParityView — the receipt contract', () => {
  it('rows from a source draw the reference’s row and only call back', () => {
    const receipts: ProgressReceipt[] = [
      { id: 'r1', amount: 20, unit: 'squats', goalTitle: '500 squats together', community: 'Oak Grove Together', whenLabel: '8 min ago' },
    ];
    const actions = render(ready({ receipts }));
    expect(byId('wsf-activity-receipts-unavailable')).toBeNull();
    expect(text('wsf-activity-receipt-r1')).toContain('+20');
    expect(text('wsf-activity-receipt-r1')).toContain('Oak Grove Together · 8 min ago');
    click('wsf-activity-receipt-r1');
    expect(actions.onOpenReceipt).toHaveBeenCalledWith('r1');
  });
});

describe('ProgressParityView — states', () => {
  it('first eligible: no totals, the clarification, Start moving calls back', () => {
    const actions = render(ready({ open: [], finished: [], canStart: true }));
    expect(byId('wsf-activity-totals')).toBeNull();
    expect(byId('wsf-activity-privacy')).not.toBeNull();
    expect(byId('wsf-activity-empty')!.getAttribute('data-state')).toBe('first-eligible');
    expect(text('wsf-activity-empty')).toContain('Your first contribution will appear here');
    click('wsf-activity-start');
    expect(actions.onStartMoving).toHaveBeenCalledTimes(1);
    expect(byId('wsf-activity-open-community')).toBeNull();
  });

  it('no open goal: no Start moving, Open community calls back', () => {
    const actions = render(ready({ open: [], finished: [], canStart: false }));
    expect(byId('wsf-activity-empty')!.getAttribute('data-state')).toBe('no-open-goal');
    expect(text('wsf-activity-empty')).toContain('No goal is open for contributions');
    expect(byId('wsf-activity-start')).toBeNull();
    click('wsf-activity-open-community');
    expect(actions.onOpenCommunity).toHaveBeenCalledTimes(1);
  });

  it('partial: says so above the lists, counts only what loaded, Retry calls back', () => {
    const actions = render(ready({ finished: [], partial: true }));
    expect(text('wsf-activity-partial')).toContain('This list is partial.');
    expect(byId('wsf-activity-total-0')!.getAttribute('aria-label')).toBe('45 squats recorded');
    expect(before('wsf-activity-partial', 'wsf-activity-rows')).toBe(true);
    click('wsf-activity-partial-retry');
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
  });

  it('partial with nothing loaded claims no "first" contribution', () => {
    render(ready({ open: [], finished: [], partial: true, canStart: true }));
    expect(byId('wsf-activity-partial')).not.toBeNull();
    expect(text('wsf-activity-empty')).not.toContain('Your first contribution');
  });

  it('failure keeps identity, guesses no amount, Retry calls back', () => {
    const actions = render({ kind: 'failed', memberName: 'Alex M.' });
    expect(container.textContent).toContain('PRIVATE TO YOU · ALEX M.');
    expect(byId('wsf-activity-totals')).toBeNull();
    expect(text('wsf-activity-error')).toContain('Your progress couldn’t be loaded');
    expect(text('wsf-activity-error')).toContain('We won’t guess amounts or show them as zero.');
    click('wsf-activity-retry');
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
  });

  it('loading and signed out show no name, no totals and no clarification', () => {
    render({ kind: 'loading' });
    expect(byId('wsf-activity-loading')).not.toBeNull();
    expect(container.textContent).not.toContain('ALEX');
    expect(byId('wsf-activity-privacy')).toBeNull();
    render({ kind: 'signedOut' });
    expect(byId('wsf-activity-signed-out')).not.toBeNull();
    expect(byId('wsf-activity-totals')).toBeNull();
    expect(byId('wsf-activity-privacy')).toBeNull();
  });
});
