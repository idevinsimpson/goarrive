/**
 * THE ACTIVITY A SCANNED PHONE CARRIES, AND THE RULE THAT GATES THE TWO WAYS
 * ON.
 *
 * Three claims are pinned here, and they are the three the journey rests on:
 *
 *   1. AN ACTIVITY IS A LABEL AND NOTHING ELSE. It cannot become a path, it
 *      cannot carry a credential, it cannot be truncated into a different
 *      selection, and it is refused rather than repaired.
 *   2. A SCAN IS NOT A DECISION. A phone that arrives carrying an activity has
 *      selected nothing; `initialSelection` returns null for it, which is what
 *      makes "only after activity selection" true in one place instead of in
 *      every render.
 *   3. AN ADDRESS BUILT WITHOUT AN ACTIVITY IS THE ADDRESS THAT WAS BUILT
 *      BEFORE THIS PARAMETER EXISTED — byte for byte, for every builder.
 *
 * The screens are proved in tests-e2e/ui-event-activity-choice.spec.ts, in a
 * real browser against real callables. These are the pure halves.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACTIVITY_LABEL_MAX,
  activityKey,
  activityLabelFor,
  eventActivities,
  EVENT_ACTIVITY_PARAM,
  EVENT_CHOICE_PHONE_LABEL,
  EVENT_CHOICE_QUEUE_LABEL,
  initialSelection,
  readActivityLabel,
} from '../src/eventActivity';
import {
  clearPendingEventActivity,
  readPendingEventActivity,
  routeAfterJoin,
  setPendingEventActivity,
  STATION_STORAGE_KEYS,
} from '../src/stationSession';
import {
  buildEventJoinUrlFromScreenedCode,
  buildEventUrl,
  buildJoinEventUrl,
  eventRoute,
} from '../src/ui/eventLinks';

const ORIGIN = 'https://westayfit-app.web.app';
const CODE = 'vT6nQpR2s8XyZ0aBcDeFgH';

describe('what an activity label may be', () => {
  it('is the event’s own word for what it counts', () => {
    expect(readActivityLabel('squats')).toBe('squats');
    expect(readActivityLabel('  Push Ups  ')).toBe('Push Ups');
    expect(readActivityLabel('Sentadillas')).toBe('Sentadillas');
  });

  it('collapses the whitespace a paste carries and strips control characters', () => {
    expect(readActivityLabel('squats\n\tand  more')).toBe('squats and more');
    expect(readActivityLabel('sq\u0000uats')).toBe('sq uats');
  });

  it('is nothing at all rather than something that was cut in half', () => {
    // A truncated label is a DIFFERENT label from the one somebody chose.
    // Refusing it loses context; substituting it would invent a selection.
    const tooLong = 'x'.repeat(ACTIVITY_LABEL_MAX + 1);
    expect(readActivityLabel(tooLong)).toBeNull();
    expect(readActivityLabel('x'.repeat(ACTIVITY_LABEL_MAX))).toHaveLength(ACTIVITY_LABEL_MAX);
  });

  it('refuses anything that is not a string, and anything empty', () => {
    expect(readActivityLabel('')).toBeNull();
    expect(readActivityLabel('   ')).toBeNull();
    expect(readActivityLabel(undefined)).toBeNull();
    expect(readActivityLabel(null)).toBeNull();
    // expo-router hands a repeated query parameter back as an array.
    expect(readActivityLabel(['squats'])).toBeNull();
    expect(readActivityLabel({ toString: () => 'squats' })).toBeNull();
  });
});

describe('the key an activity is filed under', () => {
  it('is boring, stable and safe to put in a testID', () => {
    expect(activityKey('squats')).toBe('squats');
    expect(activityKey('Push Ups')).toBe('push-ups');
    expect(activityKey('  laps / lengths  ')).toBe('laps-lengths');
  });

  it('never yields something that could be read as a path or an empty id', () => {
    expect(activityKey('../../admin')).toBe('admin');
    expect(activityKey('???')).toBe('activity');
    expect(activityKey('ПРИСЕДАНИЯ')).toBe('activity');
    expect(activityKey('x'.repeat(64))).toHaveLength(32);
  });
});

describe('what an event offers', () => {
  it('is the event’s own activity when nothing was scanned', () => {
    expect(eventActivities({ unit: 'squats' })).toEqual([
      { key: 'squats', label: 'squats', carried: false },
    ]);
  });

  it('folds a scan that names the event’s own unit into ONE activity', () => {
    // The ordinary case: a station's code names its own goal's unit, so the
    // scan and the server agree and the person is not shown the same thing
    // twice.
    const list = eventActivities({ unit: 'squats', carried: 'Squats' });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ key: 'squats', label: 'Squats', carried: true });
  });

  it('puts what was scanned first when it is not what the server named', () => {
    const list = eventActivities({ unit: 'squats', carried: 'push ups' });
    expect(list.map((a) => a.label)).toEqual(['push ups', 'squats']);
    expect(list.map((a) => a.carried)).toEqual([true, false]);
  });

  it('gives two different labels two different keys', () => {
    const list = eventActivities({ unit: '???', carried: '!!!' });
    expect(list.map((a) => a.key)).toEqual(['activity', 'activity-2']);
  });

  it('offers nothing when there is nothing to offer', () => {
    expect(eventActivities({})).toEqual([]);
    expect(eventActivities({ unit: '   ', carried: null })).toEqual([]);
    // A label the shape check refuses is not an activity at all.
    expect(eventActivities({ unit: 'x'.repeat(200) })).toEqual([]);
  });
});

describe('what is selected the moment the screen opens', () => {
  it('is NOTHING when the journey arrived carrying a scan', () => {
    // The whole of "a scan alone never enqueues", one step earlier: a scan is
    // how somebody got here, not what they decided.
    const list = eventActivities({ unit: 'squats', carried: 'squats' });
    expect(initialSelection(list, 'squats')).toBeNull();
  });

  it('is the one activity when the page was opened without a scan', () => {
    const list = eventActivities({ unit: 'squats' });
    expect(initialSelection(list, null)).toBe('squats');
    expect(initialSelection(list, undefined)).toBe('squats');
    // A carried value that is not a usable label is not a scan.
    expect(initialSelection(list, '   ')).toBe('squats');
  });

  it('is nothing when there is more than one, or none', () => {
    expect(initialSelection(eventActivities({ unit: 'squats', carried: 'laps' }), null)).toBeNull();
    expect(initialSelection([], null)).toBeNull();
  });

  it('names the label behind a selection, or nothing', () => {
    const list = eventActivities({ unit: 'squats' });
    expect(activityLabelFor(list, 'squats')).toBe('squats');
    expect(activityLabelFor(list, 'laps')).toBeNull();
    expect(activityLabelFor(list, null)).toBeNull();
  });
});

describe('the words the two ways on are offered in', () => {
  // The Director's contract is these two strings. They live in the module so
  // the screen and the browser spec read one literal, and this is where a
  // change to either of them stops being silent.
  it('are the approved ones, exactly', () => {
    expect(EVENT_CHOICE_PHONE_LABEL).toBe('Use my phone');
    expect(EVENT_CHOICE_QUEUE_LABEL).toBe('Join the kiosk queue');
  });
});

describe('the activity across the sign-up round trip', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('rides sessionStorage beside the event, by the same mechanism', () => {
    setPendingEventActivity('squats');
    expect(readPendingEventActivity()).toBe('squats');
    expect(window.sessionStorage.getItem('wsf.pendingEventActivity')).toBe('squats');
    clearPendingEventActivity();
    expect(readPendingEventActivity()).toBeNull();
  });

  it('is one of this feature’s own keys, and is declared as one', () => {
    expect(STATION_STORAGE_KEYS).toContain('wsf.pendingEventActivity');
  });

  it('stores nothing of the wrong shape, and reads nothing of the wrong shape back', () => {
    setPendingEventActivity('x'.repeat(ACTIVITY_LABEL_MAX + 1));
    expect(readPendingEventActivity()).toBeNull();
    expect(window.sessionStorage.getItem('wsf.pendingEventActivity')).toBeNull();
    // A hand-edited entry must not become something this app will render.
    window.sessionStorage.setItem('wsf.pendingEventActivity', 'x'.repeat(200));
    expect(readPendingEventActivity()).toBeNull();
  });

  it('is dropped when there is no journey left to carry it', () => {
    setPendingEventActivity('   ');
    expect(readPendingEventActivity()).toBeNull();
  });
});

describe('where a finished join lands, now that it carries two things', () => {
  it('takes the activity to the event as a query value', () => {
    expect(routeAfterJoin('group_1', 'goal_1', 'squats')).toBe('/event/goal_1?activity=squats');
    expect(routeAfterJoin('group_1', 'goal_1', 'Push Ups')).toBe(
      '/event/goal_1?activity=Push%20Ups'
    );
  });

  it('is exactly what it was before when there is no activity', () => {
    expect(routeAfterJoin('group_1', 'goal_1')).toBe('/event/goal_1');
    expect(routeAfterJoin('group_1', 'goal_1', null)).toBe('/event/goal_1');
    expect(routeAfterJoin('group_1', 'goal_1', '  ')).toBe('/event/goal_1');
  });

  it('never lets an activity build or steer a path', () => {
    // The path is the goal id, escaped, and the activity is a value on it.
    const route = routeAfterJoin('group_1', 'goal_1', '../../admin?x=1&y=2');
    expect(route.split('?')[0]).toBe('/event/goal_1');
    const params = new URLSearchParams(route.split('?')[1] ?? '');
    expect([...params.keys()]).toEqual([EVENT_ACTIVITY_PARAM]);
    expect(params.get(EVENT_ACTIVITY_PARAM)).toBe('../../admin?x=1&y=2');
  });

  it('drops an activity that has no event to be about', () => {
    expect(routeAfterJoin('group_1', null, 'squats')).toBe('/community/group_1');
    expect(routeAfterJoin('group_1', 'a/../b', 'squats')).toBe('/community/group_1');
  });
});

describe('the addresses, with and without an activity', () => {
  it('are byte-for-byte the old ones when no activity is given', () => {
    expect(eventRoute('goal_1')).toBe('/event/goal_1');
    expect(eventRoute('goal_1', null)).toBe('/event/goal_1');
    expect(buildEventUrl({ origin: ORIGIN, goalId: 'goal_1' })).toBe(`${ORIGIN}/event/goal_1`);
    expect(
      buildEventJoinUrlFromScreenedCode({ origin: ORIGIN, joinCode: CODE, goalId: 'goal_1' })
    ).toBe(`${ORIGIN}/join/${CODE}?event=goal_1`);
    expect(
      buildJoinEventUrl({ origin: ORIGIN, joinCode: CODE, joinPolicy: 'public', goalId: 'goal_1' })
    ).toBe(`${ORIGIN}/join/${CODE}?event=goal_1`);
  });

  it('name the activity as a second query value, never as part of the path', () => {
    expect(eventRoute('goal_1', 'squats')).toBe('/event/goal_1?activity=squats');
    const url = buildEventJoinUrlFromScreenedCode({
      origin: ORIGIN,
      joinCode: CODE,
      goalId: 'goal_1',
      activity: 'Push Ups',
    })!;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/join/${CODE}`);
    expect([...parsed.searchParams.keys()]).toEqual(['event', 'activity']);
    expect(parsed.searchParams.get('event')).toBe('goal_1');
    expect(parsed.searchParams.get('activity')).toBe('Push Ups');
    expect(parsed.hash).toBe('');
  });

  it('escape an activity rather than letting it add parameters of its own', () => {
    const url = buildEventJoinUrlFromScreenedCode({
      origin: ORIGIN,
      joinCode: CODE,
      goalId: 'goal_1',
      activity: 'squats&admin=1',
    })!;
    const parsed = new URL(url);
    expect([...parsed.searchParams.keys()]).toEqual(['event', 'activity']);
    expect(parsed.searchParams.get('activity')).toBe('squats&admin=1');
  });

  /**
   * ADMISSION POLICY IS STILL NOT THIS FEATURE'S TO CHANGE. An activity does
   * not make a link exist for a community that admits nobody by link.
   */
  it('do not exist for a community that admits nobody by link, activity or no activity', () => {
    expect(
      buildJoinEventUrl({
        origin: ORIGIN,
        joinCode: CODE,
        joinPolicy: 'private',
        goalId: 'goal_1',
        activity: 'squats',
      })
    ).toBeNull();
    expect(
      buildJoinEventUrl({
        origin: ORIGIN,
        joinCode: null,
        joinPolicy: 'public',
        goalId: 'goal_1',
        activity: 'squats',
      })
    ).toBeNull();
  });

  it('carry no credential and no authority, with an activity on them', () => {
    const url = buildEventJoinUrlFromScreenedCode({
      origin: ORIGIN,
      joinCode: CODE,
      goalId: 'goal_1',
      activity: 'squats',
    })!;
    // Only the two things this journey needs: which community, which event,
    // and what it is running. Nothing else may ever be added here.
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(['activity', 'event']);
  });
});
