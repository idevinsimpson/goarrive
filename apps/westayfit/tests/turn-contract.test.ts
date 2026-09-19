/**
 * THE TURN CONTRACT, client half.
 *
 * The properties pinned here are the ones the feature exists to keep:
 *
 *   - THE HALL SHOWS ONE PERSON. `hallVisibleNames` is the only function that
 *     says which names a screen would print, and it never returns more than
 *     one, for any state, including one hand-built with extra fields on it.
 *   - THE STATE MACHINE HAS SEVEN STATES and four live ones, and the one
 *     control a station offers is a function of the state rather than of which
 *     buttons somebody remembered to disable.
 *   - A PERSON IS NEVER TOLD A POSITION. They are told how many are ahead.
 *   - The 45 seconds and the 10 seconds are the server's numbers.
 */

import { describe, expect, test } from 'vitest';

import {
  READY_LEASE_SECONDS,
  RESULT_VISIBLE_SECONDS,
  TURN_NAME_REFUSED,
  TURN_NO_SHOW_MESSAGE,
  TURN_OTHER_ACTIVITY_MESSAGE,
  announceHallTurn,
  describeHallResult,
  describeTurnPlace,
  describeWaitingCount,
  formatTurnCode,
  hallVisibleNames,
  isTurnLive,
  isUsableTurnCount,
  stationAction,
  stationActionLabel,
  turnCountValue,
  type HallState,
  type TurnStatus,
} from '../src/turnContract';

function hall(overrides: Partial<HallState> = {}): HallState {
  return {
    stationId: 'st1',
    stationLabel: 'Station 1',
    assigned: null,
    result: null,
    waitingCount: 0,
    ...overrides,
  };
}

describe('what a screen in a room may show', () => {
  test('a hall state carries exactly five keys, and none of them is a list', () => {
    const state = hall({
      assigned: { code: 'K7P', calledName: 'Sam', state: 'assigned', readySecondsLeft: 40, activityUnit: 'squats' },
      result: null,
      waitingCount: 12,
    });
    expect(Object.keys(state).sort()).toEqual([
      'assigned',
      'result',
      'stationId',
      'stationLabel',
      'waitingCount',
    ]);
    // The property the whole feature turns on, asserted over the WHOLE payload
    // rather than field by field: nothing in it is an array.
    for (const value of Object.values(state)) {
      expect(Array.isArray(value)).toBe(false);
    }
    // THE DISCLOSURE RULE, and the one deliberate addition to it. The hall
    // may name the person it is serving and nothing else about anybody — and
    // now also WHAT THAT TURN IS FOR, because a combined event's line holds
    // people who chose different activities and the screen has to know which
    // movement to run. It names an activity, not a person.
    expect(Object.keys(state.assigned!).sort()).toEqual([
      'activityUnit',
      'calledName',
      'code',
      'readySecondsLeft',
      'state',
    ]);
  });

  test('however it is driven, the hall prints at most ONE name', () => {
    expect(hallVisibleNames(hall())).toEqual([]);
    expect(
      hallVisibleNames(
        hall({ assigned: { code: 'K7P', calledName: 'Sam', state: 'ready', readySecondsLeft: null, activityUnit: 'squats' } })
      )
    ).toEqual(['Sam']);
    // A state hand-built with a waiting list bolted onto it still prints one
    // name: there is no path from a list to the screen.
    const smuggled = {
      ...hall({
        assigned: { code: 'K7P', calledName: 'Sam', state: 'ready', readySecondsLeft: null, activityUnit: 'squats' },
      }),
      waiting: [
        { calledName: 'Ada', code: 'B2C' },
        { calledName: 'Ben', code: 'D4E' },
      ],
    } as unknown as HallState;
    expect(hallVisibleNames(smuggled)).toEqual(['Sam']);
  });

  test('the ten-second result names nobody', () => {
    const line = describeHallResult({ code: 'K7P', amount: 30, unit: 'squats', secondsLeft: 7 });
    expect(line).toBe('K7P · 30 squats recorded.');
    expect(line).not.toContain('Sam');
    expect(describeHallResult(null)).toBeNull();
    expect(describeHallResult({ code: 'K7P', amount: 30, unit: '', secondsLeft: 1 })).toBe(
      'K7P · 30 recorded.'
    );
  });

  test('the announcement is one sentence, carrying the name AND the code', () => {
    expect(announceHallTurn(hall())).toBeNull();
    expect(
      announceHallTurn(
        hall({
          assigned: { code: 'K7P', calledName: 'Sam', state: 'assigned', readySecondsLeft: 44, activityUnit: 'squats' },
        })
      )
    ).toBe('Sam · K7P — it’s your turn at Station 1.');
    expect(
      announceHallTurn(
        hall({
          stationLabel: '',
          assigned: { code: 'K7P', calledName: 'Sam', state: 'ready', readySecondsLeft: null, activityUnit: 'squats' },
        })
      )
    ).toBe('Sam · K7P — ready.');
    expect(
      announceHallTurn(
        hall({
          assigned: { code: 'K7P', calledName: 'Sam', state: 'active', readySecondsLeft: null, activityUnit: 'squats' },
        })
      )
    ).toBe('Sam · K7P — running now at Station 1.');
  });

  test('the waiting are a count, in words', () => {
    expect(describeWaitingCount(0)).toBe('Nobody is waiting.');
    expect(describeWaitingCount(1)).toBe('1 person waiting.');
    expect(describeWaitingCount(9)).toBe('9 people waiting.');
    expect(describeWaitingCount(-3)).toBe('Nobody is waiting.');
    expect(describeWaitingCount(Number.NaN)).toBe('Nobody is waiting.');
  });
});

