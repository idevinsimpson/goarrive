import { describe, expect, it } from 'vitest';

import {
  displayAuthValueToSend,
  unsettledFor,
  type DisplayAuthOutcome,
} from '../src/displayAuthControl';

describe('unsettledFor', () => {
  it('is null unless this exact goal has an unsettled outcome', () => {
    const cases: DisplayAuthOutcome[] = [
      { kind: 'idle' },
      { kind: 'saving', goalId: 'g1', intended: true },
      { kind: 'confirmed', goalId: 'g1', intended: true, title: 'T' },
    ];
    for (const outcome of cases) {
      expect(unsettledFor(outcome, 'g1')).toBeNull();
    }
  });

  it('does not bleed one goal’s pending state onto another goal’s card', () => {
    const outcome: DisplayAuthOutcome = { kind: 'unconfirmed', goalId: 'g1', intended: true };
    expect(unsettledFor(outcome, 'g1')).toEqual(outcome);
    expect(unsettledFor(outcome, 'g2')).toBeNull();
  });
});

describe('displayAuthValueToSend', () => {
  it('toggles the shown permission when nothing is unsettled', () => {
    expect(displayAuthValueToSend(null, false)).toBe(true);
    expect(displayAuthValueToSend(null, true)).toBe(false);
  });

  it('carries the value that was asked for, whatever the card shows', () => {
    // The four combinations of intended × what the card currently shows. The
    // second row of each pair is the one that matters: the card already agrees
    // with the intended value, which is exactly what happens when the request
    // reached the server and only the answer was lost. Re-deriving the value
    // from the card there would send the opposite and undo it.
    for (const kind of ['unconfirmed', 'failed'] as const) {
      expect(displayAuthValueToSend({ kind, goalId: 'g', intended: true }, false)).toBe(true);
      expect(displayAuthValueToSend({ kind, goalId: 'g', intended: true }, true)).toBe(true);
      expect(displayAuthValueToSend({ kind, goalId: 'g', intended: false }, true)).toBe(false);
      expect(displayAuthValueToSend({ kind, goalId: 'g', intended: false }, false)).toBe(false);
    }
  });

  it('never returns the inverse of the card when something is unsettled', () => {
    // Stated as the defect rather than the fix, so the case fails if the
    // implementation ever goes back to inverting a stale local value.
    for (const currentlyAuthorized of [true, false]) {
      for (const intended of [true, false]) {
        const sent = displayAuthValueToSend(
          { kind: 'unconfirmed', goalId: 'g', intended },
          currentlyAuthorized
        );
        expect({ currentlyAuthorized, intended, sent }).toEqual({
          currentlyAuthorized,
          intended,
          sent: intended,
        });
      }
    }
  });
});
