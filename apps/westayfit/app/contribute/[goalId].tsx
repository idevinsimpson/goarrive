import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { signOut } from 'firebase/auth';
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

import {
  guideHeading,
  selectActivityGuide,
  SELF_COUNT_NOTE,
} from '../../src/activityGuides';
import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import {
  canAddMore,
  classifyContributeError,
  parseEntry,
  recordMoreLabel,
  refusalCopy,
  repeatNotice,
  resolveRepeatPolicy,
  resultCopy,
  resultVariant,
  stepEntry,
  type RefusalReason,
  type RepeatPolicy,
} from '../../src/contributionFlow';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import {
  KIOSK_TICK_MS,
  KIOSK_UNRESOLVED_NOTICE,
  clearKioskReturnGoal,
  isKioskFlag,
  kioskCountdownExpired,
  kioskCountdownLabel,
  kioskRemainingMs,
  kioskRemainingSeconds,
  runKioskFinish,
  type KioskOutcome,
} from '../../src/kioskSession';
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
import { formatClock } from '../../src/ui/dates';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import {
  formatCount,
  percentLabel,
  progressPhase,
  statusLine,
  totalOfTargetLabel,
} from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

// Poll wsfGoalPulse at the server cache TTL so a peer's contribution
// surfaces without a manual refresh. Matches GOAL_PULSE_CACHE_TTL_MS in
// functions-westayfit — a shorter poll pays a Firestore round-trip on every
// tick, a longer poll wastes the cache window.
const POLL_INTERVAL_MS = 2_000;

// D-1. This screen is a sequence of whole-screen states, and each one states
// what it is in a single sentence at the top. That sentence is the state's
// heading, and until now it was not one programmatically. react-native-web
// turns accessibilityRole="header" plus a level into a real <h1>, carrying
// exactly the styles the line already had, so nothing changes on screen.
// `aria-level` is not in the React Native prop types, hence the cast.
const HEADING_1 = { accessibilityRole: 'header', 'aria-level': 1 } as Record<string, unknown>;
// The counting guide is a section INSIDE the entry screen, under that screen's
// one h1. Same cast, one level down.
const HEADING_2 = { accessibilityRole: 'header', 'aria-level': 2 } as Record<string, unknown>;

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
  // The server's one-time target-crossing signal, present with the shared
  // fields and only with them. Carried straight through to the receipt copy —
  // this screen never derives it and never substitutes for it.
  crossedTarget?: boolean;
};

