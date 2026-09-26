import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  privacyConsequence,
  privacySaveErrorCopy,
  type CommunityPrivacyPanelProps,
  type PrivacyCommunity,
} from '../src/ui/communityParityTypes';
import { CommunityPrivacyPanelView } from '../src/ui/CommunityPrivacyPanelView';

/**
 * COMMUNITY-PRESENTATION-ACCELERATOR-1: the privacy panel and W7 Check 43's
 * failure contract (measured on `0b460ce3`):
 *   - no optimistic privacy: a press asks, and the switch waits for the store
 *   - the stored value is authoritative: the switch shows only what is stored
 *   - a save error stays visible after a re-read, until Retry or a new action
 *   - reply-lost-after-write and a membership refusal each have their words
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
const checked = (id: string) => byId(id)?.getAttribute('aria-checked');
function click(id: string) {
  const el = byId(id);
  expect(el, `${id} is not on screen`).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const OAK: PrivacyCommunity = {
  groupId: 'oak',
  displayName: 'Oak Grove Together',
  stored: { name: 'visible', activity: 'visible' },
  saving: null,
  saveError: null,
};

function props(communities: PrivacyCommunity[], over: Partial<CommunityPrivacyPanelProps> = {}) {
  return {
    load: 'ready' as const,
    communities,
    onChange: vi.fn(),
    onRetrySave: vi.fn(),
    onRetryLoad: vi.fn(),
    ...over,
  };
}
function render(p: CommunityPrivacyPanelProps) {
  act(() => root.render(<CommunityPrivacyPanelView {...p} />));
  return p;
}

describe('no optimistic privacy', () => {
  it('a press asks for the other value and the switch stays on the stored one', () => {
    const p = render(props([OAK]));
    expect(checked('wsf-privacy-panel-name-oak')).toBe('true');
    click('wsf-privacy-panel-name-oak');
    expect(p.onChange).toHaveBeenCalledWith('oak', 'name', 'private');
    // Nothing stored has changed, so nothing on screen has either.
    expect(checked('wsf-privacy-panel-name-oak')).toBe('true');
    click('wsf-privacy-panel-activity-oak');
    expect(p.onChange).toHaveBeenLastCalledWith('oak', 'activity', 'private');
    expect(checked('wsf-privacy-panel-activity-oak')).toBe('true');
  });

  it('shows exactly the stored pair, and its consequence in the feed’s words', () => {
    render(props([{ ...OAK, stored: { name: 'private', activity: 'visible' } }]));
    expect(checked('wsf-privacy-panel-name-oak')).toBe('false');
    expect(checked('wsf-privacy-panel-activity-oak')).toBe('true');
    expect(text('wsf-privacy-panel-note-oak')).toContain('“Anonymous member.”');
    expect(privacyConsequence({ name: 'private', activity: 'private' })).toContain('You are not listed');
    expect(privacyConsequence({ name: 'visible', activity: 'visible' })).toBeNull();
  });

  it('while saving, both switches refuse a second press and say so', () => {
    const p = render(props([{ ...OAK, saving: 'name' }]));
    click('wsf-privacy-panel-name-oak');
    click('wsf-privacy-panel-activity-oak');
    expect(p.onChange).not.toHaveBeenCalled();
    expect(text('wsf-privacy-panel-name-oak')).toContain('Saving…');
    expect(byId('wsf-privacy-panel-name-oak')?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('a failed save stays said', () => {
  it('survives a re-read of the stored values, with the switch on the stored value', () => {
    const failed = { ...OAK, stored: { name: 'private' as const, activity: 'visible' as const }, saveError: 'notSaved' as const };
    const p = render(props([failed]));
    expect(text('wsf-privacy-panel-error-oak')).toContain('That change wasn’t saved.');
    expect(checked('wsf-privacy-panel-name-oak')).toBe('false');
    // The route re-reads; the store answers the same value. The error is the
    // route's to keep, and this view never clears it.
    render({ ...p, communities: [{ ...failed }] });
    expect(byId('wsf-privacy-panel-error-oak')).not.toBeNull();
    expect(checked('wsf-privacy-panel-name-oak')).toBe('false');
    click('wsf-privacy-panel-retry-oak');
    expect(p.onRetrySave).toHaveBeenCalledWith('oak');
  });

  it('explains a reply lost after the write landed, and follows the re-read’s stored value', () => {
    // Before the re-read: the switch shows the value stored before the save.
    const p = render(props([{ ...OAK, stored: { name: 'private', activity: 'visible' }, saveError: 'unconfirmed' }]));
    expect(text('wsf-privacy-panel-error-oak')).toContain('We couldn’t confirm that change.');
    expect(checked('wsf-privacy-panel-name-oak')).toBe('false');
    // The re-read finds the write DID land: the switch moves to the stored
    // value, and the explanation stays until Retry or a new action.
    render({ ...p, communities: [{ ...OAK, stored: { name: 'visible', activity: 'visible' }, saveError: 'unconfirmed' }] });
    expect(checked('wsf-privacy-panel-name-oak')).toBe('true');
    expect(byId('wsf-privacy-panel-error-oak')).not.toBeNull();
    // A new action from here is the member's to make.
    click('wsf-privacy-panel-name-oak');
    expect(p.onChange).toHaveBeenCalledWith('oak', 'name', 'private');
  });

  it('keeps the save error on screen while the re-read is loading, and when it fails', () => {
    const failed = { ...OAK, saveError: 'notSaved' as const };
    const p = render(props([failed, { ...OAK, groupId: 'harbor', displayName: 'Harbor Lunch Crew' }]));
    render({ ...p, load: 'loading' });
    expect(text('wsf-privacy-panel-error-oak')).toContain('That change wasn’t saved.');
    // No switch while no stored value can be vouched for; the other community,
    // with nothing to say, is not drawn.
    expect(byId('wsf-privacy-panel-name-oak')).toBeNull();
    expect(byId('wsf-privacy-panel-block-harbor')).toBeNull();
    render({ ...p, load: 'failed' });
    expect(byId('wsf-privacy-panel-load-failed')).not.toBeNull();
    expect(text('wsf-privacy-panel-error-oak')).toContain('That change wasn’t saved.');
    click('wsf-privacy-panel-retry-oak');
    expect(p.onRetrySave).toHaveBeenCalledWith('oak');
    render({ ...p, load: 'ready' });
    expect(byId('wsf-privacy-panel-error-oak')).not.toBeNull();
    expect(checked('wsf-privacy-panel-name-oak')).toBe('true');
  });

  it('explains a membership refusal and offers no switch or retry that cannot work', () => {
    render(props([{ ...OAK, saveError: 'membershipRefused' }]));
    expect(text('wsf-privacy-panel-error-oak')).toBe(
      privacySaveErrorCopy('membershipRefused', 'Oak Grove Together'),
    );
    expect(byId('wsf-privacy-panel-name-oak')).toBeNull();
    expect(byId('wsf-privacy-panel-activity-oak')).toBeNull();
    expect(byId('wsf-privacy-panel-retry-oak')).toBeNull();
  });

  it('keeps each community’s error to that community', () => {
    const harbor = { ...OAK, groupId: 'harbor', displayName: 'Harbor Lunch Crew' };
    render(props([{ ...OAK, saveError: 'notSaved' }, harbor]));
    expect(byId('wsf-privacy-panel-error-oak')).not.toBeNull();
    expect(byId('wsf-privacy-panel-error-harbor')).toBeNull();
  });
});

describe('the switch pattern on web', () => {
  const key = (id: string, k: string) => {
    act(() => {
      byId(id)!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });
  };

  it('Space asks for the change, like a click; not while saving', () => {
    const p = render(props([OAK]));
    key('wsf-privacy-panel-name-oak', ' ');
    expect(p.onChange).toHaveBeenCalledWith('oak', 'name', 'private');
    expect(checked('wsf-privacy-panel-name-oak')).toBe('true');
    const q = render(props([{ ...OAK, saving: 'activity' }]));
    key('wsf-privacy-panel-name-oak', ' ');
    expect(q.onChange).not.toHaveBeenCalled();
  });

  it('the hint is the switch’s description, and "Saving…" is announced politely', () => {
    render(props([{ ...OAK, saving: 'name' }]));
    const sw = byId('wsf-privacy-panel-name-oak')!;
    const hint = byId('wsf-privacy-panel-name-oak-hint')!;
    expect(sw.getAttribute('aria-describedby')).toBe(hint.id);
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(hint.textContent).toBe('Saving…');
  });

  it('each accessible name starts with the words on screen', () => {
    render(props([{ ...OAK, saveError: 'notSaved' }]));
    expect(byId('wsf-privacy-panel-name-oak')?.getAttribute('aria-label')).toBe(
      'Show my name and initials in Oak Grove Together',
    );
    expect(byId('wsf-privacy-panel-activity-oak')?.getAttribute('aria-label')).toBe(
      'Show my individual activity in Oak Grove Together',
    );
    expect(byId('wsf-privacy-panel-retry-oak')?.getAttribute('aria-label')).toBe(
      'Try again to save Oak Grove Together',
    );
  });

  it('shows the member’s own name in the hint when the route passes it', () => {
    render(props([{ ...OAK, shownName: 'Alex M.' }]));
    expect(text('wsf-privacy-panel-name-oak-hint')).toBe('Members see “Alex M.”');
  });
});

describe('load states', () => {
  it('a failed load says so and retries; nothing is drawn as a setting', () => {
    const p = render(props([OAK], { load: 'failed' }));
    expect(byId('wsf-privacy-panel-load-failed')).not.toBeNull();
    expect(byId('wsf-privacy-panel-name-oak')).toBeNull();
    click('wsf-privacy-panel-load-retry');
    expect(p.onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it('no communities yet reads as such', () => {
    render(props([]));
    expect(byId('wsf-privacy-panel-none')).not.toBeNull();
  });
});
