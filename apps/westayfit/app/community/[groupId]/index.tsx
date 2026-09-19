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
} from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { AuthFlagOffPanel } from '../../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../../src/callableErrors';
import { FormShell } from '../../../src/AuthFormPrimitives';
import { resolveRepeatPolicy, type RepeatPolicy } from '../../../src/contributionFlow';
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
import { communityMomentumLine } from '../../../src/communityMomentum';
import {
  canShareGoalDisplay,
  displayShareUrl,
  shareControlLabel,
  shareRoute,
  SHARE_DISCLOSURE,
  type ShareStatus,
} from '../../../src/shareGoalDisplay';
import { wsfTheme } from '../../../src/theme';
import { PROGRESS_GREEN } from '../../../src/ui/brandAssets';
import { ButtonLink } from '../../../src/ui/ButtonLink';
import { JoinQrCode } from '../../../src/ui/JoinQrCode';
import { buildJoinUrl, isLinkJoinable } from '../../../src/ui/joinLink';
import {
  formatActiveWindowLabel,
  formatClock,
  formatMonthYear,
  formatPeriod,
  formatReachedOn,
} from '../../../src/ui/dates';
import { kit } from '../../../src/ui/kit';
import { LIVING_WE_ASPECT } from '../../../src/ui/livingWeCalibration';
import { LivingWeProgress } from '../../../src/ui/LivingWeProgress';
import {
  formatCount,
  isReached,
  percentLabel,
  progressPhase,
  statusLine,
  totalOfTargetLabel,
} from '../../../src/ui/progressFormat';
import { WsfWordmark } from '../../../src/ui/WsfWordmark';

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
  /**
   * The server's one-time target-crossing event, as an ISO instant, or null
   * for a goal that never crossed. Member-authorized: wsfListGoals refuses
   * anyone who is not an active member, and wsfGoalPulse — the public
   * aggregate — does not carry it.
   *
   * It is the DAY IT HAPPENED, not a live "reached" flag. Whether the goal
   * stands at or beyond its target right now still comes from the confirmed
   * total and target below (progressPhase), so a correction that drops the
   * total back honestly changes the state and leaves the history alone.
   */
  reachedAt?: string | null;
  // Present only on a wsfListGoals call that asked for history. Optional here
  // because the type also describes the responses that did not.
  sharedTotal?: number;
  timezone?: string;
  closedAt?: string | null;
};

type ListGoalsResponse = { goals: ListedGoal[] };

/**
 * The extra facts a goal carries when the screen asks for history, via
 * wsfListGoals' `includeHistory` flag. An intersection rather than fields on
 * ListedGoal, matching the server: without the flag the response is exactly
 * what it has always been, and nothing here is assumed to be present.
 */
type GoalHistoryFields = {
  sharedTotal: number;
  timezone: string;
  closedAt: string | null;
};

type HistoryGoal = ListedGoal & GoalHistoryFields;

/**
 * A goal is only rendered as a history row once it actually carries the facts
 * a history row states. A server that did not honour the flag produces rows
 * with no total and no zone, and "undefined of 500 flights" — or a fabricated
 * 0 — is worse than not listing the goal.
 */
function hasHistoryFields(goal: ListedGoal): goal is HistoryGoal {
  return (
    typeof (goal as Partial<HistoryGoal>).sharedTotal === 'number' &&
    typeof (goal as Partial<HistoryGoal>).timezone === 'string'
  );
}

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
// wsfGoalPulse's complete response: the four aggregate fields and, since the
// owner's publication decision of 2026-09-18, the goal's window and time zone.
// Community Home renders goal dates from THIS confirmed window in the goal's
// own zone; wsfListGoals carries no zone and is not used for dates.
type PulseTotals = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
  communityDisplayName: string;
  goalTitle: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

/**
 * Three states, kept apart on purpose: a progress read that has not returned,
 * one that returned, and one that failed. A failed read is NOT zero progress
 * and is never rendered as a number.
 */
type GoalProgress =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      pulse: PulseTotals;
      ownCredit: number | null;
      /** null when the member-authorized read was not made (a closed goal). */
      repeatPolicy: RepeatPolicy | null;
      at: Date;
    }
  | { kind: 'failed' };

type MyContributionResponse = { ownCredit: number; unit: string; repeatPolicy?: unknown };

