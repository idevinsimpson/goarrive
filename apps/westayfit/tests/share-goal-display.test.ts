import { describe, expect, it } from 'vitest';

import { communityMomentumLine } from '../src/communityMomentum';
import {
  canShareGoalDisplay,
  displayShareUrl,
  shareControlLabel,
  shareRoute,
  SHARE_DISCLOSURE,
} from '../src/shareGoalDisplay';

describe('displayShareUrl — what is actually shared', () => {
  it('is the public display route on the origin the member is already on', () => {
    expect(displayShareUrl('https://app.westay.fit', 'goal-123')).toBe(
      'https://app.westay.fit/display/goal-123'
    );
  });

  it('never doubles a slash when the origin carries a trailing one', () => {
    expect(displayShareUrl('https://app.westay.fit/', 'goal-123')).toBe(
      'https://app.westay.fit/display/goal-123'
    );
  });

  it('keeps a port, which staging and local origins carry', () => {
    expect(displayShareUrl('http://127.0.0.1:8081', 'g1')).toBe('http://127.0.0.1:8081/display/g1');
  });

  it('escapes the goal id rather than pasting it into a path', () => {
    expect(displayShareUrl('https://app.westay.fit', 'a b/c?d')).toBe(
      'https://app.westay.fit/display/a%20b%2Fc%3Fd'
    );
  });

  it('returns null rather than a half-built URL', () => {
    // No origin (server render, native), no id, and anything that is not an
    // absolute http(s) origin. A guess here would be a link that resolves
    // somewhere the member did not intend.
    expect(displayShareUrl(null, 'g1')).toBeNull();
    expect(displayShareUrl(undefined, 'g1')).toBeNull();
    expect(displayShareUrl('', 'g1')).toBeNull();
    expect(displayShareUrl('https://app.westay.fit', '')).toBeNull();
    expect(displayShareUrl('https://app.westay.fit', '   ')).toBeNull();
    expect(displayShareUrl('https://app.westay.fit', null)).toBeNull();
    expect(displayShareUrl('app.westay.fit', 'g1')).toBeNull();
    expect(displayShareUrl('https://app.westay.fit/community/x', 'g1')).toBeNull();
    expect(displayShareUrl('javascript:alert(1)', 'g1')).toBeNull();
  });
});

describe('canShareGoalDisplay — nothing unpublished is shareable', () => {
  it('allows only an authorized goal', () => {
    expect(canShareGoalDisplay({ aggregateDisplayAuthorized: true }, { isSample: false })).toBe(true);
    expect(canShareGoalDisplay({ aggregateDisplayAuthorized: false }, { isSample: false })).toBe(false);
    expect(canShareGoalDisplay({}, { isSample: false })).toBe(false);
    expect(canShareGoalDisplay(null, { isSample: false })).toBe(false);
  });

  it('refuses a sample community, whose display shows nothing whatever the permission says', () => {
    expect(canShareGoalDisplay({ aggregateDisplayAuthorized: true }, { isSample: true })).toBe(false);
  });

  it('treats a missing isSample as not-sample, matching the loaded group shape', () => {
    expect(canShareGoalDisplay({ aggregateDisplayAuthorized: true }, {})).toBe(true);
  });
});

describe('shareRoute — the fallback decision', () => {
  it('prefers the Web Share API when the browser has it', () => {
    expect(shareRoute({ share: () => Promise.resolve(), clipboard: { writeText: () => {} } })).toBe(
      'webShare'
    );
  });

  it('falls back to the clipboard when share is absent', () => {
    expect(shareRoute({ clipboard: { writeText: () => {} } })).toBe('clipboard');
  });

  it('is unavailable when neither exists, so no control is drawn', () => {
    expect(shareRoute({})).toBe('unavailable');
    expect(shareRoute({ clipboard: null })).toBe('unavailable');
    expect(shareRoute({ clipboard: {} })).toBe('unavailable');
    expect(shareRoute(null)).toBe('unavailable');
    expect(shareRoute(undefined)).toBe('unavailable');
  });

  it('does not accept a non-callable `share` property as the Web Share API', () => {
    expect(shareRoute({ share: true, clipboard: { writeText: () => {} } })).toBe('clipboard');
    expect(shareRoute({ share: true })).toBe('unavailable');
  });
});

describe('shareControlLabel', () => {
  it('leaves the explanation to the share sheet in the Web Share route', () => {
    expect(shareControlLabel('webShare', 'idle')).toBe('Share');
    expect(shareControlLabel('webShare', 'copied')).toBe('Share');
  });

  it('says what it does, and confirms with the same "Copied" as the invite control', () => {
    expect(shareControlLabel('clipboard', 'idle')).toBe('Copy display link');
    expect(shareControlLabel('clipboard', 'copied')).toBe('Copied');
    expect(shareControlLabel('clipboard', 'failed')).toBe('Copy failed — try again');
  });
});

describe('SHARE_DISCLOSURE', () => {
  it('states both halves of the privacy contract, verbatim', () => {
    expect(SHARE_DISCLOSURE).toBe(
      'Anyone with this link can see the shared progress — never who contributed.'
    );
  });
});

describe('communityMomentumLine — counts goals, never people', () => {
  const ok = (reached: boolean) => ({ confirmed: true, reached });

  it('rolls up the open goals once every one of them is confirmed', () => {
    expect(communityMomentumLine([ok(true), ok(false)])).toBe('1 of 2 open goals reached together.');
    expect(communityMomentumLine([ok(false), ok(false), ok(false)])).toBe(
      '0 of 3 open goals reached together.'
    );
    expect(communityMomentumLine([ok(true), ok(true)])).toBe('2 of 2 open goals reached together.');
  });

  it('says nothing at all when a goal has not answered', () => {
    // A count over the subset that happened to answer would read as a count
    // over all of them. A failed read is not zero progress.
    expect(communityMomentumLine([ok(true), { confirmed: false, reached: false }])).toBeNull();
  });

  it('says nothing for fewer than two open goals, which the hero already states', () => {
    expect(communityMomentumLine([])).toBeNull();
    expect(communityMomentumLine([ok(true)])).toBeNull();
  });
});