describe('the state machine', () => {
  test('four states hold a place, three do not', () => {
    const all: TurnStatus[] = [
      'waiting',
      'assigned',
      'ready',
      'active',
      'done',
      'noShow',
      'left',
    ];
    expect(all.filter((s) => isTurnLive(s))).toEqual(['waiting', 'assigned', 'ready', 'active']);
    expect(isTurnLive(null)).toBe(false);
    expect(isTurnLive('anything else')).toBe(false);
  });

  test('the station offers exactly one action, decided by the state', () => {
    expect(stationAction(hall())).toBe('callNext');
    expect(stationAction(null)).toBe('callNext');
    expect(
      stationAction(
        hall({
          assigned: { code: 'K7P', calledName: 'Sam', state: 'assigned', readySecondsLeft: 12, activityUnit: 'squats' },
        })
      )
    ).toBe('awaitReady');
    expect(
      stationAction(
        hall({ assigned: { code: 'K7P', calledName: 'Sam', state: 'ready', readySecondsLeft: null, activityUnit: 'squats' } })
      )
    ).toBe('start');
    expect(
      stationAction(
        hall({
          assigned: { code: 'K7P', calledName: 'Sam', state: 'active', readySecondsLeft: null, activityUnit: 'squats' },
        })
      )
    ).toBe('complete');
  });

  test('every action has a label, and none of them says “call next” twice', () => {
    const labels = (['callNext', 'awaitReady', 'start', 'complete'] as const).map((a) =>
      stationActionLabel(a)
    );
    expect(new Set(labels).size).toBe(4);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
  });

  test('a person is told how many are ahead, never a position', () => {
    expect(describeTurnPlace({ status: 'waiting', ahead: 0 })).toBe('You’re next.');
    expect(describeTurnPlace({ status: 'waiting', ahead: 1 })).toBe('1 person ahead of you.');
    expect(describeTurnPlace({ status: 'waiting', ahead: 6 })).toBe('6 people ahead of you.');
    expect(describeTurnPlace({ status: 'left', ahead: 0 })).toBe('You’re not in the line.');
  });

  test('being assigned says where, and counts the lease down', () => {
    expect(
      describeTurnPlace({
        status: 'assigned',
        ahead: 0,
        stationLabel: 'Station 2',
        readySecondsLeft: 30,
      })
    ).toBe('It’s your turn at Station 2. Tap “I’m ready” within 30s.');
    expect(
      describeTurnPlace({ status: 'assigned', ahead: 0, stationLabel: 'Station 2', readySecondsLeft: 0 })
    ).toBe('It’s your turn at Station 2. Tap “I’m ready”.');
    expect(describeTurnPlace({ status: 'ready', ahead: 0, stationLabel: 'Station 2' })).toBe(
      'You’re up at Station 2. Walk over — they’re expecting you.'
    );
    expect(describeTurnPlace({ status: 'active', ahead: 0, stationLabel: 'Station 2' })).toBe(
      'Your turn is running at Station 2.'
    );
  });

  test('the lease and the result window are the server’s numbers', () => {
    expect(READY_LEASE_SECONDS).toBe(45);
    expect(RESULT_VISIBLE_SECONDS).toBe(10);
  });

  test('the refusal sentences name no field, no code and no person', () => {
    for (const sentence of [
      TURN_NAME_REFUSED,
      TURN_NO_SHOW_MESSAGE,
      TURN_OTHER_ACTIVITY_MESSAGE,
    ]) {
      expect(sentence).not.toMatch(/uid|entryId|goalId|attemptId|null|undefined/i);
      expect(sentence.length).toBeGreaterThan(20);
    }
  });
});

describe('the code, and the count', () => {
  test('a code is printed upper case and unchanged', () => {
    expect(formatTurnCode('k7p')).toBe('K7P');
    expect(formatTurnCode('  K7P ')).toBe('K7P');
    expect(formatTurnCode(null)).toBe('');
  });

  test('a count is refused locally exactly where the server refuses it', () => {
    expect(isUsableTurnCount('1')).toBe(true);
    expect(isUsableTurnCount('100000')).toBe(true);
    expect(isUsableTurnCount('0')).toBe(false);
    expect(isUsableTurnCount('100001')).toBe(false);
    expect(isUsableTurnCount('12.5')).toBe(false);
    expect(isUsableTurnCount('-4')).toBe(false);
    expect(isUsableTurnCount('')).toBe(false);
    expect(isUsableTurnCount(null)).toBe(false);
    expect(turnCountValue(' 30 ')).toBe(30);
    expect(turnCountValue('nope')).toBeNull();
  });
});
