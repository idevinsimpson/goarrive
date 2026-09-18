import { describe, expect, it } from 'vitest';

import {
  classifyContributeError,
  parseEntry,
  refusalCopy,
  resultCopy,
  resultVariant,
  stepEntry,
} from '../src/contributionFlow';

describe('entry: only a whole number from 1 to 100,000 becomes a submission', () => {
  it.each([
    ['', false],
    ['  ', false],
    ['0', false],
    ['-5', false],
    ['1.5', false],
    ['abc', false],
    ['100001', false],
    ['1', true],
    ['20', true],
    [' 20 ', true],
    ['100000', true],
  ])('%j → ok=%s', (text, ok) => {
    expect(parseEntry(text).ok).toBe(ok);
  });

  it('returns the parsed count', () => {
    const r = parseEntry('20');
    expect(r).toEqual({ ok: true, count: 20 });
  });

  it('steps with +/− and clamps at 0 and the maximum', () => {
    expect(stepEntry('', 1)).toBe('1');
    expect(stepEntry('20', 1)).toBe('21');
    expect(stepEntry('20', -1)).toBe('19');
    expect(stepEntry('0', -1)).toBe('0');
    expect(stepEntry('abc', 10)).toBe('10');
    expect(stepEntry('100000', 5)).toBe('100000');
  });
});

describe('a callable error is a definitive refusal or an unknown outcome', () => {
  it('treats closed, window and membership refusals as definitive', () => {
    expect(classifyContributeError({ code: 'functions/failed-precondition', message: 'This goal is closed.' })).toEqual({ kind: 'refused', reason: 'closed' });
    expect(classifyContributeError({ code: 'functions/failed-precondition', message: 'Goal has not started yet.' })).toEqual({ kind: 'refused', reason: 'notStarted' });
    expect(classifyContributeError({ code: 'functions/failed-precondition', message: 'Goal window has ended.' })).toEqual({ kind: 'refused', reason: 'windowEnded' });
    expect(classifyContributeError({ code: 'functions/permission-denied', message: 'Members only.' })).toEqual({ kind: 'refused', reason: 'notMember' });
    expect(classifyContributeError({ code: 'functions/not-found', message: 'Goal not found.' })).toEqual({ kind: 'refused', reason: 'notFound' });
    expect(classifyContributeError({ code: 'functions/unauthenticated', message: 'Sign in first.' })).toEqual({ kind: 'refused', reason: 'signedOut' });
    expect(classifyContributeError({ code: 'functions/invalid-argument', message: 'count' })).toEqual({ kind: 'refused', reason: 'invalid' });
  });

  it('keeps every other failure unknown, so the attempt keeps its identity', () => {
    for (const e of [
      { code: 'functions/unavailable', message: 'unavailable' },
      { code: 'functions/deadline-exceeded', message: 'deadline' },
      { code: 'functions/internal', message: 'Contribution record mismatch.' },
      new TypeError('Failed to fetch'),
      'string error',
      null,
      undefined,
    ]) {
      expect(classifyContributeError(e).kind).toBe('unknown');
    }
  });

  it('names what was not recorded in every refusal', () => {
    for (const reason of ['closed', 'windowEnded', 'notStarted', 'notMember', 'notFound', 'signedOut', 'invalid'] as const) {
      const c = refusalCopy(reason, 20, 'squats');
      expect(c.body).toContain('20 squats were not recorded');
      expect(c.headline.length).toBeGreaterThan(0);
    }
    expect(refusalCopy('closed', 20, 'squats').headline).toBe('This goal is no longer accepting contributions.');
    expect(refusalCopy('notMember', 20, 'squats').headline).toBe('This contribution can’t be recorded from this account.');
    // Non-enumerating: the not-found copy does not say which of the reasons applies.
    expect(refusalCopy('notFound', 20, 'squats').body).not.toMatch(/member|group|permission/i);
  });
});

