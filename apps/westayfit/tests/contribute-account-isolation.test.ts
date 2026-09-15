import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPendingIfAttempt,
  isSameContext,
  legacyPendingKey,
  loadPending,
  pendingKey,
  retireLegacyPending,
  savePendingIfAttempt,
  type PendingContribution,
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

describe('persisted state is guarded per attempt, not only per context', () => {
  /**
   * The defect these cover: both catch blocks persisted unconditionally, so a
   * failure belonging to attempt 1 could overwrite attempt 2's record for the
   * same account and goal — resurrecting reconciled work underneath work the
   * member was still doing. The visible error was suppressed by the context
   * guard; the write was not.
   *
   * These are helper-level tests. The browser test in
   * tests-e2e/e5-community-goal-seam.spec.ts does NOT discriminate this case:
   * a navigation-based account switch tears down the in-flight request, so the
   * late catch never runs there. That is recorded rather than glossed.
   */
  const row = (attemptId: string, count: number): PendingContribution => ({
    goalId: GOAL,
    attemptId,
    count,
    ts: 1,
    state: 'sending',
  });

  it('an old failure does not overwrite a newer attempt', () => {
    // Attempt 2 owns the slot.
    savePendingIfAttempt(row('attempt-2', 7), A, 'attempt-2');
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-2');

    // Attempt 1 fails late and tries to escalate its own row.
    const wrote = savePendingIfAttempt(
      { ...row('attempt-1', 11), state: 'unknown' },
      A,
      'attempt-1'
    );

    expect(wrote, 'the superseded attempt must not write').toBe(false);
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-2');
    expect(loadPending(GOAL, A)?.count).toBe(7);
  });

  it('an old success does not clear a newer attempt', () => {
    savePendingIfAttempt(row('attempt-2', 7), A, 'attempt-2');
    const cleared = clearPendingIfAttempt(GOAL, A, 'attempt-1');
    expect(cleared, 'the superseded attempt must not clear').toBe(false);
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-2');
  });

  it('the attempt that owns the slot may still update and clear it', () => {
    savePendingIfAttempt(row('attempt-2', 7), A, 'attempt-2');
    expect(savePendingIfAttempt({ ...row('attempt-2', 7), state: 'unknown' }, A, 'attempt-2')).toBe(
      true
    );
    expect(loadPending(GOAL, A)?.state).toBe('unknown');
    expect(clearPendingIfAttempt(GOAL, A, 'attempt-2')).toBe(true);
    expect(loadPending(GOAL, A)).toBeNull();
  });

  it('the full sequence: attempt 1 reconciled, attempt 2 started, attempt 1 fails late', () => {
    // A starts attempt 1.
    savePendingIfAttempt(row('attempt-1', 11), A, 'attempt-1');
    // A reconciles it successfully — the slot is released.
    expect(clearPendingIfAttempt(GOAL, A, 'attempt-1')).toBe(true);
    // A starts attempt 2.
    savePendingIfAttempt(row('attempt-2', 7), A, 'attempt-2');
    // Attempt 1's original request finally fails.
    savePendingIfAttempt({ ...row('attempt-1', 11), state: 'unknown' }, A, 'attempt-1');

    // Attempt 2 stands; attempt 1 is not resurrected over it.
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-2');
    expect(loadPending(GOAL, A)?.count).toBe(7);
  });

  it("does not touch another account's slot", () => {
    savePendingIfAttempt(row('attempt-b', 5), B, 'attempt-b');
    savePendingIfAttempt(row('attempt-a', 9), A, 'attempt-a');
    expect(loadPending(GOAL, B)?.attemptId).toBe('attempt-b');
    expect(loadPending(GOAL, A)?.attemptId).toBe('attempt-a');
  });
});
