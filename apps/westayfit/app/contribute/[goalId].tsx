import { Link, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { barPercent, integerPercent } from '../../src/goalPercent';
import {
  clearPending,
  clearPendingIfAttempt,
  isSameContext,
  loadPending,
  retireLegacyPending,
  savePendingNew,
  updatePendingIfAttempt,
  type PendingContribution,
} from '../../src/pendingContribution';
import { wsfTheme } from '../../src/theme';

// Poll wsfGoalPulse at the server cache TTL so a peer's contribution
// surfaces without a manual refresh. Matches GOAL_PULSE_CACHE_TTL_MS in
// functions-westayfit — a shorter poll pays a Firestore round-trip on every
// tick, a longer poll wastes the cache window.
const POLL_INTERVAL_MS = 2_000;


// Response shapes mirror wsfContribute / wsfGoalPulse / wsfMyContribution in
// functions-westayfit.
type GoalPulse = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
  contributorCount: number;
};

type ContributeResult = {
  addedCount: number;
  ownCredit: number;
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
  alreadyRecorded: boolean;
};

// Authenticated own credit for the signed-in member. Read from the server on
// load; never derived client-side.
type MyContribution = { ownCredit: number; unit: string };

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notSignedIn' }
  | { kind: 'notFound' }
  | { kind: 'closed'; pulse: GoalPulse; ownCredit: number }
  | { kind: 'ready'; pulse: GoalPulse; ownCredit: number }
  | { kind: 'error'; message: string };

