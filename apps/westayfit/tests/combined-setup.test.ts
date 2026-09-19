import { describe, expect, it } from 'vitest';

import {
  COMBINED_REFUSAL_BODY,
  COMBINED_REFUSAL_HEADLINE,
  MAX_COMBINED_CHILDREN,
  MIN_COMBINED_CHILDREN,
  childSelectionMessage,
  ineligibleMessage,
  ineligibleReason,
  isChildEligible,
  parseLocalDateTime,
  parseTargetInput,
  validateChildSelection,
} from '../src/combinedSetup';
import { KIOSK_REFUSAL_BODY, KIOSK_REFUSAL_HEADLINE } from '../src/kioskSession';

const WINDOW = {
  startsAt: new Date('2026-09-20T00:00:00.000Z'),
  endsAt: new Date('2026-10-04T00:00:00.000Z'),
};

function child(startsAt: string, endsAt: string) {
  return { goalId: 'g1', title: 'Squats', status: 'active', startsAt, endsAt };
}

/**
 * THE FROZEN RULE. An activity is eligible only if its own window sits
 * entirely inside the combined window. That is what makes the parent's total
 * an exact sum of the children's lifetime counters: wsfContribute enforces
 * each child's own window on the server, so every contribution that can ever
 * exist on an eligible child necessarily lands inside the combined window.
 */
describe('isChildEligible / ineligibleReason', () => {
  it('accepts an activity strictly inside the combined period', () => {
    expect(
      isChildEligible({
        child: child('2026-09-21T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
        window: WINDOW,
      })
    ).toBe(true);
  });

  // Inclusive at both ends: an activity whose window IS the combined window
  // is eligible. Every contribution it can take is inside the period.
  it('accepts an activity whose window is exactly the combined window', () => {
    expect(
      isChildEligible({
        child: child('2026-09-20T00:00:00.000Z', '2026-10-04T00:00:00.000Z'),
        window: WINDOW,
      })
    ).toBe(true);
  });

  it('refuses an activity that starts one millisecond early', () => {
    const args = {
      child: child('2026-09-19T23:59:59.999Z', '2026-09-28T00:00:00.000Z'),
      window: WINDOW,
    };
    expect(isChildEligible(args)).toBe(false);
    expect(ineligibleReason(args)).toBe('startsBefore');
  });

  it('refuses an activity that ends one millisecond late', () => {
    const args = {
      child: child('2026-09-21T00:00:00.000Z', '2026-10-04T00:00:00.001Z'),
      window: WINDOW,
    };
    expect(isChildEligible(args)).toBe(false);
    expect(ineligibleReason(args)).toBe('endsAfter');
  });

  // A window that cannot be read cannot be checked against the rule, and the
  // rule is the whole correctness of the derived total. Refuse, do not guess.
  it('refuses an activity whose window cannot be read', () => {
    expect(ineligibleReason({ child: child('not a date', 'nor this'), window: WINDOW })).toBe(
      'unreadableWindow'
    );
  });

  it('gives each refusal its own plain sentence', () => {
    expect(ineligibleMessage('startsBefore')).toBe(
      'This activity starts before the combined period.'
    );
    expect(ineligibleMessage('endsAfter')).toBe('This activity ends after the combined period.');
    expect(ineligibleMessage('unreadableWindow')).toContain('can’t be combined');
  });
});

/**
 * THE DUPLICATE CASE IS THE ONE THAT MATTERS. A repeated id would be summed
 * twice and is the only way this feature could double-count. It is refused
 * here, refused again at the callable's boundary, and deduped defensively
 * when the server derives the total.
 */
describe('validateChildSelection', () => {
  it('refuses fewer than two: a combined goal of one activity is not combined', () => {
    expect(validateChildSelection([])).toBe('tooFew');
    expect(validateChildSelection(['a'])).toBe('tooFew');
  });

  it('accepts two and accepts six', () => {
    expect(validateChildSelection(['a', 'b'])).toBeNull();
    expect(validateChildSelection(['a', 'b', 'c', 'd', 'e', 'f'])).toBeNull();
  });

  it('refuses seven', () => {
    expect(validateChildSelection(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('tooMany');
  });

  it('refuses a duplicate before it can be counted twice', () => {
    expect(validateChildSelection(['a', 'a'])).toBe('duplicate');
    expect(validateChildSelection(['a', 'b', 'a'])).toBe('duplicate');
  });

  it('states the bounds it enforces', () => {
    expect(MIN_COMBINED_CHILDREN).toBe(2);
    expect(MAX_COMBINED_CHILDREN).toBe(6);
    expect(childSelectionMessage('tooFew')).toContain('2');
    expect(childSelectionMessage('tooMany')).toContain('6');
    expect(childSelectionMessage('duplicate')).toBe('Each activity can be chosen once.');
  });
});

/**
 * The combined screen refuses in the SAME words as the kiosk and the public
 * display. It must be no more of an oracle than they are.
 */
describe('the generic refusal', () => {
  it('is the same two strings the kiosk and display use', () => {
    expect(COMBINED_REFUSAL_HEADLINE).toBe(KIOSK_REFUSAL_HEADLINE);
    expect(COMBINED_REFUSAL_BODY).toBe(KIOSK_REFUSAL_BODY);
    expect(COMBINED_REFUSAL_HEADLINE).toBe('Nothing to show here');
  });
});

describe('parseLocalDateTime', () => {
  it('reads the web control’s own shape in the device zone', () => {
    const d = parseLocalDateTime('2026-10-02T15:00');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(2);
    expect(d?.getHours()).toBe(15);
    expect(d?.getMinutes()).toBe(0);
  });

  it('refuses a day that does not exist rather than rolling it over', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-10-02T25:00')).toBeNull();
  });

  it('refuses anything that is not a date-time', () => {
    expect(parseLocalDateTime('')).toBeNull();
    expect(parseLocalDateTime('tomorrow')).toBeNull();
    expect(parseLocalDateTime('2026-10-02')).toBeNull();
  });
});

describe('parseTargetInput', () => {
  it('accepts a whole number the callable will accept', () => {
    expect(parseTargetInput('2000')).toBe(2000);
    expect(parseTargetInput(' 1 ')).toBe(1);
  });

  it('refuses everything the callable would refuse', () => {
    expect(parseTargetInput('')).toBeNull();
    expect(parseTargetInput('0')).toBeNull();
    expect(parseTargetInput('-5')).toBeNull();
    expect(parseTargetInput('1.5')).toBeNull();
    expect(parseTargetInput('1e6')).toBeNull();
    expect(parseTargetInput('100000001')).toBeNull();
  });
});
