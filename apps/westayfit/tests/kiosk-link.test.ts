import { describe, expect, it } from 'vitest';

import { buildKioskUrl } from '../src/ui/kioskLink';

describe('buildKioskUrl', () => {
  it('builds the address a kiosk screen opens', () => {
    expect(buildKioskUrl({ origin: 'https://example.web.app', goalId: 'goal-1' })).toBe(
      'https://example.web.app/kiosk/goal-1'
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(buildKioskUrl({ origin: 'https://example.web.app/', goalId: 'goal-1' })).toBe(
      'https://example.web.app/kiosk/goal-1'
    );
    expect(buildKioskUrl({ origin: 'https://example.web.app///', goalId: 'goal-1' })).toBe(
      'https://example.web.app/kiosk/goal-1'
    );
  });

  // A link is either correct or absent. A half-built one would be copied,
  // pasted onto a kiosk at an event, and fail there rather than here.
  it('returns nothing rather than a broken link', () => {
    expect(buildKioskUrl({ origin: null, goalId: 'goal-1' })).toBeNull();
    expect(buildKioskUrl({ origin: undefined, goalId: 'goal-1' })).toBeNull();
    expect(buildKioskUrl({ origin: '', goalId: 'goal-1' })).toBeNull();
    expect(buildKioskUrl({ origin: 'https://example.web.app', goalId: null })).toBeNull();
    expect(buildKioskUrl({ origin: 'https://example.web.app', goalId: '   ' })).toBeNull();
  });

  it('escapes an id so the path cannot be steered by it', () => {
    expect(buildKioskUrl({ origin: 'https://example.web.app', goalId: 'a/../b' })).toBe(
      'https://example.web.app/kiosk/a%2F..%2Fb'
    );
  });
});
