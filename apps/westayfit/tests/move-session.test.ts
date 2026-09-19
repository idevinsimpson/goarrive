import { describe, expect, it } from 'vitest';

import {
  MOVE_ATTEMPT_PARAM,
  mintMoveRoundId,
  moveAttemptIdFor,
  moveBackHref,
  moveHandoffHref,
  moveHandoffUrl,
  readActivityLabel,
  readMoveRoundId,
  readReturnPath,
} from '../src/moveSession';

/** The exact shape wsfContribute accepts, copied from normalizeAttemptId(). */
const SERVER_ATTEMPT = /^[A-Za-z0-9_-]{8,128}$/;

describe('mintMoveRoundId', () => {
  it('produces an id the server would accept as an attempt id on its own', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = mintMoveRoundId();
      expect(readMoveRoundId(id)).toBe(id);
      expect(SERVER_ATTEMPT.test(id)).toBe(true);
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => mintMoveRoundId()));
    expect(ids.size).toBe(200);
  });
});

describe('readMoveRoundId', () => {
  it('accepts an ordinary minted id and refuses anything else', () => {
    expect(readMoveRoundId('mvabc123def456')).toBe('mvabc123def456');
    expect(readMoveRoundId('  mvabc123def456 ')).toBe('mvabc123def456');
    for (const bad of [null, undefined, 42, '', 'short', '../../etc', 'has space', 'a'.repeat(65)]) {
      expect(readMoveRoundId(bad)).toBeNull();
    }
  });
});

// ONE ROUND, ONE ATTEMPT, PER PERSON. The same round finished on a phone and
// at a station is one attemptId, so wsfContribute records it once. Two
// different people who scanned the same panel are two different attempt ids,
// so neither can overwrite the other's recent-additions document — the server
// names that document by the attempt id alone, with no uid in the path.
describe('moveAttemptIdFor', () => {
  const round = 'mvabc123def456';

  it('is the same for one person on two devices', () => {
    expect(moveAttemptIdFor(round, 'uidAAAAAAAA')).toBe(
      moveAttemptIdFor(round, 'uidAAAAAAAA')
    );
  });

  it('differs between two people who share a round id', () => {
    expect(moveAttemptIdFor(round, 'uidAAAAAAAA')).not.toBe(
      moveAttemptIdFor(round, 'uidBBBBBBBB')
    );
  });

  it('differs between two rounds by the same person', () => {
    expect(moveAttemptIdFor('mvround0000001', 'uidAAAAAAAA')).not.toBe(
      moveAttemptIdFor('mvround0000002', 'uidAAAAAAAA')
    );
  });

  it('always produces something the server will accept', () => {
    const id = moveAttemptIdFor(round, 'K2mXqZ7bTfVwLp9RsN4dCjHg1uYe');
    expect(id).not.toBeNull();
    expect(SERVER_ATTEMPT.test(id as string)).toBe(true);
  });

  it('is null when either half is missing or malformed, so the caller mints its own', () => {
    expect(moveAttemptIdFor(null, 'uidAAAAAAAA')).toBeNull();
    expect(moveAttemptIdFor(undefined, 'uidAAAAAAAA')).toBeNull();
    expect(moveAttemptIdFor('nope', 'uidAAAAAAAA')).toBeNull();
    expect(moveAttemptIdFor(round, null)).toBeNull();
    expect(moveAttemptIdFor(round, '')).toBeNull();
    expect(moveAttemptIdFor(round, 'has space')).toBeNull();
  });
});

