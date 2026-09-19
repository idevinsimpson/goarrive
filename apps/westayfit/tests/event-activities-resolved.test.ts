/**
 * THE REAL MULTI-ACTIVITY CHOICE.
 *
 * A combined-event QR resolves to the setup's frozen children, and every one
 * of them is offered with its own goal id. A one-goal event resolves to one
 * activity, and the legacy builder it falls back to is untouched.
 *
 * The rule that makes the whole "nothing enters the line until somebody says
 * so" contract hold is `initialSelection`, and it is tested here against a
 * resolved list rather than against the one-entry list it used to see: a real
 * choice of two selects NOTHING until somebody taps.
 */

import { describe, expect, test } from 'vitest';

import {
  activityGoalIdFor,
  activityLabelFor,
  eventActivities,
  eventActivitiesFrom,
  initialSelection,
} from '../src/eventActivity';

const SQUATS = { goalId: 'goalSquats', title: 'Squats', unit: 'squats' };
const PUSHUPS = { goalId: 'goalPushups', title: 'Push-ups', unit: 'push-ups' };

describe('a combined event offers every frozen child', () => {
  test('each activity carries its own goal id', () => {
    const list = eventActivitiesFrom({ resolved: [SQUATS, PUSHUPS] });
    expect(list.map((a) => a.label)).toEqual(['squats', 'push-ups']);
    expect(list.map((a) => a.goalId)).toEqual(['goalSquats', 'goalPushups']);
    expect(new Set(list.map((a) => a.key)).size).toBe(2);
    expect(activityGoalIdFor(list, list[0]!.key)).toBe('goalSquats');
    expect(activityGoalIdFor(list, list[1]!.key)).toBe('goalPushups');
    expect(activityGoalIdFor(list, 'nonsense')).toBeNull();
  });

  test('a real choice of two selects NOTHING until somebody taps', () => {
    const list = eventActivitiesFrom({ resolved: [SQUATS, PUSHUPS] });
    expect(initialSelection(list, null)).toBeNull();
    expect(initialSelection(list, 'squats')).toBeNull();
  });

  test('the scanned activity comes first, once, and keeps its own goal', () => {
    const list = eventActivitiesFrom({ resolved: [SQUATS, PUSHUPS], carried: 'push-ups' });
    expect(list.map((a) => a.label)).toEqual(['push-ups', 'squats']);
    expect(list[0]!.carried).toBe(true);
    expect(list[0]!.goalId).toBe('goalPushups');
    // Folded, not repeated: the room's activity is not offered twice.
    expect(list).toHaveLength(2);
  });

  test('a carried activity this event does not offer is not invented', () => {
    const list = eventActivitiesFrom({ resolved: [SQUATS, PUSHUPS], carried: 'burpees' });
    expect(list.map((a) => a.label)).toEqual(['squats', 'push-ups']);
    for (const activity of list) expect(activity.carried).toBe(false);
  });

  test('an activity with no unit or no goal is dropped rather than shown blank', () => {
    const list = eventActivitiesFrom({
      resolved: [SQUATS, { goalId: '', title: 'Nameless', unit: 'laps' }, { goalId: 'g', title: 't', unit: '' }],
    });
    expect(list.map((a) => a.goalId)).toEqual(['goalSquats']);
  });
});

describe('a one-goal event is what it always was', () => {
  test('one resolved activity stands selected when nobody scanned', () => {
    const list = eventActivitiesFrom({ resolved: [SQUATS] });
    expect(list).toHaveLength(1);
    const key = initialSelection(list, null);
    expect(key).toBe(list[0]!.key);
    expect(activityLabelFor(list, key)).toBe('squats');
    expect(activityGoalIdFor(list, key)).toBe('goalSquats');
  });

  test('the legacy builder is untouched and still names no goal', () => {
    const list = eventActivities({ unit: 'squats', carried: null });
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('squats');
    expect(list[0]!.goalId).toBeUndefined();
    expect(activityGoalIdFor(list, list[0]!.key)).toBeNull();
  });
});