// A persisted attempt (goalId, attemptId, count) that MAY not have reached
// the server. Stored under `wsf.pendingContribution.{goalId}` in
// localStorage so a page reload can reconcile the same attempt via
// idempotent replay — the server counts the attemptId once regardless of
// how many times the client sends it.
// A single-tap attempt id — used to make wsfContribute idempotent. A new
// one is minted per submission; a double-tap of "Log it" reuses the
// in-flight id so the server counts it once regardless of network retries.
function mintAttemptId(): string {
  const g: any = globalThis;
  if (g?.crypto?.randomUUID) {
    return g.crypto.randomUUID().replace(/-/g, '');
  }
  return `attempt_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

// barPercent + integerPercent moved to src/goalPercent so the arithmetic
// can be unit-tested without pulling this whole tsx module through jsdom.

export default function ContributeToGoal() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = params.goalId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ContributeResult | null>(null);
  const [pending, setPending] = useState<PendingContribution | null>(null);
  // Ref instead of state — the in-flight attempt id must NOT trigger a
  // re-render (would risk generating a new id mid-submit and defeat
  // idempotency). Cleared on each fresh "Log it" tap.
  const attemptRef = useRef<string | null>(null);

  const uid = user?.uid ?? null;
  // The identity a request belongs to. A response that arrives after the
  // account changed is discarded rather than applied — that is what stops a
  // delayed callback from restoring the previous person's state into the new
  // session.
  const identityRef = useRef<string | null>(uid);
  // Monotonic generation for (account, goal). Every async path captures it and
  // compares before touching state, so a late success, a late failure and a
  // late `finally` from a superseded context are all discarded. Comparing the
  // uid alone is not enough: the same account switching goals, or switching
  // A -> B -> A while a request is in flight, both pass a uid check.
  const generationRef = useRef(0);
  const contextRef = useRef<{ uid: string | null; goalId: string | undefined }>({ uid, goalId });
  const [legacyOrphan, setLegacyOrphan] = useState<PendingContribution | null>(null);

  // Restore this ACCOUNT's unconfirmed attempt for this goal, and clear
  // everything on sign-out, an account switch or a goal switch. Both the
  // pending banner and the last receipt are cleared: a receipt shows a
  // member's own credit and must not survive into someone else's session.
  useEffect(() => {
    generationRef.current += 1;
    identityRef.current = uid;
    contextRef.current = { uid, goalId };
    attemptRef.current = null;
    // Nothing from the previous context stays on screen while the new one
    // loads: not the pending banner, not the receipt, not the typed entry,
    // not an error, and not the previous ready-state totals.
    setPending(null);
    setLastResult(null);
    setLegacyOrphan(null);
    setEntry('');
    setEntryError(null);
    setSubmitting(false);
    setState({ kind: 'loading' });

    if (!goalId) return;

    // A record written before the key carried a uid belongs to an account we
    // cannot identify. It is retired, never adopted and never resubmitted.
    const orphaned = retireLegacyPending(goalId);
    if (orphaned) setLegacyOrphan(orphaned);

    if (!uid) return;
    const existing = loadPending(goalId, uid);
    if (existing) {
      setPending({ ...existing, state: 'unknown' });
      // Persist the escalated state so a second reload shows the same banner
      // even if the user does nothing. Restoring it NEVER makes it confirmed;
      // only a server response does that.
      updatePendingIfAttempt({ ...existing, state: 'unknown' }, uid, existing.attemptId);
    }

    return () => {
      // Navigating away invalidates everything outstanding, so a response that
      // lands after the screen unmounts — and after the member comes back —
      // cannot be applied to the remounted screen.
      generationRef.current += 1;
    };
  }, [goalId, uid]);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'notSignedIn' });
      return;
    }
    if (!goalId) {
      setState({ kind: 'error', message: 'Missing goal id.' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const pulseFn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const mineFn = httpsCallable<{ goalId: string }, MyContribution>(
          getFirebaseFunctions(),
          'wsfMyContribution'
        );
        // Own credit comes from the server on every load — authenticated,
        // uncached, keyed by the caller's uid — so a reload, a closed goal or
        // an authorized correction never shows a stale or invented number.
        const [pulseRes, mineRes] = await Promise.all([
          pulseFn({ goalId }),
          mineFn({ goalId }),
        ]);
        if (cancelled) return;
        const pulse = pulseRes.data;
        const ownCredit = mineRes.data.ownCredit;
        if (pulse.status !== 'active') {
          setState({ kind: 'closed', pulse, ownCredit });
          return;
        }
        setState({ kind: 'ready', pulse, ownCredit });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          setState({ kind: 'notFound' });
          return;
        }
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load goal.',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, goalId]);

  // Second effect: once the initial load has landed us on ready/closed,
  // poll wsfGoalPulse so peer contributions surface within the cache TTL.
  // Kept as a separate effect from the initial-load one so that transient
  // poll errors never clobber the load state — display/[goalId].tsx uses
  // one effect because it has no other state to protect.
  const shouldPoll = state.kind === 'ready' || state.kind === 'closed';
  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready || !user || !goalId) return;
    if (!shouldPoll) return;

    let cancelled = false;
    const fn = httpsCallable<{ goalId: string }, GoalPulse>(
      getFirebaseFunctions(),
      'wsfGoalPulse'
    );
    const tick = async () => {
      try {
        const result = await fn({ goalId });
        if (cancelled) return;
        const pulse = result.data;
        setState((prev) => {
          if (prev.kind === 'ready') {
            return pulse.status === 'active'
              ? { kind: 'ready', pulse, ownCredit: prev.ownCredit }
              : { kind: 'closed', pulse, ownCredit: prev.ownCredit };
          }
          if (prev.kind === 'closed') {
            return { kind: 'closed', pulse, ownCredit: prev.ownCredit };
          }
          // Effect fired during a transition to error/notFound/notSignedIn —
          // drop the poll result rather than clobber the terminal state.
          return prev;
        });
      } catch {
        // Transient poll error — the next tick reconciles automatically.
        // We already have a valid pulse on screen; do not surface as error.
      }
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ready, user, goalId, shouldPoll]);

  const sendContribute = useCallback(
    async (attemptId: string, count: number) => {
      // The full context this request belongs to: account, goal AND
      // generation. Captured now, compared when the response lands.
      const owner = identityRef.current;
      const startedGoal = goalId;
      const generation = generationRef.current;
      if (!owner) throw new Error('Sign in first.');
      const fn = httpsCallable<
        { goalId: string; attemptId: string; count: number },
        ContributeResult
      >(getFirebaseFunctions(), 'wsfContribute');
      const result = await fn({ goalId: goalId as string, attemptId, count });
      // A delayed response belonging to a superseded context is discarded, not
      // applied. The pending row stays under the ORIGINAL account and goal so
      // that person can still reconcile it when they come back — it is never
      // transferred, never resent as someone else, and a newer attempt is
      // never cleared because an older response arrived.
      if (
        !isSameContext(
          { generation, uid: owner, goalId: startedGoal },
          { generation: generationRef.current, uid: identityRef.current, goalId }
        )
      ) {
        return;
      }
      const data = result.data;
      // Server truth received — the pending row is no longer needed.
      clearPendingIfAttempt(goalId as string, owner, attemptId);
      setPending(null);
      setLastResult(data);
      setState((prev) => ({
        kind: data.status === 'active' ? 'ready' : 'closed',
        pulse: {
          sharedTotal: data.sharedTotal,
          target: data.target,
          unit: data.unit,
          status: data.status,
          contributorCount:
            prev.kind === 'ready' || prev.kind === 'closed'
              ? prev.pulse.contributorCount
              : 0,
        },
        ownCredit: data.ownCredit,
      }));
      // Ready for the next fresh attempt.
      attemptRef.current = null;
      setEntry('');
    },
    [goalId]
  );

  const onSubmit = useCallback(async () => {
    if (state.kind !== 'ready') return;
    if (submitting) return;
    const trimmed = entry.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      setEntryError('Type a whole number.');
      return;
    }
    const count = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(count) || count < 1 || count > 100_000) {
      setEntryError('Enter a count from 1 to 100000.');
      return;
    }
    setEntryError(null);
    setSubmitting(true);

    if (!attemptRef.current) attemptRef.current = mintAttemptId();
    const attemptId = attemptRef.current;

    // Persist BEFORE sending. If the tab crashes mid-flight, a reload sees
    // this record and offers reconcile with the SAME attemptId — the
    // server-side idempotency check will count it exactly once.
    const pendingRow: PendingContribution = {
      goalId: goalId as string,
      attemptId,
      count,
      ts: Date.now(),
      state: 'sending',
    };
    savePendingNew(pendingRow, uid as string);
    setPending(pendingRow);

    const generation = generationRef.current;
    const owner = uid as string;
    const startedGoal = goalId;
    const stillCurrent = () =>
      isSameContext(
        { generation, uid: owner, goalId: startedGoal },
        { generation: generationRef.current, uid: identityRef.current, goalId }
      );

    try {
      await sendContribute(attemptId, count);
    } catch (e) {
      // The persisted row is always escalated under the ORIGINAL account, so
      // the attempt stays reconcilable even if the context has moved on.
      const escalated: PendingContribution = { ...pendingRow, state: 'unknown' };
      // Conditional: this failure may only touch the record if the slot is
      // still ITS attempt. A newer attempt for the same account and goal is
      // never overwritten by an older one's failure.
      updatePendingIfAttempt(escalated, owner, attemptId);
      // Everything visible is guarded too: a failure from a superseded context
      // must not surface a banner or an error under a different identity.
      if (!stillCurrent()) return;
      setPending(escalated);

      const message =
        e instanceof FirebaseError &&
        e.code === 'functions/failed-precondition'
          ? 'This goal is closed or outside its window.'
          : e instanceof FirebaseError && e.code === 'functions/not-found'
            ? 'Goal not found.'
            : e instanceof FirebaseError &&
                e.code === 'functions/permission-denied'
              ? 'Members only.'
              : e instanceof Error
                ? e.message
                : 'Contribution failed.';
      setEntryError(message);
    } finally {
      // A superseded request's finally must not re-enable the new context's
      // form, which the new context already reset.
      if (stillCurrent()) setSubmitting(false);
    }
  }, [state, submitting, entry, goalId, uid, sendContribute]);

  const onReconcile = useCallback(async () => {
    if (!pending) return;
    if (submitting) return;
    setSubmitting(true);
    setEntryError(null);
    // Same attemptId + count as the persisted row. Server-side idempotency
    // returns the original body if the earlier call did land.
    attemptRef.current = pending.attemptId;
    const generation = generationRef.current;
    const owner = uid as string;
    const startedGoal = goalId;
    const stillCurrent = () =>
      isSameContext(
        { generation, uid: owner, goalId: startedGoal },
        { generation: generationRef.current, uid: identityRef.current, goalId }
      );

    // Flip the persisted state to 'sending' during the retry so a further
    // crash mid-retry still lands us on the banner.
    updatePendingIfAttempt({ ...pending, state: 'sending' }, owner, pending.attemptId);
    setPending({ ...pending, state: 'sending' });

    try {
      await sendContribute(pending.attemptId, pending.count);
    } catch (e) {
      const escalated: PendingContribution = { ...pending, state: 'unknown' };
      // Conditional, for the same reason as onSubmit: an old reconcile failure
      // must not overwrite a newer attempt's record.
      updatePendingIfAttempt(escalated, owner, pending.attemptId);
      if (!stillCurrent()) return;
      setPending(escalated);
      const message =
        e instanceof FirebaseError &&
        e.code === 'functions/failed-precondition'
          ? 'This goal is closed or outside its window.'
          : e instanceof FirebaseError && e.code === 'functions/not-found'
            ? 'Goal not found.'
            : e instanceof FirebaseError &&
                e.code === 'functions/permission-denied'
              ? 'Members only.'
              : e instanceof Error
                ? e.message
                : 'Retry failed.';
      setEntryError(message);
    } finally {
      if (stillCurrent()) setSubmitting(false);
    }
  }, [pending, submitting, goalId, uid, sendContribute]);

  const onDiscardPending = useCallback(() => {
    if (submitting || !pending) return;
    // Discarding does NOT retract the server-side record if it landed —
    // this only removes the local reminder. The user is asserting "I know
    // this is fine; stop bugging me." No shared-total mutation happens.
    clearPending(pending.goalId, uid as string);
    setPending(null);
    setEntryError(null);
  }, [pending, submitting]);

  if (!wsfAuthEnabled) {
    return (
      <AuthFlagOffPanel
        title="Contribute"
        testID="wsf-contribute-disabled"
      />
    );
  }
  if (state.kind === 'loading') {
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>Loading goal…</Text>
      </View>
    );
  }
  if (state.kind === 'notSignedIn') {
    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>Sign in to contribute</Text>
        <Link
          href="/signin"
          style={styles.link}
          testID="wsf-contribute-signin-link"
        >
          Sign in
        </Link>
      </View>
    );
  }
  if (state.kind === 'notFound') {
    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>Goal not found</Text>
        <Text style={styles.body}>
          This goal does not exist or is not visible.
        </Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.screen}>
        <Text style={styles.heading}>Something went wrong</Text>
        <Text style={styles.body}>{state.message}</Text>
      </View>
    );
  }

  const pulse = state.pulse;
  const pct = barPercent(pulse.sharedTotal, pulse.target);
  const truePct = integerPercent(pulse.sharedTotal, pulse.target);
  const ownCredit =
    state.kind === 'ready' || state.kind === 'closed' ? state.ownCredit : 0;
  const remaining = Math.max(0, pulse.target - pulse.sharedTotal);
  const overshoot = pulse.sharedTotal > pulse.target;

  return (
    <View style={styles.screen} testID="wsf-contribute-screen">
      {wsfUsingEmulators ? (
        <Text style={styles.testPill} testID="wsf-contribute-test-banner">
          LOCAL SYNTHETIC TEST
        </Text>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.subheading}>Shared total</Text>
        <Text style={styles.bigNumber} testID="wsf-contribute-shared-total">
          {pulse.sharedTotal} <Text style={styles.unit}>{pulse.unit}</Text>
        </Text>
        <Text style={styles.body}>
          Goal: {pulse.target} {pulse.unit}
        </Text>
        <View
          style={styles.barTrack}
          accessibilityLabel={`${truePct}% of goal`}
          testID="wsf-contribute-bar"
        >
          <View
            style={[
              styles.barFill,
              {
                width: `${pct}%`,
                backgroundColor: overshoot
                  ? wsfTheme.colors.accent
                  : wsfTheme.colors.primary,
              },
            ]}
          />
        </View>
        <Text style={styles.caption} testID="wsf-contribute-remaining">
          {overshoot
            ? `Past the goal by ${pulse.sharedTotal - pulse.target}`
            : remaining === 0
              ? 'Goal reached'
              : `${remaining} to go`}
        </Text>
        <Text style={styles.caption} testID="wsf-contribute-own-credit">
          Your confirmed credit: {ownCredit} {pulse.unit}
        </Text>
      </View>

      {pending ? (
        <View style={styles.pendingCard} testID="wsf-contribute-pending">
          <Text style={styles.pendingHead}>
            {pending.state === 'sending'
              ? 'Sending your count…'
              : 'Your last submission is pending'}
          </Text>
          <Text style={styles.body}>
            You entered {pending.count} {pulse.unit}. We don't yet have
            confirmation from the server. Retry is safe — the server counts
            this attempt once regardless of how many times you send it.
          </Text>
          <Pressable
            style={[styles.primary, submitting && styles.primaryDisabled]}
            onPress={onReconcile}
            disabled={submitting}
            testID="wsf-contribute-reconcile"
          >
            <Text style={styles.primaryText}>
              {submitting ? 'Retrying…' : 'Retry same submission'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondary, submitting && styles.primaryDisabled]}
            onPress={onDiscardPending}
            disabled={submitting}
            testID="wsf-contribute-discard-pending"
          >
            <Text style={styles.secondaryText}>Discard local reminder</Text>
          </Pressable>
        </View>
      ) : null}

      {state.kind === 'closed' ? (
        <View style={styles.card}>
          <Text style={styles.subheading}>This goal is closed</Text>
          <Text style={styles.body}>No more contributions accepted.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.subheading}>Add your count</Text>
          <TextInput
            style={styles.input}
            value={entry}
            onChangeText={setEntry}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="e.g. 20"
            editable={!submitting && !pending}
            testID="wsf-contribute-entry"
          />
          {entryError ? (
            <Text style={styles.errorText} testID="wsf-contribute-error">
              {entryError}
            </Text>
          ) : null}
          <Pressable
            style={[
              styles.primary,
              (submitting || !!pending) && styles.primaryDisabled,
            ]}
            onPress={onSubmit}
            disabled={submitting || !!pending}
            testID="wsf-contribute-submit"
          >
            <Text style={styles.primaryText}>
              {submitting ? 'Logging…' : pending ? 'Reconcile first' : 'Log it'}
            </Text>
          </Pressable>
          {lastResult ? (
            <View style={styles.receipt} testID="wsf-contribute-receipt">
              <Text style={styles.receiptHead}>
                {lastResult.alreadyRecorded
                  ? 'Already recorded.'
                  : `+${lastResult.addedCount} added.`}
              </Text>
              <Text style={styles.receiptLine}>
                Your total: {lastResult.ownCredit} {lastResult.unit}
              </Text>
              <Text style={styles.receiptLine}>
                Shared: {lastResult.sharedTotal} / {lastResult.target}{' '}
                {lastResult.unit}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: wsfTheme.spacing.lg,
    gap: wsfTheme.spacing.md,
    backgroundColor: wsfTheme.colors.background,
  },
  card: {
    backgroundColor: wsfTheme.colors.surface,
    padding: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    gap: wsfTheme.spacing.sm,
  },
  pendingCard: {
    backgroundColor: '#FFF5E5',
    padding: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.md,
    borderWidth: 1,
    borderColor: '#F5A623',
    gap: wsfTheme.spacing.sm,
  },
  pendingHead: {
    ...wsfTheme.typography.subheading,
    color: '#7A4A00',
  },
  testPill: {
    color: '#FFFFFF',
    backgroundColor: '#B0342A',
    fontWeight: '700',
    letterSpacing: 1,
    fontSize: 12,
    paddingHorizontal: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.xs,
    borderRadius: wsfTheme.radius.sm,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  heading: {
    ...wsfTheme.typography.heading,
    color: wsfTheme.colors.text,
  },
  subheading: {
    ...wsfTheme.typography.subheading,
    color: wsfTheme.colors.text,
  },
  body: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.text,
  },
  caption: {
    ...wsfTheme.typography.caption,
    color: wsfTheme.colors.textMuted,
  },
  bigNumber: {
    fontSize: 48,
    fontWeight: '700',
    color: wsfTheme.colors.primary,
    lineHeight: 56,
  },
  unit: {
    fontSize: 20,
    fontWeight: '400',
    color: wsfTheme.colors.textMuted,
  },
  barTrack: {
    height: 12,
    backgroundColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: wsfTheme.radius.pill,
  },
  input: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.sm,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    fontSize: 20,
    color: wsfTheme.colors.text,
    backgroundColor: wsfTheme.colors.background,
  },
  primary: {
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
  },
  primaryDisabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: wsfTheme.colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    paddingVertical: wsfTheme.spacing.sm,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
  },
  secondaryText: {
    color: wsfTheme.colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    ...wsfTheme.typography.caption,
    color: '#B0342A',
  },
  receipt: {
    marginTop: wsfTheme.spacing.md,
    padding: wsfTheme.spacing.md,
    borderRadius: wsfTheme.radius.sm,
    backgroundColor: wsfTheme.colors.background,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    gap: wsfTheme.spacing.xs,
  },
  receiptHead: {
    ...wsfTheme.typography.subheading,
    color: wsfTheme.colors.text,
  },
  receiptLine: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.text,
  },
  link: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.primary,
    textDecorationLine: 'underline',
  },
});
