import { describe, expect, it } from 'vitest';

import {
  beginContext,
  confirmedButAbsent,
  dismissOutcome,
  displayAuthValueToSend,
  initialDisplayAuthState,
  operationIsCurrent,
  outcomeFor,
  settleOperation,
  startOperation,
  unsettledFor,
  type DisplayAuthState,
  type OperationScope,
} from '../src/displayAuthControl';

const GROUP = 'grpA';
const UID = 'uid1';

function scopeFor(state: DisplayAuthState, goalId: string): OperationScope {
  return { generation: state.generation, groupId: GROUP, uid: UID, goalId };
}

/** The screen's starting point: one context established, nothing outstanding. */
function freshContext(): DisplayAuthState {
  return beginContext(initialDisplayAuthState);
}

describe('displayAuthValueToSend', () => {
  it('toggles the shown permission when nothing is unsettled', () => {
    expect(displayAuthValueToSend(null, false)).toBe(true);
    expect(displayAuthValueToSend(null, true)).toBe(false);
  });

  it('carries the value that was asked for, whatever the card shows', () => {
    // The row that matters is the second of each pair: the card already agrees
    // with the intended value, which is what happens when the request reached
    // the server and only the answer was lost. Re-deriving from the card there
    // sends the opposite and undoes it.
    for (const kind of ['unconfirmed', 'failed'] as const) {
      expect(displayAuthValueToSend({ kind, intended: true, title: 'T' }, false)).toBe(true);
      expect(displayAuthValueToSend({ kind, intended: true, title: 'T' }, true)).toBe(true);
      expect(displayAuthValueToSend({ kind, intended: false, title: 'T' }, true)).toBe(false);
      expect(displayAuthValueToSend({ kind, intended: false, title: 'T' }, false)).toBe(false);
    }
  });

  it('never returns the inverse of the card when something is unsettled', () => {
    // Stated as the defect rather than the fix, so it fails if the
    // implementation ever goes back to inverting a stale local value.
    for (const currentlyAuthorized of [true, false]) {
      for (const intended of [true, false]) {
        const sent = displayAuthValueToSend(
          { kind: 'unconfirmed', intended, title: 'T' },
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

describe('an unresolved outcome on one goal survives work on another', () => {
  it('keeps goal A unconfirmed while goal B is changed', () => {
    let s = freshContext();
    s = settleOperation(s, scopeFor(s, 'A'), {
      kind: 'unconfirmed',
      intended: true,
      title: 'Goal A',
    });
    // B starts, and then settles, entirely independently.
    s = startOperation(s, scopeFor(s, 'B'), false, 'Goal B');
    expect(unsettledFor(s, 'A')).toEqual({ kind: 'unconfirmed', intended: true, title: 'Goal A' });
    s = settleOperation(s, scopeFor(s, 'B'), {
      kind: 'confirmed',
      intended: false,
      title: 'Goal B',
    });
    expect(unsettledFor(s, 'A')).toEqual({ kind: 'unconfirmed', intended: true, title: 'Goal A' });
    expect(outcomeFor(s, 'B')).toEqual({ kind: 'confirmed', intended: false, title: 'Goal B' });
  });

  it('keeps goal A’s retry on its ORIGINAL intended value after B’s work', () => {
    let s = freshContext();
    s = settleOperation(s, scopeFor(s, 'A'), {
      kind: 'unconfirmed',
      intended: true,
      title: 'Goal A',
    });
    s = settleOperation(s, scopeFor(s, 'B'), {
      kind: 'failed',
      intended: false,
      title: 'Goal B',
    });
    // A asked for true; B asked for false. A's retry is still true.
    expect(displayAuthValueToSend(unsettledFor(s, 'A'), false)).toBe(true);
    expect(displayAuthValueToSend(unsettledFor(s, 'B'), false)).toBe(false);
  });

  it('a delayed result for one goal cannot clear another goal’s saving state', () => {
    let s = freshContext();
    s = startOperation(s, scopeFor(s, 'A'), true, 'Goal A');
    const bScope = scopeFor(s, 'B');
    s = startOperation(s, bScope, false, 'Goal B');
    // B's result lands late. A is still saving, and still saving `true`.
    s = settleOperation(s, bScope, { kind: 'unconfirmed', intended: false, title: 'Goal B' });
    expect(outcomeFor(s, 'A')).toEqual({ kind: 'saving', intended: true, title: 'Goal A' });
  });

  it('only an explicit dismissal removes an unresolved outcome', () => {
    let s = freshContext();
    s = settleOperation(s, scopeFor(s, 'A'), {
      kind: 'unconfirmed',
      intended: true,
      title: 'Goal A',
    });
    s = startOperation(s, scopeFor(s, 'B'), true, 'Goal B');
    expect(unsettledFor(s, 'A')).not.toBeNull();
    s = dismissOutcome(s, 'A');
    expect(outcomeFor(s, 'A')).toBeNull();
    // and dismissing one goal leaves the other alone
    expect(outcomeFor(s, 'B')).not.toBeNull();
  });
});

describe('session identity survives leaving and returning', () => {
  it('A → B → A does not make an old operation current again', () => {
    const inA1 = freshContext();
    const opInA1 = scopeFor(inA1, 'G');
    // The operation is current while the screen is still on that visit to A.
    expect(operationIsCurrent(inA1, opInA1, { groupId: GROUP, uid: UID })).toBe(true);

    const inB = beginContext(inA1);
    const inA2 = beginContext(inB);

    // Back on A: same account, same community, same goal — and the old
    // operation is still not current, because it belongs to the earlier visit.
    expect(opInA1.groupId).toBe(GROUP);
    expect(opInA1.uid).toBe(UID);
    expect(operationIsCurrent(inA2, opInA1, { groupId: GROUP, uid: UID })).toBe(false);
    // Comparing account and community alone would have said it was current.
    expect(opInA1.groupId === GROUP && opInA1.uid === UID).toBe(true);
  });

  it('a response arriving after navigation cannot overwrite a new session’s state', () => {
    let s = freshContext();
    const staleScope = scopeFor(s, 'G');
    s = startOperation(s, staleScope, true, 'Goal G');

    // The screen moves to another community and back; both clear the outcomes.
    s = beginContext(s);
    s = beginContext(s);
    expect(outcomeFor(s, 'G')).toBeNull();

    // A newer operation on the same goal is in flight.
    const freshScope = scopeFor(s, 'G');
    s = startOperation(s, freshScope, false, 'Goal G');

    // The old response finally lands. It changes nothing.
    const after = settleOperation(s, staleScope, {
      kind: 'confirmed',
      intended: true,
      title: 'Goal G',
    });
    expect(after).toBe(s);
    expect(outcomeFor(after, 'G')).toEqual({ kind: 'saving', intended: false, title: 'Goal G' });
  });

  it('a stale operation cannot start one either', () => {
    let s = freshContext();
    const staleScope = scopeFor(s, 'G');
    s = beginContext(s);
    expect(startOperation(s, staleScope, true, 'Goal G')).toBe(s);
  });

  it('changing context clears permission messages and confirmations', () => {
    let s = freshContext();
    s = settleOperation(s, scopeFor(s, 'A'), {
      kind: 'confirmed',
      intended: true,
      title: 'Goal A',
    });
    s = settleOperation(s, scopeFor(s, 'B'), {
      kind: 'unconfirmed',
      intended: false,
      title: 'Goal B',
    });
    const moved = beginContext(s);
    expect(moved.byGoal).toEqual({});
    expect(confirmedButAbsent(moved, [])).toEqual([]);
  });
});

describe('confirmedButAbsent', () => {
  it('reports a confirmed goal that has dropped out of the list, and only that', () => {
    let s = freshContext();
    s = settleOperation(s, scopeFor(s, 'closed'), {
      kind: 'confirmed',
      intended: false,
      title: 'Closed goal',
    });
    s = settleOperation(s, scopeFor(s, 'listed'), {
      kind: 'confirmed',
      intended: true,
      title: 'Listed goal',
    });
    s = settleOperation(s, scopeFor(s, 'pending'), {
      kind: 'unconfirmed',
      intended: true,
      title: 'Pending goal',
    });
    expect(confirmedButAbsent(s, ['listed'])).toEqual([
      { goalId: 'closed', intended: false, title: 'Closed goal' },
    ]);
  });
});
