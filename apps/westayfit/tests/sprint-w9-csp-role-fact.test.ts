import { describe, expect, it } from 'vitest';

import { roleLabel } from '../src/labels';
import { roleFact } from '../src/ui/communityParityTypes';

/** COMMUNITY-SETTINGS-PARITY-1 (Director #506 `5845751705`): the member-facing role. */
describe('the Community banner role fact', () => {
  it('reads "Champion" for a founding Champion, as in the frozen reference', () => {
    expect(roleFact('foundingChampion')).toBe('Champion');
  });
  it('keeps every other role, and unknown stays unknown', () => {
    expect(roleFact('coChampion')).toBe('Co-Champion');
    expect(roleFact('member')).toBe('Member');
    expect(roleFact(null)).toBeNull();
  });
  it('does not change the wider role label', () => {
    expect(roleLabel('foundingChampion')).toBe('Founding Champion');
  });
});
