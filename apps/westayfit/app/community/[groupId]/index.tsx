import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { AuthFlagOffPanel } from '../../../src/AuthFlagOffPanel';
import { FormShell, SecondaryLink } from '../../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../../src/featureFlags';
import { getFirebaseFirestore, getFirebaseFunctions } from '../../../src/firebase';
import {
  beginContext,
  confirmedButAbsent,
  displayAuthValueToSend,
  dismissOutcome,
  initialDisplayAuthState,
  operationIsCurrent,
  outcomeFor,
  settleOperation,
  startOperation,
  unsettledFor,
  type DisplayAuthState,
  type OperationScope,
} from '../../../src/displayAuthControl';
import {
  challengeParticipationLabel,
  groupTypeLabel,
  joinPolicyLabel,
  memberCountLabel,
  roleLabel,
  statusLabel,
} from '../../../src/labels';
import { wsfTheme } from '../../../src/theme';
import { PROGRESS_GREEN } from '../../../src/ui/brandAssets';
import { formatClock, formatEndsAt, formatMonthYear, formatPeriod } from '../../../src/ui/dates';
import { LivingWeProgress } from '../../../src/ui/LivingWeProgress';
import {
  formatCount,
  percentLabel,
  progressPhase,
  statusLine,
  totalOfTargetLabel,
} from '../../../src/ui/progressFormat';
import { WsfWordmark } from '../../../src/ui/WsfWordmark';

/**
 * A link that looks and lays out like a button. Expo Router's Link renders a
 * text anchor on web, so flex centring and minimum heights on it do nothing;
 * `asChild` hands the href and press handling to a Pressable that can carry
 * the button styles. The anchor keeps its href for cold loads and the testID
 * stays on the element a test clicks.
 */
function ButtonLink({
  href,
  style,
  textStyle,
  testID,
  label,
}: {
  href: string;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  label: string;
}) {
  return (
    <Link href={href as never} asChild>
      <Pressable style={style} testID={testID} accessibilityRole="link">
        <Text style={textStyle}>{label}</Text>
      </Pressable>
    </Link>
  );
}

type GroupDoc = {
  displayName: string;
  groupType: string;
  joinPolicy: string;
  lifecycleStatus: string;
  joinCode?: string;
  isSample?: boolean;
  // Written by wsfCreateCommunity as a server timestamp. Read from the same
  // document this page already fetches; rendered only when it is present and
  // parses, never assumed.
  createdAt?: Timestamp | { toDate?: () => Date } | null;
};

type ActiveChallenge = {
  id: string;
  title: string;
  participantCount: number;
  completedCount: number;
  goalTarget: number | null;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notSignedIn' }
  | { kind: 'notMember' }
  | {
      kind: 'ready';
      group: GroupDoc;
      role: string;
      memberCount: number | null;
      isSample: boolean;
      activeChallenge: ActiveChallenge | null;
    }
  | { kind: 'error'; message: string };

type MyCommunityItem = {
  groupId: string;
  displayName: string;
  groupType: string;
  joinPolicy: string;
  role: string;
  memberCount: number;
  isSample: boolean;
  activeChallenge: {
    id: string;
    title: string;
    participantCount: number;
    completedCount: number;
    goalTarget: number | null;
  } | null;
};

type MyCommunitiesResponse = { items: MyCommunityItem[] };

type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  startsAt: string;
  endsAt: string;
  aggregateDisplayAuthorized: boolean;
};

type ListGoalsResponse = { goals: ListedGoal[] };

/**
 * Three distinct states, deliberately not two.
 *
 * Catching the error and leaving an empty array made a failed load
 * indistinguishable from a community that genuinely has no goal yet — and the
 * page then told the member "No goal running yet", which is a claim about the
 * community rather than about the request. "We could not load this" and
 * "there is nothing here" are different facts and get different words.
 */
type GoalsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; goals: ListedGoal[] }
  | { kind: 'failed'; message: string };

type ListChallengeResponse = {
  challenge:
    | { id: string; title: string; status: string; goalTarget: number | null }
    | null;
  totals: {
    participantCount: number;
    completedCount: number;
    goalTarget: number | null;
  };
};

// Response shape mirrors wsfGoalPulse in functions-westayfit. This page reads
// it ONCE per goal on load and on return, never on a timer: the community
// page is a place to see where things stand, not a live display.
type PulseTotals = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
};

/**
 * Three states, kept apart on purpose: a progress read that has not returned,
 * one that returned, and one that failed. A failed read is NOT zero progress
 * and is never rendered as a number.
 */
type GoalProgress =
  | { kind: 'loading' }
  | { kind: 'ok'; pulse: PulseTotals; ownCredit: number | null; at: Date }
  | { kind: 'failed' };

type MyContributionResponse = { ownCredit: number; unit: string };

