import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import {
  classifyContributeError,
  parseEntry,
  refusalCopy,
  resultCopy,
  resultVariant,
  stepEntry,
  type RefusalReason,
} from '../../src/contributionFlow';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFirestore, getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import {
  clearPendingIfAttempt,
  isSameContext,
  loadPending,
  retireLegacyPending,
  savePendingNew,
  updatePendingIfAttempt,
  type PendingContribution,
} from '../../src/pendingContribution';
import { wsfTheme } from '../../src/theme';
import { PROGRESS_GREEN } from '../../src/ui/brandAssets';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import {
  formatCount,
  percentLabel,
  statusLine,
  totalOfTargetLabel,
} from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

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

/**
 * Optional labels for the screen, shown only once the SERVER has confirmed
 * both facts a route parameter merely hints at: the signed-in account is an
 * active member of that community (wsfListGoals refuses everyone else) and
 * this goal belongs to it (it appears in that list). The community name then
 * comes from the group document, which only members can read. Anything short
 * of that renders the generic experience: no name, no title, no leak.
 */
type ScreenContext =
  | { kind: 'none' }
  | { kind: 'verified'; groupId: string; communityName: string; goalTitle: string };

type ListedGoal = { goalId: string; title: string };

// The pre-write steps. Everything after "Record" is derived from the
// attempt's own state (sending, unknown, refused, confirmed), not from here.
type Step = 'move' | 'enter' | 'review';

type Refusal = { reason: RefusalReason; count: number };

