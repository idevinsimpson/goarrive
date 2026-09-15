import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isSameContext,
  legacyPendingKey,
  loadPending,
  pendingKey,
  retireLegacyPending,
  type RequestContext,
} from '../src/pendingContribution';

/**
 * Package C's C5 account-isolation requirements, exercised directly.
 *
 * The defect these cover: the pending-contribution record used to be keyed by
 * goal alone, so on a shared device it was inherited by whoever signed in
 * next — and because the server keys idempotency on goalId, uid AND attemptId,
 * replaying it under a different uid does not deduplicate. It books a NEW
 * contribution credited to the wrong member.
 *
 * These are unit tests of the isolation logic. They are NOT the browser
 * integration run, and they establish nothing about invitations or joining.
 */

const GOAL = 'goal-1';
const OTHER_GOAL = 'goal-2';
const A = 'uid-a';
const B = 'uid-b';

function ctx(generation: number, uid: string | null, goalId: string | undefined): RequestContext {
  return { generation, uid, goalId };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('a request is scoped to account, goal and generation', () => {
  it('accepts a response that comes back in the same context', () => {
    expect(isSameContext(ctx(3, A, GOAL), ctx(3, A, GOAL))).toBe(true);
  });

  it('rejects a response that arrives after an account switch', () => {
    expect(isSameContext(ctx(3, A, GOAL), ctx(4, B, GOAL))).toBe(false);
  });

  it('rejects a response that arrives after the SAME account switched goals', () => {
    // A uid comparison alone would have accepted this one.
    expect(isSameContext(ctx(3, A, GOAL), ctx(4, A, OTHER_GOAL))).toBe(false);
  });

  it('rejects a response from before an A -> B -> A round trip', () => {
    // Account and goal are identical again; only the generation differs, and
    // that is the whole reason it is there.
    const started = ctx(1, A, GOAL);
    const afterRoundTrip = ctx(3, A, GOAL);
    expect(started.uid).toBe(afterRoundTrip.uid);
    expect(started.goalId).toBe(afterRoundTrip.goalId);
    expect(isSameContext(started, afterRoundTrip)).toBe(false);
  });

  it('rejects a response that arrives after sign-out', () => {
    expect(isSameContext(ctx(3, A, GOAL), ctx(4, null, GOAL))).toBe(false);
  });

  it('is symmetric about which side is stale', () => {
    expect(isSameContext(ctx(4, A, GOAL), ctx(3, A, GOAL))).toBe(false);
  });
});

describe('the pending record belongs to one account', () => {
  it('keys by goal and account together', () => {
    expect(pendingKey(GOAL, A)).not.toBe(pendingKey(GOAL, B));
    expect(pendingKey(GOAL, A)).not.toBe(pendingKey(OTHER_GOAL, A));
    expect(pendingKey(GOAL, A)).toContain(A);
  });

  it("does not let B read A's unsent attempt", () => {
    window.localStorage.setItem(
      pendingKey(GOAL, A),
      JSON.stringify({ goalId: GOAL, attemptId: 'attempt-a', count: 20, ts: 1, state: 'unknown' })
    );
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-a');
    // The requirement in one line: A's uncertain attempt must never appear as
    // B's effort.
    expect(loadPending(GOAL, B)).toBeNull();
  });

  it("preserves A's attempt id so A's own retry still counts once", () => {
    const row = { goalId: GOAL, attemptId: 'attempt-a', count: 20, ts: 1, state: 'unknown' };
    window.localStorage.setItem(pendingKey(GOAL, A), JSON.stringify(row));
    // Reloading yields the SAME attemptId, which is what makes the server's
    // idempotency check count the retry once rather than twice.
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-a');
  });

  it('does not read one goal record for another goal', () => {
    window.localStorage.setItem(
      pendingKey(GOAL, A),
      JSON.stringify({ goalId: GOAL, attemptId: 'attempt-a', count: 20, ts: 1, state: 'unknown' })
    );
    expect(loadPending(OTHER_GOAL, A)).toBeNull();
  });
});

describe('a legacy unscoped record is retired, never adopted', () => {
  const legacyRow = {
    goalId: GOAL,
    attemptId: 'legacy-attempt',
    count: 30,
    ts: 1,
    state: 'unknown' as const,
  };

  it('quarantines it and leaves no account able to load it', () => {
    window.localStorage.setItem(legacyPendingKey(GOAL), JSON.stringify(legacyRow));

    const retired = retireLegacyPending(GOAL);
    expect(retired?.attemptId).toBe('legacy-attempt');

    // Gone from the key anyone could inherit it from…
    expect(window.localStorage.getItem(legacyPendingKey(GOAL))).toBeNull();
    // …and not adopted by either account.
    expect(loadPending(GOAL, A)).toBeNull();
    expect(loadPending(GOAL, B)).toBeNull();

    // The attempt identity survives, so the original effort can still be
    // reconciled rather than silently lost.
    const orphanKey = Object.keys(window.localStorage).find((k) => k.includes('orphan'));
    expect(orphanKey).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(orphanKey as string) as string).attemptId).toBe(
      'legacy-attempt'
    );
  });

  it('keeps the original when the quarantine write fails, rather than losing it', () => {
    window.localStorage.setItem(legacyPendingKey(GOAL), JSON.stringify(legacyRow));
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    const retired = retireLegacyPending(GOAL);
    setItem.mockRestore();

    expect(retired?.attemptId).toBe('legacy-attempt');
    // Removing the original before the copy succeeded would have destroyed the
    // only record of the attempt identity.
    expect(window.localStorage.getItem(legacyPendingKey(GOAL))).not.toBeNull();
    // It is still inert: loadPending only ever reads account-scoped keys, so
    // no account can adopt or resubmit it.
    expect(loadPending(GOAL, A)).toBeNull();
    expect(loadPending(GOAL, B)).toBeNull();
  });

  it('is a no-op when there is no legacy record', () => {
    expect(retireLegacyPending(GOAL)).toBeNull();
  });
});