export default function CommunityPage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [goalsState, setGoalsState] = useState<GoalsState>({ kind: 'loading' });
  const [goalsReloadToken, setGoalsReloadToken] = useState(0);
  const [progress, setProgress] = useState<Record<string, GoalProgress>>({});
  const [progressReloadToken, setProgressReloadToken] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [resetting, setResetting] = useState(false);
  const [resetJoinCode, setResetJoinCode] = useState<string | null>(null);
  const [resetOutcome, setResetOutcome] = useState<'idle' | 'done' | 'failed'>('idle');
  // PACKAGE E. Three distinct outcomes, because a failed request does not
  // establish what the server did: it may have saved the change before the
  // connection dropped. `unconfirmed` is that case, and it is not an error
  // message dressed up — it is the honest answer until a read settles it.
  //
  // Per GOAL, not one shared slot. See src/displayAuthControl: a single slot
  // meant starting an action on one goal erased another goal's unresolved
  // outcome while its request was still in flight, taking its warning, its
  // intended retry value and its disabled control with it.
  const [displayAuth, setDisplayAuth] = useState<DisplayAuthState>(initialDisplayAuthState);

  // A response that lands after the screen has moved on must not write into
  // whatever is on screen now. Account and community alone cannot tell
  // A → B → A from never having left, so the context carries a generation
  // that advances every time it is (re-)established. The refs let a late
  // response read the CURRENT context without being re-created on every change.
  const contextRef = useRef<{ groupId: string; uid: string | null }>({
    groupId,
    uid: user?.uid ?? null,
  });
  const displayAuthRef = useRef<DisplayAuthState>(displayAuth);
  displayAuthRef.current = displayAuth;
  useEffect(() => {
    contextRef.current = { groupId, uid: user?.uid ?? null };
    // A new context. Everything the previous one had to say about permissions
    // goes with it, and the generation advances so nothing still outstanding
    // from the old one can write here again.
    setDisplayAuth((prev) => beginContext(prev));
  }, [groupId, user?.uid]);

  const [leaveState, setLeaveState] = useState<
    { kind: 'idle' } | { kind: 'confirming' } | { kind: 'leaving' } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'notSignedIn' });
      return;
    }
    if (!groupId) {
      setState({ kind: 'error', message: 'Missing group id.' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const db = getFirebaseFirestore();
        const functions = getFirebaseFunctions();

        const membershipRef = doc(db, 'wsfMemberships', `${groupId}_${user.uid}`);
        const membershipSnap = await getDoc(membershipRef);
        if (cancelled) return;
        if (!membershipSnap.exists()) {
          setState({ kind: 'notMember' });
          return;
        }
        const membership = membershipSnap.data() as { role: string; membershipStatus: string };
        // D2/D3 DEFECT FOUND AND FIXED IN THIS PACKAGE. This gate used to be
        // existence-only: it read membershipStatus and never looked at it.
        // Removal and voluntary departure both LEAVE the membership document
        // in place and change its status, so a removed person still satisfied
        // `exists()` and this screen rendered for them — community name, the
        // goal list, the invite link, and the Champion controls if their role
        // said foundingChampion. The callables refuse them (proved in
        // functions-westayfit/tests/callable/wsf-admission-controls.test.ts),
        // but this screen is itself a member-only path and was not closing.
        // Anything that is not an active membership is not a membership here.
        if (membership.membershipStatus !== 'active') {
          setState({ kind: 'notMember' });
          return;
        }

        const groupSnap = await getDoc(doc(db, 'wsfCommunityGroups', groupId));
        if (cancelled) return;
        if (!groupSnap.exists()) {
          setState({ kind: 'error', message: 'Community not found.' });
          return;
        }
        const group = groupSnap.data() as GroupDoc;

        // Aggregate totals (memberCount, sample flag, active challenge summary)
        // come from wsfMyCommunities so this page reads exactly one aggregate
        // source. If the caller is a member the item will be present; a race
        // against a fresh join could momentarily miss it, and we fall back to
        // rendering without the count line rather than blocking the page.
        let memberCount: number | null = null;
        let isSample = group.isSample === true;
        let activeChallenge: ActiveChallenge | null = null;
        try {
          const myFn = httpsCallable<Record<string, never>, MyCommunitiesResponse>(
            functions,
            'wsfMyCommunities'
          );
          const myResult = await myFn({});
          if (cancelled) return;
          const item = myResult.data.items.find((i) => i.groupId === groupId);
          if (item) {
            memberCount = item.memberCount;
            isSample = item.isSample;
            activeChallenge = item.activeChallenge;
          }
        } catch {
          // Non-blocking. The page still renders with what we have.
        }

        // If the challenge summary was not populated by wsfMyCommunities (race
        // or callable error), fall back to a direct wsfListChallenge call —
        // that is the source of truth for this group's current challenge and
        // is what the challenge screen itself uses.
        if (!activeChallenge) {
          try {
            const listFn = httpsCallable<{ groupId: string }, ListChallengeResponse>(
              functions,
              'wsfListChallenge'
            );
            const listResult = await listFn({ groupId });
            if (cancelled) return;
            if (listResult.data.challenge) {
              activeChallenge = {
                id: listResult.data.challenge.id,
                title: listResult.data.challenge.title,
                participantCount: listResult.data.totals.participantCount,
                completedCount: listResult.data.totals.completedCount,
                goalTarget: listResult.data.totals.goalTarget,
              };
            }
          } catch {
            // Silent fallback — no challenge card.
          }
        }

        setState({
          kind: 'ready',
          group,
          role: membership.role,
          memberCount,
          isSample,
          activeChallenge,
        });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Load failed.' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId]);

  // The seam this package exists to add. Every other wsfGoals access is by
  // explicit goalId, so before wsfListGoals a member who did not create the
  // goal had no way to reach it.
  //
  // Its own effect, so a retry is a real action and a failure does not take
  // the rest of the community page down with it. Reset to `loading` on every
  // context change: results from a previous account or community must never
  // be on screen while a different one loads.
  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready || !user || !groupId) return;

    let cancelled = false;
    setGoalsState({ kind: 'loading' });

    (async () => {
      try {
        const fn = httpsCallable<{ groupId: string }, ListGoalsResponse>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const result = await fn({ groupId });
        if (cancelled) return;
        setGoalsState({ kind: 'loaded', goals: result.data.goals ?? [] });
      } catch (e) {
        if (cancelled) return;
        setGoalsState({
          kind: 'failed',
          message: e instanceof Error ? e.message : 'Could not load goals.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId, goalsReloadToken]);

  // Confirmed progress for every listed goal, from the same aggregate the
  // contribution and display screens use (wsfGoalPulse admits an active
  // member), plus the member's own credit for open goals (wsfMyContribution).
  // One read each, in parallel; each goal settles on its own so one slow or
  // failed read never blanks the others.
  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready || !user || !groupId) return;
    if (goalsState.kind !== 'loaded') {
      setProgress({});
      return;
    }
    let cancelled = false;
    const functions = getFirebaseFunctions();
    setProgress(
      Object.fromEntries(goalsState.goals.map((g) => [g.goalId, { kind: 'loading' as const }]))
    );
    for (const goal of goalsState.goals) {
      (async () => {
        try {
          const pulseFn = httpsCallable<{ goalId: string }, PulseTotals>(functions, 'wsfGoalPulse');
          const ownFn = httpsCallable<{ goalId: string }, MyContributionResponse>(
            functions,
            'wsfMyContribution'
          );
          const [pulseResult, ownResult] = await Promise.all([
            pulseFn({ goalId: goal.goalId }),
            goal.status === 'active'
              ? ownFn({ goalId: goal.goalId }).catch(() => null)
              : Promise.resolve(null),
          ]);
          if (cancelled) return;
          setProgress((prev) => ({
            ...prev,
            [goal.goalId]: {
              kind: 'ok',
              pulse: pulseResult.data,
              ownCredit: ownResult ? ownResult.data.ownCredit : null,
              at: new Date(),
            },
          }));
        } catch {
          if (cancelled) return;
          setProgress((prev) => ({ ...prev, [goal.goalId]: { kind: 'failed' } }));
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId, goalsState, progressReloadToken]);

  // Coming back to this screen (from a contribution, say) re-reads progress.
  // The first focus is the mount, which the effect above already covers.
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) setProgressReloadToken((n) => n + 1);
      focusedBefore.current = true;
    }, [])
  );

  const refreshProgress = useCallback(() => setProgressReloadToken((n) => n + 1), []);

  const inviteUrl = (() => {
    if (state.kind !== 'ready') return null;
    const code = resetJoinCode ?? state.group.joinCode;
    if (!code) return null;
    // D4: public AND inviteOnly are link-joinable. private is not — a general
    // community link never admits anyone there.
    if (state.group.joinPolicy !== 'public' && state.group.joinPolicy !== 'inviteOnly') return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/join/${code}`;
  })();

  const onCopyInvite = useCallback(async () => {
    if (!inviteUrl || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2_000);
    } catch {
      setCopyStatus('failed');
    }
  }, [inviteUrl]);

  /**
   * D1: retire the current link. New admissions through the old one stop; no
   * member is removed and no contribution is touched. The old code then
   * resolves exactly as an unknown code does — for everyone, members included.
   */
  const onResetInvite = useCallback(async () => {
    if (resetting || !groupId) return;
    setResetting(true);
    setResetOutcome('idle');
    try {
      const fn = httpsCallable<{ groupId: string }, { joinCode: string }>(
        getFirebaseFunctions(),
        'wsfResetJoinCode'
      );
      const result = await fn({ groupId });
      setResetJoinCode(result.data.joinCode);
      setCopyStatus('idle');
      setResetOutcome('done');
    } catch {
      // A failure here is NOT cosmetic and must never be swallowed. The reason
      // a Champion resets a link is usually that the old one got somewhere it
      // should not have. Leaving the button to settle back to "Reset link"
      // would let them walk away believing a live link is dead. The old link
      // is still working, and the screen has to say so.
      setResetOutcome('failed');
    } finally {
      setResetting(false);
    }
  }, [groupId, resetting]);

  /**
   * D2: leave a community of your own accord. This is the ONLY one of the
   * membership actions that can be finished inside this package's scope,
   * because it is the only one that acts on the caller themselves —
   * wsfLeaveCommunity takes no target and reads the uid off the token.
   * Removing, reinstating or designating someone else all need that person's
   * account id, and nothing this screen loads yields another member's id.
   *
   * The sole-Champion refusal is deliberately surfaced verbatim rather than
   * hidden by disabling the control: the server's message names what has to
   * happen first, and a greyed-out button would not.
   */
  const onLeave = useCallback(async () => {
    if (!groupId) return;
    setLeaveState({ kind: 'leaving' });
    try {
      const fn = httpsCallable<{ groupId: string }, unknown>(
        getFirebaseFunctions(),
        'wsfLeaveCommunity'
      );
      await fn({ groupId });
      router.replace('/');
    } catch (e) {
      const message =
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message)
          : 'Could not leave this community. Try again.';
      setLeaveState({ kind: 'failed', message });
    }
  }, [groupId, router]);

  /**
   * PACKAGE E. Authorize or revoke this goal's aggregate for the public
   * display. A separate, explicit act — not part of creating a goal — and
   * available only to a Champion, whose authority is scoped to this community.
   *
   * The interesting part is failure. The first version caught any error and
   * told the Champion "Nothing changed" or "It is still on". Neither is a fact
   * a lost response establishes: the server may well have saved it. So a
   * failure is not reported as an outcome. It triggers a READ-BACK of the
   * authoritative value, and only if that also fails does the screen say, in
   * those words, that it could not confirm the setting.
   *
   * `intended` is the explicit value that was asked for, carried through the
   * retry. Retrying by inverting whatever the card currently shows could undo
   * a request that actually succeeded.
   */
  const readStoredDisplayAuth = useCallback(
    async (targetGoalId: string): Promise<boolean | null> => {
      // The authoritative read. wsfListGoals reports the stored permission for
      // every goal this Champion can see, closed ones included. `null` means
      // the read itself did not settle anything — it is not `false`, and it
      // must not be rendered as one.
      try {
        const fn = httpsCallable<{ groupId: string }, ListGoalsResponse>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const result = await fn({ groupId });
        const found = (result.data.goals ?? []).find((g) => g.goalId === targetGoalId);
        if (!found) return null;
        return found.aggregateDisplayAuthorized === true;
      } catch {
        return null;
      }
    },
    [groupId]
  );

  const onSetDisplayAuth = useCallback(
    async (targetGoalId: string, intended: boolean, title: string) => {
      // The operation's identity, fixed now. Generation is what makes this
      // more than a uid/groupId comparison: an operation begun on an earlier
      // visit to THIS SAME community, by THIS SAME account, carries an older
      // generation and is recognisably not the current one.
      const scope: OperationScope = {
        generation: displayAuthRef.current.generation,
        groupId,
        uid: user?.uid ?? null,
        goalId: targetGoalId,
      };
      const stillCurrent = () =>
        operationIsCurrent(displayAuthRef.current, scope, contextRef.current);

      setDisplayAuth((prev) => startOperation(prev, scope, intended, title));
      try {
        const fn = httpsCallable<
          { goalId: string; authorized: boolean },
          { aggregateDisplayAuthorized: boolean }
        >(getFirebaseFunctions(), 'wsfSetGoalDisplayAuthorization');
        await fn({ goalId: targetGoalId, authorized: intended });
        if (!stillCurrent()) return;
        setDisplayAuth((prev) =>
          settleOperation(prev, scope, { kind: 'confirmed', intended, title })
        );
        setGoalsReloadToken((n) => n + 1);
      } catch {
        if (!stillCurrent()) return;
        // The request did not come back. That is not the same as the change
        // not happening — the server may have saved it before the connection
        // dropped — so read the stored value rather than assert an outcome.
        const stored = await readStoredDisplayAuth(targetGoalId);
        if (!stillCurrent()) return;
        if (stored === null) {
          // Both the write and the read-back failed. Nothing is known, and the
          // screen says exactly that. A failed read is never turned into an
          // assumed permission value.
          setDisplayAuth((prev) =>
            settleOperation(prev, scope, { kind: 'unconfirmed', intended, title })
          );
          return;
        }
        // The read-back settled it. Show the stored permission either way, and
        // when it disagrees with what was asked for, say the change did not
        // take effect instead of leaving a silent no-op.
        setGoalsReloadToken((n) => n + 1);
        setDisplayAuth((prev) =>
          settleOperation(
            prev,
            scope,
            stored === intended
              ? { kind: 'confirmed', intended, title }
              : { kind: 'failed', intended, title }
          )
        );
      }
    },
    [groupId, user?.uid, readStoredDisplayAuth]
  );

  const onDismissDisplayAuth = useCallback((targetGoalId: string) => {
    setDisplayAuth((prev) => dismissOutcome(prev, targetGoalId));
  }, []);

  const onShareInvite = useCallback(async () => {
    if (!inviteUrl) return;
    if (typeof navigator === 'undefined' || !('share' in navigator)) return;
    try {
      await (navigator as Navigator & {
        share: (data: ShareData) => Promise<void>;
      }).share({
        title: 'Join our We Stay Fit community',
        url: inviteUrl,
      });
    } catch {
      // User dismissed the share sheet or the browser blocked it — no-op.
    }
  }, [inviteUrl]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Your community" testID="wsf-community-disabled" />;
  }

  if (state.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Your community" testID="wsf-community-loading">
        <View {...({ 'data-state': 'loading' } as Record<string, unknown>)}>
          <Text style={styles.body}>Loading…</Text>
        </View>
      </FormShell>
    );
  }

  if (state.kind === 'notSignedIn') {
    return (
      <FormShell
        heading="Your community"
        intro="Sign in to view this community."
        testID="wsf-community-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  if (state.kind === 'notMember') {
    return (
      <FormShell
        heading="Not a member"
        intro="You are not a member of this community."
        testID="wsf-community-not-member"
      >
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <FormShell heading="Something went wrong" testID="wsf-community-error">
        <View {...({ 'data-state': 'error' } as Record<string, unknown>)}>
          <Text style={styles.error}>{state.message}</Text>
        </View>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  const { group, role, memberCount, isSample, activeChallenge } = state;
  const isChampion = role === 'foundingChampion';
  const hasShareApi = typeof navigator !== 'undefined' && 'share' in navigator;

  // One featured goal, explicitly: the open goal that ends soonest (the
  // server lists by endsAt). Others keep their own separately labelled mark;
  // nothing here averages or merges goals.
  const loadedGoals = goalsState.kind === 'loaded' ? goalsState.goals : [];
  const activeGoals = loadedGoals.filter((g) => g.status === 'active');
  const closedGoals = loadedGoals.filter((g) => g.status !== 'active');
  const featured = activeGoals[0] ?? null;
  const otherActive = activeGoals.slice(1);
  const createdLabel = (() => {
    const raw = group.createdAt;
    if (!raw || typeof raw !== 'object' || typeof raw.toDate !== 'function') return null;
    try {
      return formatMonthYear(raw.toDate());
    } catch {
      return null;
    }
  })();
  const heroWeWidth = Math.max(160, Math.min(280, windowWidth - 2 * 20 - 2 * 20));
  const smallWeWidth = 104;

  const contributeHref = (goalId: string, mode: 'move' | 'record') =>
    `/contribute/${goalId}?groupId=${encodeURIComponent(groupId)}&mode=${mode}`;

  const renderDisplayAuthControl = (goal: ListedGoal) => {
    const goalIsOpen = goal.status === 'active';
    const outcome = outcomeFor(displayAuth, goal.goalId);
    const saving = outcome?.kind === 'saving';
    // Unsettled covers the two cases where the last request left something
    // to say: the outcome is unknown, or it is known and the change did not
    // take. Both carry the value that was asked for. src/displayAuthControl
    // decides what the control sends; this file does not keep its own copy.
    const unsettled = unsettledFor(displayAuth, goal.goalId);
    // A closed goal keeps no contribution controls, but a display permission
    // granted while it ran is still in force: closing a goal does not revoke
    // it. So the Champion keeps the revoke control on a closed goal that is
    // still authorized, and that is the only control a closed goal carries.
    const showDisplayControl = isChampion && (goalIsOpen || goal.aggregateDisplayAuthorized);
    if (!showDisplayControl) return null;
    return (
      // PACKAGE E. Champion-only, and secondary to the goal itself: the goal
      // is the thing, this is a permission about it. The copy describes the
      // permission this application controls. It does not claim anything
      // about screens, saved images or snapshots already shared, which this
      // application cannot reach and cannot speak for.
      <View key={goal.goalId} style={styles.manageGoal} testID={`wsf-goal-display-auth-${goal.goalId}`}>
        <Text style={styles.manageGoalTitle}>{goal.title}</Text>
        <Text style={styles.body} testID={`wsf-goal-display-auth-state-${goal.goalId}`}>
          {goal.aggregateDisplayAuthorized
            ? 'Public display is authorized for this goal. A public display can show the running total only — never individual contributions or member names.'
            : 'Public display is not authorized for this goal.'}
        </Text>
        <Pressable
          onPress={() =>
            onSetDisplayAuth(
              goal.goalId,
              displayAuthValueToSend(unsettled, goal.aggregateDisplayAuthorized),
              goal.title
            )
          }
          disabled={saving}
          style={styles.secondaryButton}
          testID={`wsf-goal-display-auth-toggle-${goal.goalId}`}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>
            {saving
              ? 'Saving…'
              : unsettled
                ? unsettled.intended
                  ? 'Try again: authorize public display'
                  : 'Try again: remove public display'
                : goal.aggregateDisplayAuthorized
                  ? 'Remove public display'
                  : 'Authorize public display'}
          </Text>
        </Pressable>
        {unsettled ? (
          <View>
            <Text style={styles.error} testID={`wsf-goal-display-auth-unsettled-${goal.goalId}`}>
              {unsettled.kind === 'unconfirmed'
                ? 'We could not confirm this goal’s current display permission. What is shown above may be out of date until this succeeds.'
                : unsettled.intended
                  ? 'That change did not take effect. Public display is still not authorized for this goal.'
                  : 'That change did not take effect. Public display is still authorized for this goal.'}
            </Text>
            {/*
              The only way an unresolved outcome leaves this card other than
              being settled. Work on another goal must never clear it silently.
            */}
            <Pressable
              onPress={() => onDismissDisplayAuth(goal.goalId)}
              style={styles.secondaryButton}
              testID={`wsf-goal-display-auth-dismiss-${goal.goalId}`}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Dismiss this notice</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const renderFreshness = (p: GoalProgress) =>
    p.kind === 'ok' ? (
      <View style={styles.freshnessRow}>
        <Text style={styles.heroFreshness} testID="wsf-community-progress-updated">
          {`Updated ${formatClock(p.at)}`}
        </Text>
        <Pressable
          onPress={refreshProgress}
          accessibilityRole="button"
          testID="wsf-community-progress-refresh"
          style={styles.freshnessButton}
        >
          <Text style={styles.heroFreshnessLink}>Refresh</Text>
        </Pressable>
      </View>
    ) : null;

  // `hero` is the navy active-goal surface; `card` is a light card; `closed`
  // is the compact past-goal record (exact result and period, no "complete"
  // line: "Closed at 62.4%" already says it).
  const renderProgressFacts = (goal: ListedGoal, p: GoalProgress, variant: 'hero' | 'card' | 'closed') => {
    const onDark = variant === 'hero';
    if (p.kind === 'loading') {
      return (
        <Text
          style={onDark ? styles.heroBody : styles.body}
          testID={`wsf-community-goal-progress-loading-${goal.goalId}`}
        >
          Loading progress…
        </Text>
      );
    }
    if (p.kind === 'failed') {
      return (
        <View style={onDark ? styles.heroCentered : null} testID={`wsf-community-goal-progress-error-${goal.goalId}`}>
          <Text style={onDark ? styles.heroBody : styles.body}>Progress couldn’t be loaded just now.</Text>
          <Pressable
            onPress={refreshProgress}
            accessibilityRole="button"
            style={onDark ? styles.heroOutlineButton : styles.secondaryButton}
            testID={`wsf-community-goal-progress-retry-${goal.goalId}`}
          >
            <Text style={onDark ? styles.heroOutlineButtonText : styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    const { sharedTotal, target, unit, status } = p.pulse;
    const phase = progressPhase(sharedTotal, target, status);
    if (variant === 'closed') {
      return (
        <View style={styles.factsSmall}>
          <Text style={styles.totalSmall} testID={`wsf-community-goal-total-${goal.goalId}`}>
            {totalOfTargetLabel(sharedTotal, target, unit)}
          </Text>
          <Text style={styles.closedResult} testID={`wsf-community-goal-status-${goal.goalId}`}>
            {statusLine(sharedTotal, target, status)}
          </Text>
        </View>
      );
    }
    return (
      <View style={onDark ? styles.factsLarge : styles.factsSmall}>
        <Text
          style={onDark ? styles.heroTotal : styles.totalSmall}
          testID={`wsf-community-goal-total-${goal.goalId}`}
        >
          {totalOfTargetLabel(sharedTotal, target, unit)}
        </Text>
        <Text
          style={onDark ? styles.heroPercent : styles.percentSmall}
          testID={`wsf-community-goal-percent-${goal.goalId}`}
        >
          {`${percentLabel(sharedTotal, target)} complete`}
        </Text>
        <Text
          style={[
            onDark ? styles.heroStatus : styles.statusLine,
            phase === 'nearGoal' ? (onDark ? styles.heroStatusNear : styles.statusLineNear) : null,
          ]}
          testID={`wsf-community-goal-status-${goal.goalId}`}
        >
          {statusLine(sharedTotal, target, status)}
        </Text>
      </View>
    );
  };

  // The management surface: a sheet over the page, so opening it never
  // pushes the community's own content down. Every Package E control lives
  // here with its existing testID, copy and outcome handling.
  const renderManageSheet = () => (
    <Modal
      visible={isChampion && manageOpen}
      transparent
      animationType="none"
      onRequestClose={() => setManageOpen(false)}
    >
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={styles.sheetScrim}
          onPress={() => setManageOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close Champion tools"
          testID="wsf-community-manage-scrim"
        />
        <View style={[styles.sheet, { maxHeight: Math.min(windowHeight * 0.88, 760) }]} testID="wsf-community-manage-panel">
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Champion tools</Text>
            <Pressable
              onPress={() => setManageOpen(false)}
              accessibilityRole="button"
              style={styles.sheetClose}
              testID="wsf-community-manage-close"
            >
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {goalsState.kind === 'loaded' && loadedGoals.length ? (
              <View style={styles.sheetSection}>
                <Text style={styles.manageIntro}>
                  Public display is a permission you grant per goal. A display shows the
                  running total only.
                </Text>
                {[...activeGoals, ...closedGoals].map((goal) => renderDisplayAuthControl(goal))}
              </View>
            ) : goalsState.kind === 'loaded' ? (
              <Text style={styles.body}>No goals yet. Close this and start one from the community page.</Text>
            ) : goalsState.kind === 'failed' ? (
              <Text style={styles.body}>Goals could not be loaded, so there is nothing to manage yet.</Text>
            ) : (
              <Text style={styles.body}>Loading goals…</Text>
            )}
            {/*
              The confirmation for a change whose card is no longer here to show
              it. Revoking on a closed goal takes the goal out of the list, so
              without this the Champion clicks the control and watches the goal
              disappear with nothing said about why.
            */}
            {goalsState.kind === 'loaded'
              ? confirmedButAbsent(
                  displayAuth,
                  goalsState.goals.map((g) => g.goalId)
                ).map((done) => (
                  <Text
                    key={done.goalId}
                    style={styles.body}
                    testID="wsf-goal-display-auth-confirmed-absent"
                  >
                    {done.intended
                      ? `Public display is now authorized for “${done.title}”.`
                      : `Public display has been removed for “${done.title}”. That goal has closed, so it is no longer listed here.`}
                  </Text>
                ))
              : null}
            {goalsState.kind === 'loaded' && activeGoals.length ? (
              <ButtonLink
                href={`/goals/new?groupId=${encodeURIComponent(groupId)}`}
                style={styles.secondaryButton}
                textStyle={styles.secondaryButtonText}
                testID="wsf-community-start-goal"
                label="Start another goal"
              />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      testID="wsf-community"
      {...({ 'data-state': 'ready' } as Record<string, unknown>)}
    >
      <View style={styles.inner}>
        {/* Product chrome: the full wordmark, compact; Champion tools behind one quiet control. */}
        <View style={styles.productHeader}>
          <WsfWordmark variant="navy" height={22} testID="wsf-community-wordmark" />
          {isChampion ? (
            <Pressable
              onPress={() => setManageOpen(true)}
              accessibilityRole="button"
              accessibilityState={{ expanded: manageOpen }}
              accessibilityLabel="Champion tools"
              style={styles.manageButton}
              testID="wsf-community-manage"
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </Pressable>
          ) : null}
        </View>
        {renderManageSheet()}

        {/* Community identity: the main character. */}
        <View style={styles.identity}>
          <View style={styles.headingRow}>
            <Text style={styles.heading} testID="wsf-community-name">
              {group.displayName}
            </Text>
            {isSample ? (
              <Text style={styles.sampleBadge} testID="wsf-community-sample-badge">
                Sample
              </Text>
            ) : null}
          </View>
          {featured ? (
            <Text style={styles.humanLine} testID="wsf-community-human-line">
              Moving together.
            </Text>
          ) : null}
          {memberCount != null ? (
            <Text style={styles.identityMeta} testID="wsf-community-member-count">
              {memberCountLabel(memberCount)}
            </Text>
          ) : null}
        </View>

        {/* The active goal: the product hero, on its own navy surface. */}
        <View style={styles.section} testID="wsf-community-goals">
          {goalsState.kind === 'loading' ? (
            <View
              style={styles.hero}
              testID="wsf-community-goals-loading"
              {...({ 'data-state': 'loading' } as Record<string, unknown>)}
            >
              <Text style={styles.heroEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.heroBody}>Loading goals…</Text>
            </View>
          ) : goalsState.kind === 'failed' ? (
            <View
              style={styles.hero}
              testID="wsf-community-goals-error"
              {...({ 'data-state': 'error' } as Record<string, unknown>)}
            >
              <Text style={styles.heroEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.heroTitle}>Goals couldn&apos;t be loaded</Text>
              <Text style={styles.heroBody}>
                This is a problem loading them, not a community without goals.
              </Text>
              <Pressable
                onPress={() => setGoalsReloadToken((n) => n + 1)}
                style={styles.heroOutlineButton}
                testID="wsf-community-goals-retry"
                accessibilityRole="button"
              >
                <Text style={styles.heroOutlineButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : featured ? (
            (() => {
              const p = progress[featured.goalId] ?? { kind: 'loading' as const };
              const ends = formatEndsAt(featured.endsAt);
              return (
                <View style={styles.hero} testID="wsf-community-goal-hero">
                  <Text style={styles.heroEyebrow}>What we&apos;re doing</Text>
                  <Text style={styles.heroTitle} testID={`wsf-community-goal-title-${featured.goalId}`}>
                    {featured.title}
                  </Text>
                  <Text style={styles.heroMeta}>{ends ? `Open · ${ends}` : 'Open'}</Text>
                  {p.kind === 'ok' ? (
                    <View style={styles.weWrap}>
                      <LivingWeProgress
                        completed={p.pulse.sharedTotal}
                        target={p.pulse.target}
                        unit={p.pulse.unit}
                        width={heroWeWidth}
                        surface="dark"
                        testID={`wsf-community-goal-we-${featured.goalId}`}
                      />
                    </View>
                  ) : null}
                  {renderProgressFacts(featured, p, 'hero')}
                  {renderFreshness(p)}
                  <View style={styles.actions}>
                    <ButtonLink
                      href={contributeHref(featured.goalId, 'move')}
                      style={styles.primaryButton}
                      textStyle={styles.primaryButtonText}
                      testID={`wsf-community-goal-link-${featured.goalId}`}
                      label="Start moving"
                    />
                    <ButtonLink
                      href={contributeHref(featured.goalId, 'record')}
                      style={styles.heroOutlineButtonWide}
                      textStyle={styles.heroOutlineButtonText}
                      testID={`wsf-community-goal-record-${featured.goalId}`}
                      label={`Already moved? Record ${p.kind === 'ok' ? p.pulse.unit : featured.unit}`}
                    />
                  </View>
                </View>
              );
            })()
          ) : (
            <View
              style={styles.hero}
              testID="wsf-community-no-goal"
              {...({ 'data-state': 'empty' } as Record<string, unknown>)}
            >
              <Text style={styles.heroEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.heroTitle}>No goal running yet</Text>
              <Text style={styles.heroBody}>
                {isChampion
                  ? 'Start one and your community can begin contributing.'
                  : 'Your Champion can start one for this community.'}
              </Text>
              {isChampion ? (
                <View style={styles.actions}>
                  <ButtonLink
                    href={`/goals/new?groupId=${encodeURIComponent(groupId)}`}
                    style={styles.primaryButton}
                    textStyle={styles.primaryButtonText}
                    testID="wsf-community-start-goal"
                    label="Start a goal"
                  />
                </View>
              ) : null}
            </View>
          )}

          {/* Your part: exact own credit, no ranking, no comparison. */}
          {featured
            ? (() => {
                const p = progress[featured.goalId];
                if (!p || p.kind !== 'ok' || p.ownCredit == null) return null;
                return (
                  <View style={styles.card} testID={`wsf-community-your-part-${featured.goalId}`}>
                    <Text style={styles.sectionEyebrow}>Your part</Text>
                    <Text style={styles.body}>
                      {p.ownCredit > 0
                        ? `You’ve added ${formatCount(p.ownCredit)} ${p.pulse.unit} to this goal.`
                        : 'Your first contribution counts here.'}
                    </Text>
                    <ButtonLink
                      href={contributeHref(featured.goalId, 'record')}
                      style={styles.inlineLink}
                      textStyle={styles.inlineLinkText}
                      testID={`wsf-community-your-part-link-${featured.goalId}`}
                      label={p.ownCredit > 0 ? `Record more ${p.pulse.unit}` : `Record ${p.pulse.unit}`}
                    />
                  </View>
                );
              })()
            : null}

          {/* Other open goals keep their own separately labelled mark. */}
          {otherActive.map((goal) => {
            const p = progress[goal.goalId] ?? { kind: 'loading' as const };
            return (
              <View key={goal.goalId} style={styles.card} testID={`wsf-community-goal-card-${goal.goalId}`}>
                <Text style={styles.sectionEyebrow}>Also under way</Text>
                <View style={styles.smallGoalRow}>
                  {p.kind === 'ok' ? (
                    <LivingWeProgress
                      completed={p.pulse.sharedTotal}
                      target={p.pulse.target}
                      unit={p.pulse.unit}
                      width={smallWeWidth}
                      surface="light"
                      testID={`wsf-community-goal-we-${goal.goalId}`}
                    />
                  ) : null}
                  <View style={styles.smallGoalText}>
                    <Text style={styles.cardTitle} testID={`wsf-community-goal-title-${goal.goalId}`}>
                      {goal.title}
                    </Text>
                    {renderProgressFacts(goal, p, 'card')}
                  </View>
                </View>
                <ButtonLink
                  href={contributeHref(goal.goalId, 'move')}
                  style={styles.secondaryButtonWide}
                  textStyle={styles.secondaryButtonText}
                  testID={`wsf-community-goal-link-${goal.goalId}`}
                  label="Add your contribution"
                />
              </View>
            );
          })}
        </View>

        {/*
          Community challenge (E3), unchanged in substance. Rendered only when
          a challenge is actually running: an empty "no challenge" card under
          an active goal read as a contradiction.
        */}
        {activeChallenge ? (
          <View style={styles.section} testID="wsf-community-challenge-card">
            <Link
              href={`/community/${groupId}/challenge` as never}
              style={styles.card}
              testID="wsf-community-challenge-link"
            >
              <View>
                <Text style={styles.sectionEyebrow}>Community challenge</Text>
                <Text style={styles.cardTitle}>{activeChallenge.title}</Text>
                <Text style={styles.cardMeta}>
                  {challengeParticipationLabel(
                    activeChallenge.participantCount,
                    activeChallenge.completedCount
                  )}
                </Text>
              </View>
            </Link>
          </View>
        ) : null}

        {/*
          Past goals. wsfListGoals returns a closed goal only while it is still
          authorized for public display, so this is the AVAILABLE subset of the
          community's history, not a complete archive — hence "Past goals",
          never "everything we've done", and omitted rather than "no history"
          when it is empty. A complete history needs a data source that does
          not exist yet.
        */}
        {closedGoals.length ? (
          <View style={styles.section} testID="wsf-community-history">
            <Text style={styles.sectionEyebrow}>{closedGoals.length > 1 ? 'Past goals' : 'Past goal'}</Text>
            {closedGoals.map((goal) => {
              const p = progress[goal.goalId] ?? { kind: 'loading' as const };
              const period = formatPeriod(goal.startsAt, goal.endsAt);
              return (
                <View
                  key={goal.goalId}
                  style={styles.card}
                  testID={`wsf-community-goal-closed-${goal.goalId}`}
                  {...({ 'data-state': 'closed' } as Record<string, unknown>)}
                >
                  <View style={styles.smallGoalRow}>
                    {p.kind === 'ok' ? (
                      <LivingWeProgress
                        completed={p.pulse.sharedTotal}
                        target={p.pulse.target}
                        unit={p.pulse.unit}
                        width={smallWeWidth}
                        surface="light"
                        testID={`wsf-community-goal-we-${goal.goalId}`}
                      />
                    ) : null}
                    <View style={styles.smallGoalText}>
                      <Text style={styles.cardTitle}>{goal.title}</Text>
                      {renderProgressFacts(goal, p, 'closed')}
                      {period ? <Text style={styles.cardMeta}>{period}</Text> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* About the community: the human facts, with the administrative rows folded away. */}
        <View style={styles.section} testID="wsf-community-about">
          <Text style={styles.sectionEyebrow}>About this community</Text>
          <View style={styles.cardQuiet}>
            {memberCount != null ? (
              <Row label="Members" value={memberCountLabel(memberCount)} testID="wsf-community-members-row" />
            ) : null}
            {createdLabel ? (
              <Row label="Community since" value={createdLabel} testID="wsf-community-created" />
            ) : null}
            <Pressable
              onPress={() => setDetailsOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              style={styles.detailsToggle}
              testID="wsf-community-details-toggle"
            >
              <Text style={styles.detailsToggleText}>
                {detailsOpen ? 'Hide community details' : 'Community details'}
              </Text>
            </Pressable>
            {detailsOpen ? (
              <View style={styles.details} testID="wsf-community-details">
                <Row label="Type" value={groupTypeLabel(group.groupType)} testID="wsf-community-type" quiet />
                <Row label="Joining" value={joinPolicyLabel(group.joinPolicy)} testID="wsf-community-policy" quiet />
                <Row label="Status" value={statusLabel(group.lifecycleStatus)} testID="wsf-community-status" quiet />
                <Row label="Your role" value={roleLabel(role)} testID="wsf-community-role" quiet />
              </View>
            ) : null}
          </View>

          {/* Invite: only when this viewer actually has a working link to share. */}
          {inviteUrl ? (
            <View style={styles.cardQuiet} testID="wsf-community-invite">
              <Text style={styles.cardTitle}>Invite your people</Text>
              <View>
                <Text style={styles.inviteUrl} selectable testID="wsf-community-invite-url">
                  {inviteUrl}
                </Text>
                <Text style={styles.body} testID="wsf-community-invite-caveat">
                  {group.joinPolicy === 'inviteOnly'
                    ? 'Anyone with this link can join, including someone it is forwarded to. It keeps working until you reset it.'
                    : 'This community can be found and joined by anyone.'}
                </Text>
                {resetOutcome === 'done' ? (
                  <Text style={styles.body} testID="wsf-community-invite-reset-done">
                    The old link no longer works. Share the new one above.
                  </Text>
                ) : null}
                {resetOutcome === 'failed' ? (
                  <Text style={styles.error} testID="wsf-community-invite-reset-error">
                    The link could not be reset. The link above is still the live one and still
                    lets people join. Try again.
                  </Text>
                ) : null}
                <View style={styles.inviteActions}>
                  <Pressable
                    onPress={onCopyInvite}
                    style={styles.secondaryButton}
                    testID="wsf-community-invite-copy"
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryButtonText}>
                      {copyStatus === 'copied'
                        ? 'Copied'
                        : copyStatus === 'failed'
                          ? 'Copy failed — long-press the link'
                          : 'Copy link'}
                    </Text>
                  </Pressable>
                  {hasShareApi ? (
                    <Pressable
                      onPress={onShareInvite}
                      style={styles.secondaryButton}
                      testID="wsf-community-invite-share"
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryButtonText}>Share</Text>
                    </Pressable>
                  ) : null}
                  {isChampion ? (
                    <Pressable
                      onPress={onResetInvite}
                      disabled={resetting}
                      style={styles.tertiaryButton}
                      testID="wsf-community-invite-reset"
                      accessibilityRole="button"
                    >
                      <Text style={styles.tertiaryButtonText}>
                        {resetting ? 'Resetting…' : 'Reset link'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.section} testID="wsf-community-membership">
          <Text style={styles.sectionEyebrow}>Your membership</Text>
          {leaveState.kind === 'idle' ? (
            <Pressable
              onPress={() => setLeaveState({ kind: 'confirming' })}
              style={styles.tertiaryButton}
              testID="wsf-community-leave"
              accessibilityRole="button"
            >
              <Text style={styles.tertiaryButtonText}>Leave this community</Text>
            </Pressable>
          ) : null}
          {leaveState.kind === 'confirming' ? (
            <View style={styles.cardQuiet} testID="wsf-community-leave-confirm">
              <Text style={styles.body}>
                You will stop seeing this community&apos;s goals and can no longer contribute to
                them. What you have already contributed stays counted toward the community&apos;s
                totals. You can rejoin with a current invite link.
              </Text>
              <View style={styles.inviteActions}>
                <Pressable
                  onPress={onLeave}
                  style={styles.secondaryButton}
                  testID="wsf-community-leave-confirm-yes"
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Yes, leave</Text>
                </Pressable>
                <Pressable
                  onPress={() => setLeaveState({ kind: 'idle' })}
                  style={styles.tertiaryButton}
                  testID="wsf-community-leave-cancel"
                  accessibilityRole="button"
                >
                  <Text style={styles.tertiaryButtonText}>Stay</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {leaveState.kind === 'leaving' ? (
            <Text style={styles.body} testID="wsf-community-leave-pending">
              Leaving…
            </Text>
          ) : null}
          {leaveState.kind === 'failed' ? (
            <View>
              <Text style={styles.error} testID="wsf-community-leave-error">
                {leaveState.message}
              </Text>
              <Pressable
                onPress={() => setLeaveState({ kind: 'idle' })}
                style={styles.tertiaryButton}
                testID="wsf-community-leave-dismiss"
                accessibilityRole="button"
              >
                <Text style={styles.tertiaryButtonText}>OK</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <SecondaryLink href="/" label="Back to home" />
        </View>
      </View>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  testID,
  quiet = false,
}: {
  label: string;
  value: string;
  testID?: string;
  quiet?: boolean;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={quiet ? styles.rowLabelQuiet : styles.rowLabel}>{label}</Text>
      <Text style={quiet ? styles.rowValueQuiet : styles.rowValue}>{value}</Text>
    </View>
  );
}

const NAVY = wsfTheme.colors.primary;
const CREAM = wsfTheme.colors.background;
const CARD_BORDER = '#E3E7E1';
// Cream at reduced strength on the navy hero: still well above 4.5:1.
const HERO_MUTED = 'rgba(247,245,240,0.78)';
const HERO_RULE = 'rgba(247,245,240,0.35)';

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: wsfTheme.colors.background },
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    backgroundColor: wsfTheme.colors.background,
  },
  inner: { maxWidth: 640, width: '100%', gap: 18 },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  manageButton: {
    borderWidth: 1,
    borderColor: NAVY,
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: 'center',
  },
  manageButtonText: { color: NAVY, fontWeight: '600', fontSize: 15 },
  identity: { gap: 4 },
  headingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  sampleBadge: {
    color: NAVY,
    backgroundColor: '#FBF1D3',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: wsfTheme.radius.pill,
    overflow: 'hidden',
  },
  humanLine: { color: wsfTheme.colors.textMuted, fontSize: 17, lineHeight: 24 },
  identityMeta: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  section: { gap: 12 },
  sectionEyebrow: {
    color: wsfTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ---- the hero: navy surface, cream type, green for confirmed progress ----
  hero: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
    gap: 10,
  },
  heroEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: CREAM,
    fontSize: 27,
    fontWeight: '800',
    lineHeight: 33,
    letterSpacing: -0.3,
  },
  heroMeta: { color: HERO_MUTED, fontSize: 15, lineHeight: 20 },
  heroBody: { color: CREAM, fontSize: 16, lineHeight: 22 },
  heroCentered: { alignItems: 'center', gap: 8 },
  weWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 6 },
  factsLarge: { alignItems: 'center', gap: 2 },
  factsSmall: { gap: 2 },
  heroTotal: { color: CREAM, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
  heroPercent: { color: PROGRESS_GREEN, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  heroStatus: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  heroStatusNear: { color: CREAM, fontWeight: '700' },
  freshnessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  heroFreshness: { color: HERO_MUTED, fontSize: 13 },
  freshnessButton: { minHeight: 32, justifyContent: 'center' },
  heroFreshnessLink: { color: CREAM, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  actions: { gap: 10, marginTop: 8 },
  primaryButton: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 14,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: NAVY, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  heroOutlineButtonWide: {
    borderWidth: 1.5,
    borderColor: HERO_RULE,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroOutlineButton: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: HERO_RULE,
    borderRadius: wsfTheme.radius.pill,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginTop: 6,
  },
  heroOutlineButtonText: { color: CREAM, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  // ---- light cards, quieter than the hero ----
  totalSmall: { color: wsfTheme.colors.text, fontSize: 16, fontWeight: '700' },
  percentSmall: { color: wsfTheme.colors.text, fontSize: 14, fontWeight: '600' },
  statusLine: { color: wsfTheme.colors.textMuted, fontSize: 15, lineHeight: 20 },
  statusLineNear: { color: wsfTheme.colors.text, fontWeight: '700' },
  closedResult: { color: wsfTheme.colors.text, fontSize: 14, fontWeight: '600' },
  secondaryButtonWide: {
    backgroundColor: wsfTheme.colors.surface,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: wsfTheme.colors.surface,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: wsfTheme.radius.pill,
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tertiaryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  tertiaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  inlineLink: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' },
  inlineLinkText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardQuiet: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardTitle: { color: wsfTheme.colors.text, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  cardMeta: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  smallGoalRow: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  smallGoalText: { flex: 1, gap: 4 },

  // ---- Champion tools sheet ----
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,31,58,0.55)' },
  sheetScrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C9CFD8',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  sheetTitle: { color: wsfTheme.colors.text, fontSize: 20, fontWeight: '800' },
  sheetClose: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  sheetCloseText: { color: NAVY, fontSize: 16, fontWeight: '700', textDecorationLine: 'underline' },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 12, paddingBottom: 8 },
  sheetSection: { gap: 10 },
  manageIntro: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  manageGoal: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#D5DCE5' },
  manageGoalTitle: { color: wsfTheme.colors.text, fontSize: 16, fontWeight: '700' },

  // ---- about ----
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: wsfTheme.colors.textMuted, fontSize: 15 },
  rowValue: { color: wsfTheme.colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  rowLabelQuiet: { color: wsfTheme.colors.textMuted, fontSize: 13 },
  rowValueQuiet: { color: wsfTheme.colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  detailsToggle: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: 2 },
  detailsToggleText: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  details: { borderTopWidth: 1, borderTopColor: CARD_BORDER, paddingTop: 4 },
  body: { color: wsfTheme.colors.text, fontSize: 16, lineHeight: 22 },
  error: { color: '#B4232C', fontSize: 15, lineHeight: 21 },
  inviteUrl: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  inviteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  footer: { alignItems: 'center', paddingTop: 8 },
});