// A single-tap attempt id — used to make wsfContribute idempotent. A new
// one is minted per submission; a double-tap of "Record" reuses the
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

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function ContributeToGoal() {
  const params = useLocalSearchParams<{ goalId: string; groupId?: string; mode?: string }>();
  const goalId = params.goalId;
  const groupIdHint = typeof params.groupId === 'string' && params.groupId ? params.groupId : null;
  // Community Home already chose the branch; a cold link without a mode
  // starts at result entry, the most direct path.
  const initialStep: Step = params.mode === 'move' ? 'move' : 'enter';
  const { ready, user } = useWsfAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [context, setContext] = useState<ScreenContext>({ kind: 'none' });
  const [step, setStep] = useState<Step>(initialStep);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ContributeResult | null>(null);
  const [pending, setPending] = useState<PendingContribution | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Ref instead of state — the in-flight attempt id must NOT trigger a
  // re-render (would risk generating a new id mid-submit and defeat
  // idempotency). Cleared on each fresh "Record" tap.
  const attemptRef = useRef<string | null>(null);
  // The last confirmed shared total the screen showed before the write. The
  // result reads it to tell "our goal is reached" from "we were already past
  // it"; it never produces a member-specific crossing claim.
  const sharedBeforeRef = useRef<number | null>(null);

  // Optional timer on the movement screen. It measures nothing the app
  // records; it is a stopwatch for the member's own reference.
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerBase, setTimerBase] = useState(0); // elapsed ms accumulated while paused
  const [timerStartedAt, setTimerStartedAt] = useState<number | null>(null);
  const [timerNow, setTimerNow] = useState(0);
  const timerElapsed = timerBase + (timerRunning && timerStartedAt != null ? timerNow - timerStartedAt : 0);
  const timerUsed = timerRunning || timerBase > 0;

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
  // pending screen and the last receipt are cleared: a receipt shows a
  // member's own credit and must not survive into someone else's session.
  useEffect(() => {
    generationRef.current += 1;
    identityRef.current = uid;
    contextRef.current = { uid, goalId };
    attemptRef.current = null;
    // Nothing from the previous context stays on screen while the new one
    // loads: not the pending screen, not the receipt, not the typed entry,
    // not an error, not a refusal, and not the previous ready-state totals.
    setPending(null);
    setLastResult(null);
    setLegacyOrphan(null);
    setRefusal(null);
    sharedBeforeRef.current = null;
    setEntry('');
    setEntryError(null);
    setReviewCount(null);
    setSubmitting(false);
    setStep(initialStep);
    setContext({ kind: 'none' });
    setState({ kind: 'loading' });
    setTimerBase(0);
    setTimerStartedAt(null);
    setTimerRunning(false);

    if (!goalId) return;

    // A record written before the key carried a uid belongs to an account we
    // cannot identify. It is retired, never adopted and never resubmitted.
    const orphaned = retireLegacyPending(goalId);
    if (orphaned) setLegacyOrphan(orphaned);

    if (!uid) return;
    const existing = loadPending(goalId, uid);
    if (existing) {
      setPending({ ...existing, state: 'unknown' });
      // Persist the escalated state so a second reload shows the same screen
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
    // initialStep is derived from the route's mode param; a mode change on
    // the same goal is not a context change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Optional labels, verified server-side before they are shown together.
  // Independent of the goal load: a failure here only means the generic
  // experience, never a blocked contribution.
  useEffect(() => {
    if (!wsfAuthEnabled || !ready || !user || !goalId || !groupIdHint) return;
    let cancelled = false;
    (async () => {
      try {
        const listFn = httpsCallable<{ groupId: string }, { goals: ListedGoal[] }>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const listed = await listFn({ groupId: groupIdHint });
        if (cancelled) return;
        const goal = listed.data.goals.find((g) => g.goalId === goalId);
        if (!goal) return;
        const snap = await getDoc(doc(getFirebaseFirestore(), 'wsfCommunityGroups', groupIdHint));
        if (cancelled) return;
        const name = (snap.data() as { displayName?: unknown } | undefined)?.displayName;
        if (typeof name !== 'string' || !name) return;
        setContext({ kind: 'verified', groupId: groupIdHint, communityName: name, goalTitle: goal.title });
      } catch {
        // Not a member, unknown group, or a read refused: stay generic.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, goalId, groupIdHint]);

  // Poll wsfGoalPulse only while the member is still before the write. Once
  // an attempt is in flight, unknown, refused or confirmed, the screen shows
  // that attempt's own truth and a cached poll must not overwrite it.
  const beforeWrite = !pending && !refusal && !lastResult;
  const shouldPoll = beforeWrite && (state.kind === 'ready' || state.kind === 'closed');
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

  // Timer tick, only while running.
  useEffect(() => {
    if (!timerRunning) return;
    setTimerNow(Date.now());
    const t = setInterval(() => setTimerNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timerRunning]);

  const onTimerStart = useCallback(() => {
    const now = Date.now();
    setTimerStartedAt(now);
    setTimerNow(now);
    setTimerRunning(true);
  }, []);
  const onTimerPause = useCallback(() => {
    if (timerStartedAt != null) setTimerBase((b) => b + (Date.now() - timerStartedAt));
    setTimerStartedAt(null);
    setTimerRunning(false);
  }, [timerStartedAt]);
  const onTimerReset = useCallback(() => {
    setTimerBase(0);
    setTimerStartedAt(null);
    setTimerRunning(false);
  }, []);
  // Leaving the movement screen: a running timer is paused, not lost.
  const onDoneMoving = useCallback(() => {
    if (timerRunning) onTimerPause();
    setStep('enter');
  }, [timerRunning, onTimerPause]);

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
      // PACKAGE E: the shared-state fields come back only when the caller is
      // still authorized to see them. A caller who lost membership mid-session
      // and replays a landed attempt gets the server's own-only receipt: the
      // effort happened, it counted once, here is what it was — and nothing
      // about where the community stands now. The receipt renders as exactly
      // that (no shared numbers, no mark, no further contribution). The load
      // state is left untouched so nothing invents community progress, and
      // the next load of this route answers with the same non-enumerating
      // not-found the display path gives.
      if (
        data.sharedTotal === undefined ||
        data.target === undefined ||
        data.unit === undefined ||
        data.status === undefined
      ) {
        attemptRef.current = null;
        setReviewCount(null);
        return;
      }
      const nextStatus = data.status;
      setState({
        kind: nextStatus === 'active' ? 'ready' : 'closed',
        pulse: {
          sharedTotal: data.sharedTotal,
          target: data.target,
          unit: data.unit,
          status: nextStatus,
        },
        ownCredit: data.ownCredit,
      });
      // Ready for the next fresh attempt.
      attemptRef.current = null;
      setEntry('');
      setReviewCount(null);
    },
    [goalId]
  );

  // Entry → review. No network write happens here.
  const onReview = useCallback(() => {
    if (state.kind !== 'ready') return;
    const parsed = parseEntry(entry);
    if (!parsed.ok) {
      setEntryError(parsed.message);
      return;
    }
    setEntryError(null);
    setReviewCount(parsed.count);
    setStep('review');
  }, [state.kind, entry]);

  const onEdit = useCallback(() => {
    setStep('enter');
  }, []);

  // Review → record. The explicit confirmation boundary: the only place a
  // new attempt is created and sent.
  const onRecord = useCallback(async () => {
    if (state.kind !== 'ready') return;
    if (submitting) return;
    if (reviewCount == null) return;
    const count = reviewCount;
    setEntryError(null);
    setSubmitting(true);
    sharedBeforeRef.current = state.pulse.sharedTotal;

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
      const failure = classifyContributeError(e);
      if (failure.kind === 'refused') {
        // The server ran the request and refused it: nothing was recorded and
        // nothing will be. The reminder would only ask the member to replay a
        // request that will be refused again, so it is retired — under the
        // ORIGINAL account, and only if the slot is still this attempt.
        clearPendingIfAttempt(goalId as string, owner, attemptId);
        if (!stillCurrent()) return;
        setPending(null);
        attemptRef.current = null;
        setRefusal({ reason: failure.reason, count });
      } else {
        // Unknown outcome: the persisted row is escalated under the ORIGINAL
        // account, so the attempt stays reconcilable even if the context has
        // moved on. Conditional: this failure may only touch the record if
        // the slot is still ITS attempt.
        const escalated: PendingContribution = { ...pendingRow, state: 'unknown' };
        updatePendingIfAttempt(escalated, owner, attemptId);
        if (!stillCurrent()) return;
        setPending(escalated);
      }
    } finally {
      // A superseded request's finally must not re-enable the new context's
      // form, which the new context already reset.
      if (stillCurrent()) setSubmitting(false);
    }
  }, [state, submitting, reviewCount, goalId, uid, sendContribute]);

  // Replay the SAME attempt. The server keys idempotency on goal, account and
  // attemptId and returns the original receipt if the earlier call landed.
  const onReconcile = useCallback(async () => {
    if (!pending) return;
    if (submitting) return;
    setSubmitting(true);
    setEntryError(null);
    attemptRef.current = pending.attemptId;
    sharedBeforeRef.current =
      state.kind === 'ready' || state.kind === 'closed' ? state.pulse.sharedTotal : null;
    const generation = generationRef.current;
    const owner = uid as string;
    const startedGoal = goalId;
    const stillCurrent = () =>
      isSameContext(
        { generation, uid: owner, goalId: startedGoal },
        { generation: generationRef.current, uid: identityRef.current, goalId }
      );

    // Flip the persisted state to 'sending' during the replay so a further
    // crash mid-replay still lands us on the pending screen.
    updatePendingIfAttempt({ ...pending, state: 'sending' }, owner, pending.attemptId);
    setPending({ ...pending, state: 'sending' });

    try {
      await sendContribute(pending.attemptId, pending.count);
    } catch (e) {
      const failure = classifyContributeError(e);
      if (failure.kind === 'refused') {
        clearPendingIfAttempt(goalId as string, owner, pending.attemptId);
        if (!stillCurrent()) return;
        setPending(null);
        attemptRef.current = null;
        setRefusal({ reason: failure.reason, count: pending.count });
      } else {
        const escalated: PendingContribution = { ...pending, state: 'unknown' };
        // Conditional, for the same reason as onRecord: an old replay failure
        // must not overwrite a newer attempt's record.
        updatePendingIfAttempt(escalated, owner, pending.attemptId);
        if (!stillCurrent()) return;
        setPending(escalated);
      }
    } finally {
      if (stillCurrent()) setSubmitting(false);
    }
  }, [pending, submitting, goalId, uid, sendContribute, state]);

  // There is deliberately no control that discards an unresolved attempt's
  // reminder: it is the only recovery context for effort whose outcome is
  // unknown. The supported path is to leave and come back, restore the same
  // attempt, and confirm it. (Storage cleanup on account/goal transitions
  // lives in src/pendingContribution.ts.)

  const onRefusalEdit = useCallback(() => {
    setRefusal(null);
    setStep('enter');
  }, []);

  // ---- render ---------------------------------------------------------------

  const communityName = context.kind === 'verified' ? context.communityName : null;
  const backHref = context.kind === 'verified' ? `/community/${context.groupId}` : '/';
  const backLabel = context.kind === 'verified' ? 'Back to community' : 'Back to home';
  const heroWeWidth = Math.max(160, Math.min(280, windowWidth - 2 * 20 - 2 * 22));
  const contextWeWidth = 88;

  const renderChrome = (showBack: boolean) => (
    <View style={styles.chrome}>
      <WsfWordmark variant="navy" height={22} testID="wsf-contribute-wordmark" />
      {showBack ? (
        <ButtonLink
          href={backHref}
          style={styles.chromeLink}
          textStyle={styles.chromeLinkText}
          testID="wsf-contribute-back"
          label={backLabel}
        />
      ) : null}
    </View>
  );

  const renderTestNote = () =>
    wsfUsingEmulators ? (
      <Text style={styles.testNote} testID="wsf-contribute-test-banner">
        Local synthetic test
      </Text>
    ) : null;

  // The community/goal labels, shown together only when verified.
  const renderContextLabels = () =>
    context.kind === 'verified' ? (
      <View style={styles.contextLabels}>
        <Text style={styles.contextCommunity} testID="wsf-contribute-community">
          {context.communityName}
        </Text>
        <Text style={styles.contextGoal} testID="wsf-contribute-goal-title">
          {context.goalTitle}
        </Text>
      </View>
    ) : null;

  const screen = (children: React.ReactNode, testID?: string) => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Contribute" testID="wsf-contribute-disabled" />;
  }
  if (state.kind === 'loading') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.quietCard}>
          <ActivityIndicator color={NAVY} />
          <Text style={styles.body}>Loading goal…</Text>
        </View>
      </>
    );
  }
  if (state.kind === 'notSignedIn') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-signed-out">
          <Text style={styles.heading}>Sign in to contribute</Text>
          <Text style={styles.body}>
            Contributions are recorded to your account, so sign in before you record one.
          </Text>
          <ButtonLink
            href="/signin"
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
            testID="wsf-contribute-signin-link"
            label="Sign in"
          />
        </View>
      </>
    );
  }
  if (state.kind === 'notFound') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-not-found">
          <Text style={styles.heading}>Goal not found</Text>
          <Text style={styles.body}>
            This goal doesn’t exist or isn’t available to this account.
          </Text>
          <ButtonLink
            href="/"
            style={styles.secondaryButton}
            textStyle={styles.secondaryButtonText}
            testID="wsf-contribute-home"
            label="Back to home"
          />
        </View>
      </>
    );
  }
  if (state.kind === 'error') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-load-error">
          <Text style={styles.heading}>Something went wrong</Text>
          <Text style={styles.body}>{state.message}</Text>
          <ButtonLink
            href="/"
            style={styles.secondaryButton}
            textStyle={styles.secondaryButtonText}
            testID="wsf-contribute-home"
            label="Back to home"
          />
        </View>
      </>
    );
  }

  const pulse = state.pulse;
  const unit = pulse.unit;
  const ownCredit = state.ownCredit;

  const ownCreditLine = (value: number, u: string) => (
    <Text style={styles.ownCredit} testID="wsf-contribute-own-credit">
      {`Your total on this goal: ${formatCount(value)} ${u}`}
    </Text>
  );

  // Compact confirmed context: small navy WE beside the exact numbers.
  const renderCompactProgress = () => (
    <View style={styles.compactProgress} testID="wsf-contribute-context">
      <LivingWeProgress
        completed={pulse.sharedTotal}
        target={pulse.target}
        unit={unit}
        width={contextWeWidth}
        surface="light"
        testID="wsf-contribute-context-we"
      />
      <View style={styles.compactText}>
        <Text style={styles.compactTotal} testID="wsf-contribute-shared-total">
          {totalOfTargetLabel(pulse.sharedTotal, pulse.target, unit)}
        </Text>
        <Text style={styles.compactPercent}>{`${percentLabel(pulse.sharedTotal, pulse.target)} complete`}</Text>
        {ownCreditLine(ownCredit, unit)}
      </View>
    </View>
  );

  // ---- confirmed result: the signature moment -------------------------------
  if (lastResult) {
    const r = lastResult;
    const variant = resultVariant(r, sharedBeforeRef.current);
    const copy = resultCopy(r, communityName, unit, sharedBeforeRef.current);
    const hasShared = variant !== 'ownOnly';
    return screen(
      <>
        {renderChrome(false)}
        <View
          style={styles.hero}
          testID="wsf-contribute-receipt"
          {...({ dataSet: { variant } } as Record<string, unknown>)}
        >
          <Text style={styles.heroEyebrow}>{r.alreadyRecorded ? 'Already recorded' : 'Recorded'}</Text>
          <Text style={styles.heroHeadline} testID="wsf-contribute-result-headline">
            {copy.headline}
          </Text>
          <Text style={styles.heroSubline} testID="wsf-contribute-result-subline">
            {copy.subline}
          </Text>
          {hasShared ? (
            <>
              <View style={styles.weWrap}>
                <LivingWeProgress
                  completed={r.sharedTotal}
                  target={r.target}
                  unit={r.unit}
                  width={heroWeWidth}
                  surface="dark"
                  testID="wsf-contribute-we"
                />
              </View>
              <View style={styles.heroFacts}>
                <Text style={styles.heroTotal} testID="wsf-contribute-shared-total">
                  {totalOfTargetLabel(r.sharedTotal, r.target, r.unit)}
                </Text>
                <Text style={styles.heroPercent} testID="wsf-contribute-percent">
                  {`${percentLabel(r.sharedTotal, r.target)} complete`}
                </Text>
                <Text style={styles.heroStatus} testID="wsf-contribute-status">
                  {statusLine(r.sharedTotal, r.target, r.status)}
                </Text>
              </View>
              {copy.standing ? (
                <Text style={styles.heroStanding} testID="wsf-contribute-result-standing">
                  {copy.standing}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
        {ownCreditLine(r.ownCredit, hasShared ? r.unit : unit)}
        {hasShared ? renderContextLabels() : null}
        <View style={styles.actions}>
          <ButtonLink
            href={hasShared ? backHref : '/'}
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
            testID="wsf-contribute-back"
            label={hasShared ? backLabel : 'Back to home'}
          />
          {/*
            DESIGN / DATA GAP — REPEAT POLICY: no "Add another contribution"
            here. The goal schema carries no published repeat rule, so the
            result does not encourage an immediate second attempt. The
            community page's goal action remains available.
          */}
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- definitive refusal ---------------------------------------------------
  if (refusal) {
    const copy = refusalCopy(refusal.reason, refusal.count, unit);
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-refused" {...({ dataSet: { reason: refusal.reason } } as Record<string, unknown>)}>
          <Text style={styles.eyebrowMuted}>Not recorded</Text>
          <Text style={styles.heading} testID="wsf-contribute-refused-headline">
            {copy.headline}
          </Text>
          <Text style={styles.body} testID="wsf-contribute-refused-body">
            {copy.body}
          </Text>
          <View style={styles.actions}>
            {refusal.reason === 'invalid' ? (
              <Pressable
                onPress={onRefusalEdit}
                accessibilityRole="button"
                style={styles.primaryButton}
                testID="wsf-contribute-refused-edit"
              >
                <Text style={styles.primaryButtonText}>Edit the number</Text>
              </Pressable>
            ) : null}
            <ButtonLink
              href={refusal.reason === 'signedOut' ? '/signin' : backHref}
              style={refusal.reason === 'invalid' ? styles.secondaryButton : styles.primaryButton}
              textStyle={refusal.reason === 'invalid' ? styles.secondaryButtonText : styles.primaryButtonText}
              testID="wsf-contribute-back"
              label={refusal.reason === 'signedOut' ? 'Sign in' : backLabel}
            />
          </View>
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- recording (in flight) -------------------------------------------------
  if (pending && pending.state === 'sending') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-recording">
          <ActivityIndicator color={NAVY} size="large" />
          <Text style={styles.heading}>Recording your contribution…</Text>
          <Text style={styles.body}>{`${formatCount(pending.count)} ${unit}`}</Text>
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- unknown outcome --------------------------------------------------------
  if (pending) {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.pendingCard} testID="wsf-contribute-pending">
          <Text style={styles.eyebrowMuted}>Not confirmed yet</Text>
          <Text style={styles.heading}>We couldn’t confirm your contribution yet.</Text>
          <Text style={styles.body}>
            We don’t know whether this effort was recorded. Don’t record it again.
          </Text>
          <Text style={styles.pendingCount} testID="wsf-contribute-pending-count">
            {`You entered ${formatCount(pending.count)} ${unit}.`}
          </Text>
          <Pressable
            onPress={onReconcile}
            disabled={submitting}
            accessibilityRole="button"
            style={styles.primaryButton}
            testID="wsf-contribute-reconcile"
          >
            <Text style={styles.primaryButtonText}>Confirm this contribution</Text>
          </Pressable>
          <Text style={styles.caption}>
            This sends the same attempt again. If it already reached us, it will not count twice.
          </Text>
          <Text style={styles.caption}>
            You can leave this page. The same attempt will be here when you come back.
          </Text>
        </View>
        <View style={styles.actions}>
          <ButtonLink
            href={backHref}
            style={styles.tertiaryButton}
            textStyle={styles.tertiaryButtonText}
            testID="wsf-contribute-back"
            label={backLabel}
          />
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- closed goal ------------------------------------------------------------
  if (state.kind === 'closed') {
    return screen(
      <>
        {renderChrome(false)}
        {renderContextLabels()}
        <View style={styles.hero} testID="wsf-contribute-closed">
          <Text style={styles.heroEyebrow}>Closed</Text>
          <Text style={styles.heroHeadline}>This goal is closed.</Text>
          <View style={styles.weWrap}>
            <LivingWeProgress
              completed={pulse.sharedTotal}
              target={pulse.target}
              unit={unit}
              width={heroWeWidth}
              surface="dark"
              testID="wsf-contribute-we"
            />
          </View>
          <View style={styles.heroFacts}>
            <Text style={styles.heroTotal} testID="wsf-contribute-shared-total">
              {totalOfTargetLabel(pulse.sharedTotal, pulse.target, unit)}
            </Text>
            <Text style={styles.heroPercent} testID="wsf-contribute-percent">
              {`${percentLabel(pulse.sharedTotal, pulse.target)} complete`}
            </Text>
            <Text style={styles.heroStatus} testID="wsf-contribute-status">
              {statusLine(pulse.sharedTotal, pulse.target, pulse.status)}
            </Text>
          </View>
        </View>
        {ownCreditLine(ownCredit, unit)}
        <Text style={styles.body}>It is no longer taking contributions.</Text>
        <View style={styles.actions}>
          <ButtonLink
            href={backHref}
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
            testID="wsf-contribute-back"
            label={backLabel}
          />
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- review ---------------------------------------------------------------
  if (step === 'review' && reviewCount != null) {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-review-screen">
          <Text style={styles.eyebrowMuted}>Review</Text>
          <Text style={styles.heading}>Review your contribution</Text>
          {renderContextLabels()}
          <Text style={styles.reviewQuantity} testID="wsf-contribute-review-quantity">
            {`${formatCount(reviewCount)} ${unit}`}
          </Text>
          <Text style={styles.body}>This will be recorded once toward this goal.</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onRecord}
              disabled={submitting}
              accessibilityRole="button"
              style={styles.primaryButton}
              testID="wsf-contribute-submit"
            >
              <Text style={styles.primaryButtonText}>{`Record ${formatCount(reviewCount)} ${unit}`}</Text>
            </Pressable>
            <Pressable
              onPress={onEdit}
              disabled={submitting}
              accessibilityRole="button"
              style={styles.secondaryButton}
              testID="wsf-contribute-edit"
            >
              <Text style={styles.secondaryButtonText}>Edit</Text>
            </Pressable>
          </View>
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- start moving -----------------------------------------------------------
  if (step === 'move') {
    return screen(
      <>
        {renderChrome(true)}
        {renderContextLabels()}
        {renderCompactProgress()}
        <View style={styles.card} testID="wsf-contribute-move-screen">
          <Text style={styles.heading}>Ready when you are.</Text>
          <Text style={styles.body}>
            {`Count your own ${unit}. When you’re finished, enter the number you completed.`}
          </Text>
          <View style={styles.timerBox} testID="wsf-contribute-timer">
            <Text style={styles.eyebrowMuted}>Optional timer</Text>
            <Text style={styles.timerClock} testID="wsf-contribute-timer-clock">
              {formatElapsed(timerElapsed)}
            </Text>
            <View style={styles.timerActions}>
              {timerRunning ? (
                <Pressable onPress={onTimerPause} accessibilityRole="button" style={styles.secondaryButton} testID="wsf-contribute-timer-pause">
                  <Text style={styles.secondaryButtonText}>Pause</Text>
                </Pressable>
              ) : (
                <Pressable onPress={onTimerStart} accessibilityRole="button" style={styles.secondaryButton} testID="wsf-contribute-timer-start">
                  <Text style={styles.secondaryButtonText}>{timerBase > 0 ? 'Resume' : 'Start timer'}</Text>
                </Pressable>
              )}
              {timerUsed ? (
                <Pressable onPress={onTimerReset} accessibilityRole="button" style={styles.tertiaryButton} testID="wsf-contribute-timer-reset">
                  <Text style={styles.tertiaryButtonText}>Reset</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.caption}>
              For your own reference. It doesn’t record anything or change the community total.
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={onDoneMoving}
              accessibilityRole="button"
              style={styles.primaryButton}
              testID="wsf-contribute-done"
            >
              <Text style={styles.primaryButtonText}>I’m done — enter my {unit}</Text>
            </Pressable>
            {!timerUsed ? (
              <Pressable
                onPress={onDoneMoving}
                accessibilityRole="button"
                style={styles.tertiaryButton}
                testID="wsf-contribute-skip-timer"
              >
                <Text style={styles.tertiaryButtonText}>Skip timer and enter {unit}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- enter result -----------------------------------------------------------
  return screen(
    <>
      {renderChrome(true)}
      {renderContextLabels()}
      {renderCompactProgress()}
      <View style={styles.card} testID="wsf-contribute-entry-screen">
        <Text style={styles.heading}>{`How many ${unit} did you complete?`}</Text>
        <View style={styles.entryRow}>
          <Pressable
            onPress={() => setEntry((v) => stepEntry(v, -1))}
            accessibilityRole="button"
            accessibilityLabel="One fewer"
            style={styles.stepButton}
            testID="wsf-contribute-minus"
          >
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <TextInput
            style={styles.entryInput}
            value={entry}
            onChangeText={(v) => {
              setEntry(v);
              if (entryError) setEntryError(null);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="0"
            placeholderTextColor="#9AA6B8"
            accessibilityLabel={`Number of ${unit} completed`}
            testID="wsf-contribute-entry"
          />
          <Pressable
            onPress={() => setEntry((v) => stepEntry(v, 1))}
            accessibilityRole="button"
            accessibilityLabel="One more"
            style={styles.stepButton}
            testID="wsf-contribute-plus"
          >
            <Text style={styles.stepButtonText}>+</Text>
          </Pressable>
        </View>
        <View style={styles.quickRow}>
          {[5, 10, 25].map((n) => (
            <Pressable
              key={n}
              onPress={() => setEntry((v) => stepEntry(v, n))}
              accessibilityRole="button"
              style={styles.quickChip}
              testID={`wsf-contribute-plus-${n}`}
            >
              <Text style={styles.quickChipText}>{`+${n}`}</Text>
            </Pressable>
          ))}
        </View>
        {entryError ? (
          <Text style={styles.errorText} testID="wsf-contribute-error">
            {entryError}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            onPress={onReview}
            accessibilityRole="button"
            style={styles.primaryButton}
            testID="wsf-contribute-review"
          >
            <Text style={styles.primaryButtonText}>Review my contribution</Text>
          </Pressable>
        </View>
      </View>
      {renderTestNote()}
    </>,
    'wsf-contribute-screen'
  );
}

const NAVY = wsfTheme.colors.primary;
const CREAM = wsfTheme.colors.background;
const CARD_BORDER = '#E3E7E1';
const HERO_MUTED = 'rgba(247,245,240,0.78)';

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: CREAM },
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    backgroundColor: CREAM,
  },
  inner: { maxWidth: 560, width: '100%', gap: 16 },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  chromeLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  chromeLinkText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  contextLabels: { gap: 2 },
  contextCommunity: { color: wsfTheme.colors.textMuted, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  contextGoal: { color: wsfTheme.colors.text, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  compactProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  compactText: { flex: 1, gap: 2 },
  compactTotal: { color: wsfTheme.colors.text, fontSize: 17, fontWeight: '800' },
  compactPercent: { color: wsfTheme.colors.text, fontSize: 14, fontWeight: '600' },
  ownCredit: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },

  card: {
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  quietCard: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  pendingCard: {
    backgroundColor: '#FFF8E8',
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: '#EAD9A6',
  },
  pendingCount: { color: wsfTheme.colors.text, fontSize: 18, fontWeight: '800' },
  eyebrowMuted: {
    color: wsfTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  body: { color: wsfTheme.colors.text, fontSize: 16, lineHeight: 22 },
  caption: { color: wsfTheme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  errorText: { color: '#B4232C', fontSize: 15, lineHeight: 21 },

  // hero (result, closed)
  hero: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 22,
    gap: 8,
  },
  heroEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroHeadline: { color: CREAM, fontSize: 28, fontWeight: '800', lineHeight: 34, letterSpacing: -0.3 },
  heroSubline: { color: PROGRESS_GREEN, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  weWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 6 },
  heroFacts: { alignItems: 'center', gap: 2 },
  heroTotal: { color: CREAM, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
  heroPercent: { color: PROGRESS_GREEN, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  heroStatus: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  heroStanding: { color: CREAM, fontSize: 15, lineHeight: 21, textAlign: 'center', paddingTop: 6 },

  // entry
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryInput: {
    // flex: 1 alone lets a text input keep its intrinsic width and overflow
    // the row on web; minWidth 0 lets it shrink to the space that is there.
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    borderWidth: 2,
    borderColor: NAVY,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 40,
    fontWeight: '800',
    color: wsfTheme.colors.text,
    textAlign: 'center',
    backgroundColor: CREAM,
  },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: { color: NAVY, fontSize: 28, fontWeight: '700', lineHeight: 32 },
  quickRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  quickChip: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#EEF2F6',
    justifyContent: 'center',
  },
  quickChipText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  reviewQuantity: { color: wsfTheme.colors.text, fontSize: 44, fontWeight: '800', lineHeight: 52, letterSpacing: -0.5 },

  // timer
  timerBox: {
    backgroundColor: CREAM,
    borderRadius: 16,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  timerClock: { color: wsfTheme.colors.text, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // buttons
  actions: { gap: 10, marginTop: 4 },
  primaryButton: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: NAVY, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    alignSelf: 'stretch',
    backgroundColor: wsfTheme.colors.surface,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tertiaryButton: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  tertiaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  testNote: { color: wsfTheme.colors.textMuted, fontSize: 11, textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase' },
});