describe('moveHandoffHref', () => {
  it('lands on the existing contribute screen at its ordinary entry step', () => {
    const href = moveHandoffHref({ goalId: 'goal-1', roundId: 'mvabc123def456' });
    expect(href.startsWith('/contribute/goal-1?')).toBe(true);
    expect(href).toContain(`${MOVE_ATTEMPT_PARAM}=mvabc123def456`);
    // Not the contribute screen's own movement step, and never a kiosk
    // session: starting one of those is not this screen's to do.
    expect(href).not.toContain('mode=');
    expect(href).not.toContain('kiosk=');
  });

  it('carries the community hint when the caller had one', () => {
    expect(moveHandoffHref({ goalId: 'g', roundId: 'mvabc123def456', groupId: 'grp' })).toContain(
      'groupId=grp'
    );
    expect(moveHandoffHref({ goalId: 'g', roundId: 'mvabc123def456' })).not.toContain('groupId');
  });

  it('is still a usable link before a round has been started', () => {
    expect(moveHandoffHref({ goalId: 'g', roundId: null })).toBe('/contribute/g');
  });

  it('carries no count, no elapsed time and nothing that could become credit', () => {
    const href = moveHandoffHref({ goalId: 'g', roundId: 'mvabc123def456', groupId: 'grp' });
    for (const forbidden of ['count', 'reps', 'elapsed', 'seconds', 'credit', 'total']) {
      expect(href.includes(forbidden), `handoff carries "${forbidden}"`).toBe(false);
    }
  });

  it('escapes a goal id rather than letting it become a path', () => {
    expect(moveHandoffHref({ goalId: 'a/b', roundId: null })).toBe('/contribute/a%2Fb');
  });
});

describe('moveHandoffUrl', () => {
  it('is the absolute form of the same address, for a QR on a station panel', () => {
    expect(
      moveHandoffUrl({ origin: 'https://wsf.example/', goalId: 'g', roundId: 'mvabc123def456' })
    ).toBe('https://wsf.example/contribute/g?attempt=mvabc123def456');
  });

  it('is null with no origin or no goal, so no QR is drawn from a guess', () => {
    expect(moveHandoffUrl({ origin: null, goalId: 'g', roundId: 'mvabc123def456' })).toBeNull();
    expect(moveHandoffUrl({ origin: 'https://x', goalId: '', roundId: 'mvabc123def456' })).toBeNull();
  });
});

// THE RETURN PATH IS INSIDE THIS APP OR IT IS NOT A RETURN PATH.
describe('readReturnPath', () => {
  it('accepts an ordinary internal path, with a query', () => {
    expect(readReturnPath('/event/goal-1')).toBe('/event/goal-1');
    expect(readReturnPath('/community/grp?tab=goals')).toBe('/community/grp?tab=goals');
    expect(readReturnPath('/')).toBe('/');
  });

  it('refuses anything that could leave this app', () => {
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      'javascript:alert(1)',
      '/\\evil.example',
      'event/goal-1',
      '',
      null,
      undefined,
      7,
      `/${'x'.repeat(600)}`,
    ]) {
      expect(readReturnPath(bad), `accepted ${String(bad)}`).toBeNull();
    }
  });
});

describe('moveBackHref', () => {
  it('prefers the preserved return path', () => {
    expect(moveBackHref({ from: '/event/g1', eventGoalId: 'g2', groupId: 'grp' })).toBe('/event/g1');
  });

  it('falls back to the event, then the community, then home', () => {
    expect(moveBackHref({ from: 'https://evil.example', eventGoalId: 'g2' })).toBe('/event/g2');
    expect(moveBackHref({ groupId: 'grp' })).toBe('/community/grp');
    expect(moveBackHref({})).toBe('/');
  });
});

describe('readActivityLabel', () => {
  it('keeps the goal’s own word for what is counted', () => {
    expect(readActivityLabel(' squats ')).toBe('squats');
    expect(readActivityLabel('push-ups')).toBe('push-ups');
  });

  it('refuses nothing-at-all and anything absurdly long', () => {
    expect(readActivityLabel('')).toBeNull();
    expect(readActivityLabel('   ')).toBeNull();
    expect(readActivityLabel('x'.repeat(65))).toBeNull();
    expect(readActivityLabel(12)).toBeNull();
  });

  it('strips control characters rather than rendering them', () => {
    expect(readActivityLabel('sq\u0000uats')).toBe('squats');
  });
});
