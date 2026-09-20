import { describe, expect, it, beforeEach } from 'vitest';

import { forgetCurrentCommunity, rememberCurrentCommunity, resolveCurrentCommunity } from '../src/currentCommunity';

describe('which community Home opens', () => {
  beforeEach(() => window.localStorage.clear());

  it('opens nothing when the member is in nothing', () => {
    expect(resolveCurrentCommunity('u1', [])).toBeNull();
  });

  it('opens the only community without needing to remember anything', () => {
    expect(resolveCurrentCommunity('u1', ['g1'])).toBe('g1');
  });

  it('asks rather than guesses when there are several and none was opened', () => {
    expect(resolveCurrentCommunity('u1', ['g1', 'g2'])).toBeNull();
  });

  it('opens the one last opened', () => {
    rememberCurrentCommunity('u1', 'g2');
    expect(resolveCurrentCommunity('u1', ['g1', 'g2'])).toBe('g2');
  });

  it('discards a remembered community the member has left', () => {
    rememberCurrentCommunity('u1', 'g2');
    // They are no longer in g2. Opening it would show a refusal, so it is
    // dropped and the single remaining community wins.
    expect(resolveCurrentCommunity('u1', ['g1'])).toBe('g1');
  });

  it('never hands one account the other account’s community', () => {
    rememberCurrentCommunity('u1', 'g2');
    expect(resolveCurrentCommunity('u2', ['g1', 'g2'])).toBeNull();
  });

  it('forgets on request, so signing out does not leave a trail', () => {
    rememberCurrentCommunity('u1', 'g2');
    forgetCurrentCommunity('u1');
    expect(resolveCurrentCommunity('u1', ['g1', 'g2'])).toBeNull();
  });

  it('ignores an empty id rather than storing one', () => {
    rememberCurrentCommunity('u1', '');
    expect(resolveCurrentCommunity('u1', ['g1', 'g2'])).toBeNull();
  });
});