// Authenticated own credit for the signed-in member. Read from the server on
// load; never derived client-side.
// `activityGuideKey` is the goal's optional per-goal guide override. It rides
// this authenticated member-only read, NOT wsfGoalPulse: the pulse is the
// authorized display payload and its nine fields are fixed.
//
// It also carries the goal's repeat policy. That is deliberate: this is the
// MEMBER-AUTHORIZED goal read this screen already makes, and the public
// wsfGoalPulse response is left exactly as it was. repeatPolicy is optional
// here only so a response from a server that predates the field still parses
// — resolveRepeatPolicy turns anything but 'multiple' into 'once'.
type MyContribution = {
  ownCredit: number;
  unit: string;
  activityGuideKey?: string;
  repeatPolicy?: unknown;
};

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
  const params = useLocalSearchParams<{
    goalId: string;
    groupId?: string;
    mode?: string;
    kiosk?: string;
  }>();
  const goalId = params.goalId;
  // KIOSK MODE. The flow below is unchanged — same entry, same review, same
  // record, same receipt. What the flag adds is an end: a way for one visitor
  // at a shared device to finish and leave nothing behind. It never changes
  // what is recorded, who it is credited to, or what the screen claims.
  const kiosk = isKioskFlag(params.kiosk);
  const groupIdHint = typeof params.groupId === 'string' && params.groupId ? params.groupId : null;
  // Community Home already chose the branch; a cold link without a mode
  // starts at result entry, the most direct path.
  const initialStep: Step = params.mode === 'move' ? 'move' : 'enter';
  const { ready, user } = useWsfAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // A6. When this screen last heard a confirmed answer about the goal — set by
  // the cold load and by every successful poll tick. Client receipt time, the
  // same fact (and the same wording) as Community Home and the public display.
  const [pulseAt, setPulseAt] = useState<Date | null>(null);
  const [context, setContext] = useState<ScreenContext>({ kind: 'none' });
  const [step, setStep] = useState<Step>(initialStep);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  // The goal's optional guide override, from the authenticated own-credit read.
  const [activityGuideKey, setActivityGuideKey] = useState<string | null>(null);
  // The counting guide is collapsed on arrival and remembers nothing: no
  // storage, no per-account preference. Reset with every context change below,
  // exactly like the entry itself.
  const [guideOpen, setGuideOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<ContributeResult | null>(null);
  // The goal's repeat policy, from the member-authorized read. 'once' until
  // the server answers — not the resolved default, because before the answer
  // arrives the screen knows nothing. Nothing that depends on it renders
  // before the load completes, so this value is never the one on screen.
  const [repeatPolicy, setRepeatPolicy] = useState<RepeatPolicy>('once');
  const [pending, setPending] = useState<PendingContribution | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Ref instead of state — the in-flight attempt id must NOT trigger a
  // re-render (would risk generating a new id mid-submit and defeat
  // idempotency). Cleared on each fresh "Record" tap.
  const attemptRef = useRef<string | null>(null);
  // Ref, not the `submitting` state: two taps delivered in the SAME task both
  // read the same rendered `submitting` value (false) and both pass, because
  // React has not re-rendered between them — and `disabled` on the button is
  // last render's attribute for the same reason. This flips synchronously, so
  // the second tap of a double tap is not a second submission at all. The
  // state and the disabled button stay: they are what the member sees.
  const inFlightRef = useRef(false);
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
    inFlightRef.current = false;
    // Nothing from the previous context stays on screen while the new one
    // loads: not the pending screen, not the receipt, not the typed entry,
    // not an error, not a refusal, and not the previous ready-state totals.
    setPending(null);
    setLastResult(null);
    setRepeatPolicy('once');
    setLegacyOrphan(null);
    setRefusal(null);
    sharedBeforeRef.current = null;
    setEntry('');
    setEntryError(null);
    setReviewCount(null);
    setActivityGuideKey(null);
    setGuideOpen(false);
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
      setState({ kind: 'error', message: 'This goal could not be found.' });
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
        setActivityGuideKey(
          typeof mineRes.data.activityGuideKey === 'string' ? mineRes.data.activityGuideKey : null
        );
        setRepeatPolicy(resolveRepeatPolicy(mineRes.data.repeatPolicy));
        setPulseAt(new Date());
        if (pulse.status !== 'active') {
          setState({ kind: 'closed', pulse, ownCredit });
          return;
        }
        setState({ kind: 'ready', pulse, ownCredit });
      } catch (e) {
        if (cancelled) return;
        // A malformed id in the link is "not found" to the member, not a
        // retryable error carrying the server's argument message.
        if (
          e instanceof FirebaseError &&
          (e.code === 'functions/not-found' || e.code === 'functions/invalid-argument')
        ) {
          setState({ kind: 'notFound' });
          return;
        }
        // The session is no longer valid server-side (revoked, disabled,
        // password changed elsewhere) even though the client still holds a
        // user: that is the sign-in screen, not "Something went wrong" with
        // the server's sentence under it.
        if (e instanceof FirebaseError && e.code === 'functions/unauthenticated') {
          setState({ kind: 'notSignedIn' });
          return;
        }
        // A1. The server's sentence is a developer fact, not member copy. It
        // is logged; the screen says what the member can act on.
        console.warn('[wsf] goal load failed', e);
        setState({
          kind: 'error',
          message: 'We couldn’t load this goal right now. Check your connection and try again.',
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
    let timer: ReturnType<typeof setInterval> | null = null;
    // Responses are not guaranteed to land in the order they were issued.
    // Same admission guard as the display: a response older than one already
    // applied is dropped, so the total on screen never counts backwards and
    // the "before" figure captured at Record is never an inverted one.
    let issued = 0;
    let applied = 0;
    // One outstanding pulse request at a time. See `tick`.
    let inFlight = false;
    const fn = httpsCallable<{ goalId: string }, GoalPulse>(
      getFirebaseFunctions(),
      'wsfGoalPulse'
    );
    const tick = async () => {
      // A tick that fires while the previous request is still outstanding
      // adds a SECOND request to a connection that has not answered the
      // first, and a slow server turns this 2s poll into a growing queue of
      // them. Skipping loses nothing: the outstanding request asks exactly
      // the same question, and a response that lands out of order is already
      // inadmissible under `applied`. Only the request is skipped.
      if (inFlight) return;
      inFlight = true;
      const seq = ++issued;
      try {
        const result = await fn({ goalId });
        if (cancelled) return;
        if (seq <= applied) return;
        applied = seq;
        const pulse = result.data;
        setPulseAt(new Date());
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
      } catch (e) {
        if (cancelled) return;
        // A refusal is not transient: the server has decided this member no
        // longer has a route to the goal (membership lost, goal gone). The
        // screen must not keep painting a total it is no longer entitled to,
        // nor invite a contribution the write would refuse. Same generic
        // not-found as a cold load, and the poll ends with it.
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          setState((prev) => (prev.kind === 'ready' || prev.kind === 'closed' ? { kind: 'notFound' } : prev));
          return;
        }
        // Anything else is transient — the next tick reconciles automatically.
        // We already have a valid pulse on screen; do not surface as error.
      } finally {
        inFlight = false;
      }
    };
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
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
      // The "current" side is read from contextRef, the live record of what
      // the screen is showing NOW. Passing the closure's own `goalId` as the
      // current goal compared it with itself — always equal — so the goal leg
      // of the check rested entirely on the generation counter. It reads the
      // ref instead, and a late response for goal A cannot land on goal B.
      if (
        !isSameContext(
          { generation, uid: owner, goalId: startedGoal },
          {
            generation: generationRef.current,
            uid: contextRef.current.uid,
            goalId: contextRef.current.goalId,
          }
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

  // A real second contribution, offered only under 'multiple'. It returns the
  // screen to entry with NOTHING carried over from the confirmed one: no
  // count, no attempt id, no captured "before". The next Record mints a fresh
  // attemptId, which is what makes it a different attempt rather than a replay
  // of the one just recorded.
  const onAddMore = useCallback(() => {
    attemptRef.current = null;
    inFlightRef.current = false;
    sharedBeforeRef.current = null;
    setLastResult(null);
    setRefusal(null);
    setEntry('');
    setEntryError(null);
    setReviewCount(null);
    setSubmitting(false);
    setStep('enter');
  }, []);

  // Review → record. The explicit confirmation boundary: the only place a
  // new attempt is created and sent.
  const onRecord = useCallback(async () => {
    // Synchronous first: the second tap of a double tap is refused here,
    // before it can mint anything or overwrite this attempt's result.
    if (inFlightRef.current) return;
    if (state.kind !== 'ready') return;
    if (submitting) return;
    if (reviewCount == null) return;
    inFlightRef.current = true;
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
        {
          generation: generationRef.current,
          uid: contextRef.current.uid,
          goalId: contextRef.current.goalId,
        }
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
      inFlightRef.current = false;
      // A superseded request's finally must not re-enable the new context's
      // form, which the new context already reset.
      if (stillCurrent()) setSubmitting(false);
    }
  }, [state, submitting, reviewCount, goalId, uid, sendContribute]);

  // Replay the SAME attempt. The server keys idempotency on goal, account and
  // attemptId and returns the original receipt if the earlier call landed.
  const onReconcile = useCallback(async () => {
    // Same synchronous guard as Record: a double tap on "Confirm this
    // contribution" is one replay, not two.
    if (inFlightRef.current) return;
    if (!pending) return;
    if (submitting) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setEntryError(null);
    attemptRef.current = pending.attemptId;
    // A replay has NO trustworthy "before". The total on screen was captured
    // before the unknown period, polling is off for the whole of it, and the
    // shared total can have moved either way since — including downwards past
    // the target, which would read the confirmed result as "we were already
    // past it" when the community has only just got there. null is the honest
    // answer, and contributionFlow lets it fall to `reached`, which is true
    // whenever the confirmed total the server returns is at or beyond target.
    sharedBeforeRef.current = null;
    const generation = generationRef.current;
    const owner = uid as string;
    const startedGoal = goalId;
    const stillCurrent = () =>
      isSameContext(
        { generation, uid: owner, goalId: startedGoal },
        {
          generation: generationRef.current,
          uid: contextRef.current.uid,
          goalId: contextRef.current.goalId,
        }
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
      inFlightRef.current = false;
      if (stillCurrent()) setSubmitting(false);
    }
  }, [pending, submitting, goalId, uid, sendContribute]);

  // There is deliberately no control that discards an unresolved attempt's
  // reminder: it is the only recovery context for effort whose outcome is
  // unknown. The supported path is to leave and come back, restore the same
  // attempt, and confirm it. (Storage cleanup on account/goal transitions
  // lives in src/pendingContribution.ts.)

  const onRefusalEdit = useCallback(() => {
    setRefusal(null);
    setStep('enter');
  }, []);

  // ---- kiosk session: Finish, and the idle countdown that performs it -------
  //
  // Everything here is inert unless `?kiosk=1` is on the route. The rules it
  // obeys — what may be erased, what may not, and what the visitor is told
  // when nobody knows the outcome — live in src/kioskSession.ts and are
  // tested there directly.
  const kioskOutcome: KioskOutcome = lastResult
    ? 'confirmed'
    : refusal
      ? 'refused'
      : pending
        ? 'unresolved'
        : 'none';
  // A session ends by itself only from a screen it has come to REST on. The
  // entry, review and movement screens have somebody standing at them
  // mid-thought; a receipt, a refusal and an unresolved attempt do not.
  // An attempt still in flight is NOT a rest state: signing out from under a
  // request that has not answered is how an outcome becomes unknowable.
  const kioskTerminal =
    kiosk && (lastResult != null || refusal != null || (pending != null && pending.state === 'unknown'));
  const [kioskFinishing, setKioskFinishing] = useState(false);
  const [kioskError, setKioskError] = useState<string | null>(null);
  // Bumped by "Stay". Restarting the countdown is a new deadline, not a
  // pause: the next person's session must not inherit a clock someone else
  // stopped.
  const [kioskStay, setKioskStay] = useState(0);
  const [kioskStartedAt, setKioskStartedAt] = useState<number | null>(null);
  const [kioskNow, setKioskNow] = useState(0);
  // Ref, not state, for the same reason as `inFlightRef`: a second tap of
  // Finish delivered in the same task must not start a second sign-out.
  const kioskFinishRef = useRef(false);

  const onKioskFinish = useCallback(
    async (outcome: KioskOutcome) => {
      if (!goalId) return;
      if (kioskFinishRef.current) return;
      kioskFinishRef.current = true;
      setKioskFinishing(true);
      setKioskError(null);
      const result = await runKioskFinish(
        {
          goalId: goalId as string,
          outcome,
          uid,
          // The attempt this session made. `attemptRef` is cleared the moment
          // an outcome is known, so an unresolved attempt is found on the
          // pending row instead — which is the only case where the id matters
          // at all, and the one case where nothing is cleared.
          attemptId: pending?.attemptId ?? attemptRef.current,
        },
        {
          signOut: () => signOut(getFirebaseAuth()),
          clearPendingIfAttempt,
          clearKioskKeys: clearKioskReturnGoal,
        }
      );
      if (!result.signedOut) {
        // Returning to the start screen while still signed in would hand the
        // next visitor this account. Stay put and say so.
        kioskFinishRef.current = false;
        setKioskFinishing(false);
        setKioskError('We couldn’t sign you out. Don’t leave this device signed in — try Finish again.');
        return;
      }
      // Back to the start screen that is (normally) already underneath this
      // one: dismissTo pops to it, so the device does not accumulate a start
      // screen per visitor; on a cold load of ?kiosk=1 there is nothing to
      // pop to and it behaves as a replace.
      router.dismissTo(result.returnTo as never);
    },
    [goalId, uid, pending]
  );

  // The clock. Wall time, read every second, so a throttled or backgrounded
  // tab cannot keep a previous visitor's receipt on a kiosk indefinitely.
  useEffect(() => {
    if (!kioskTerminal) {
      setKioskStartedAt(null);
      return;
    }
    const started = Date.now();
    setKioskStartedAt(started);
    setKioskNow(started);
    const timer = setInterval(() => setKioskNow(Date.now()), KIOSK_TICK_MS);
    return () => clearInterval(timer);
  }, [kioskTerminal, kioskStay, kioskOutcome]);

  const kioskRemaining =
    kioskStartedAt == null ? Number.POSITIVE_INFINITY : kioskRemainingMs(kioskStartedAt, kioskNow);

  useEffect(() => {
    if (!kioskTerminal) return;
    if (kioskStartedAt == null) return;
    if (!kioskCountdownExpired(kioskRemaining)) return;
    void onKioskFinish(kioskOutcome);
  }, [kioskTerminal, kioskStartedAt, kioskRemaining, kioskOutcome, onKioskFinish]);

  // ---- render ---------------------------------------------------------------

  const communityName = context.kind === 'verified' ? context.communityName : null;
  const backHref = context.kind === 'verified' ? `/community/${context.groupId}` : '/';
  const backLabel = context.kind === 'verified' ? 'Back to community' : 'Back to home';
  const heroWeWidth = Math.max(96, Math.min(280, windowWidth - 2 * 20 - 2 * 22));
  const contextWeWidth = 88;

  const renderChrome = (showBack: boolean) => (
    <View style={styles.chrome}>
      <WsfWordmark variant="navy" height={22} testID="wsf-contribute-wordmark" />
      {/*
        ON A KIOSK THERE IS NO "BACK". The link goes to a community page that
        belongs to the account currently signed in, and on a shared device
        that is a door out of the flow and into someone's community for
        whoever walks up next. The kiosk's one way out is Finish, which ends
        the session rather than navigating within it.
      */}
      {kiosk ? (
        <Pressable
          onPress={() => void onKioskFinish(kioskOutcome)}
          disabled={kioskFinishing}
          accessibilityRole="button"
          style={styles.chromeLink}
          testID="wsf-kiosk-finish-chrome"
        >
          <Text style={styles.chromeLinkText}>{kioskFinishing ? 'Finishing…' : 'Finish'}</Text>
        </Pressable>
      ) : showBack ? (
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

  // The prominent end-of-session control, shown on every screen a kiosk
  // session can come to rest on. It carries the countdown that performs the
  // same Finish when nobody is standing there, and — when the outcome is
  // UNKNOWN — the one sentence the visitor needs before they walk away.
  const renderKioskFinish = (outcome: KioskOutcome) =>
    kiosk ? (
      <View style={styles.kioskBar} testID="wsf-kiosk-finish-bar">
        {outcome === 'unresolved' ? (
          <Text style={styles.kioskNotice} testID="wsf-kiosk-unresolved-note">
            {KIOSK_UNRESOLVED_NOTICE}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void onKioskFinish(outcome)}
          disabled={kioskFinishing}
          accessibilityRole="button"
          style={styles.primaryButton}
          testID="wsf-kiosk-finish"
        >
          <Text style={styles.primaryButtonText}>
            {kioskFinishing ? 'Finishing…' : 'Finish'}
          </Text>
        </Pressable>
        <Text style={styles.caption} testID="wsf-kiosk-finish-explainer">
          Finish signs you out and returns this device to its start screen.
        </Text>
        <View style={styles.kioskCountdownRow}>
          {/* D-2. The countdown changes without anybody acting, so it
              announces itself politely rather than interrupting. */}
          <Text style={styles.caption} testID="wsf-kiosk-countdown" aria-live="polite">
            {kioskCountdownLabel(kioskRemainingSeconds(kioskRemaining))}
          </Text>
          <Pressable
            onPress={() => setKioskStay((n) => n + 1)}
            accessibilityRole="button"
            style={styles.tertiaryButton}
            testID="wsf-kiosk-stay"
          >
            <Text style={styles.tertiaryButtonText}>Stay</Text>
          </Pressable>
        </View>
        {kioskError ? (
          <Text style={styles.kioskError} testID="wsf-kiosk-finish-error" aria-live="polite">
            {kioskError}
          </Text>
        ) : null}
      </View>
    ) : null;

  const renderTestNote = () =>
    wsfUsingEmulators ? (
      <Text style={styles.testNote} testID="wsf-contribute-test-banner">
        Sample data
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
          <Text style={styles.heading} {...HEADING_1}>Sign in to contribute</Text>
          <Text style={styles.body}>
            Contributions are recorded to your account, so sign in before you record one.
          </Text>
          <ButtonLink
            href="/signin"
            style={styles.primaryButton}
            textStyle={styles.primaryButtonText}
            testID="wsf-contribute-signin-link"
            label="Sign in"
            // On a kiosk this gate is a hand-off, not a page the visitor came
            // from: the sign-in returns them to /contribute/<goal>?kiosk=1 by
            // replacing the sign-in screen, so a PUSHED gate would leave a
            // second contribution screen mounted underneath the one they use.
            replace={kiosk}
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
          <Text style={styles.heading} {...HEADING_1}>Something went wrong</Text>
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

  // The unit is known once the goal has loaded. It is NOT known when the goal
  // refused to load but this account still holds an unresolved attempt for it
  // — a member removed after an attempt whose outcome was never confirmed.
  // That attempt is still theirs to reconcile (the server honours the replay
  // regardless of membership drift), so the reminder, the replay's receipt
  // and a refusal render before "Goal not found" can hide them, with the
  // number alone when the unit is not on hand.
  const unitKnown: string | null =
    state.kind === 'ready' || state.kind === 'closed' ? state.pulse.unit : null;
  const effortLabel = (count: number, u: string | null) =>
    u ? `${formatCount(count)} ${u}` : formatCount(count);

  const ownCreditLine = (value: number, u: string | null) => (
    <Text style={styles.ownCredit} testID="wsf-contribute-own-credit">
      {`Your total on this goal: ${effortLabel(value, u)}`}
    </Text>
  );

  // ---- confirmed result: the signature moment -------------------------------
  if (lastResult) {
    const r = lastResult;
    const variant = resultVariant(r, sharedBeforeRef.current);
    const copy = resultCopy(r, communityName, unitKnown, sharedBeforeRef.current);
    const hasShared = variant !== 'ownOnly';
    return screen(
      <>
        {renderChrome(false)}
        <View
          style={styles.hero}
          testID="wsf-contribute-receipt"
          // D-2. The outcome replaces the form in place rather than by
          // navigating, so the receipt has to announce itself.
          aria-live="polite"
          {...({ dataSet: { variant } } as Record<string, unknown>)}
        >
          <Text style={styles.heroEyebrow}>{r.alreadyRecorded ? 'Already recorded' : 'Recorded'}</Text>
          <Text style={styles.heroHeadline} testID="wsf-contribute-result-headline" {...HEADING_1}>
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
                <Text
                  style={[
                    styles.heroStatus,
                    progressPhase(r.sharedTotal, r.target, r.status) === 'nearGoal'
                      ? styles.heroStatusNear
                      : null,
                  ]}
                  testID="wsf-contribute-status"
                >
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
        {ownCreditLine(r.ownCredit, hasShared ? r.unit : (r.unit ?? unitKnown))}
        {hasShared ? renderContextLabels() : null}
        <View style={styles.actions}>
          {kiosk ? (
            renderKioskFinish('confirmed')
          ) : (
            <>
            {/*
              REPEAT POLICY. The goal now publishes one, so the result can offer
              a second contribution where the server will actually accept it —
              'multiple', goal still active, and a receipt that carried shared
              state. Under 'once' this is absent and the result ends where it
              always did.

              It carries Community Home's existing wording, "Record more {unit}",
              rather than a second name for the same act. The two are never on
              screen together — they are on different screens — and Community
              Home now withholds its own offer on a goal this member has already
              finished, so the product makes the offer once or not at all.
            */}
            {canAddMore(repeatPolicy, r) ? (
              <Pressable
                onPress={onAddMore}
                accessibilityRole="button"
                style={styles.primaryButton}
                testID="wsf-contribute-record-more"
              >
                <Text style={styles.primaryButtonText}>
                  {recordMoreLabel(hasShared ? r.unit : unitKnown)}
                </Text>
              </Pressable>
            ) : null}
            <ButtonLink
              href={hasShared ? backHref : '/'}
              style={canAddMore(repeatPolicy, r) ? styles.secondaryButton : styles.primaryButton}
              textStyle={
                canAddMore(repeatPolicy, r) ? styles.secondaryButtonText : styles.primaryButtonText
              }
              testID="wsf-contribute-back"
              label={hasShared ? backLabel : 'Back to home'}
            />
            </>
          )}
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- definitive refusal ---------------------------------------------------
  if (refusal) {
    const copy = refusalCopy(refusal.reason, refusal.count, unitKnown ?? '');
    return screen(
      <>
        {renderChrome(false)}
        <View
          style={styles.card}
          testID="wsf-contribute-refused"
          aria-live="polite"
          {...({ dataSet: { reason: refusal.reason } } as Record<string, unknown>)}
        >
          <Text style={styles.eyebrowMuted}>Not recorded</Text>
          <Text style={styles.heading} testID="wsf-contribute-refused-headline" {...HEADING_1}>
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
            {kiosk ? (
              renderKioskFinish('refused')
            ) : (
              <ButtonLink
                href={refusal.reason === 'signedOut' ? '/signin' : backHref}
                style={refusal.reason === 'invalid' ? styles.secondaryButton : styles.primaryButton}
                textStyle={refusal.reason === 'invalid' ? styles.secondaryButtonText : styles.primaryButtonText}
                testID="wsf-contribute-back"
                label={refusal.reason === 'signedOut' ? 'Sign in' : backLabel}
              />
            )}
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
        <View style={styles.card} testID="wsf-contribute-recording" aria-live="polite">
          <ActivityIndicator color={NAVY} size="large" />
          <Text style={styles.heading} {...HEADING_1}>Recording your contribution…</Text>
          <Text style={styles.body}>{effortLabel(pending.count, unitKnown)}</Text>
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
        <View style={styles.pendingCard} testID="wsf-contribute-pending" aria-live="polite">
          <Text style={styles.eyebrowMuted}>Not confirmed yet</Text>
          <Text style={styles.heading} {...HEADING_1}>We couldn’t confirm your contribution yet.</Text>
          <Text style={styles.body}>
            We don’t know whether this effort was recorded. Don’t record it again.
          </Text>
          <Text style={styles.pendingCount} testID="wsf-contribute-pending-count">
            {`You entered ${effortLabel(pending.count, unitKnown)}.`}
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
          {/* Not true on a shared device: the visitor is about to be signed
              out of it. The kiosk says where the attempt actually is instead
              (KIOSK_UNRESOLVED_NOTICE, on the Finish bar below). */}
          {kiosk ? null : (
            <Text style={styles.caption}>
              You can leave this page. The same attempt will be here when you come back.
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          {kiosk ? (
            renderKioskFinish('unresolved')
          ) : (
            <ButtonLink
              href={backHref}
              style={styles.tertiaryButton}
              textStyle={styles.tertiaryButtonText}
              testID="wsf-contribute-back"
              label={backLabel}
            />
          )}
        </View>
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  if (state.kind === 'notFound') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.card} testID="wsf-contribute-not-found">
          <Text style={styles.heading} {...HEADING_1}>Goal not found</Text>
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
  const pulse = state.pulse;
  const unit = pulse.unit;
  const ownCredit = state.ownCredit;

  // The counting guide for this goal's unit — the per-goal override first, the
  // unit-derived key otherwise, a generic guide when neither is in the table.
  // Entry screen only: a receipt and a refusal are about a number already sent,
  // and nothing about counting applies to them any more.
  const renderCountingGuide = () => {
    const guide = selectActivityGuide({ unit, activityGuideKey });
    return (
      <View style={styles.guideBox} testID="wsf-contribute-guide">
        <View {...HEADING_2}>
          <Pressable
            onPress={() => setGuideOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: guideOpen }}
            // Matches LegalAccordion: accessibilityState carries it on native,
            // the raw attribute for browsers that only read the DOM.
            {...({ 'aria-expanded': guideOpen } as Record<string, unknown>)}
            style={styles.guideToggle}
            testID="wsf-contribute-guide-toggle"
          >
            <Text style={styles.guideToggleText}>{guideHeading(unit)}</Text>
            <Text style={styles.guideToggleMark}>{guideOpen ? '\u25B2' : '\u25BC'}</Text>
          </Pressable>
        </View>
        {guideOpen ? (
          <View
            style={styles.guidePanel}
            testID="wsf-contribute-guide-panel"
            {...({ role: 'region' } as Record<string, unknown>)}
          >
            {guide.rules.map((rule, i) => (
              <Text key={rule} style={styles.body} testID={`wsf-contribute-guide-rule-${i}`}>
                {rule}
              </Text>
            ))}
            <Text style={styles.caption} testID="wsf-contribute-guide-counts">
              {guide.counts}
            </Text>
            <Text style={styles.caption} testID="wsf-contribute-guide-does-not-count">
              {guide.doesNotCount}
            </Text>
            <Text style={styles.caption} testID="wsf-contribute-guide-self-count">
              {SELF_COUNT_NOTE}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

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
        <Text style={styles.compactPercent} testID="wsf-contribute-context-percent">
          {`${percentLabel(pulse.sharedTotal, pulse.target)} complete`}
        </Text>
        {ownCreditLine(ownCredit, unit)}
        {/*
          A6. The compact total is live (a 2s poll), so it needs the same
          "as of" honesty Community Home and the public display carry. No
          refresh control: nothing here is waiting to be asked.
        */}
        {pulseAt ? (
          <Text style={styles.contextUpdated} testID="wsf-contribute-context-updated">
            {`Confirmed ${formatClock(pulseAt)}`}
          </Text>
        ) : null}
      </View>
    </View>
  );

  // ---- closed goal ------------------------------------------------------------
  if (state.kind === 'closed') {
    return screen(
      <>
        {renderChrome(false)}
        {renderContextLabels()}
        <View style={styles.hero} testID="wsf-contribute-closed">
          <Text style={styles.heroEyebrow}>Closed</Text>
          <Text style={styles.heroHeadline} {...HEADING_1}>This goal is closed.</Text>
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
            {/*
              A5. No "N% complete" line on a closed goal: the status line below
              is "Closed at N%" (or "Goal reached"), which already says it, and
              two percentages on one card invite the reader to reconcile them.
              Same rule as Community Home's past-goal card.
            */}
            <Text
              style={[
                styles.heroStatus,
                progressPhase(pulse.sharedTotal, pulse.target, pulse.status) === 'nearGoal'
                  ? styles.heroStatusNear
                  : null,
              ]}
              testID="wsf-contribute-status"
            >
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
          <Text style={styles.heading} {...HEADING_1}>Review your contribution</Text>
          {renderContextLabels()}
          <Text style={styles.reviewQuantity} testID="wsf-contribute-review-quantity">
            {`${formatCount(reviewCount)} ${unit}`}
          </Text>
          <Text style={styles.body} testID="wsf-contribute-repeat-notice">
            {repeatNotice(repeatPolicy)}
          </Text>
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
          <Text style={styles.heading} {...HEADING_1}>Ready when you are.</Text>
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
        <Text style={styles.heading} {...HEADING_1}>{`How many ${unit} did you complete?`}</Text>
        {(() => {
          const minus = (
            <Pressable
              onPress={() => setEntry((v) => stepEntry(v, -1))}
              accessibilityRole="button"
              accessibilityLabel="One fewer"
              style={styles.stepButton}
              testID="wsf-contribute-minus"
            >
              <Text style={styles.stepButtonText}>−</Text>
            </Pressable>
          );
          const plus = (
            <Pressable
              onPress={() => setEntry((v) => stepEntry(v, 1))}
              accessibilityRole="button"
              accessibilityLabel="One more"
              style={styles.stepButton}
              testID="wsf-contribute-plus"
            >
              <Text style={styles.stepButtonText}>+</Text>
            </Pressable>
          );
          const input = (
            <TextInput
              style={styles.entryInput}
              value={entry}
              onChangeText={(v) => {
                setEntry(v);
                if (entryError) setEntryError(null);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              enterKeyHint="done"
              placeholder="0"
              placeholderTextColor={wsfTheme.colors.textMuted}
              accessibilityLabel={`Number of ${unit} completed`}
              testID="wsf-contribute-entry"
            />
          );
          // On a very narrow screen (or at 200% zoom) the two round buttons
          // and the input no longer fit on one line: the input takes its own
          // line and the buttons sit underneath, still full size.
          if (windowWidth < 320) {
            return (
              <View style={styles.entryStack}>
                {input}
                <View style={styles.entryStackButtons}>
                  {minus}
                  {plus}
                </View>
              </View>
            );
          }
          return (
            <View style={styles.entryRow}>
              {minus}
              {input}
              {plus}
            </View>
          );
        })()}
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
          <Text
            style={styles.errorText}
            testID="wsf-contribute-error"
            // D-2. The entry is refused in place: nothing moves, nothing takes
            // focus, so without this the refusal is silent to a screen reader.
            accessibilityRole="alert"
          >
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
        {renderCountingGuide()}
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
  // ---- kiosk -----------------------------------------------------------
  kioskBar: { gap: 10 },
  kioskNotice: { color: NAVY, fontSize: 17, lineHeight: 24, fontWeight: '700' },
  kioskError: { color: '#8A1C1C', fontSize: 15, lineHeight: 21, fontWeight: '700' },
  kioskCountdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },

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
  // A6. Freshness under the live compact total.
  contextUpdated: { color: wsfTheme.colors.textMuted, fontSize: 12, lineHeight: 18, letterSpacing: 0.3 },

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
  // A4. Same near-goal emphasis as Community Home's hero and the public
  // display: the last stretch is the one line worth leaning on.
  heroStatusNear: { color: CREAM, fontWeight: '700' },
  heroStanding: { color: CREAM, fontSize: 15, lineHeight: 21, textAlign: 'center', paddingTop: 6 },

  // entry
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryStack: { gap: 10 },
  entryStackButtons: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
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
    // D-4. 44 px: the owner's minimum touch target.
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#EEF2F6',
    justifyContent: 'center',
  },
  quickChipText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  reviewQuantity: { color: wsfTheme.colors.text, fontSize: 44, fontWeight: '800', lineHeight: 52, letterSpacing: -0.5 },

  // counting guide
  guideBox: {
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
    marginTop: 4,
  },
  // 44 px minimum target, the same floor the chrome links use.
  guideToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  guideToggleText: {
    color: NAVY,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  guideToggleMark: { color: NAVY, fontSize: 13 },
  guidePanel: { gap: 8, paddingBottom: 8 },

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