export default function CommunityPage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  // W7. The display-link control keeps its OWN state and its own timer. It is
  // a different link to a different audience from the invite link, and a copy
  // of one must never light up the other's confirmation.
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const [goalsState, setGoalsState] = useState<GoalsState>({ kind: 'loading' });
  const [goalsReloadToken, setGoalsReloadToken] = useState(0);
  const [progress, setProgress] = useState<Record<string, GoalProgress>>({});
  const [progressReloadToken, setProgressReloadToken] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The ask-first step in front of link rotation, and the member's disclosure
  // of their membership options. Both are presentation state: nothing is sent
  // until the confirmation is accepted.
  const [resetConfirming, setResetConfirming] = useState(false);
  const [membershipOpen, setMembershipOpen] = useState(false);
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
  // The handle of the timer that returns "Copied" to its resting label. It is
  // held because it has to be CANCELLABLE: two copies a second apart used to
  // leave two timers running, and the first one — armed by the first tap —
  // fired 1s into the second tap's two seconds and wiped a "Copied" that had
  // just been shown. One timer at a time, and none left behind on unmount.
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCopyReset = useCallback(() => {
    if (copyResetRef.current) {
      clearTimeout(copyResetRef.current);
      copyResetRef.current = null;
    }
  }, []);
  useEffect(() => clearCopyReset, [clearCopyReset]);
  // The same one-timer-at-a-time rule for the display-link control.
  const shareResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearShareReset = useCallback(() => {
    if (shareResetRef.current) {
      clearTimeout(shareResetRef.current);
      shareResetRef.current = null;
    }
  }, []);
  useEffect(() => clearShareReset, [clearShareReset]);
  useEffect(() => {
    contextRef.current = { groupId, uid: user?.uid ?? null };
    // A new context. Everything the previous one had to say about permissions
    // goes with it, and the generation advances so nothing still outstanding
    // from the old one can write here again.
    setDisplayAuth((prev) => beginContext(prev));
    // The same rule for the invite link: a join code minted by "Create a new invite link"
    // belongs to the community it was minted for. It must never be rendered
    // as another community's link when the screen is reused for a different
    // community or account.
    setResetJoinCode(null);
    setResetOutcome('idle');
    setResetConfirming(false);
    setMembershipOpen(false);
    setCopyStatus('idle');
    setShareStatus('idle');
  }, [groupId, user?.uid]);
  // Closing the sheet withdraws an unanswered confirmation with it: reopening
  // Manage must never land on "will stop working for everyone" unasked.
  useEffect(() => {
    if (!manageOpen) setResetConfirming(false);
  }, [manageOpen]);

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
      setState({ kind: 'error', message: 'This community could not be found.' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const db = getFirebaseFirestore();
        const functions = getFirebaseFunctions();

        const membershipRef = doc(db, 'wsfMemberships', `${groupId}_${user.uid}`);
        // A NEVER-MEMBER'S READ IS REFUSED, NOT EMPTY. firestore.rules gates
        // this document on `resource.data.userId == request.auth.uid`, and a
        // document that does not exist has no `resource` to satisfy it: the
        // get comes back `permission-denied` rather than as a missing snapshot.
        // Every not-a-member case exercised until now (removed, departed) left
        // the document in place, so this screen only ever saw the `exists()`
        // half and sent a signed-in stranger to the generic load error.
        // Denied here is the same fact as absent — this account holds no
        // membership of this community — and lands on the same state. Any
        // other failure is still a failure and falls through to the catch.
        const membershipSnap = await getDoc(membershipRef).catch((e: unknown) => {
          if ((e as { code?: string } | null)?.code === 'permission-denied') return null;
          throw e;
        });
        if (cancelled) return;
        if (!membershipSnap || !membershipSnap.exists()) {
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
        // A1. The server's own sentence is a developer fact, not member copy —
        // it can name a callable, a region or an internal reason. It goes to
        // the console; the screen says what the member can act on.
        console.warn('[wsf] community load failed', e);
        setState({
          kind: 'error',
          message: 'We couldn’t load this community right now. Check your connection and try again.',
        });
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
        const fn = httpsCallable<
          { groupId: string; includeHistory: boolean },
          ListGoalsResponse
        >(getFirebaseFunctions(), 'wsfListGoals');
        // ONE call and one round trip for both sections. `includeHistory` adds
        // every closed goal of the community regardless of display
        // authorization — the community's own record — and the extra facts a
        // history row needs to state its result. The screen splits active from
        // closed below; the server does not decide the layout.
        const result = await fn({ groupId, includeHistory: true });
        if (cancelled) return;
        setGoalsState({ kind: 'loaded', goals: result.data.goals ?? [] });
      } catch (e) {
        if (cancelled) return;
        // A1. Same rule as the community load: the raw reason is logged, the
        // screen keeps its own fixed copy (rendered by the goals-error hero
        // and the Champion panel, neither of which prints this message).
        console.warn('[wsf] goal list failed', e);
        setGoalsState({ kind: 'failed', message: 'Could not load goals.' });
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
    // Open goals only. A closed goal's record now arrives with the goal list
    // itself — `includeHistory` carries its confirmed shared total — so a
    // pulse read for one would be a request whose answer nothing renders.
    const openGoals = goalsState.goals.filter((g) => g.status === 'active');
    setProgress(
      Object.fromEntries(openGoals.map((g) => [g.goalId, { kind: 'loading' as const }]))
    );
    for (const goal of openGoals) {
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
              repeatPolicy: ownResult ? resolveRepeatPolicy(ownResult.data.repeatPolicy) : null,
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
      // Leaving the screen closes the Champion tools sheet. The sheet is a
      // portal over the whole window, and the stack keeps this screen
      // mounted underneath the next one, so an open sheet would otherwise
      // sit on top of the screen being navigated to.
      return () => setManageOpen(false);
    }, [])
  );

  const refreshProgress = useCallback(() => setProgressReloadToken((n) => n + 1), []);

  // D4: public AND inviteOnly are link-joinable. private is not — a general
  // community link never admits anyone there. The rule itself lives in
  // `src/ui/joinLink.ts` so the QR in the Champion sheet encodes the SAME
  // string this control copies, rather than a second derivation of it.
  const inviteUrl =
    state.kind === 'ready'
      ? buildJoinUrl({
          origin: typeof window === 'undefined' ? null : window.location.origin,
          joinCode: resetJoinCode ?? state.group.joinCode,
          joinPolicy: state.group.joinPolicy,
        })
      : null;

  const onCopyInvite = useCallback(async () => {
    if (!inviteUrl || typeof navigator === 'undefined') return;
    // This tap owns the label from here on. Whatever the previous tap armed
    // is cancelled first, so it cannot clear a confirmation this tap is about
    // to show — or a failure, which must not be timed out at all.
    clearCopyReset();
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('copied');
      copyResetRef.current = setTimeout(() => {
        copyResetRef.current = null;
        setCopyStatus('idle');
      }, 2_000);
    } catch {
      setCopyStatus('failed');
    }
  }, [inviteUrl, clearCopyReset]);

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
      // should not have. Leaving the button to settle back to its resting label
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
      setLeaveState({
        kind: 'failed',
        message: describeCallableError(e, 'Could not leave this community. Try again.'),
      });
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
      //
      // It reads a list it does not publish, and the caller then reloads the
      // same list — two wsfListGoals for one failed write. That second call
      // is NOT redundant: it is the reload whose own failure orphans this
      // outcome, and tests-e2e/ui-champion-torture.spec.ts ("D-7: a failed
      // goals reload must not take the read-back warning with it") fails the
      // second call to prove the warning survives without its card. Publishing
      // this response and dropping the reload saves one call on an error path
      // and makes that case unreachable, so it is deliberately not done here.
      try {
        const fn = httpsCallable<{ groupId: string }, ListGoalsResponse>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const result = await fn({ groupId });
        const found = (result.data.goals ?? []).find((g) => g.goalId === targetGoalId);
        // ABSENT IS AN ANSWER. wsfListGoals returns the goals that are active
        // OR display-authorized, so a CLOSED goal whose revoke actually landed
        // is absent BY CONSTRUCTION — its authorization was the only thing
        // keeping it listed. Reading that as "the read settled nothing" made
        // the one case the read-back exists for (a lost response on a
        // successful revoke) report "We could not confirm…", when the absence
        // is the confirmation. Only a thrown read is unknown.
        if (!found) return false;
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

  /**
   * W7. Share the PUBLIC DISPLAY link for a goal — the one artefact that is
   * safe to hand to someone outside the community, and only once the Champion
   * has authorized it. src/shareGoalDisplay decides the URL and the route;
   * this callback only performs it.
   *
   * Web Share route: the sheet is the confirmation, so nothing on the page
   * changes. A rejection is a dismissal as often as it is a failure, and the
   * two are indistinguishable here, so neither is reported as an outcome —
   * the same rule the invite Share control already follows.
   *
   * Clipboard route: the existing invite behaviour, "Copied" for two seconds,
   * and a failure that is NOT timed out because nothing was copied.
   */
  const onShareGoalDisplay = useCallback(
    async (url: string) => {
      const route = shareRoute(typeof navigator === 'undefined' ? null : navigator);
      if (route === 'unavailable') return;
      clearShareReset();
      if (route === 'webShare') {
        try {
          await (navigator as Navigator & {
            share: (data: ShareData) => Promise<void>;
          }).share({ url });
        } catch {
          /* dismissed or blocked — no claim either way */
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        setShareStatus('copied');
        shareResetRef.current = setTimeout(() => {
          shareResetRef.current = null;
          setShareStatus('idle');
        }, 2_000);
      } catch {
        setShareStatus('failed');
      }
    },
    [clearShareReset]
  );

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Your community" testID="wsf-community-disabled" />;
  }

  if (state.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Your community" testID="wsf-community-loading">
        <View {...({ 'data-state': 'loading' } as Record<string, unknown>)}>
          <Text style={kit.statusText}>Loading…</Text>
        </View>
      </FormShell>
    );
  }

  if (state.kind === 'notSignedIn') {
    return (
      <FormShell
        // Not "Your community": whoever is reading this is not signed in, so
        // it is not theirs yet, and the heading should not say it is.
        heading="This community"
        intro="Sign in to view this community."
        testID="wsf-community-signed-out"
      >
        {/*
          One state, one job, one obvious primary. An underlined text link
          alone in a card gives a signed-out visitor nothing that looks like
          the way forward (clause 12).
        */}
        <ButtonLink
          href="/signin"
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-community-signin"
          label="Sign in"
        />
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
        <ButtonLink
          href="/"
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-community-not-member-home"
          label="Back to home"
        />
      </FormShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <FormShell heading="Something went wrong" testID="wsf-community-error">
        <View {...({ 'data-state': 'error' } as Record<string, unknown>)}>
          {/* A1. Body copy, like the contribution screen's: this is a state
              of the page, not a validation error the member can correct. The
              red `styles.error` stays for the real validation errors below. */}
          <Text style={kit.body}>{state.message}</Text>
        </View>
        <ButtonLink
          href="/"
          style={kit.tertiaryButton}
          textStyle={kit.tertiaryButtonText}
          testID="wsf-community-error-home"
          label="Back to home"
        />
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
  // The history rows: the closed goals from the same wsfListGoals response,
  // which now carries all of them and not only the display-authorized subset.
  // `closedGoals` is that same set and is what the Champion's permission cards
  // read too — those cards filter it themselves. Open goals belong to the
  // active section, so nothing is listed twice.
  //
  // Most recent first: the server returns one ascending list for both
  // sections, and a history reads newest-first.
  const closedHistory = closedGoals
    .filter(hasHistoryFields)
    .slice()
    .sort((a, b) => (a.endsAt === b.endsAt ? a.goalId.localeCompare(b.goalId) : b.endsAt.localeCompare(a.endsAt)));
  const featured = activeGoals[0] ?? null;
  const otherActive = activeGoals.slice(1);
  // D-7. Which goals actually get a permission card this pass — ONE source,
  // consulted by the card renderer and by the orphan block in the Manage
  // sheet, so every outcome is reported exactly once: never twice, and never
  // (as it was) not at all because the list around it failed to reload.
  const hasDisplayAuthCard = (goal: ListedGoal) =>
    isChampion && (goal.status === 'active' || goal.aggregateDisplayAuthorized);
  const cardedGoalIds = new Set(
    goalsState.kind === 'loaded' && loadedGoals.length
      ? [...activeGoals, ...closedGoals].filter(hasDisplayAuthCard).map((g) => g.goalId)
      : []
  );
  const createdLabel = (() => {
    const raw = group.createdAt;
    if (!raw || typeof raw !== 'object' || typeof raw.toDate !== 'function') return null;
    try {
      return formatMonthYear(raw.toDate());
    } catch {
      return null;
    }
  })();
  // Fits the hero at any width, including a 200% text-zoom reflow (≈195 px).
  const heroWeWidth = Math.max(96, Math.min(280, windowWidth - 2 * 20 - 2 * 22));
  const smallWeWidth = 104;
  // The hero's progress area reserves the room the We mark, its three facts
  // and the freshness line will take, so a pulse that lands does not move
  // the title above it or the actions below it.
  const progressAreaMinHeight = Math.round(heroWeWidth / LIVING_WE_ASPECT) + 14 + 6 + 118;
  const linkJoinable = isLinkJoinable(group.joinPolicy);
  // Champions always get the Invite card (on a private community it carries
  // the honest no-link sentence); members get it only with a working link.
  const showInviteCard = isChampion || (linkJoinable && inviteUrl != null);
  // One human line under the name, and only once the goal list has answered:
  // a claim about what the community is doing waits for the facts.
  const humanLine =
    goalsState.kind === 'loaded' ? (featured ? 'Moving together.' : 'Ready to get moving.') : null;
  const footerLine = [
    memberCount != null ? memberCountLabel(memberCount) : null,
    createdLabel ? `since ${createdLabel}` : null,
  ]
    .filter((part): part is string => part != null)
    .join(' · ');

  // W7. The display link for the featured goal, or null — which is the normal
  // case. Everything that has to be true is decided in src/shareGoalDisplay:
  // the goal is authorized, the community is not sample data, this browser has
  // a mechanism, and an absolute origin exists to build the URL from. Both
  // browser reads happen at render, but the hero that carries the control only
  // exists after the async loads have answered, so the static export never
  // renders it and there is nothing for hydration to disagree with.
  const goalShareRoute = shareRoute(typeof navigator === 'undefined' ? null : navigator);
  const featuredShareUrl =
    featured && canShareGoalDisplay(featured, { isSample }) && goalShareRoute !== 'unavailable'
      ? displayShareUrl(typeof window === 'undefined' ? null : window.location.origin, featured.goalId)
      : null;

  // W7. One roll-up across the community's open goals, from pulses already on
  // hand. Null — no line at all — whenever it cannot be said completely; see
  // src/communityMomentum for each of the three suppressing rules.
  const momentumLine = communityMomentumLine(
    activeGoals.map((goal) => {
      const p = progress[goal.goalId];
      return p?.kind === 'ok'
        ? { confirmed: true, reached: isReached(p.pulse.sharedTotal, p.pulse.target) }
        : { confirmed: false, reached: false };
    })
  );

  const contributeHref = (goalId: string, mode: 'move' | 'record') =>
    `/contribute/${goalId}?groupId=${encodeURIComponent(groupId)}&mode=${mode}`;

  const renderDisplayAuthControl = (goal: ListedGoal) => {
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
    if (!hasDisplayAuthCard(goal)) return null;
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
            ? 'Public display is authorized for this goal. It can show the community name, goal, period, and shared progress — never individual contributions or member names.'
            : 'Public display is not authorized for this goal.'}
        </Text>
        {/*
          The permission is real, and on a SAMPLE community it still shows
          nothing: wsfGoalPulse refuses the display route for a sample group
          whatever this goal says. The control does not consult that, so the
          state text above would otherwise promise a display that cannot exist.
          A qualifier, not a rewrite of the state text — the stored permission
          really is what it says it is.
        */}
        {isSample ? (
          <Text style={styles.body} testID={`wsf-goal-display-auth-sample-note-${goal.goalId}`}>
            This community is sample data, so no public display will show it.
          </Text>
        ) : null}
        {/*
          The publication decision, stated BEFORE it is made. Authorizing a
          goal publishes its context as well as its progress (owner decision,
          2026-09-18), so the Champion reads exactly what a display may show
          before granting it.
        */}
        {!goal.aggregateDisplayAuthorized ? (
          <Text style={styles.manageIntro} testID={`wsf-goal-display-auth-explain-${goal.goalId}`}>
            A public display can show this community’s name, this goal’s name and period, and the
            shared progress. It never shows individual contributions or member names.
          </Text>
        ) : null}
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
          // D-9. With two goals in the sheet the visible label is the same on
          // both controls ("Authorize public display"), so by name alone they
          // are indistinguishable. The name says which goal; the visible text
          // is untouched.
          accessibilityLabel={`${goal.title}: ${
            goal.aggregateDisplayAuthorized ? 'Remove' : 'Authorize'
          } public display`}
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
          {`Confirmed ${formatClock(p.at)}`}
        </Text>
        <Pressable
          onPress={refreshProgress}
          accessibilityRole="button"
          testID="wsf-community-progress-refresh"
          style={styles.freshnessButton}
          accessibilityLabel="Refresh confirmed progress"
        >
          <Text style={styles.heroFreshnessLink}>Refresh</Text>
        </Pressable>
      </View>
    ) : null;

  // `hero` is the navy active-goal surface; `card` is a light card. The
  // compact closed-goal record moved to the History section, which renders
  // from the goal list's own history facts rather than from a pulse read.
  const renderProgressFacts = (goal: ListedGoal, p: GoalProgress, variant: 'hero' | 'card') => {
    const onDark = variant === 'hero';
    if (p.kind === 'loading') {
      // A quiet one-line status, never the surface's main content: the goal's
      // title stays the headline while the numbers are on their way.
      return (
        <Text
          style={onDark ? styles.heroStatus : styles.cardMeta}
          testID={`wsf-community-goal-progress-loading-${goal.goalId}`}
        >
          Checking progress…
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
            accessibilityLabel={`Try again: ${goal.title} progress`}
          >
            <Text style={onDark ? styles.heroOutlineButtonText : styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    const { sharedTotal, target, unit, status } = p.pulse;
    const phase = progressPhase(sharedTotal, target, status);
    // THE DAY WE REACHED IT. The instant is the server's one-time crossing
    // event, read on the member-authorized goal list; the zone is the goal's
    // own, from the confirmed pulse, so every member reads the same day.
    //
    // Shown only while the goal is at or beyond its target, because the LIVE
    // state is what this page reports. After a correction that drops the
    // total back below the line, the page says what is true now ("40 to go")
    // and does not print a past date beside it as if it still stood; the
    // event itself is not erased — it is simply not the current state.
    const reachedOn =
      goal.reachedAt && (phase === 'reachedOpen' || phase === 'closedReached')
        ? formatReachedOn(goal.reachedAt, { timeZone: p.pulse.timezone })
        : null;
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
        {reachedOn ? (
          <Text
            style={onDark ? styles.heroStatus : styles.statusLine}
            testID={`wsf-community-goal-reached-${goal.goalId}`}
          >
            {reachedOn}
          </Text>
        ) : null}
      </View>
    );
  };

  // The leave control and its confirmation, in one place. A member reaches it
  // through the "Membership options" disclosure at the bottom of the page; a
  // Champion reaches it inside Manage. Only one of the two ever renders, so
  // every testID here exists exactly once on screen.
  const renderLeaveControls = () => (
    <View style={styles.leaveBlock}>
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
  );

  // The management surface: a sheet over the page, so opening it never
  // pushes the community's own content down. Every Package E control lives
  // here with its existing testID, copy and outcome handling, and the
  // administrative facts (community details, the invite QR, link rotation,
  // leaving) live here too — out of the member journey, one tap away.
  const renderManageSheet = () => (
    <Modal
      visible={isChampion && manageOpen}
      transparent
      animationType="none"
      onRequestClose={() => setManageOpen(false)}
      // D-3. react-native-web renders the modal as role="dialog" and spreads
      // the rest of its props onto that element. Without a name the dialog is
      // announced as just "dialog"; this is the sheet's own visible title.
      aria-label="Champion tools"
    >
      <View style={styles.sheetBackdrop}>
        {/*
          Tapping outside closes the sheet. The scrim is a plain view with a
          click handler, deliberately not a focusable or announced control:
          a focusable scrim ends up in the sheet's Tab cycle and a single key
          press would dismiss the sheet. The Close button (and Escape) is the
          accessible way out.
        */}
        <View
          style={styles.sheetScrim}
          // `onClick` is a react-native-web prop that the RN typings omit.
          {...({ onClick: () => setManageOpen(false) } as Record<string, unknown>)}
          accessible={false}
          aria-hidden
          testID="wsf-community-manage-scrim"
        />
        <View style={[styles.sheet, { maxHeight: Math.min(windowHeight * 0.88, 760) }]} testID="wsf-community-manage-panel">
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} {...HEADING_2}>Champion tools</Text>
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
                <Text style={styles.sheetSectionTitle}>Public display</Text>
                <Text style={styles.manageIntro}>
                  Public display is a permission you grant per goal. An authorized display can
                  show the community name, the goal and its period, and the shared progress —
                  nothing about individual members.
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
                  // ABSENT FROM WHAT. Not "absent from this response" — since
                  // W6 the response carries `includeHistory`, so every closed
                  // goal of the community is in it whatever its display
                  // permission says, and a revoke on a closed goal would never
                  // read as absent again. The set that means something here is
                  // the one the permission cards are drawn from and the one the
                  // unflagged wsfListGoals returns: active OR display-
                  // authorized. A closed goal drops out of it exactly when the
                  // revoke lands, which is the confirmation.
                  goalsState.goals
                    .filter((g) => g.status === 'active' || g.aggregateDisplayAuthorized)
                    .map((g) => g.goalId)
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
            {/*
              D-7 / D-7b. OUTCOMES WHOSE CARD IS NOT ON SCREEN THIS PASS.
              Every one of these operations bumps the goals reload token, and
              a reload takes the list to `loading` and possibly to `failed` —
              so the card that carries the warning, its retry and its Dismiss
              is gone exactly when there is something to say. A failed reload
              used to swallow the read-back warning with it, and a SUCCESSFUL
              authorize whose reload failed said nothing at all about a public
              display having just been switched on.

              Same copy and same testIDs as the card, because it is the same
              outcome; the set above guarantees only one of the two renders.
            */}
            {Object.entries(displayAuth.byGoal)
              .filter(([goalId]) => !cardedGoalIds.has(goalId))
              .map(([goalId, outcome]) => {
                if (outcome.kind === 'unconfirmed' || outcome.kind === 'failed') {
                  return (
                    <View key={goalId} style={styles.manageGoal}>
                      <Text style={styles.manageGoalTitle}>{outcome.title}</Text>
                      <Text style={styles.error} testID={`wsf-goal-display-auth-unsettled-${goalId}`}>
                        {outcome.kind === 'unconfirmed'
                          ? 'We could not confirm this goal’s current display permission. What is shown above may be out of date until this succeeds.'
                          : outcome.intended
                            ? 'That change did not take effect. Public display is still not authorized for this goal.'
                            : 'That change did not take effect. Public display is still authorized for this goal.'}
                      </Text>
                      {/* The retry sends the value that was ASKED FOR, exactly as the card's does. */}
                      <Pressable
                        onPress={() =>
                          onSetDisplayAuth(
                            goalId,
                            displayAuthValueToSend(outcome, outcome.intended),
                            outcome.title
                          )
                        }
                        style={styles.secondaryButton}
                        testID={`wsf-goal-display-auth-toggle-${goalId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${outcome.title}: ${
                          outcome.intended ? 'Remove' : 'Authorize'
                        } public display`}
                      >
                        <Text style={styles.secondaryButtonText}>
                          {outcome.intended
                            ? 'Try again: authorize public display'
                            : 'Try again: remove public display'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => onDismissDisplayAuth(goalId)}
                        style={styles.secondaryButton}
                        testID={`wsf-goal-display-auth-dismiss-${goalId}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.secondaryButtonText}>Dismiss this notice</Text>
                      </Pressable>
                    </View>
                  );
                }
                // A confirmed change with no card and no list to say it is
                // absent from. The goal may well still be listed once the
                // reload succeeds, so this says only what was established —
                // never that the goal has closed or gone.
                if (outcome.kind === 'confirmed' && goalsState.kind !== 'loaded') {
                  return (
                    <Text
                      key={goalId}
                      style={styles.body}
                      testID={`wsf-goal-display-auth-confirmed-orphan-${goalId}`}
                    >
                      {outcome.intended
                        ? `Public display is now authorized for “${outcome.title}”.`
                        : `Public display has been removed for “${outcome.title}”.`}
                    </Text>
                  );
                }
                return null;
              })}

            {/*
              Community details: the administrative facts about this community,
              here for the person who administers it rather than in every
              member's journey. The type/joining/status/role rows stay behind
              their own disclosure with the same testIDs they have always had.
            */}
            <View style={styles.sheetSection}>
              <Text style={styles.sheetSectionTitle}>Community details</Text>
              {memberCount != null ? (
                <Row label="Members" value={memberCountLabel(memberCount)} testID="wsf-community-members-row" />
              ) : null}
              {createdLabel ? (
                <Row label="Community since" value={createdLabel} testID="wsf-community-created" />
              ) : null}
              <Pressable
                onPress={() => setDetailsOpen((v) => !v)}
                accessibilityRole="button"
                aria-expanded={detailsOpen}
                style={styles.detailsToggle}
                testID="wsf-community-details-toggle"
              >
                <Text style={styles.detailsToggleText}>
                  {detailsOpen ? 'Hide details' : 'Show all details'}
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

            {/*
              The join link as something a phone can scan. Champion-only by
              construction: this whole Modal is `visible={isChampion && ...}`,
              so a member or a signed-out visitor never renders it — the QR is
              not hidden from them, it does not exist for them.

              It carries no authority of its own. It is the same `/join/<code>`
              URL the Invite card copies, and a scan lands on the same join
              page with the same identity requirements behind it. Creating a
              new invite link re-derives `inviteUrl`, which re-encodes the
              symbol. This instance carries the hosted-harness testIDs
              (wsf-community-qr, -toggle, -symbol); the Invite card's own
              instance uses its own prefix so each id resolves to one element.
            */}
            <View style={styles.sheetSection} testID="wsf-community-qr-section">
              <Text style={styles.sheetSectionTitle}>Invite QR</Text>
              {linkJoinable ? (
                inviteUrl ? (
                  <JoinQrCode url={inviteUrl} caveat={MANAGE_QR_CAVEAT} />
                ) : (
                  <Text style={styles.manageIntro} testID="wsf-community-qr-pending">
                    This community&apos;s invite link is not ready yet, so there is nothing to
                    encode. Close this and open it again.
                  </Text>
                )
              ) : (
                <JoinQrCode url={null} />
              )}
            </View>

            {/*
              D1: retire the current link. A confirmation first, because the
              consequence is for everyone who holds the old link, not only for
              the Champion tapping it. The callable and its outcome handling
              are unchanged; only the ask-first step is new.
            */}
            {linkJoinable ? (
              <View style={styles.sheetSection} testID="wsf-community-invite-link">
                <Text style={styles.sheetSectionTitle}>Invite link</Text>
                <Text style={styles.manageIntro} testID="wsf-community-invite-caveat">
                  {/*
                    Clause 9. Both sentences state what the join callable and
                    the rules actually enforce for the stored value. A link
                    admits to 'public' and 'inviteOnly' alike, and nothing in
                    this product lists, searches or otherwise discovers a
                    community — so the public branch says what Start your
                    community and the join preview already say, word for word,
                    instead of claiming a discovery feature that does not exist.
                  */}
                  {group.joinPolicy === 'inviteOnly'
                    ? 'Anyone with this link can join, including someone it is forwarded to. It keeps working until you create a new one.'
                    : 'Anyone with the invite link can join. The community is not listed or searchable anywhere, so people need the link.'}
                </Text>
                {resetOutcome === 'done' ? (
                  <Text style={styles.body} testID="wsf-community-invite-reset-done">
                    The old link no longer works. Copy invite, Share invite and the QR code now use
                    the new one.
                  </Text>
                ) : null}
                {resetOutcome === 'failed' ? (
                  <Text style={styles.error} testID="wsf-community-invite-reset-error">
                    A new link could not be created. The current link is still the live one and
                    still lets people join. Try again.
                  </Text>
                ) : null}
                {resetConfirming ? (
                  <View style={styles.cardQuiet} testID="wsf-community-reset-confirm">
                    <Text style={styles.body}>
                      The current invite link will stop working for everyone who has it.
                    </Text>
                    <View style={styles.inviteActions}>
                      <Pressable
                        onPress={() => {
                          setResetConfirming(false);
                          void onResetInvite();
                        }}
                        style={[styles.secondaryButton, styles.rowButton]}
                        testID="wsf-community-reset-confirm-yes"
                        accessibilityRole="button"
                      >
                        <Text style={[styles.secondaryButtonText, styles.rowButtonText]}>
                          Yes, create a new link
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setResetConfirming(false)}
                        style={[styles.tertiaryButton, styles.rowButton]}
                        testID="wsf-community-reset-cancel"
                        accessibilityRole="button"
                      >
                        <Text style={[styles.tertiaryButtonText, styles.rowButtonText]}>
                          Keep the current link
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setResetConfirming(true)}
                    disabled={resetting}
                    style={styles.secondaryButton}
                    testID="wsf-community-reset"
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryButtonText}>
                      {resetting ? 'Creating a new link…' : 'Create a new invite link'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {goalsState.kind === 'loaded' && activeGoals.length ? (
              <ButtonLink
                href={`/goals/new?groupId=${encodeURIComponent(groupId)}`}
                style={styles.secondaryButton}
                textStyle={styles.secondaryButtonText}
                testID="wsf-community-start-goal"
                label="Start another goal"
                onPress={() => setManageOpen(false)}
              />
            ) : null}

            {/* Destructive, and last: leaving, with the sole-Champion refusal surfaced verbatim. */}
            <View style={styles.sheetSection} testID="wsf-community-membership">
              <Text style={styles.sheetSectionTitle}>Membership</Text>
              {renderLeaveControls()}
            </View>
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
              aria-expanded={manageOpen}
              accessibilityLabel="Manage: Champion tools"
              style={styles.manageButton}
              testID="wsf-community-manage"
            >
              <Text style={styles.manageButtonText}>Manage</Text>
            </Pressable>
          ) : null}
        </View>
        {renderManageSheet()}

        {/* Community identity: the main character. The name and one human line — the count and the founding month wait at the foot of the page. */}
        <View style={styles.identity}>
          <View style={styles.headingRow}>
            {/*
              D-1. The community is what this page is about, so its name is
              the page's one top-level heading. Role and level only — the
              styles, and therefore the rendering, are unchanged.
            */}
            <Text style={[styles.heading, styles.headingName]} testID="wsf-community-name" {...HEADING_1}>
              {group.displayName}
            </Text>
            {isSample ? (
              <Text style={styles.sampleBadge} testID="wsf-community-sample-badge">
                Sample
              </Text>
            ) : null}
          </View>
          {humanLine ? (
            <Text style={styles.humanLine} testID="wsf-community-human-line">
              {humanLine}
            </Text>
          ) : null}
        </View>

        {/* The active goal: the product hero, on its own navy surface. */}
        <View style={styles.section} testID="wsf-community-goals">
          {goalsState.kind === 'loading' ? (
            <View
              style={styles.compactCard}
              testID="wsf-community-goals-loading"
              {...({ 'data-state': 'loading' } as Record<string, unknown>)}
            >
              <Text style={styles.sectionEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.cardMeta}>Loading goals…</Text>
            </View>
          ) : goalsState.kind === 'failed' ? (
            <View
              style={styles.hero}
              testID="wsf-community-goals-error"
              {...({ 'data-state': 'error' } as Record<string, unknown>)}
            >
              <Text style={styles.heroEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.heroTitle} {...HEADING_2}>Goals couldn&apos;t be loaded</Text>
              <Text style={styles.heroBody}>
                We couldn&apos;t load this community&apos;s goals just now. Try again in a moment.
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
              // The window in the goal's published zone, once the pulse has
              // confirmed it. Until then, and if the read fails, the line says
              // only "Open": a viewer-local calendar day could be the wrong day.
              // And an `active` goal whose end instant has passed says
              // "Ended …" rather than "Open · Ends …": nothing closes a goal
              // automatically, so the status outlives the window. Same helper
              // as the public display, so the two never disagree.
              const windowLabel =
                p.kind === 'ok'
                  ? formatActiveWindowLabel(p.pulse.endsAt, { timeZone: p.pulse.timezone })
                  : 'Open';
              return (
                <View style={styles.hero} testID="wsf-community-goal-hero">
                  {/*
                    A3. The one place this surface can say the target is met
                    while the goal is still open. Confirmed pulse only — an
                    unconfirmed or failed read keeps the neutral eyebrow.
                  */}
                  <Text style={styles.heroEyebrow} testID="wsf-community-goal-eyebrow">
                    {p.kind === 'ok' &&
                    progressPhase(p.pulse.sharedTotal, p.pulse.target, p.pulse.status) === 'reachedOpen'
                      ? 'Goal reached'
                      : 'What we’re doing'}
                  </Text>
                  <Text
                    style={styles.heroTitle}
                    testID={`wsf-community-goal-title-${featured.goalId}`}
                    {...HEADING_2}
                  >
                    {featured.title}
                  </Text>
                  <Text style={styles.heroMeta} testID={`wsf-community-goal-period-${featured.goalId}`}>
                    {windowLabel}
                  </Text>
                  {/*
                    The progress area keeps its height while the pulse is on
                    its way, so the title above and the actions below do not
                    move when it lands: a freshly created goal reads as the
                    hero from the first paint, with one quiet line where the
                    numbers will be.
                  */}
                  <View style={[styles.progressArea, { minHeight: progressAreaMinHeight }]}>
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
                  </View>
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
                  {/*
                    W7. Sharing, and only what is already published. The control
                    exists only when this goal's aggregate is authorized for
                    public display, because the public display is the only thing
                    here that is safe to put in front of a stranger. Nothing in
                    this control invites anyone, names anyone, or asks the member
                    to recruit: it hands over a URL and stops.
                  */}
                  {featuredShareUrl ? (
                    <View style={styles.shareBlock} testID={`wsf-community-goal-share-block-${featured.goalId}`}>
                      <Pressable
                        onPress={() => onShareGoalDisplay(featuredShareUrl)}
                        style={styles.heroOutlineButtonWide}
                        testID={`wsf-community-goal-share-${featured.goalId}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${featured.title}: share the public display link`}
                      >
                        <Text style={styles.heroOutlineButtonText}>
                          {shareControlLabel(goalShareRoute, shareStatus)}
                        </Text>
                      </Pressable>
                      {/* Said before the link leaves, not after. */}
                      <Text
                        style={styles.heroShareNote}
                        testID={`wsf-community-goal-share-note-${featured.goalId}`}
                      >
                        {SHARE_DISCLOSURE}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })()
          ) : (
            // No goal: an honest, compact statement — not a tall empty hero.
            // The Champion's one action is here; a member gets no fake one.
            <View
              style={styles.compactCard}
              testID="wsf-community-no-goal"
              {...({ 'data-state': 'empty' } as Record<string, unknown>)}
            >
              <Text style={styles.sectionEyebrow}>What we&apos;re doing</Text>
              <Text style={styles.cardTitle} {...HEADING_2}>No goal running yet</Text>
              <Text style={styles.cardMeta}>
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

          {/*
            W7. Community momentum: one line across the open goals, and only
            when every one of them has answered. It counts GOALS, never people
            — no server surface here counts contributors, and none is invented.
            Members only, which this whole screen already is: a non-member is
            refused at `state.kind === 'notMember'` above and never reaches it.
          */}
          {momentumLine ? (
            <Text style={styles.momentumLine} testID="wsf-community-momentum">
              {momentumLine}
            </Text>
          ) : null}

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
                    {/*
                      REPEAT POLICY. "Record more" is an invitation, and an
                      invitation the server will refuse is worse than no
                      invitation at all: on a goal that takes one contribution
                      per member, a member who has already contributed is
                      finished here, and saying so by saying nothing is more
                      honest than sending them to a refusal screen. Their own
                      credit above still tells them what they did.

                      Only an EXPLICIT 'once' withholds it. An absent policy
                      resolves to 'multiple' — unchanged behaviour — and keeps
                      the link exactly as it was.
                    */}
                    {p.repeatPolicy === 'once' && p.ownCredit > 0 ? null : (
                      <ButtonLink
                        href={contributeHref(featured.goalId, 'record')}
                        style={styles.inlineLink}
                        textStyle={styles.inlineLinkText}
                        testID={`wsf-community-your-part-link-${featured.goalId}`}
                        label={p.ownCredit > 0 ? `Record more ${p.pulse.unit}` : `Record ${p.pulse.unit}`}
                      />
                    )}
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
          Invite people. An invitation, not URL administration: the link itself
          is never printed as body copy anywhere on this card, symbol included
          (JoinQrCode showUrl={false}) — it rides on the card as
          `data-invite-url` for the tests that assert which link is shared —
          and the working ways to pass it on are the controls. A Champion
          always has this card; a member has it when the policy admits by link
          (public or inviteOnly). On a private community a member sees nothing
          here, and the Champion sees the honest sentence in place of a QR.

          D4: public AND inviteOnly are link-joinable, private is not; the rule
          lives in src/ui/joinLink so the QR encodes exactly the copied string.
        */}
        {showInviteCard ? (
          <View
            style={styles.card}
            testID="wsf-community-invite"
            dataSet={inviteUrl ? { inviteUrl } : undefined}
          >
            <Text style={styles.cardTitle} {...HEADING_2}>Invite people</Text>
            {linkJoinable ? (
              inviteUrl ? (
                <>
                  <Text style={styles.body}>
                    Share this community with people you want to move with.
                  </Text>
                  <View style={styles.inviteActions}>
                    <Pressable
                      onPress={onCopyInvite}
                      style={[styles.secondaryButton, styles.rowButton]}
                      testID="wsf-community-invite-copy"
                      accessibilityRole="button"
                    >
                      <Text style={[styles.secondaryButtonText, styles.rowButtonText]}>
                        {copyStatus === 'copied'
                          ? 'Copied'
                          : copyStatus === 'failed'
                            ? 'Copy failed — use the QR code'
                            : 'Copy invite'}
                      </Text>
                    </Pressable>
                    {hasShareApi ? (
                      <Pressable
                        onPress={onShareInvite}
                        style={[styles.secondaryButton, styles.rowButton]}
                        testID="wsf-community-invite-share"
                        accessibilityRole="button"
                      >
                        <Text style={[styles.secondaryButtonText, styles.rowButtonText]}>
                          Share invite
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {/*
                    showUrl={false}: clause 5. On the member-facing card the
                    link moves by Copy invite / Share invite / the symbol, and
                    is never printed as body copy. `data-qr-url` still rides
                    on the symbol, so ui-join-qr keeps asserting exactly which
                    URL was encoded.
                  */}
                  <JoinQrCode
                    url={inviteUrl}
                    testIDPrefix="wsf-community-invite-qr"
                    caveat={INVITE_QR_CAVEAT}
                    showUrl={false}
                  />
                </>
              ) : (
                <Text style={styles.cardMeta} testID="wsf-community-invite-pending">
                  Your invite link isn&apos;t ready yet. Reload the page to try again.
                </Text>
              )
            ) : (
              <JoinQrCode url={null} testIDPrefix="wsf-community-invite-qr" />
            )}
          </View>
        ) : null}

        {/*
          History — the community's complete record of its closed goals,
          reached and unreached, from wsfListGoals({ includeHistory: true }).
          Rendered only when there is something to record: an empty History
          under a brand-new goal is page furniture, and a failed load is
          already reported by the goals card above. Each row states its own
          result with the shared helpers — "Reached", or "Closed at N%" — and
          the exact total beside it, so a reached goal's overshoot is still
          visible in "515 of 500 squats". Open goals stay in the active
          section above; nothing is listed twice.
        */}
        {closedHistory.length ? (
          <View style={styles.section} testID="wsf-community-history">
            <Text style={styles.sectionEyebrow} {...HEADING_2}>
              History
            </Text>
            {closedHistory.map((goal) => {
              const phase = progressPhase(goal.sharedTotal, goal.target, goal.status);
              // "Reached" and "Closed at N%" are the two honest results a closed
              // goal can have, and statusLine already produces the second.
              const result = phase === 'closedReached' ? 'Reached' : statusLine(goal.sharedTotal, goal.target, goal.status);
              const period = formatPeriod(goal.startsAt, goal.endsAt, { timeZone: goal.timezone });
              return (
                <View
                  key={goal.goalId}
                  style={styles.card}
                  testID={`wsf-community-goal-closed-${goal.goalId}`}
                  {...({ 'data-state': 'closed' } as Record<string, unknown>)}
                >
                  <View style={styles.smallGoalRow}>
                    <LivingWeProgress
                      completed={goal.sharedTotal}
                      target={goal.target}
                      unit={goal.unit}
                      width={smallWeWidth}
                      surface="light"
                      testID={`wsf-community-goal-we-${goal.goalId}`}
                    />
                    <View style={styles.smallGoalText}>
                      <Text style={styles.cardTitle}>{goal.title}</Text>
                      <View style={styles.factsSmall}>
                        <Text style={styles.totalSmall} testID={`wsf-community-goal-total-${goal.goalId}`}>
                          {totalOfTargetLabel(goal.sharedTotal, goal.target, goal.unit)}
                        </Text>
                        <Text style={styles.closedResult} testID={`wsf-community-goal-status-${goal.goalId}`}>
                          {result}
                        </Text>
                      </View>
                      {period ? (
                        <Text style={styles.cardMeta} testID={`wsf-community-goal-period-${goal.goalId}`}>
                          {period}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/*
          The foot of the page, as one block behind a hairline: the two quiet
          community facts, the member's membership disclosure and the way
          back. Three separately-spaced quiet lines read as leftovers; one
          utility block reads as the end of the page.
        */}
        <View style={styles.utility}>
        {footerLine ? (
          <Text style={[kit.caption, styles.footerLine]} testID="wsf-community-member-count">
            {footerLine}
          </Text>
        ) : null}

        {/*
          A member's membership options, disclosed rather than displayed: the
          only action here is destructive, and it should never sit in the
          journey as if it were the next thing to do. A Champion's copy of the
          same control is inside Manage.
        */}
        {!isChampion ? (
          <View style={styles.membership} testID="wsf-community-membership">
            <Pressable
              onPress={() => setMembershipOpen((v) => !v)}
              accessibilityRole="button"
              aria-expanded={membershipOpen}
              style={styles.tertiaryButton}
              testID="wsf-community-membership-toggle"
            >
              <Text style={styles.tertiaryButtonText}>
                {membershipOpen ? 'Hide membership options' : 'Membership options'}
              </Text>
            </Pressable>
            {membershipOpen ? renderLeaveControls() : null}
          </View>
        ) : null}

        <View style={styles.footer}>
          <ButtonLink
            href="/"
            style={FOOTER_LINK}
            textStyle={styles.tertiaryButtonText}
            testID="wsf-community-home-link"
            label="Back to home"
          />
        </View>
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
// D-1. react-native-web turns accessibilityRole="header" plus a level into a
// real <h1>/<h2> carrying exactly the styles the line already had, so these
// add structure and change nothing on screen. `aria-level` is not in the
// React Native prop types, hence the casts.
const HEADING_1 = { accessibilityRole: 'header', 'aria-level': 1 } as Record<string, unknown>;
const HEADING_2 = { accessibilityRole: 'header', 'aria-level': 2 } as Record<string, unknown>;

// The QR's honest note, worded for where it sits. Inside Manage the control
// that retires the link is in the section below the symbol; on the Invite
// card there is no such control, so the note stops at what scanning does.
const MANAGE_QR_CAVEAT =
  'Scanning opens the join page — whoever scans it still has to sign in and finish setting up an account before they can join. Create a new invite link below and this code stops working; show this one again for the new link.';
const INVITE_QR_CAVEAT =
  'Scanning opens the join page — whoever scans it still has to sign in and finish setting up an account before they can join.';

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
    minHeight: 44,
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
  // The community name is a stored string of up to 80 characters sitting in a
  // row beside the Sample badge. A flex child's default minimum size is its
  // CONTENT, so at 195 CSS px (200 % zoom) the longest storable name refused
  // to shrink and ran off the right edge — wrapping could not help, because
  // the row never offered the name less width than it wanted. `minWidth: 0`
  // withdraws that floor and `flexShrink: 1` lets the row take the space
  // back; a word too long for the line it is then given breaks inside itself,
  // which Text already allows (react-native-web sets word-wrap: break-word).
  headingName: { flexShrink: 1, minWidth: 0 },
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
  // W7. One quiet line between the hero and "Your part": a fact about the
  // community's goals, not a leaderboard and not a nudge.
  momentumLine: { color: wsfTheme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
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
  // Reserved room for the mark and the facts; the loading line sits centred
  // in it rather than at the top of a hole.
  progressArea: { justifyContent: 'center', gap: 2 },
  weWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 6 },
  factsLarge: { alignItems: 'center', gap: 2 },
  factsSmall: { gap: 2 },
  heroTotal: { color: CREAM, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
  heroPercent: { color: PROGRESS_GREEN, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  heroStatus: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  heroStatusNear: { color: CREAM, fontWeight: '700' },
  freshnessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  heroFreshness: { color: HERO_MUTED, fontSize: 13 },
  freshnessButton: { minHeight: 44, justifyContent: 'center' },
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
  // W7. The share control sits under the contribution actions, quieter than
  // both, with its disclosure directly beneath it rather than behind a tap.
  shareBlock: { gap: 8, marginTop: 12 },
  heroShareNote: { color: HERO_MUTED, fontSize: 13, lineHeight: 18, textAlign: 'center' },

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
  footerLink: { alignSelf: 'center' },
  tertiaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  inlineLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
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
  // The goal slot when there is no goal to be a hero: a quiet card the height
  // of its sentence, not a navy surface with nothing to say.
  compactCard: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  footerLine: { textAlign: 'center' },
  membership: { alignItems: 'center', gap: 8 },
  leaveBlock: { gap: 8, alignSelf: 'stretch' },
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
  sheetSectionTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  manageIntro: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  manageGoal: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#D5DCE5' },
  manageGoalTitle: { color: wsfTheme.colors.text, fontSize: 16, fontWeight: '700' },

  // ---- about ----
  // Label and value sit on one line; on a very narrow screen (or at 200%
  // text zoom) the value wraps under the label instead of overflowing.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLabel: { color: wsfTheme.colors.textMuted, fontSize: 15, flexShrink: 1, minWidth: 0 },
  rowValue: { color: wsfTheme.colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1, minWidth: 0, marginLeft: 'auto' },
  rowLabelQuiet: { color: wsfTheme.colors.textMuted, fontSize: 13, flexShrink: 1, minWidth: 0 },
  rowValueQuiet: { color: wsfTheme.colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1, minWidth: 0, marginLeft: 'auto' },
  detailsToggle: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 2 },
  detailsToggleText: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  details: { borderTopWidth: 1, borderTopColor: CARD_BORDER, paddingTop: 4 },
  body: { color: wsfTheme.colors.text, fontSize: 16, lineHeight: 22 },
  error: { color: '#B4232C', fontSize: 15, lineHeight: 21 },
  inviteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  // A control that shares a wrapping row with other controls: it gives way
  // before the viewport does, and its label wraps inside it. Without these a
  // long label ("Yes, create a new link") keeps its intrinsic width and
  // pushes past a 195 px viewport — invariant 4.
  rowButton: { flexShrink: 1, minWidth: 0 },
  rowButtonText: { flexShrink: 1, minWidth: 0 },
  // The quiet things at the foot of the page, below a hairline: the two
  // community facts, the membership disclosure and the way back, one block
  // with one rhythm instead of three separately-spaced lines.
  utility: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 16,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  footer: { alignItems: 'center', paddingTop: 0 },
});

// expo-router's `Link asChild` merges the child's style into the link's by
// OBJECT SPREAD (@radix-ui/react-slot). An array of styles survives that as
// { 0: …, 1: … }, which react-native-web then fails to apply — it takes the
// whole screen down. So the composed footer link style is flattened here,
// once, rather than written as an array at the call site.
const FOOTER_LINK = StyleSheet.flatten([styles.tertiaryButton, styles.footerLink]);