describe('the confirmed result never credits someone else’s work to this member', () => {
  const base = { ownCredit: 20, alreadyRecorded: false, unit: 'squats', status: 'active' as const };

  it('is ordinary below the target', () => {
    const r = { ...base, addedCount: 20, sharedTotal: 261, target: 500 };
    expect(resultVariant(r, 241)).toBe('ordinary');
    const c = resultCopy(r, 'Smyrna Strong', null, 241);
    expect(c.headline).toBe('You added 20 squats.');
    expect(c.subline).toBe('You moved us closer.');
    expect(c.standing).toBe('Smyrna Strong is now at 261 of 500 squats.');
  });

  it('under concurrency reports the current total without assigning the difference', () => {
    // Someone else's 15 landed too. The member added 20; the total is 276.
    const r = { ...base, addedCount: 20, sharedTotal: 276, target: 500 };
    const c = resultCopy(r, 'Smyrna Strong', null, 241);
    expect(c.headline).toBe('You added 20 squats.');
    expect(c.standing).toBe('Smyrna Strong is now at 276 of 500 squats.');
    expect(JSON.stringify(c)).not.toMatch(/241|→|35 /);
  });

  it('never claims a crossing from sharedTotal - addedCount', () => {
    // target 500, member added 20, current total 510. Before this member the
    // confirmed total they saw was 470; another member's 20 may have landed
    // in between, so nothing may say THIS member crossed the target.
    const r = { ...base, addedCount: 20, sharedTotal: 510, target: 500 };
    for (const before of [470, 490, null]) {
      const variant = resultVariant(r, before);
      expect(variant).not.toBe('crossed');
      expect(variant).toBe('reached');
      const c = resultCopy(r, 'Maple Street Movers', null, before);
      const text = JSON.stringify(c);
      expect(text).not.toMatch(/WE did it|you crossed|your contribution (reached|completed)|winning|final rep|closer/i);
      expect(c.headline).toBe('You added 20 squats.');
      expect(c.subline).toBe('Our goal is reached.');
      expect(c.standing).toBe(
        'Our goal of 500 squats is reached and still open. Maple Street Movers is now at 510 of 500 squats.'
      );
    }
  });

  it('reads as post-target when the goal was already reached before this member acted', () => {
    const r = { ...base, addedCount: 5, sharedTotal: 515, target: 500 };
    expect(resultVariant(r, 510)).toBe('postTarget');
    expect(resultVariant(r, 500)).toBe('postTarget');
    const c = resultCopy(r, 'Maple Street Movers', null, 510);
    expect(c.headline).toBe('You added 5 squats.');
    // A7: named like every other variant, not a bare "We're".
    expect(c.subline).toBe('Maple Street Movers is now at 515 of 500 squats together.');
    expect(c.standing).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/closer|WE did it/);
  });

  it('exactly at the target reads reached, with the closed wording when closed', () => {
    expect(resultCopy({ ...base, addedCount: 20, sharedTotal: 500, target: 500 }, null, null, 480).standing).toBe(
      'Our goal of 500 squats is reached and still open. We are now at 500 of 500 squats.'
    );
    expect(
      resultCopy({ ...base, addedCount: 20, sharedTotal: 500, target: 500, status: 'closed' }, null, null, 480).standing
    ).toBe('Our goal of 500 squats is reached. We are now at 500 of 500 squats.');
  });

  it('does not invent pluralisation for arbitrary unit strings', () => {
    const c = resultCopy({ ...base, unit: 'minutes of walking', addedCount: 30, sharedTotal: 5010, target: 5000 }, null, null, 4980);
    expect(c.standing).toBe('Our goal of 5,000 minutes of walking is reached and still open. We are now at 5,010 of 5,000 minutes of walking.');
  });

  it('does not celebrate an already-recorded replay', () => {
    const r = { ...base, addedCount: 20, sharedTotal: 261, target: 500, alreadyRecorded: true };
    expect(resultVariant(r, 241)).toBe('alreadyRecorded');
    const c = resultCopy(r, 'Smyrna Strong', null, 241);
    expect(c.headline).toBe('This contribution was already recorded.');
    expect(c.subline).toBe('It counted once.');
    expect(c.standing).toBe('Smyrna Strong is at 261 of 500 squats.');
    expect(JSON.stringify(c)).not.toMatch(/WE did it|closer/);
  });

  it('shows only the member’s own credit when the shared state is withheld', () => {
    const r = { addedCount: 20, ownCredit: 20, alreadyRecorded: false };
    expect(resultVariant(r)).toBe('ownOnly');
    const c = resultCopy(r, null);
    expect(c.headline).toBe('You added 20.');
    expect(c.standing).toBeNull();
    const replay = resultCopy({ addedCount: 20, ownCredit: 34, alreadyRecorded: true }, 'Smyrna Strong', 'squats');
    expect(replay.headline).toBe('This contribution was already recorded.');
    expect(replay.subline).toBe('It counted once.');
    expect(replay.standing).toBeNull();
    expect(JSON.stringify(replay)).not.toMatch(/Smyrna|of 500|WE did it|closer/);
  });

  it('uses a generic subject when the community context is not verified', () => {
    const c = resultCopy({ ...base, addedCount: 20, sharedTotal: 261, target: 500 }, null, null, 241);
    expect(c.standing).toBe('We are now at 261 of 500 squats.');
  });
});
