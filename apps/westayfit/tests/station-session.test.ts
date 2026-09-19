/**
 * The rules a screen at an event obeys, tested directly.
 *
 * The route module cannot be imported by the harness (a bracketed dynamic
 * path), which is exactly why these rules live in src/stationSession.ts — the
 * same reason src/kioskSession.ts exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearPendingEventGoal,
  clearStationCredential,
  credentialForGoal,
  formatPairingCode,
  isStationSlot,
  normalizePairingCode,
  pairingCodeInputValue,
  readPendingEventGoal,
  readStationCredential,
  routeAfterJoin,
  saveStationCredential,
  setPendingEventGoal,
  STATION_PAIRING_ALPHABET,
  STATION_PAIRING_CODE_LENGTH,
  STATION_SLOTS,
  STATION_STORAGE_KEYS,
} from '../src/stationSession';

const SECRET = 'ZmFrZS1zZWNyZXQtZm9yLXRlc3RzLW9ubHktMDAwMQ';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the pairing code alphabet', () => {
  // A copy of the server's alphabet, deliberately — the client cannot import
  // the functions package. This is the test that keeps the copy honest.
  it('is the 32 characters the server mints from, with the ambiguous ones gone', () => {
    expect(STATION_PAIRING_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(STATION_PAIRING_ALPHABET).toHaveLength(32);
    expect(STATION_PAIRING_CODE_LENGTH).toBe(6);
    for (const ambiguous of ['I', 'O', '0', '1']) {
      expect(STATION_PAIRING_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('has exactly two slots', () => {
    expect(STATION_SLOTS).toEqual([1, 2]);
    expect(isStationSlot(1)).toBe(true);
    expect(isStationSlot(2)).toBe(true);
    expect(isStationSlot(3)).toBe(false);
    expect(isStationSlot('1')).toBe(false);
    expect(isStationSlot(null)).toBe(false);
  });
});

describe('normalizePairingCode', () => {
  it('accepts what a person actually types', () => {
    expect(normalizePairingCode('abc def')).toBe('ABCDEF');
    expect(normalizePairingCode('ABC-DEF')).toBe('ABCDEF');
    expect(normalizePairingCode('  ABCDEF  ')).toBe('ABCDEF');
  });

  // A character outside the alphabet is EVIDENCE OF A MISTYPE, not noise to
  // drop: dropping it would send six different characters to the server than
  // the person believes they typed.
  it('refuses a code with a character that cannot be in one', () => {
    expect(normalizePairingCode('ABCDE0')).toBeNull();
    expect(normalizePairingCode('ABCDEO')).toBeNull();
    expect(normalizePairingCode('ABCDEI')).toBeNull();
    expect(normalizePairingCode('ABCDE1')).toBeNull();
    expect(normalizePairingCode('ABCD!F')).toBeNull();
  });

  it('refuses anything that is not six characters', () => {
    expect(normalizePairingCode('ABCDE')).toBeNull();
    expect(normalizePairingCode('ABCDEFG')).toBeNull();
    expect(normalizePairingCode('')).toBeNull();
    expect(normalizePairingCode(null)).toBeNull();
    expect(normalizePairingCode(123456 as unknown)).toBeNull();
  });
});

describe('what the input field may contain while it is being typed', () => {
  it('folds case, drops what cannot be in a code, and stops at six', () => {
    expect(pairingCodeInputValue('abc')).toBe('ABC');
    expect(pairingCodeInputValue('a-b c')).toBe('ABC');
    expect(pairingCodeInputValue('ABCDEFGH')).toBe('ABCDEF');
    expect(pairingCodeInputValue('0O1I')).toBe('');
  });

  it('shows a full code in two groups, and a partial one as typed', () => {
    expect(formatPairingCode('ABCDEF')).toBe('ABC DEF');
    expect(formatPairingCode('abcdef')).toBe('ABC DEF');
    expect(formatPairingCode('ABC')).toBe('ABC');
  });
});

describe('the credential this screen holds', () => {
  it('survives a round trip through storage', () => {
    expect(
      saveStationCredential({ stationId: 'st_1', secret: SECRET, goalId: 'goal_1', slot: 2 })
    ).toBe(true);
    expect(readStationCredential()).toEqual({
      stationId: 'st_1',
      secret: SECRET,
      goalId: 'goal_1',
      slot: 2,
    });
  });

  it('owns exactly one localStorage key and writes nothing else', () => {
    saveStationCredential({ stationId: 'st_1', secret: SECRET, goalId: 'goal_1', slot: 1 });
    expect(Object.keys(window.localStorage)).toEqual(['wsf.stationCredential']);
    expect(STATION_STORAGE_KEYS).toContain('wsf.stationCredential');
  });

  // The credential belongs to the goal it was enrolled on. Presenting it on
  // another goal's screen is the mistake; the server's refusal is only the
  // consequence.
  it('is offered only to the goal it was enrolled on', () => {
    saveStationCredential({ stationId: 'st_1', secret: SECRET, goalId: 'goal_1', slot: 1 });
    expect(credentialForGoal('goal_1')?.stationId).toBe('st_1');
    expect(credentialForGoal('goal_2')).toBeNull();
    expect(credentialForGoal('')).toBeNull();
    expect(credentialForGoal(null)).toBeNull();
  });

  it('refuses to store, and refuses to read back, a credential of the wrong shape', () => {
    expect(saveStationCredential({ stationId: '', secret: SECRET, goalId: 'g', slot: 1 })).toBe(false);
    expect(saveStationCredential({ stationId: 'st', secret: 'too-short', goalId: 'g', slot: 1 })).toBe(false);
    expect(
      saveStationCredential({ stationId: 'st', secret: SECRET, goalId: 'a/../b', slot: 1 })
    ).toBe(false);
    expect(
      saveStationCredential({ stationId: 'st', secret: SECRET, goalId: 'g', slot: 3 as never })
    ).toBe(false);
    expect(window.localStorage.getItem('wsf.stationCredential')).toBeNull();

    window.localStorage.setItem('wsf.stationCredential', 'not json');
    expect(readStationCredential()).toBeNull();
    window.localStorage.setItem(
      'wsf.stationCredential',
      JSON.stringify({ stationId: 'st', secret: SECRET, goalId: 'g', slot: 9 })
    );
    expect(readStationCredential()).toBeNull();
  });

  it('forgets the enrolment on request', () => {
    saveStationCredential({ stationId: 'st_1', secret: SECRET, goalId: 'goal_1', slot: 1 });
    clearStationCredential();
    expect(readStationCredential()).toBeNull();
  });

  // A device that cannot remember is not enrolled, and says so rather than
  // throwing on a screen standing in a hall.
  it('survives a browser that refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStationCredential()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(
      saveStationCredential({ stationId: 'st', secret: SECRET, goalId: 'g', slot: 1 })
    ).toBe(false);
  });
});

describe('the event a newcomer arrived from', () => {
  it('rides sessionStorage across the sign-up round trip', () => {
    setPendingEventGoal('goal_1');
    expect(readPendingEventGoal()).toBe('goal_1');
    expect(window.sessionStorage.getItem('wsf.pendingEventGoalId')).toBe('goal_1');
    clearPendingEventGoal();
    expect(readPendingEventGoal()).toBeNull();
  });

  it('stores nothing that could become a path of its own', () => {
    setPendingEventGoal('../../admin');
    expect(readPendingEventGoal()).toBeNull();
    window.sessionStorage.setItem('wsf.pendingEventGoalId', 'a/b');
    expect(readPendingEventGoal()).toBeNull();
  });

  it('holds a goal id and nothing else — no credential, ever', () => {
    saveStationCredential({ stationId: 'st_1', secret: SECRET, goalId: 'goal_1', slot: 1 });
    setPendingEventGoal('goal_1');
    expect(window.sessionStorage.getItem('wsf.pendingEventGoalId')).not.toContain(SECRET);
  });
});

describe('where a finished join lands', () => {
  it('goes to the event when the visitor came from one', () => {
    expect(routeAfterJoin('group_1', 'goal_1')).toBe('/event/goal_1');
  });

  it('goes exactly where it went before when they did not', () => {
    expect(routeAfterJoin('group_1', null)).toBe('/community/group_1');
  });

  it('never builds a path out of an unusable id', () => {
    expect(routeAfterJoin('group_1', 'a/../b')).toBe('/community/group_1');
    expect(routeAfterJoin('group_1', '')).toBe('/community/group_1');
  });
});
