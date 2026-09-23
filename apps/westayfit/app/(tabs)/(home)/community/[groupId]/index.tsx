import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useWsfAuth } from '../../../../../src/auth';
import { rememberCurrentCommunity } from '../../../../../src/currentCommunity';
import { AuthFlagOffPanel } from '../../../../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../../../../src/callableErrors';
import { FormShell } from '../../../../../src/AuthFormPrimitives';
import { resolveRepeatPolicy, type RepeatPolicy } from '../../../../../src/contributionFlow';
import { wsfAuthEnabled } from '../../../../../src/featureFlags';
import { getFirebaseFirestore, getFirebaseFunctions } from '../../../../../src/firebase';
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
} from '../../../../../src/displayAuthControl';
import {
  challengeParticipationLabel,
  groupTypeLabel,
  joinPolicyLabel,
  memberCountLabel,
  roleLabel,
  statusLabel,
} from '../../../../../src/labels';
import { communityMomentumLine } from '../../../../../src/communityMomentum';
import {
  canShareGoalDisplay,
  displayShareUrl,
  shareControlLabel,
  shareRoute,
  SHARE_DISCLOSURE,
  type ShareStatus,
} from '../../../../../src/shareGoalDisplay';
import { wsfTheme } from '../../../../../src/theme';
import { PROGRESS_GREEN } from '../../../../../src/ui/brandAssets';
import { ButtonLink } from '../../../../../src/ui/ButtonLink';
import { JoinQrCode } from '../../../../../src/ui/JoinQrCode';
import { buildJoinUrl, isLinkJoinable } from '../../../../../src/ui/joinLink';
import { buildKioskUrl, currentOrigin } from '../../../../../src/ui/kioskLink';
import { buildStationUrl } from '../../../../../src/ui/eventLinks';
import { buildCombinedUrl } from '../../../../../src/ui/combinedLink';
import {
  childSelectionMessage,
  deviceTimeZone,
  ineligibleMessage,
  ineligibleReason,
  MAX_COMBINED_CHILDREN,
  parseLocalDateTime,
  parseTargetInput,
  validateChildSelection,
  zoneInWords,
} from '../../../../../src/combinedSetup';
import { DateTimeField } from '../../../../../src/ui/DateTimeField';
import { OptionGroup, OptionRow } from '../../../../../src/ui/OptionRow';
import {
  normalizePairingCode,
  pairingCodeInputValue,
  STATION_PAIRING_CODE_LENGTH,
  STATION_SLOTS,
  type StationSlot,
} from '../../../../../src/stationSession';
import {
  formatActiveWindowLabel,
  formatClock,
  formatMonthYear,
  formatPeriod,
  formatReachedOn,
} from '../../../../../src/ui/dates';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  HAIRLINE,
  INK_QUIET,
  ON_ACTION,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  SURFACE,
  display,
  elevation,
  kit,
} from '../../../../../src/ui/kit';
import { LIVING_WE_ASPECT } from '../../../../../src/ui/livingWeCalibration';
import {
  MomentumRow,
  PresenceRow,
  type ActivityRow,
} from '../../../../../src/ui/CommunityPresence';
import { LivingWeProgress } from '../../../../../src/ui/LivingWeProgress';
import {
  formatCount,
  isReached,
  fillRatio,
  percentLabel,
  progressPhase,
  statusLine,
  totalOfTargetLabel,
  totalOfTargetParts,
} from '../../../../../src/ui/progressFormat';

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
      /**
       * How many OTHER communities this member belongs to. The switcher
       * exists only when this is non-zero: an affordance that leads nowhere
       * teaches people the app is lying about what it offers. Null means the
       * aggregate read did not answer, and the switcher stays hidden rather
       * than guessing.
       */
      otherCommunityCount: number;
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
  /*
    THE SOCIAL LAYER. Both reads are ENRICHMENT: the page is about the
    community and its goal, and it rendered for months without either. So a
    failure in either one is swallowed and simply renders nothing, never an
    error state and never a blocked page. A member must not lose their goal
    because the directory was slow.
  */
  const [presence, setPresence] = useState<{
    people: { displayName: string; role: string }[];
    /**
     * Whether this is the WHOLE visible set. Only then can the page say that
     * somebody is unlisted: with a page still outstanding, fewer rows than
     * members proves nothing except that there is another page.
     */
    complete: boolean;
  } | null>(null);
  const [momentum, setMomentum] = useState<{
    entries: ActivityRow[];
    contributorsToday: number | null;
  } | null>(null);
  const [goalsState, setGoalsState] = useState<GoalsState>({ kind: 'loading' });
  const [goalsReloadToken, setGoalsReloadToken] = useState(0);

  /*
    WHO IS HERE, AND WHAT HAS JUST HAPPENED.

    Two member-only callables, both gated on active membership server-side, and
    both fired only once this page has resolved to `ready` — which is already
    past the membership check, so a non-member never issues either call.

    `contributorsToday` is asked for against the FEATURED GOAL and no other,
    because "today" is the goal's own stored timezone and active window. Asking
    without a goal returns null rather than a count computed on some other
    clock: never Cloud Functions host time, never accidental UTC, never the
    caller device's local day.

    THIS HOOK LIVES ABOVE EVERY EARLY RETURN, and that placement is the whole
    correctness story rather than a style preference. It first sat beside the
    `featured` goal further down — which is AFTER this component returns early
    for loading, signed-out, non-member and error. React counts hooks per
    render, so the page rendered one fewer hook while loading than it did once
    ready, and the render after the data arrived threw rather than painting.
    The symptom was not an error on screen: it was four authenticated specs
    timing out on a page that never appeared, while the signed-out probe passed
    because it returns early on every render and never changes the count.

    The featured goal is therefore derived here from `goalsState` rather than
    read from `featured` below. The two agree: both take the first active goal
    in the order wsfListGoals returned.
  */
  const socialFeaturedGoalId =
    goalsState.kind === 'loaded'
      ? (goalsState.goals.find((g) => g.status === 'active')?.goalId ?? null)
      : null;
  const readyForSocial = state.kind === 'ready';
  useEffect(() => {
    if (!readyForSocial || !groupId) return;
    let cancelled = false;
    const functions = getFirebaseFunctions();
    void (async () => {
      try {
        const fn = httpsCallable<
          { groupId: string },
          { members: { displayName: string; role: string }[]; nextCursor: string | null }
        >(functions, 'wsfCommunityMembers');
        const r = await fn({ groupId });
        if (!cancelled) {
          setPresence({
            people: r.data.members ?? [],
            complete: (r.data.nextCursor ?? null) === null,
          });
        }
      } catch {
        // Enrichment. Its absence is not an error state.
      }
    })();
    void (async () => {
      try {
        const fn = httpsCallable<
          { groupId: string; goalId?: string },
          { entries: ActivityRow[]; contributorsToday: number | null; nextCursor: string | null }
        >(functions, 'wsfCommunityActivity');
        const r = await fn(
          socialFeaturedGoalId ? { groupId, goalId: socialFeaturedGoalId } : { groupId }
        );
        if (!cancelled) {
          setMomentum({
            entries: r.data.entries ?? [],
            contributorsToday: r.data.contributorsToday ?? null,
          });
        }
      } catch {
        // Enrichment. Its absence is not an error state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readyForSocial, groupId, socialFeaturedGoalId]);

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
  // HOME OPENS THE COMMUNITY THE MEMBER LAST LOOKED AT. Written here, where
  // it is a fact (they are on this community's screen) rather than in the
  // navigation, where it would only be an intention.
  useEffect(() => {
    if (groupId) rememberCurrentCommunity(user?.uid ?? null, groupId);
  }, [groupId, user?.uid]);
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
  // The kiosk link keeps its own state, its own timer, and the goal it belongs
  // to. A sheet can hold several goals, and copying one goal's kiosk link must
  // never light up the confirmation under another.
  const [kioskCopy, setKioskCopy] = useState<{
    goalId: string | null;
    state: 'idle' | 'copied' | 'failed';
  }>({ goalId: null, state: 'idle' });
  const kioskCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearKioskCopyReset = useCallback(() => {
    if (kioskCopyResetRef.current) {
      clearTimeout(kioskCopyResetRef.current);
      kioskCopyResetRef.current = null;
    }
  }, []);
  useEffect(() => clearKioskCopyReset, [clearKioskCopyReset]);

  // ── WHAT KIND OF SCREEN ──────────────────────────────────────────────────
  //
  // "Set up kiosk" now asks one question first: one goal, or a combined
  // movement goal? The default is 'one', and that default is LOAD-BEARING —
  // with it selected the per-goal kiosk controls render exactly as they always
  // have, with the same testIDs and the same copy, so nothing that already
  // drives them changes.
  //
  // A COMBINED GOAL DOES NOT CHANGE ANY ACTIVITY. Each activity keeps its own
  // target, its own unit, its own period, its own contribute page and its own
  // display. Enrolling one writes nothing to it, and the combined total is
  // derived from the activities' own counters at read time — it is never
  // stored, so it cannot drift from them.
  type KioskMode = 'one' | 'combined';
  const [kioskMode, setKioskMode] = useState<KioskMode>('one');

  const [combinedTitle, setCombinedTitle] = useState('');
  const [combinedUnit, setCombinedUnit] = useState('');
  const [combinedTarget, setCombinedTarget] = useState('');
  const [combinedStart, setCombinedStart] = useState('');
  const [combinedEnd, setCombinedEnd] = useState('');
  const [combinedPicks, setCombinedPicks] = useState<string[]>([]);
  const [combinedBusy, setCombinedBusy] = useState(false);
  /**
   * The last failed attempt to start a combined goal, and WHERE it came from.
   *
   * The source matters because the two kinds age differently. A validation
   * message describes the data in the form, so it stops being true the moment
   * the Champion corrects that data — it is recomputed on every render and a
   * message the current values no longer produce is never shown. A server
   * refusal describes something that happened, so it stands until the next
   * attempt replaces it.
   *
   * This existed as a bare string and left "Give this combined goal a name of
   * at least two characters." sitting in red above a review panel that read
   * back the name the Champion had just typed. Test green and zero overflow
   * did not make that state true.
   */
  const [combinedFailure, setCombinedFailure] = useState<
    { source: 'validation' | 'server'; message: string } | null
  >(null);
  const [combinedCreated, setCombinedCreated] = useState<{
    setupId: string;
    title: string;
  } | null>(null);
  const [combinedCopy, setCombinedCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const combinedCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCombinedCopyReset = useCallback(() => {
    if (combinedCopyResetRef.current) {
      clearTimeout(combinedCopyResetRef.current);
      combinedCopyResetRef.current = null;
    }
  }, []);
  useEffect(() => clearCombinedCopyReset, [clearCombinedCopyReset]);

  // The device's own zone, read once. There is NO zone picker here, for the
  // same reason there is none on the goal form: a picker let the words on
  // screen, the instants submitted and the stored zone disagree. The typed
  // local times are read in this zone and this zone is what is submitted.
  const [combinedZone] = useState(deviceTimeZone);

  const combinedUrl = combinedCreated
    ? buildCombinedUrl({ origin: currentOrigin(), setupId: combinedCreated.setupId })
    : null;

  const onCopyCombined = useCallback(async () => {
    if (!combinedUrl || typeof navigator === 'undefined') return;
    clearCombinedCopyReset();
    try {
      await navigator.clipboard.writeText(combinedUrl);
      setCombinedCopy('copied');
      combinedCopyResetRef.current = setTimeout(() => {
        combinedCopyResetRef.current = null;
        setCombinedCopy('idle');
      }, 2_000);
    } catch {
      // Not timed out: a failure has to stay on screen, because the address
      // shown beside it is the Champion's way forward.
      setCombinedCopy('failed');
    }
  }, [combinedUrl, clearCombinedCopyReset]);

  /**
   * WHAT IS WRONG WITH THE FORM RIGHT NOW, or null.
   *
   * A pure read of the current values, in the order a Champion fills them, and
   * the ONE place that decides. The submit consults it and the render consults
   * it, so a message can never outlive the data that produced it: correct the
   * name and the name's message stops existing, because nothing computes it any
   * more.
   *
   * Every check here is also made on the server, inside the transaction that
   * writes the document. This one exists so the Champion is told before they
   * submit, never so the client decides.
   */
  const combinedValidationMessage = useMemo((): string | null => {
    const title = combinedTitle.trim();
    if (title.length < 2 || title.length > 120) {
      return 'Give this combined goal a name of at least two characters.';
    }
    const unit = combinedUnit.trim();
    if (unit.length < 1 || unit.length > 40) {
      return 'Say what the combined count is in — “movements”, for example.';
    }
    if (parseTargetInput(combinedTarget) === null) {
      return 'The target has to be a whole number of at least one.';
    }
    const start = parseLocalDateTime(combinedStart);
    if (!start) return 'Choose when the combined period starts.';
    const end = parseLocalDateTime(combinedEnd);
    if (!end) return 'Choose when the combined period ends.';
    if (end.getTime() <= start.getTime()) return 'The end must be after the start.';
    if (!combinedZone.trim()) {
      return "We can't read your device's time zone, so this goal can't be started here.";
    }
    const problem = validateChildSelection(combinedPicks);
    return problem ? childSelectionMessage(problem) : null;
  }, [
    combinedTitle,
    combinedUnit,
    combinedTarget,
    combinedStart,
    combinedEnd,
    combinedZone,
    combinedPicks,
  ]);

  /**
   * The message actually rendered, which is not always the one last recorded.
   *
   * A VALIDATION failure is recomputed: what shows is whatever the current
   * values produce, so a corrected field takes its message with it and a
   * complete form shows nothing at all. A SERVER refusal is an event, not a
   * description of the form, so it stands until the next attempt — unless the
   * Champion has since made the form invalid, in which case the nearer problem
   * is the true one and is shown instead.
   */
  const combinedError =
    combinedFailure === null
      ? null
      : combinedFailure.source === 'validation'
        ? combinedValidationMessage
        : (combinedValidationMessage ?? combinedFailure.message);

  /**
   * Freeze the setup. The callable writes exactly one document and touches no
   * activity.
   */
  const onCreateCombined = useCallback(async () => {
    const problem = combinedValidationMessage;
    if (problem) {
      setCombinedFailure({ source: 'validation', message: problem });
      return;
    }
    setCombinedFailure(null);
    // Re-read the values the validator already accepted. Narrowing, not a
    // second opinion: `combinedValidationMessage` is the single place that
    // decides, and these cannot be null past that guard.
    const title = combinedTitle.trim();
    const unit = combinedUnit.trim();
    const target = parseTargetInput(combinedTarget) as number;
    const start = parseLocalDateTime(combinedStart) as Date;
    const end = parseLocalDateTime(combinedEnd) as Date;

    setCombinedBusy(true);
    try {
      const fn = httpsCallable<
        {
          communityGroupId: string;
          title: string;
          unit: string;
          target: number;
          startsAt: string;
          endsAt: string;
          timezone: string;
          childGoalIds: string[];
        },
        { setupId: string }
      >(getFirebaseFunctions(), 'wsfCreateCombinedGoal');
      const result = await fn({
        communityGroupId: groupId,
        title,
        unit,
        target,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timezone: combinedZone,
        childGoalIds: combinedPicks,
      });
      setCombinedCreated({ setupId: result.data.setupId, title });
      setCombinedCopy('idle');
    } catch (e) {
      setCombinedFailure({
        source: 'server',
        message: describeCallableError(e, 'That combined goal could not be started. Try again.'),
      });
    } finally {
      setCombinedBusy(false);
    }
  }, [
    // The validator is the only thing that decides whether this may proceed, so
    // a stale copy of it would let a submit run against values it never saw.
    combinedValidationMessage,
    combinedTitle,
    combinedUnit,
    combinedTarget,
    combinedStart,
    combinedEnd,
    combinedZone,
    combinedPicks,
    groupId,
  ]);

  // ── SCREENS AT THIS EVENT ────────────────────────────────────────────────
  //
  // A station is a screen standing at an event with one goal open on it. It is
  // not an account and never becomes one: the Champion approves a six-
  // character code the screen shows, the server mints a secret that only that
  // screen holds, and the Champion can revoke it from here at any time.
  //
  // Everything this block touches is its own state. The Set-up-kiosk controls
  // beside it are untouched.
  type StationRow = {
    stationId: string;
    slot: StationSlot;
    label: string;
    status: 'pendingClaim' | 'active' | 'revoked';
    createdAt: string | null;
    claimedAt: string | null;
    lastSeenAt: string | null;
    revokedAt: string | null;
  };
  type StationsCell =
    | { kind: 'loading' }
    | { kind: 'ready'; rows: StationRow[] }
    | { kind: 'failed'; message: string };

  const [stations, setStations] = useState<Record<string, StationsCell>>({});
  const [stationsToken, setStationsToken] = useState(0);
  const [stationCode, setStationCode] = useState<Record<string, string>>({});
  const [stationSlot, setStationSlot] = useState<Record<string, StationSlot>>({});
  const [stationBusy, setStationBusy] = useState<string | null>(null);
  // One notice per goal, and it stays until the next action on that goal
  // replaces it: an approval or a revocation is a thing the Champion has to be
  // able to read after the list under it has already moved.
  const [stationNotice, setStationNotice] = useState<
    Record<string, { kind: 'ok' | 'error'; message: string }>
  >({});
  const [stationCopy, setStationCopy] = useState<{
    goalId: string | null;
    state: 'idle' | 'copied' | 'failed';
  }>({ goalId: null, state: 'idle' });
  const stationCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStationCopyReset = useCallback(() => {
    if (stationCopyResetRef.current) {
      clearTimeout(stationCopyResetRef.current);
      stationCopyResetRef.current = null;
    }
  }, []);
  useEffect(() => clearStationCopyReset, [clearStationCopyReset]);

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
        let otherCommunityCount = 0;
        let isSample = group.isSample === true;
        let activeChallenge: ActiveChallenge | null = null;
        try {
          const myFn = httpsCallable<Record<string, never>, MyCommunitiesResponse>(
            functions,
            'wsfMyCommunities'
          );
          const myResult = await myFn({});
          if (cancelled) return;
          otherCommunityCount = Math.max(0, myResult.data.items.length - 1);
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
          otherCommunityCount,
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

  /**
   * The address of the screen a Champion stands at an event, per goal. Built
   * from the origin this build is served from, so it is right on staging and
   * in production without anyone editing it.
   */
  const kioskUrlFor = useCallback(
    (goalId: string) => buildKioskUrl({ origin: currentOrigin(), goalId }),
    []
  );

  const onCopyKiosk = useCallback(
    async (goalId: string) => {
      const url = buildKioskUrl({ origin: currentOrigin(), goalId });
      if (!url || typeof navigator === 'undefined') return;
      clearKioskCopyReset();
      try {
        await navigator.clipboard.writeText(url);
        setKioskCopy({ goalId, state: 'copied' });
        kioskCopyResetRef.current = setTimeout(() => {
          kioskCopyResetRef.current = null;
          setKioskCopy({ goalId: null, state: 'idle' });
        }, 2_000);
      } catch {
        // Not timed out: a failure has to stay on screen, because the address
        // shown beside it is the Champion's way forward.
        setKioskCopy({ goalId, state: 'failed' });
      }
    },
    [clearKioskCopyReset]
  );

  /** The address a screen at an event is opened on. A goal id and nothing
   * else: opening it enrols nobody, because that device still has to show a
   * code and wait for this Champion to approve it. */
  const stationUrlFor = useCallback(
    (goalId: string) => buildStationUrl({ origin: currentOrigin(), goalId }),
    []
  );

  const onCopyStation = useCallback(
    async (goalId: string) => {
      const url = buildStationUrl({ origin: currentOrigin(), goalId });
      if (!url || typeof navigator === 'undefined') return;
      clearStationCopyReset();
      try {
        await navigator.clipboard.writeText(url);
        setStationCopy({ goalId, state: 'copied' });
        stationCopyResetRef.current = setTimeout(() => {
          stationCopyResetRef.current = null;
          setStationCopy({ goalId: null, state: 'idle' });
        }, 2_000);
      } catch {
        setStationCopy({ goalId, state: 'failed' });
      }
    },
    [clearStationCopyReset]
  );

  const reloadStations = useCallback(() => setStationsToken((n) => n + 1), []);

  /**
   * The enrolled screens for every goal that carries a card, loaded when the
   * Champion opens the sheet and again after every approval or revocation.
   * The callable refuses anyone who is not this community's Champion, so this
   * asks only while the Champion's own sheet is open.
   */
  const manageGoalIdsKey =
    goalsState.kind === 'loaded' ? goalsState.goals.map((g) => g.goalId).join(',') : '';
  useEffect(() => {
    if (!manageOpen) return;
    if (!manageGoalIdsKey) return;
    const goalIds = manageGoalIdsKey.split(',').filter(Boolean);
    let cancelled = false;
    setStations((prev) => {
      const next = { ...prev };
      for (const id of goalIds) if (!next[id]) next[id] = { kind: 'loading' };
      return next;
    });
    (async () => {
      const fn = httpsCallable<{ goalId: string }, { stations: StationRow[] }>(
        getFirebaseFunctions(),
        'wsfListStations'
      );
      for (const goalId of goalIds) {
        try {
          const result = await fn({ goalId });
          if (cancelled) return;
          setStations((prev) => ({
            ...prev,
            [goalId]: { kind: 'ready', rows: result.data.stations ?? [] },
          }));
        } catch (e) {
          if (cancelled) return;
          setStations((prev) => ({
            ...prev,
            [goalId]: {
              kind: 'failed',
              message: describeCallableError(e, 'We couldn’t load the screens for this goal.'),
            },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manageOpen, manageGoalIdsKey, stationsToken]);

  /**
   * APPROVE. The Champion types the six characters showing on the screen and
   * says which station it is. The slot is the Champion's choice; the screen
   * never names itself, and the server derives the label from the slot.
   */
  const onApproveStation = useCallback(
    async (goalId: string) => {
      const typed = stationCode[goalId] ?? '';
      const code = normalizePairingCode(typed);
      const slot = stationSlot[goalId] ?? 1;
      if (!code) {
        setStationNotice((prev) => ({
          ...prev,
          [goalId]: {
            kind: 'error',
            message: `Enter the ${STATION_PAIRING_CODE_LENGTH} characters showing on that screen.`,
          },
        }));
        return;
      }
      setStationBusy(`approve-${goalId}`);
      setStationNotice((prev) => {
        const next = { ...prev };
        delete next[goalId];
        return next;
      });
      try {
        const fn = httpsCallable<
          { goalId: string; code: string; slot: StationSlot },
          { stationId: string; slot: StationSlot; label: string }
        >(getFirebaseFunctions(), 'wsfApproveStation');
        const result = await fn({ goalId, code, slot });
        setStationCode((prev) => ({ ...prev, [goalId]: '' }));
        setStationNotice((prev) => ({
          ...prev,
          [goalId]: {
            kind: 'ok',
            message: `${result.data.label} is approved. That screen will finish setting itself up in a moment.`,
          },
        }));
        reloadStations();
      } catch (e) {
        setStationNotice((prev) => ({
          ...prev,
          [goalId]: {
            kind: 'error',
            message: describeCallableError(e, 'That screen could not be approved. Try again.'),
          },
        }));
      } finally {
        setStationBusy(null);
      }
    },
    [stationCode, stationSlot, reloadStations]
  );

  /**
   * REVOKE. The screen's next poll is refused and it empties its own storage,
   * so a screen left behind in a hall stops being a screen of this community's
   * — from here, without touching it.
   */
  const onRevokeStation = useCallback(
    async (goalId: string, stationId: string, label: string) => {
      setStationBusy(`revoke-${stationId}`);
      try {
        const fn = httpsCallable<{ stationId: string }, { stationId: string }>(
          getFirebaseFunctions(),
          'wsfRevokeStation'
        );
        await fn({ stationId });
        setStationNotice((prev) => ({
          ...prev,
          [goalId]: { kind: 'ok', message: `${label} is revoked. It will stop showing this goal.` },
        }));
        reloadStations();
      } catch (e) {
        setStationNotice((prev) => ({
          ...prev,
          [goalId]: {
            kind: 'error',
            message: describeCallableError(e, 'That screen could not be revoked. Try again.'),
          },
        }));
      } finally {
        setStationBusy(null);
      }
    },
    [reloadStations]
  );

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

  const { group, role, memberCount, otherCommunityCount, isSample, activeChallenge } = state;
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
  const shortViewport = windowHeight < 700;
  /*
    THE FIRST VIEWPORT MUST REACH THE ACTION, ON EVERY PHONE.

    Moving the action out of the hero onto the page put it below the fold on a
    390x640 screen — the exact regression the approved target's short-phone
    rule forbids: the first viewport keeps community identity, the mark at
    meaningful progress, AND an unmistakable movement action.

    So the rhythm gives on a short screen and the emotional core does not. The
    hero's own padding is 16 now rather than 22, which is where the wider mark
    comes from at full height.
  */
  const heroContentWidth = Math.max(60, windowWidth - 2 * 20 - 2 * 16);
  /*
    THE TARGET'S OWN PROPORTION, NOT THE WIDEST THE CARD ALLOWS.

    Letting the mark take the full content width made it larger than the
    approved target's and pushed "Your part" out of the first 390x844
    viewport, which cost the denser command-centre rhythm the target
    establishes. These are the target's three numbers.
  */
  const heroWeWidth = Math.max(
    96,
    Math.min(shortViewport ? 120 : windowWidth >= 420 ? 206 : 152, heroContentWidth),
  );
  /*
    THE BLOOM NEVER EXCEEDS THE CARD IT SITS IN.

    It was three fixed circles, the largest 300px. The hero clips with
    overflow:hidden, so at 320px and at 195px (200% zoom) the card's own
    scrollWidth ran past its box and the accessibility suite flagged it as
    horizontal clipping — correctly, because a box that scrolls sideways is a
    box that scrolls sideways whether or not the thing inside it is decorative.
    Sized from the card's content width, it cannot overflow at any width.
  */
  const bloom = heroContentWidth;
  /**
   * THE GOAL TITLE SHRINKS BEFORE IT BREAKS A WORD.
   *
   * At 200% text zoom the hero is ~163px of usable width, and "Challenge" set
   * at 27px is wider than that — so the browser broke INSIDE the word and the
   * capture read "Challen / ge". A word split down the middle is not a reflow,
   * it is a defect. The type scales at the two narrow steps so long words keep
   * their shape; nothing changes at 360 and above.
   */
  /**
   * SHORT-PHONE HERO RHYTHM.
   *
   * The identity band earns its place — it is what makes this a community and
   * not a goal card — but it costs vertical space, and on a 390x640 phone
   * that space came straight out of the primary action, which ended up 30px
   * below the fold. Rather than drop the band or shrink the Living WE (the
   * two things this slice exists to establish), the hero tightens its own
   * padding and rhythm when the viewport is short. Nothing changes above
   * ~700px tall.
   */
  const heroCompact = shortViewport
    ? { paddingTop: 8, paddingBottom: 9, gap: 3 }
    : null;
  // The identity block above the hero, not the band that used to be inside it.
  const identityCompact = shortViewport ? { gap: 0 } : null;
  const headingCompactType = shortViewport
    ? { fontSize: 22, lineHeight: 27, marginTop: 0 }
    : null;
  // The display tier steps down rather than the mark disappearing.
  const heroTotalCompact = shortViewport ? { fontSize: 27, lineHeight: 31 } : null;
  const factsCompact = shortViewport ? { gap: 3, paddingTop: 6, paddingBottom: 7, marginTop: 2 } : null;
  // The presence line is the cheapest thing in the band to shrink, and the
  // only one whose meaning survives at 12px.
  const presenceCompact = shortViewport ? { fontSize: 12, lineHeight: 16 } : null;
  /*
    THE NARROW STEPS MUST ONLY EVER SHRINK. They were 20 and 23, written when
    the hero title was 27. The title is 22 now, so the 23 step had quietly
    become an ENLARGEMENT on a narrower screen — the opposite of what it is
    for, and invisible unless you compare it with the base.
  */
  const heroTitleType =
    windowWidth < 240
      ? { fontSize: 18, lineHeight: 23 }
      : windowWidth < 300
        ? { fontSize: 20, lineHeight: 25 }
        : null;
  // The hero's progress area reserves the room the We mark, its three facts
  // and the freshness line will take, so a pulse that lands does not move
  // the title above it or the actions below it.
  // SLICE 1. 118 -> 74: the freshness row (44px) moved below the actions, so
  // the space reserved for it inside the progress area moves with it.
  const progressAreaMinHeight = Math.round(heroWeWidth / LIVING_WE_ASPECT) + 14 + 6 + 74;
  const linkJoinable = isLinkJoinable(group.joinPolicy);
  // Champions always get the Invite card (on a private community it carries
  // the honest no-link sentence); members get it only with a working link.
  const showInviteCard = isChampion || (linkJoinable && inviteUrl != null);
  // One human line under the name, and only once the goal list has answered:
  // a claim about what the community is doing waits for the facts.
  // SLICE 1. When a goal IS running the hero says so in its own words, and a
  // generic line above it was costing a row at the most expensive point on the
  // screen. It survives where it still carries information: the empty state,
  // where nothing else tells the member what this community is for.
  const humanLine = goalsState.kind === 'loaded' && !featured ? 'Ready to get moving.' : null;
  /**
   * The one line under the community's name in the Champion sheet. It says
   * what is actually running and, when the count is known, how many people
   * are here — and it says the truth about NOT knowing just as plainly.
   *
   * It never asserts a goal, a total or a member count that has not come back
   * from the server: every branch below is a state of `goalsState`, and the
   * member half is omitted entirely while `memberCount` is null rather than
   * rendered as a zero.
   */
  const manageStoryLine = (() => {
    const goalPart =
      goalsState.kind === 'loading'
        ? 'Checking what is running…'
        : goalsState.kind === 'failed'
          ? 'Goals could not be loaded'
          : activeGoals.length === 0
            ? 'No goal running yet'
            : activeGoals.length === 1
              ? `\u201C${activeGoals[0].title}\u201D is running`
              : `${activeGoals.length} goals running`;
    return memberCount != null
      ? `${goalPart} \u00B7 ${memberCountLabel(memberCount)}`
      : goalPart;
  })();

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

  /**
   * SET UP KIOSK, for one goal. Lifted out of the display-permission card
   * and into the event section, because a Champion who came to put a goal
   * on a screen should not have to find that control inside a permission
   * they were not looking for. Same testIDs, same copy, same address, same
   * dataSet — only its place in the sheet changed.
   */
  const renderKioskSetup = (goal: ListedGoal) => (
    <Fragment key={`kiosk-${goal.goalId}`}>
      {/*
        SET UP KIOSK. A kiosk is a screen standing at an event with this
        goal open on it, so the Champion needs the address of that screen —
        not an instruction to assemble one by hand. The link is built from
        the origin this build is actually served from, so it is correct on
        staging and in production without being edited.

        It sits with the display permission because the two are the same
        decision in practice: a kiosk shows the goal's shared progress, and
        that is exactly what authorizing a public display allows. When the
        permission is off the link still resolves, and the screen says the
        goal is not available — so the state text below says so first.
      */}
      {/*
        ONE GOAL, or the combined panel further down the sheet. These
        controls are what "One goal" means, and they are exactly what they
        have always been: same testIDs, same copy, same address, same
        dataSet. The chooser lives in its own section below so that choosing
        the other mode never edits this one.
      */}
      {kioskMode === 'one' ? (
        <View style={styles.manageGoal} testID={`wsf-kiosk-setup-${goal.goalId}`}>
          {/*
            No second "Set up kiosk" heading. The card above is the one that
            says it, and the goal's own name heads this block — repeating the
            card's title on every goal was the pile this section came out of.
          */}
          <Text style={styles.manageIntro} testID={`wsf-kiosk-setup-intro-${goal.goalId}`}>
            {goal.aggregateDisplayAuthorized
              ? 'Open this on the screen at your event.'
              : 'Authorize public display under Goals below, or that screen will say the goal is not available.'}
          </Text>
          {kioskUrlFor(goal.goalId) ? (
            /*
              ONE ACTION, THEN THE UTILITY. Opening the kiosk is the thing a
              Champion came here to do, so it carries the one green primary
              on this goal; copying the address is the way to do the same
              thing on another device, so it is a quiet text control under
              it. The weight is carried by shape, size and fill together —
              never by colour alone.
            */
            <View
              style={styles.actionStack}
              // The address the controls beside it act on, readable by a test
              // without being printed for a person.
              dataSet={{ kioskUrl: kioskUrlFor(goal.goalId) ?? '' }}
            >
              <ButtonLink
                href={`/kiosk/${goal.goalId}`}
                label="Open kiosk"
                style={styles.primaryButton}
                textStyle={styles.primaryButtonText}
                testID={`wsf-kiosk-setup-open-${goal.goalId}`}
              />
              <Pressable
                onPress={() => onCopyKiosk(goal.goalId)}
                style={styles.tertiaryButton}
                testID={`wsf-kiosk-setup-copy-${goal.goalId}`}
                accessibilityRole="button"
                accessibilityLabel={`${goal.title}: copy the kiosk link`}
              >
                <Text style={styles.tertiaryButtonText}>
                  {kioskCopy.goalId === goal.goalId && kioskCopy.state === 'copied'
                    ? 'Copied'
                    : 'Copy kiosk link'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.body} testID={`wsf-kiosk-setup-unavailable-${goal.goalId}`}>
              The kiosk link isn’t ready yet. Reload the page to try again.
            </Text>
          )}
          {/*
            A copy can fail for reasons this app does not control — a browser
            that refuses the clipboard without a gesture it recognises, or a
            context with no clipboard at all. When it does, the address itself
            is shown so the Champion can still get the screen open. This is the
            one place a URL is deliberately readable: it is the Champion's own
            admin sheet, the link carries no participant token and no
            authority, and the alternative is a dead end at an event.
          */}
          {kioskCopy.goalId === goal.goalId && kioskCopy.state === 'failed' ? (
            <Text style={styles.body} testID={`wsf-kiosk-setup-copy-failed-${goal.goalId}`}>
              Copy didn’t work on this device. Open the kiosk here, or type this address on the
              screen: {kioskUrlFor(goal.goalId)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Fragment>
  );

  /**
   * SCREENS AT THIS EVENT — station enrolment. Moved with its sibling, for
   * the same reason and with the same guarantee: every testID, every control
   * and every state is the one that was here before.
   */
  const renderStationEnrolment = (goal: ListedGoal) => (
    <Fragment key={`stations-${goal.goalId}`}>
      {/*
        SCREENS AT THIS EVENT — station enrolment.

        A SIBLING of Set up kiosk, not a change to it. Setting up a kiosk is
        "here is the address of the screen"; this is "and this screen, the
        one showing that code right now, is Station 1".

        WHY A CODE AND NOT A LINK. The screen cannot be signed in as anybody
        — the kiosk deliberately signs itself out — so its identity is a
        secret the server mints at the moment of approval and hands only to
        the screen that asked. Nothing enrolling rides in a URL or a QR: a
        copied station link opens a screen that still has to ask, and an
        attendee scanning either code on that screen gets a page on their own
        phone and no authority of any kind.

        WHAT IT CAN AND CANNOT DO. A station shows this goal's shared
        progress — exactly what authorizing public display already allows,
        through the same server read.

        IT DOES RECORD, and this comment used to say it did not. That stopped
        being true when the turn contract landed: a station calls the person
        whose turn it is and completes THE SAME canonical attempt their own
        phone would have, under the same key. What it still cannot do is know
        who is standing at it on its own — it records against the account the
        server assigned to that turn, never against an identity the screen
        worked out for itself.
      */}
      <View style={styles.manageGoal} testID={`wsf-kiosk-stations-${goal.goalId}`}>
        <Text style={styles.manageGoalTitle}>Screens at this event</Text>
        <Text style={styles.manageIntro} testID={`wsf-kiosk-stations-intro-${goal.goalId}`}>
          Open this address on each screen, then type the code it shows and choose which station
          it is. You can revoke a screen from here at any time.
        </Text>
        {stationUrlFor(goal.goalId) ? (
          /*
            UTILITIES, NOT THE POINT. Getting the address onto a screen is a
            step on the way; the action on this card is approving the screen
            that is standing there showing a code. So these two are quiet
            text controls and the card keeps no second button weight.
          */
          <View
            style={styles.utilityRow}
            dataSet={{ stationUrl: stationUrlFor(goal.goalId) ?? '' }}
          >
            <ButtonLink
              href={`/station/${goal.goalId}`}
              label="Open station screen"
              style={UTILITY_LINK}
              textStyle={UTILITY_LINK_TEXT}
              testID={`wsf-kiosk-stations-open-${goal.goalId}`}
            />
            <Pressable
              onPress={() => onCopyStation(goal.goalId)}
              style={[styles.tertiaryButton, styles.rowButton]}
              testID={`wsf-kiosk-stations-copy-${goal.goalId}`}
              accessibilityRole="button"
              accessibilityLabel={`${goal.title}: copy the station link`}
            >
              <Text style={[styles.tertiaryButtonText, styles.rowButtonText]}>
                {stationCopy.goalId === goal.goalId && stationCopy.state === 'copied'
                  ? 'Copied'
                  : 'Copy station link'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.body} testID={`wsf-kiosk-stations-unavailable-${goal.goalId}`}>
            The station link isn’t ready yet. Reload the page to try again.
          </Text>
        )}
        {stationCopy.goalId === goal.goalId && stationCopy.state === 'failed' ? (
          <Text style={styles.body} testID={`wsf-kiosk-stations-copy-failed-${goal.goalId}`}>
            Copy didn’t work on this device. Open the station screen here, or type this address on
            it: {stationUrlFor(goal.goalId)}
          </Text>
        ) : null}

        <Text style={styles.manageIntro}>Approve a screen</Text>
        <TextInput
          value={stationCode[goal.goalId] ?? ''}
          onChangeText={(raw) =>
            setStationCode((prev) => ({ ...prev, [goal.goalId]: pairingCodeInputValue(raw) }))
          }
          placeholder="Code on the screen"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={STATION_PAIRING_CODE_LENGTH}
          style={styles.stationCodeInput}
          testID={`wsf-kiosk-stations-code-${goal.goalId}`}
          accessibilityLabel={`${goal.title}: the code showing on that screen`}
        />
        <View style={styles.rowWrap}>
          {STATION_SLOTS.map((slot) => {
            const chosen = (stationSlot[goal.goalId] ?? 1) === slot;
            return (
              <Pressable
                key={slot}
                onPress={() => setStationSlot((prev) => ({ ...prev, [goal.goalId]: slot }))}
                style={[styles.secondaryButton, chosen ? styles.stationSlotChosen : null]}
                testID={`wsf-kiosk-stations-slot-${slot}-${goal.goalId}`}
                accessibilityRole="button"
                aria-pressed={chosen}
                accessibilityLabel={`${goal.title}: approve as Station ${slot}`}
              >
                <Text
                  style={[
                    styles.secondaryButtonText,
                    chosen ? styles.stationSlotChosenText : null,
                  ]}
                >
                  {`Station ${slot}`}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => onApproveStation(goal.goalId)}
            disabled={stationBusy === `approve-${goal.goalId}`}
            style={styles.secondaryButton}
            testID={`wsf-kiosk-stations-approve-${goal.goalId}`}
            accessibilityRole="button"
            accessibilityLabel={`${goal.title}: approve this screen`}
          >
            <Text style={styles.secondaryButtonText}>
              {stationBusy === `approve-${goal.goalId}` ? 'Approving…' : 'Approve'}
            </Text>
          </Pressable>
        </View>
        {stationNotice[goal.goalId] ? (
          <Text
            style={stationNotice[goal.goalId]!.kind === 'ok' ? styles.body : styles.error}
            testID={`wsf-kiosk-stations-notice-${goal.goalId}`}
          >
            {stationNotice[goal.goalId]!.message}
          </Text>
        ) : null}

        <View testID={`wsf-kiosk-stations-list-${goal.goalId}`} style={styles.stationList}>
          {(() => {
            const cell = stations[goal.goalId];
            if (!cell || cell.kind === 'loading') {
              return (
                <Text style={styles.body} testID={`wsf-kiosk-stations-loading-${goal.goalId}`}>
                  Loading screens…
                </Text>
              );
            }
            if (cell.kind === 'failed') {
              return (
                <Text style={styles.error} testID={`wsf-kiosk-stations-error-${goal.goalId}`}>
                  {cell.message}
                </Text>
              );
            }
            const live = cell.rows.filter((row) => row.status !== 'revoked');
            if (!live.length) {
              return (
                <Text style={styles.body} testID={`wsf-kiosk-stations-empty-${goal.goalId}`}>
                  No screens are enrolled on this goal yet.
                </Text>
              );
            }
            return live.map((row) => (
              <View
                key={row.stationId}
                style={styles.rowWrap}
                testID={`wsf-kiosk-stations-row-${row.stationId}`}
              >
                <Text style={styles.body}>
                  {/*
                    The label the SERVER derived from the slot, and the one
                    fact about the screen's state. Nothing about where it is,
                    what it is, or who set it up.
                  */}
                  {`${row.label} — ${row.status === 'active' ? 'enrolled' : 'waiting to finish setting up'}`}
                </Text>
                <Pressable
                  onPress={() => onRevokeStation(goal.goalId, row.stationId, row.label)}
                  disabled={stationBusy === `revoke-${row.stationId}`}
                  style={styles.secondaryButton}
                  testID={`wsf-kiosk-stations-revoke-${row.stationId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${goal.title}: revoke ${row.label}`}
                >
                  <Text style={styles.secondaryButtonText}>
                    {stationBusy === `revoke-${row.stationId}` ? 'Revoking…' : 'Revoke'}
                  </Text>
                </Pressable>
              </View>
            ));
          })()}
        </View>
      </View>
    </Fragment>
  );

  // SLICE 1. OUTSIDE the navy panel, on the page's own surface. It is utility
  // — when the number was last confirmed and how to ask again — and it was
  // sitting inside the emotional payoff. Its colours move with it: on cream it
  // needs the page's muted text, not the hero's light-on-dark muted.
  const renderFreshness = (p: GoalProgress) =>
    p.kind === 'ok' ? (
      <View style={styles.freshnessUtilityRow}>
        <Text style={styles.freshnessUtilityText} testID="wsf-community-progress-updated">
          {`Confirmed ${formatClock(p.at)}`}
        </Text>
        <Pressable
          onPress={refreshProgress}
          accessibilityRole="button"
          testID="wsf-community-progress-refresh"
          style={styles.freshnessButton}
          accessibilityLabel="Refresh confirmed progress"
        >
          <Text style={styles.freshnessUtilityLink}>Refresh</Text>
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
    // THE SAME RATIO THE MARK USES. fillRatio is what LivingWeProgress fills
    // by, so the bar and the mark can never disagree, and neither can be
    // driven by the rounded percentage text.
    const barRatio = fillRatio(sharedTotal, target);
    return (
      <View style={onDark ? [styles.factsLarge, factsCompact] : styles.factsSmall}>
        <Text
          style={onDark ? styles.heroTotal : styles.totalSmall}
          testID={`wsf-community-goal-total-${goal.goalId}`}
        >
          {/*
            ON THE HERO THE COUNT LEADS AND WHAT IT IS OUT OF FOLLOWS, so the
            line breaks between them rather than wrapping mid-phrase. Both
            halves stay inside ONE Text node with a newline between them: the
            element's text is still "1,847 of 5,000 squats", which is what the
            journey and a11y specs assert, and both halves come from one helper
            so they cannot drift.
          */}
          {onDark ? (
            <>
              <Text style={[styles.heroTotalCount, heroTotalCompact]}>
                {totalOfTargetParts(sharedTotal, target, unit).count}
              </Text>
              {'\n'}
              <Text style={styles.heroTotalRest}>
                {totalOfTargetParts(sharedTotal, target, unit).rest}
              </Text>
            </>
          ) : (
            totalOfTargetLabel(sharedTotal, target, unit)
          )}
        </Text>
        {onDark ? (
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${barRatio * 100}%` }]} />
          </View>
        ) : null}
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

  /**
   * The combined window, as instants, once BOTH ends are chosen and the end
   * is after the start. Null until then, which is what makes the activity
   * list say "choose the period first" rather than silently calling every
   * activity ineligible.
   *
   * The typed local times are read in the device's own zone — the same zone
   * that is submitted — so the words, the instants and the stored zone cannot
   * disagree.
   */
  const combinedStartDate = parseLocalDateTime(combinedStart);
  const combinedEndDate = parseLocalDateTime(combinedEnd);
  const combinedWindow =
    combinedStartDate && combinedEndDate && combinedEndDate.getTime() > combinedStartDate.getTime()
      ? { startsAt: combinedStartDate, endsAt: combinedEndDate }
      : null;

  /**
   * The candidate activities, straight from the goals Community Home has
   * ALREADY loaded through wsfListGoals. No new list callable, and no second
   * idea of what this community's goals are.
   *
   * Eligibility is computed here for the Champion's benefit and re-checked by
   * the server inside the transaction that writes the setup, so this list is a
   * convenience and never the authority.
   */
  const combinedCandidates = activeGoals.map((goal) => ({
    goal,
    reason: combinedWindow
      ? ineligibleReason({
          child: {
            goalId: goal.goalId,
            title: goal.title,
            status: goal.status,
            startsAt: goal.startsAt,
            endsAt: goal.endsAt,
          },
          window: combinedWindow,
        })
      : null,
  }));

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
            {/*
              IDENTITY FIRST. The sheet used to open on the words "Champion
              tools" — a drawer named after its own mechanism. The community is
              what a Champion is managing, so the community is the title, and
              "Champion tools" stays as the quiet eyebrow that says whose view
              this is and keeps the dialog's accessible name honest.
            */}
            <View style={styles.sheetHeading}>
              <Text style={styles.sheetEyebrow}>Champion tools</Text>
              <Text style={styles.sheetTitle} {...HEADING_2} testID="wsf-manage-title">
                {group.displayName}
              </Text>
            </View>
            <Pressable
              onPress={() => setManageOpen(false)}
              accessibilityRole="button"
              style={styles.sheetClose}
              testID="wsf-community-manage-close"
            >
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
          {/*
            THE STORY, AND ONLY WHAT IS KNOWN. Built in `manageStoryLine` from
            the goal list's own state — so while it is loading it says it is
            loading, when it failed it says it failed, and it never invents a
            running goal, a total or a member count.
          */}
          <Text style={styles.sheetStory} testID="wsf-manage-story">
            {manageStoryLine}
          </Text>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {/*
              YOUR EVENT — the reason a Champion opens this sheet, and now the
              first and loudest thing in it. Setting up the screen at an event
              is the one primary action here; permissions, invites and
              membership are work about the community, and they wait below
              under their own labels.
            */}
            <View style={styles.sheetSection} testID="wsf-manage-event">
              <Text style={styles.sheetSectionTitle}>Your event</Text>
            {/*
              SET UP KIOSK. One card, one question, one answer — not a stack of
              sections a Champion has to assemble in their head. The question
              governs what the card shows next, so it is asked first; "One
              goal" is the default, and "Combined movement goal" answers itself
              here.

              Every testID, every control and every state is the one that was
              here before; what changed is where they sit and how loud they are.
            */}
            <View style={styles.setupCard} testID="wsf-kiosk-mode">
              <Text style={styles.cardTitle}>Set up kiosk</Text>
              <OptionGroup accessibilityLabel="What kind of screen" testID="wsf-kiosk-mode-options">
                <OptionRow
                  label="One goal"
                  description="One activity and its progress."
                  selected={kioskMode === 'one'}
                  onPress={() => setKioskMode('one')}
                  testID="wsf-kiosk-mode-one"
                />
                <OptionRow
                  label="Combined movement goal"
                  description="Several activities adding up to one shared total."
                  selected={kioskMode === 'combined'}
                  onPress={() => setKioskMode('combined')}
                  testID="wsf-kiosk-mode-combined"
                />
              </OptionGroup>
              {kioskMode === 'one' ? (
                /*
                  ONE GOAL. This used to be a sentence pointing at controls
                  somewhere else on the sheet; the controls are here now. Each
                  running goal gets its address and its screens, in the section
                  a Champion opened to find them.

                  Every state is the goal list's own, said plainly: loading
                  says loading, a failed load says so and offers nothing it
                  cannot back up, and a community with no running goal is told
                  that rather than shown an empty frame.
                */
                <View style={styles.setupBody} testID="wsf-kiosk-mode-one-panel">
                  <Text style={styles.manageIntro} testID="wsf-kiosk-mode-one-hint">
                    One screen, one goal, one address. Each running goal has its own.
                  </Text>
                  {goalsState.kind === 'loading' ? (
                    <Text style={styles.body} testID="wsf-kiosk-setup-loading">
                      Loading this community&apos;s goals…
                    </Text>
                  ) : goalsState.kind === 'failed' ? (
                    <Text style={styles.body} testID="wsf-kiosk-setup-failed">
                      This community&apos;s goals could not be loaded, so there is no kiosk address
                      to give you. Close this and open it again.
                    </Text>
                  ) : activeGoals.length === 0 ? (
                    <Text style={styles.body} testID="wsf-kiosk-setup-empty">
                      No goal is running, so there is nothing to put on a screen yet. Close this
                      and start a goal from the community page, and its kiosk will be here.
                    </Text>
                  ) : (
                    activeGoals.map((goal) => (
                      <View key={goal.goalId} style={styles.eventGoal}>
                        <Text style={styles.manageGoalTitle}>{goal.title}</Text>
                        {/*
                          PLAIN SELECTION TRUTH. What this screen will count,
                          in the goal's own unit, read from the goal itself.
                        */}
                        <Text style={styles.manageIntro} testID={`wsf-kiosk-goal-unit-${goal.goalId}`}>
                          Counted in {goal.unit} · {formatCount(goal.target)} {goal.unit} together
                        </Text>
                        {renderKioskSetup(goal)}
                      </View>
                    ))
                  )}
                </View>
              ) : (
                <View style={styles.setupBody} testID="wsf-combined-setup">
                  <Text style={styles.manageIntro} testID="wsf-combined-setup-intro">
                    Each activity keeps its own goal, its own target and its own page.
                  </Text>
                  {combinedCreated ? (
                    <View style={styles.manageGoal} testID="wsf-combined-created">
                      <Text style={styles.manageGoalTitle}>
                        “{combinedCreated.title}” is ready
                      </Text>
                      <Text style={styles.manageIntro}>
                        Open this on the screen at your event. It shows the shared total and each
                        activity — never a member or a contribution.
                      </Text>
                      {combinedUrl ? (
                        /*
                          The same weighting as a single goal's kiosk: opening
                          the screen is the action, copying the address is the
                          way to do it on another device.
                        */
                        <View
                          style={styles.actionStack}
                          // The address the controls beside it act on, readable
                          // by a test without being printed at a person.
                          dataSet={{ combinedUrl }}
                        >
                          <ButtonLink
                            href={`/combined/${combinedCreated.setupId}`}
                            label="Open combined screen"
                            style={styles.primaryButton}
                            textStyle={styles.primaryButtonText}
                            testID="wsf-combined-open"
                          />
                          <Pressable
                            onPress={() => void onCopyCombined()}
                            style={styles.tertiaryButton}
                            testID="wsf-combined-copy"
                            accessibilityRole="button"
                            accessibilityLabel={`${combinedCreated.title}: copy the combined screen link`}
                          >
                            <Text style={styles.tertiaryButtonText}>
                              {combinedCopy === 'copied' ? 'Copied' : 'Copy link'}
                            </Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.body} testID="wsf-combined-unavailable">
                          The combined link isn’t ready yet. Reload the page to try again.
                        </Text>
                      )}
                      {/*
                        The one place this address is deliberately readable, and
                        only when the clipboard refused: it is the Champion's own
                        sheet, the link carries no participant token and no
                        authority, and the alternative is a dead end at an event.
                      */}
                      {combinedCopy === 'failed' && combinedUrl ? (
                        <Text style={styles.body} testID="wsf-combined-copy-failed">
                          Copy didn’t work on this device. Open the combined screen here, or type this
                          address on it: {combinedUrl}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <Text style={kit.fieldLabel}>What is it called?</Text>
                      <TextInput
                        value={combinedTitle}
                        onChangeText={setCombinedTitle}
                        placeholder="Our combined movement goal"
                        placeholderTextColor={wsfTheme.colors.textMuted}
                        style={kit.input}
                        testID="wsf-combined-title"
                        accessibilityLabel="What the combined goal is called"
                      />

                      <Text style={kit.fieldLabel}>What is the combined count in?</Text>
                      <TextInput
                        value={combinedUnit}
                        onChangeText={setCombinedUnit}
                        placeholder="movements"
                        placeholderTextColor={wsfTheme.colors.textMuted}
                        autoCapitalize="none"
                        style={kit.input}
                        testID="wsf-combined-unit"
                        accessibilityLabel="What the combined count is in"
                      />

                      <Text style={kit.fieldLabel}>How many together?</Text>
                      <TextInput
                        value={combinedTarget}
                        onChangeText={setCombinedTarget}
                        placeholder="2000"
                        placeholderTextColor={wsfTheme.colors.textMuted}
                        inputMode="numeric"
                        style={kit.input}
                        testID="wsf-combined-target"
                        accessibilityLabel="How many together"
                      />

                      <Text style={kit.fieldLabel}>Starts</Text>
                      <DateTimeField
                        value={combinedStart}
                        onChange={setCombinedStart}
                        testID="wsf-combined-start"
                        accessibilityLabel="When the combined period starts"
                      />
                      <Text style={kit.fieldLabel}>Ends</Text>
                      <DateTimeField
                        value={combinedEnd}
                        onChange={setCombinedEnd}
                        testID="wsf-combined-end"
                        accessibilityLabel="When the combined period ends"
                      />
                      {/*
                        A STATED FACT, not a picker. There is no zone control of
                        any kind here: the times above are read in this zone and
                        this zone is what is stored, so the words, the instants
                        and the stored value can never disagree.
                      */}
                      {combinedZone.trim() ? (
                        <Text style={kit.caption} testID="wsf-combined-timezone-line">
                          Times are in {zoneInWords(combinedZone)}
                        </Text>
                      ) : (
                        <Text style={styles.error} testID="wsf-combined-timezone-error">
                          We can&apos;t read your device&apos;s time zone, so this goal can&apos;t be
                          started here.
                        </Text>
                      )}

                      <Text style={kit.fieldLabel}>Which activities?</Text>
                      {combinedCandidates.length === 0 ? (
                        <Text style={styles.body} testID="wsf-combined-activities-empty">
                          There are no activities to combine yet.
                        </Text>
                      ) : !combinedWindow ? (
                        <Text style={styles.body} testID="wsf-combined-activities-pending">
                          Choose the combined period first, and the activities that fit inside it will
                          be listed here.
                        </Text>
                      ) : (
                        combinedCandidates.map(({ goal, reason }) =>
                          reason === null ? (
                            /*
                              OPTION-ROW SHAPED, CHECKBOX SEMANTICS. Several
                              activities are chosen at once, so this is not a
                              radio: role="radio" outside a radiogroup is an axe
                              violation (aria-required-parent) and, worse, would
                              tell a screen reader that choosing one unchooses
                              the others. The look is the kit's option row so the
                              list reads like every other guided decision, and
                              the geometry is stable whether a row is picked or
                              not.
                            */
                            <Pressable
                              key={goal.goalId}
                              onPress={() =>
                                setCombinedPicks((prev) =>
                                  prev.includes(goal.goalId)
                                    ? prev.filter((id) => id !== goal.goalId)
                                    : prev.length >= MAX_COMBINED_CHILDREN
                                      ? prev
                                      : [...prev, goal.goalId]
                                )
                              }
                              style={[
                                kit.optionRow,
                                combinedPicks.includes(goal.goalId) ? kit.optionRowSelected : null,
                              ]}
                              testID={`wsf-combined-pick-${goal.goalId}`}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: combinedPicks.includes(goal.goalId) }}
                              accessibilityLabel={`${goal.title}. Its own goal: ${formatCount(goal.target)} ${goal.unit}`}
                              {...({
                                'aria-checked': combinedPicks.includes(goal.goalId),
                              } as Record<string, unknown>)}
                            >
                              <View style={kit.optionIndicator}>
                                {combinedPicks.includes(goal.goalId) ? (
                                  <View style={kit.optionIndicatorDot} />
                                ) : null}
                              </View>
                              <View style={styles.combinedPickText}>
                                <Text style={kit.optionLabel}>{goal.title}</Text>
                                <Text style={kit.optionDescription}>
                                  Its own goal: {formatCount(goal.target)} {goal.unit}
                                </Text>
                              </View>
                            </Pressable>
                          ) : (
                            <View
                              key={goal.goalId}
                              style={styles.manageGoal}
                              testID={`wsf-combined-pick-ineligible-${goal.goalId}`}
                            >
                              <Text style={styles.manageGoalTitle}>{goal.title}</Text>
                              <Text style={styles.body}>{ineligibleMessage(reason)}</Text>
                            </View>
                          )
                        )
                      )}

                      {/*
                        REVIEW BEFORE COMMIT. A confirmation, not a wizard step:
                        the same facts the Champion just entered, read back in
                        local words, directly above the one action.
                      */}
                      <View style={styles.manageGoal} testID="wsf-combined-summary">
                        <Text style={styles.manageGoalTitle}>Check this over</Text>
                        <Row label="Community" value={group.displayName} quiet />
                        <Row label="Combined goal" value={combinedTitle.trim() || '—'} quiet />
                        <Row
                          label="Together"
                          value={
                            parseTargetInput(combinedTarget) !== null && combinedUnit.trim()
                              ? `${formatCount(parseTargetInput(combinedTarget) as number)} ${combinedUnit.trim()}`
                              : '—'
                          }
                          quiet
                        />
                        <Row
                          label="Period"
                          value={
                            combinedWindow
                              ? (formatPeriod(
                                  combinedWindow.startsAt.toISOString(),
                                  combinedWindow.endsAt.toISOString(),
                                  { timeZone: combinedZone }
                                ) ?? '—')
                              : '—'
                          }
                          quiet
                        />
                        <Row label="Time zone" value={zoneInWords(combinedZone)} quiet />
                        <Row
                          label="Activities"
                          value={
                            combinedPicks.length
                              ? combinedPicks
                                  .map(
                                    (id) =>
                                      combinedCandidates.find((c) => c.goal.goalId === id)?.goal
                                        .title ?? ''
                                  )
                                  .filter(Boolean)
                                  .join(', ')
                              : '—'
                          }
                          quiet
                        />
                      </View>

                      {combinedError ? (
                        <Text style={styles.error} testID="wsf-combined-error">
                          {combinedError}
                        </Text>
                      ) : null}
                      <Pressable
                        onPress={() => void onCreateCombined()}
                        disabled={combinedBusy}
                        style={[kit.primaryButton, combinedBusy ? kit.primaryButtonDisabled : null]}
                        testID="wsf-combined-submit"
                        accessibilityRole="button"
                      >
                        <Text style={kit.primaryButtonText}>
                          {combinedBusy ? 'Starting…' : 'Start this combined goal'}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}
            </View>
            {/*
              SCREENS AT THIS EVENT — a SIBLING of the kiosk mode, never part
              of it. A combined event enrols its screens exactly as a
              single-goal event does, so this list does not move, empty or
              change when the mode above changes. Each goal's block carries its
              own heading, its own code field and its own slots, unchanged.
            */}
            {goalsState.kind === 'loaded' && activeGoals.length ? (
              <View style={styles.sheetSubsection} testID="wsf-manage-screens">
                {activeGoals.map((goal) => (
                  <View key={goal.goalId} style={styles.eventGoal}>
                    {/*
                      Which goal's screens these are. With one running goal the
                      heading inside the block already says everything; with
                      several, the name is the only thing that tells two
                      identical-looking blocks apart.
                    */}
                    {activeGoals.length > 1 ? (
                      <Text style={styles.manageIntro}>{goal.title}</Text>
                    ) : null}
                    {renderStationEnrolment(goal)}
                  </View>
                ))}
              </View>
            ) : null}
            </View>
            {/*
              GOALS. Routine work about the goals themselves — the public
              display permission, and starting another one. Deliberately NOT
              filed under anything administrative or destructive: a Champion
              does this on an ordinary day, and it must not sit behind a
              danger label to be reached.
            */}
            <View style={styles.sheetSection} testID="wsf-manage-goals">
              <Text style={styles.sheetSectionTitle}>Goals</Text>
            {goalsState.kind === 'loaded' && loadedGoals.length ? (
              <View style={styles.sheetSubsection}>
                <Text style={styles.sheetSubsectionTitle}>Public display</Text>
                <Text style={styles.manageIntro}>A permission you grant per goal.</Text>
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
            </View>
            {/*
              MEMBERS & INVITES. Everything about who is in this community and
              how they get in — the administrative facts, the invite QR and the
              link, including retiring it. One label, so a Champion looking for
              the join code knows where to look and a Champion looking for the
              event never has to read past it.
            */}
            <View style={styles.sheetSection} testID="wsf-manage-members">
              <Text style={styles.sheetSectionTitle}>Members and invites</Text>
            {/*
              Community details: the administrative facts about this community,
              here for the person who administers it rather than in every
              member's journey. The type/joining/status/role rows stay behind
              their own disclosure with the same testIDs they have always had.
            */}
            <View style={styles.sheetSubsection}>
              <Text style={styles.sheetSubsectionTitle}>Community details</Text>
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
            <View style={styles.sheetSubsection} testID="wsf-community-qr-section">
              <Text style={styles.sheetSubsectionTitle}>Invite QR</Text>
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
              <View style={styles.sheetSubsection} testID="wsf-community-invite-link">
                <Text style={styles.sheetSubsectionTitle}>Invite link</Text>
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

            </View>
            {/*
              ADVANCED. Destructive, last, and labelled as what it is, so
              nothing routine has to be read past it — and so nothing here is
              reached by accident. Leaving carries the sole-Champion refusal
              verbatim, exactly as before.
            */}
            <View style={styles.sheetSection} testID="wsf-manage-advanced">
              <Text style={styles.sheetSectionTitleDanger}>Advanced</Text>
              <View style={styles.sheetSubsection} testID="wsf-community-membership">
                <Text style={styles.sheetSubsectionTitle}>Membership</Text>
                {renderLeaveControls()}
              </View>
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
        {/* THE WORDMARK IS THE SHELL'S NOW. The persistent member top bar
            carries it and its tap is the one gesture that goes Home. A copy
            here stacked a second wordmark under the bar, and its own Home
            gesture navigated INTO the tab tree from inside it, which pushed a
            new screen instead of revealing the mounted one.

            AND THE ROW GOES WITH IT WHEN IT IS EMPTY. Champion tools still get
            their own row; an ordinary member has nothing to put in one, and
            leaving it rendered reserved 34px of the first viewport plus the
            column's 14px gap for nothing at all — under a bar that already
            costs 52. That is what pushed the first momentum row below the tab
            bar at 390x844. */}
        {isChampion ? (
          <View style={styles.productHeader}>
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
          </View>
        ) : null}
        {renderManageSheet()}

        {/*
          THE COMMUNITY LEADS, ABOVE THE HERO.

          Slice 2 moved the name INTO the hero, on the reasoning that a name
          on cream above a goal card made the hero "a goal card that happened
          to be on a page". The approved target answers that differently and
          better: the name stays out here, and the hero stops being a card. It
          becomes the one full-weight navy object on a light screen, so the
          community reads first and the goal reads as the thing the community
          is doing.

          This block now always renders — the name is always here — so there
          is exactly one level-1 heading whether or not a goal is featured,
          instead of one in each of two places depending on state.
        */}
        <View style={[styles.identity, identityCompact]}>
          <Text style={styles.identityEyebrow}>Your community</Text>
          <View style={styles.headingRow}>
            {/*
              D-1. The community is what this page is about, so its name is
              the page's one top-level heading. Role and level only — the
              styles, and therefore the rendering, are unchanged.
            */}
            {/*
              SLICE 2. THE NAME MOVED INTO THE HERO — WHEN THERE IS A HERO.

              It used to sit out here as navy text on cream, which made the
              hero a goal card that happened to be on a page about a
              community. The community is the thing the member is inside, so
              its name is the first line of the hero itself.

              BUT A COMMUNITY WITH NO GOAL HAS NO HERO. The first version of
              this moved the name unconditionally and a goal-less community
              lost its identity entirely — no name anywhere on its own screen.
              So the name renders here when nothing is featured, and inside
              the hero when something is. Exactly one level-1 heading either
              way, never two and never none.
            */}
            <Text
              style={[styles.heading, styles.headingName, headingCompactType]}
              testID="wsf-community-name"
              numberOfLines={2}
              ellipsizeMode="tail"
              accessibilityLabel={group.displayName}
              {...HEADING_1}
            >
              {group.displayName}
            </Text>
            {isSample ? (
              <Text style={styles.sampleBadge} testID="wsf-community-sample-badge">
                Sample
              </Text>
            ) : null}
          </View>
          {/*
            PRESENCE — PEOPLE FIRST, THEN THE PROOF THAT THEY MOVED.

            The initials row is drawn from `wsfCommunityMembers`, which returns
            only members who are visible in THIS community and returns no uid
            beside any name. It renders nothing at all when nobody is visible:
            a row of empty discs would be a drawing of absence.

            THE FIRST SENTENCE THE COMMUNITY SAYS ABOUT ITSELF IS ITS SIZE, AND
            NOTHING ABOUT PRIVACY. An earlier revision appended `· some choose
            not to be listed` here; the Director's AFTER review removed it,
            because privacy belongs in Settings rather than in the line a member
            reads before anything else. The residual is still derivable and
            still not computed for the reader — what changed is that the page
            stopped narrating it.

            THE MEMBER COUNT AND THE MOVED-TODAY COUNT ARE DIFFERENT FACTS and
            are never merged into one line. One counts membership; the other
            counts distinct people who contributed inside the featured goal's
            OWN day, and it renders only when the server could prove it — a
            null renders nothing at all, never a substitute.
          */}
          {presence !== null && presence.people.length > 0 ? (
            <PresenceRow people={presence.people} />
          ) : null}
          <View style={styles.presenceRow}>
            {memberCount != null ? (
              <Text style={styles.presenceText} testID="wsf-community-hero-presence">
                {memberCountLabel(memberCount)}
              </Text>
            ) : null}
            {otherCommunityCount > 0 ? (
              <Pressable
                onPress={() => router.replace('/community')}
                accessibilityRole="link"
                accessibilityLabel={`Switch community. You are in ${otherCommunityCount + 1}.`}
                style={styles.switchChip}
                testID="wsf-community-hero-switch"
              >
                <Text style={styles.switchChipText}>Switch</Text>
              </Pressable>
            ) : null}
          </View>
          {/*
            A PROVEN ZERO IS DATA; ONLY `null` IS SILENCE.

            `null` means the server could not establish the count — no goal
            named, an unresolvable zone, a goal in another community, or a
            bounded scan that did not reach past the window start — and it
            renders nothing at all.

            `0` means the server DID establish it and nobody has moved yet in
            this goal's own day. An earlier revision suppressed that, on the
            argument that a green zero is a discouraging thing to open with.
            The Director overruled it and was right: hiding a known zero
            collapses "known zero" into "unknown", which is precisely the
            distinction the rest of this feature exists to keep. The screen
            says what is true and lets the member decide how to feel about it.
          */}
          {momentum !== null && momentum.contributorsToday !== null ? (
            <Text style={styles.movedToday} testID="wsf-community-contributors-today">
              {momentum.contributorsToday === 1
                ? '1 person moved today'
                : `${momentum.contributorsToday} people moved today`}
            </Text>
          ) : null}
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
                <Fragment>
                <View style={[styles.hero, heroCompact]} testID="wsf-community-goal-hero">
                  {/* Depth, built from layered views: a light across the
                      top of the card, and a bloom behind the mark. Neither
                      needs a gradient dependency or any photography, and the
                      bloom never touches the mark itself. */}
                  <View pointerEvents="none" style={styles.heroTopLight} />

                  {/*
                    A3. The one place this surface can say the target is met
                    while the goal is still open. Confirmed pulse only — an
                    unconfirmed or failed read keeps the neutral eyebrow.
                  */}
                  {/*
                    SLICE 1. The neutral "What we're doing" labelled what the
                    card's own content already said, and cost a row at the most
                    expensive point on a phone. "Goal reached" is real news and
                    keeps the slot; the label does not.
                  */}
                  {/*
                    NO STANDING SLOGAN IN THIS SLOT.

                    A communal line stood here for one pass. It is out: it is
                    not part of the approved verbal hierarchy, and a sentence
                    that is always true is a sentence that says nothing by the
                    second time a member sees it. The slot belongs to real
                    state news, so it carries "Goal reached" when that is true
                    and nothing at all when it is not.

                    Whose effort this is gets said where it is a fact rather
                    than a slogan: the identity block above the hero names the
                    community and its members.
                  */}
                  {p.kind === 'ok' &&
                  progressPhase(p.pulse.sharedTotal, p.pulse.target, p.pulse.status) ===
                    'reachedOpen' ? (
                    <Text style={styles.heroEyebrow} testID="wsf-community-goal-eyebrow">
                      Goal reached
                    </Text>
                  ) : null}
                  <Text
                    style={[styles.heroTitle, heroTitleType]}
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
                        <View pointerEvents="none" style={styles.glowLayer}>
                          <View style={[styles.glowRing, glowSize(bloom, 1), styles.glow3]}>
                            <View style={[styles.glowRing, glowSize(bloom, 0.7), styles.glow2]}>
                              <View style={[styles.glowRing, glowSize(bloom, 0.43), styles.glow1]} />
                            </View>
                          </View>
                        </View>
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
                  </View>
                  {/*
                    SLICE 1f. BOTH ROUTES ARE GATED, NOT ONE.

                    Slice 1 moved the repeat-policy check onto the quiet route
                    when the "Your part" duplicate was removed, and stopped
                    there. That left the green primary still inviting a
                    contribution the server refuses with "This goal takes one
                    contribution from each member" — the loudest control on the
                    screen offering a journey that ends in a refusal. Hiding
                    the quiet route and keeping the loud one is worse than
                    hiding neither, because it reads as deliberate.

                    On a `once` goal this member has already contributed to,
                    neither route is offered and the screen says plainly what
                    it recorded and why there is nothing more to do. It states
                    what was RECORDED — the system confirms a recorded
                    contribution, never that a person exercised.
                  */}
                </View>
                {/*
                  THE ACTION LIVES ON THE PAGE, NOT INSIDE THE HERO.

                  The approved target puts the hero's weight behind the
                  numbers and then hands the screen to one bright control on
                  the light ground. Inside the navy card the same button was
                  one more thing in the object it should be answering, and
                  the card grew tall enough to push everything else off a
                  short phone.

                  Every state moved with it -- the once-policy statement, the
                  two routes, and the share control -- so the gating is
                  unchanged and nothing had to be re-derived.
                */}
                {p.kind === 'ok' && p.repeatPolicy === 'once' && (p.ownCredit ?? 0) > 0 ? (
                  <View
                    style={styles.heroDone}
                    testID={`wsf-community-goal-complete-${featured.goalId}`}
                  >
                    <Text style={styles.heroDoneLead}>
                      {`You’ve recorded ${formatCount(p.ownCredit ?? 0)} ${p.pulse.unit}.`}
                    </Text>
                    <Text style={styles.heroDoneNote}>
                      This goal takes one contribution from each member.
                    </Text>
                  </View>
                ) : (
                <View style={[styles.actions, shortViewport ? styles.actionsShort : null]}>
                  <ButtonLink
                    href={contributeHref(featured.goalId, 'move')}
                    style={styles.primaryButton}
                    textStyle={styles.primaryButtonText}
                    testID={`wsf-community-goal-link-${featured.goalId}`}
                    label="Start moving"
                  />
                  <ButtonLink
                    href={contributeHref(featured.goalId, 'record')}
                    style={styles.heroSecondaryAction}
                    textStyle={styles.heroSecondaryActionText}
                    testID={`wsf-community-goal-record-${featured.goalId}`}
                    // THE UNIT IS BACK IN THE LABEL. Slice 1 cut it to
                    // "I already moved" because the control was as wide and as
                    // loud as the primary and competed with it. It is quiet
                    // now — an outline on cream under a filled green button —
                    // so it can afford to say what it records, which is what
                    // the approved target asks for. Where the pulse has not
                    // landed the unit is unknown, so the shorter sentence is
                    // used rather than a guessed noun.
                    label={
                      p.kind === 'ok' ? `Already moved? Record ${p.pulse.unit}` : 'I already moved'
                    }
                  />
                </View>
                )}
                {/*
                  SLICE 1. Below the actions, not between the figures and the
                  primary control. It is maintenance metadata, and in the old
                  order it was the last thing a 390x640 phone could show.
                */}
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
                      <Text style={styles.shareButtonText}>
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
                {renderFreshness(p)}
                </Fragment>
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
                <View style={[styles.actions, shortViewport ? styles.actionsShort : null]}>
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
            when every one of them has answered. It counts GOALS, never people.
            Members only, which this whole screen already is: a non-member is
            refused at `state.kind === 'notMember'` above and never reaches it.

            The clause that once stood here — "no server surface counts
            contributors, and none is invented" — was true until the social
            lane. `wsfCommunityActivity` now counts them, under the owner's
            decision, and the guard moved rather than disappeared: see the
            section below, where the count renders only when the server could
            PROVE it over the goal's own day.
          */}
          {momentumLine ? (
            <Text style={styles.momentumLine} testID="wsf-community-momentum">
              {momentumLine}
            </Text>
          ) : null}

          {/*
            RECENT MOMENTUM — the evidence that other real people are moving.

            Every row is a real `wsfContributions` record. A member showing
            activity but not their name appears as "Anonymous member" WITH their amount
            and time: dropping the row would quietly under-report what the
            community did in order to make the feed tidier. A member who turned
            activity off has no row at all, and their effort still moved the
            shared total.

            `contributorsToday` is rendered ONLY when the server returned a
            number. Null renders nothing — never "at least N", never an
            estimate, and never the row count standing in for a person count.
          */}
          {momentum !== null &&
          (momentum.entries.length > 0 || momentum.contributorsToday !== null) ? (
            <View style={styles.momentumCard} testID="wsf-community-momentum-card">
              <Text style={styles.sectionEyebrow}>Recent momentum</Text>
              {momentum.entries.slice(0, 3).map((row, i) => (
                <MomentumRow key={i} row={row} first={i === 0} />
              ))}
            </View>
          ) : null}

          {/* The way to the people. A quiet row, never a card competing with
              the goal for weight. */}
          <Pressable
            onPress={() => router.push(`/community/${groupId}/members`)}
            style={styles.peopleLink}
            testID="wsf-community-members-link"
            accessibilityRole="link"
            accessibilityLabel="See everyone in this community"
          >
            <Text style={styles.peopleLinkText}>See everyone in this community</Text>
            <Text style={styles.peopleLinkChevron}>›</Text>
          </Pressable>

          {/* Your part: exact own credit, no ranking, no comparison. */}
          {featured
            ? (() => {
                const p = progress[featured.goalId];
                if (!p || p.kind !== 'ok' || p.ownCredit == null) return null;
                return (
                  /*
                    SLICE 2b. A COMPACT PERSONAL STRIP, NOT ANOTHER EQUAL CARD.
                    This was a full white card with the same border, radius
                    and padding as everything else below it, which is what
                    made the page read as a stack rather than a hierarchy. It
                    is one person's private line about a shared goal — a quiet
                    strip with a green edge, no fill and no shadow, so the
                    hero above stays the only object with weight.
                  */
                  <View style={styles.personalStrip} testID={`wsf-community-your-part-${featured.goalId}`}>
                    <Text style={styles.sectionEyebrow}>Your part</Text>
                    {/*
                      SLICE 2, item 7. THE SAME FACT IS NOT STATED TWICE.
                      On a `once` goal already contributed to, the hero above
                      says "You've recorded N unit." Repeating it here as
                      "You've added N unit to this goal" was the accepted
                      redundancy from slice 1f. The hero keeps the number —
                      it is the one in the first viewport — and this card
                      carries what the hero does not: that the part is
                      counted, and where.
                    */}
                    <Text style={styles.body}>
                      {p.ownCredit > 0
                        ? (p.repeatPolicy === 'once'
                            ? 'Counted in the shared total above.'
                            : `You’ve added ${formatCount(p.ownCredit)} ${p.pulse.unit} to this goal.`)
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
                    {/*
                      SLICE 1. REMOVED. This was the THIRD route to the
                      contribution flow on one screen, after the hero's primary
                      action and "I already moved" directly above it. "Your
                      part" reports what the member has done; it does not
                      re-ask. The action lives in the hero, once.
                    */}
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
                {/*
                  NO MINI LIVING WE HERE. The mark is the product's signature
                  instrument, and the North Star draws it once per screen, big,
                  as the thing the screen is about. Repeating it at 104px on
                  every secondary row turned a signature into a bullet point:
                  four small WEs down a page compete with the hero's and with
                  each other, and none of them reads as important.

                  Nothing is lost, because nothing was being said twice. These
                  rows already print the real shared total and the real
                  percentage through `renderProgressFacts`, which is the same
                  confirmed ratio the mark was filling from.
                */}
                <View style={styles.smallGoalRow}>
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
                  {/* No mini mark on a history row either — same reason. */}
                  <View style={styles.smallGoalRow}>
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
const SURFACE_WHITE = wsfTheme.colors.surface;

/** One circle of the hero's bloom, sized from the card rather than fixed. */
function glowSize(base: number, factor: number) {
  const d = Math.round(base * factor);
  return { width: d, height: d, borderRadius: Math.round(d / 2) };
}
// Cream at reduced strength on the navy hero: still well above 4.5:1.
const HERO_MUTED = 'rgba(247,245,240,0.78)';
const HERO_RULE = 'rgba(247,245,240,0.35)';

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: wsfTheme.colors.background },
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 48,
    backgroundColor: wsfTheme.colors.background,
  },
  // 18 -> 14. The command-centre rhythm the target sets is denser than the
  // page had; four sections at 18 spent most of what the shorter hero freed.
  inner: { maxWidth: 640, width: '100%', gap: 14 },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The row still offers a 44px target — the wordmark's own Pressable does
    // that — but the row no longer reserves 44px of the first viewport for a
    // mark that is not what the member came for.
    minHeight: 34,
    // SLICE 2. The wordmark became a tappable way Home, and a Pressable does
    // not shrink the way a bare mark did: at 200% text zoom the Manage
    // control was pushed past the right edge. The row wraps and both children
    // may shrink, so the pair stays on the screen at any width.
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 4,
  },
  manageButton: {
    backgroundColor: '#ECE8E0',
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  manageButtonText: { color: NAVY, fontWeight: '700', fontSize: 14 },
  identity: { gap: 2 },
  identityEyebrow: {
    color: ACTION_GREEN_DEEP,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 1 },
  presenceText: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
  switchChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: wsfTheme.radius.pill,
    backgroundColor: '#ECE8E0',
  },
  switchChipText: { color: NAVY, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  headingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  heading: {
    // SLICE 1. Was 32/38/800 — larger than the goal title it sat above, so the
    // community's own name was the loudest thing on a screen whose job is the
    // goal. Demoted to context. At this size the two-line names that were
    // costing 76px of a 640px phone fit on one line.
    // The community leads the page now, so its name carries the weight. Slice
    // 1 demoted this to 20 because at 32 it shouted over a goal title sitting
    // directly under it; the goal title is inside a navy hero now and has its
    // own weight, so the two no longer compete for the same register.
    color: wsfTheme.colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 31,
    letterSpacing: -0.6,
    marginTop: 2,
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
  momentumCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 2,
  },
  movedToday: {
    color: ACTION_GREEN_DEEP,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    marginTop: 1,
  },
  peopleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  peopleLinkText: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  peopleLinkChevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },
  section: { gap: 8 },
  sectionEyebrow: {
    color: ACTION_GREEN_DEEP,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ---- the hero: navy surface, cream type, green for confirmed progress ----
  hero: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 16,
    // TIGHTENED FOR THE SOCIAL FOLD. The Director's AFTER review required the
    // first momentum row to be VISIBLE above the tab bar at 390x844, and said
    // to recover the height from spacing and hero composition rather than by
    // shrinking the Living WE into a minor icon or hiding an action. This is
    // that recovery: the hero's own frame gives up a few points, the mark keeps
    // its dominance.
    paddingTop: 10,
    paddingBottom: 10,
    gap: 4,
    // overflow clips the light and the bloom to the card's own corners.
    overflow: 'hidden',
    ...elevation.hero,
  },
  // A light falling across the top of the card. A rectangle drew a hard seam
  // straight through the mark — an artifact, not depth — so it is a very
  // large, very faint circle anchored above the card, which has no edge
  // inside it.
  heroTopLight: {
    position: 'absolute',
    top: -250,
    // STAYS INSIDE THE CARD'S OWN WIDTH. A circle wide enough to arc nicely
    // was 520px, and although the hero clips it, a clipped child still
    // reports its full box — which the shell's horizontal-overflow check
    // reads as content running past a 360px screen, correctly, because it
    // cannot know the difference. A full-width box with deep bottom corners
    // draws the same soft arc and has no width to run past anything.
    left: 0,
    right: 0,
    height: 360,
    borderBottomLeftRadius: 220,
    borderBottomRightRadius: 220,
    backgroundColor: 'rgba(143,224,138,0.06)',
  },
  // Three nested circles approximate a radial bloom without a gradient
  // dependency. It sits BEHIND the Living WE and never touches it: the mark's
  // own fill is the only thing that may say anything about progress.
  glowLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  glowRing: { alignItems: 'center', justifyContent: 'center' },
  glow3: { backgroundColor: 'rgba(145,203,125,0.05)' },
  glow2: { backgroundColor: 'rgba(145,203,125,0.07)' },
  glow1: { backgroundColor: 'rgba(145,203,125,0.09)' },
  // The numbers sink into their own panel, so the progress area reads as a
  // recessed instrument rather than as text floating on the card.
  progressPanel: {
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 11,
    marginTop: 6,
    gap: 6,
  },
  heroEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: CREAM,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 27,
    letterSpacing: -0.4,
  },
  heroMeta: { color: HERO_MUTED, fontSize: 15, lineHeight: 20 },
  heroBody: { color: CREAM, fontSize: 16, lineHeight: 22 },
  heroCentered: { alignItems: 'center', gap: 8 },
  // Reserved room for the mark and the facts; the loading line sits centred
  // in it rather than at the top of a hole.
  progressArea: { justifyContent: 'center', gap: 2 },
  weWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 4, paddingBottom: 2 },
  // The numbers sit in their own recessed panel, so the progress area reads as
  // an instrument rather than as text floating on the card.
  factsLarge: {
    alignItems: 'stretch',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 9,
    marginTop: 2,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.14)',
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: PROGRESS_GREEN },
  factsSmall: { gap: 2 },
  // What the community has done together is what this screen exists to show,
  // and at 24 it was smaller than the community's own name.
  heroTotal: { textAlign: 'center' },
  heroTotalCount: { ...display.lg, color: CREAM },
  heroTotalRest: { color: ON_NAVY_MUTED, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  heroPercent: { color: PROGRESS_GREEN, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  heroStatus: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  heroStatusNear: { color: CREAM, fontWeight: '700' },
  freshnessRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  freshnessUtilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Closes up under the actions rather than floating in the gap a missing
    // momentum row would otherwise leave. Was 10.
    marginTop: 2,
    gap: 12,
  },
  freshnessUtilityText: { color: wsfTheme.colors.textMuted, fontSize: 13 },
  freshnessUtilityLink: {
    color: wsfTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  heroFreshness: { color: HERO_MUTED, fontSize: 13 },
  freshnessButton: { minHeight: 44, justifyContent: 'center' },
  heroFreshnessLink: { color: CREAM, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  // SLICE 1. marginTop 8 -> 14. Removing the freshness row took the hero's
  // breathing room with it and the button sat too close to "to go". 20 read
  // better still, but it cost the worst-case long name its clearance on a
  // 390x640 phone (15px left); 14 keeps the air and returns the margin.
  actions: { gap: 8, marginTop: 2 },
  // A short phone's fold lands just under the secondary control. Without this
  // the pair sat flush against the fixed navigation, which reads as the screen
  // running out rather than as a composition ending.
  actionsShort: { marginBottom: 14 },
  // ONE FLOWING SECTION, NOT A TILE. The member's own part leads with a green
  // edge; anything that belongs with it continues under a hairline rather than
  // starting a second box of equal weight beside it.
  personalStrip: {
    backgroundColor: SURFACE_WHITE,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
    borderLeftWidth: 3,
    borderLeftColor: PROGRESS_GREEN,
    ...elevation.card,
  },
  // SLICE 2. The identity band: the community's name, then the one presence
  // fact, separated from the goal below by a hairline rather than a gap, so
  // the hero reads as one object and not two stacked cards.
  heroIdentity: {
    gap: 2,
    paddingBottom: 12,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(247,245,240,0.22)',
  },
  heroCommunity: { color: '#FFFFFF', fontSize: 17, lineHeight: 23, fontWeight: '800' },
  heroIdentityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  heroSwitch: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(247,245,240,0.45)' },
  heroSwitchText: { color: '#FFFFFF', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  heroPresence: { color: 'rgba(247,245,240,0.78)', fontSize: 13, lineHeight: 18 },
  // SLICE 1f. THE COMPLETED STATE SITS WHERE THE BUTTONS WERE, and is quiet.
  // It replaces two controls, so it must not read as a third: no fill, no
  // border, no tap affordance — a statement, in the hero's own type.
  heroDone: { marginTop: 2, gap: 4 },
  heroDoneLead: { color: NAVY, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  heroDoneNote: { color: INK_QUIET, fontSize: 14, lineHeight: 20 },
  // SLICE 1. The already-moved route is DEMOTED, not duplicated and not
  // stripped. Bare centred text (the first attempt) read as a caption and
  // lost every signal that it could be tapped. This is a quiet chip: hairline
  // border at lower contrast than the share control, sized to its label rather
  // than the full width, and still a 44px target.
  heroSecondaryAction: {
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE_WHITE,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroSecondaryActionText: { color: NAVY, fontSize: 14, fontWeight: '700' },
  // THE ACTION GREEN, NOT THE PROGRESS GREEN. They are separate tokens on
  // purpose: a button must never be able to restate what the Living WE is
  // saying about the shared total.
  primaryButton: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  primaryButtonText: { color: ON_ACTION, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  heroOutlineButtonWide: {
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE_WHITE,
    borderRadius: 16,
    minHeight: 46,
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
  // ON THE NAVY HERO. Both "Try again" controls live inside the hero, so
  // their label is the hero's light ink. This was NAVY for one pass — the
  // share control moved out onto the cream page and took the colour with it,
  // leaving the two retry labels navy on navy: an empty outlined pill, which
  // is what Board 01's unavailable capture showed. The share control has its
  // own text style now, below.
  heroOutlineButtonText: { color: CREAM, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  shareButtonText: { color: NAVY, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  // W7. The share control sits under the contribution actions, quieter than
  // both, with its disclosure directly beneath it rather than behind a tap.
  shareBlock: { gap: 8, marginTop: 12 },
  heroShareNote: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17, textAlign: 'center' },

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
    backgroundColor: SURFACE_WHITE,
    borderRadius: 20,
    padding: 16,
    gap: 8,
    ...elevation.card,
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
    backgroundColor: SURFACE_WHITE,
    borderRadius: 20,
    padding: 16,
    gap: 6,
    ...elevation.card,
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
    // A phone sheet is the whole width because the phone is. A laptop is not:
    // left unbounded, a label and its value sat at opposite ends of 1280 px
    // and the sheet read as a table of settings rather than a card.
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
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
  // The heading column takes the width the Close control does not, so a long
  // community name wraps inside the sheet instead of pushing Close off it.
  sheetHeading: { flex: 1, gap: 2, paddingRight: 12 },
  sheetEyebrow: {
    color: NAVY,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sheetTitle: { color: wsfTheme.colors.text, fontSize: 20, fontWeight: '800' },
  sheetStory: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 2 },
  sheetClose: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  sheetCloseText: { color: NAVY, fontSize: 16, fontWeight: '700', textDecorationLine: 'underline' },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 12, paddingBottom: 8 },
  sheetSection: { gap: 10 },
  // A section label is the loudest thing between cards, so it is the navy
  // green-adjacent voice of the sheet; a subsection sits under it, quieter,
  // and never competes with the section it belongs to.
  sheetSectionTitle: { color: NAVY, fontSize: 17, fontWeight: '800' },
  // Same size and weight, warned colour. The word "Advanced" carries the
  // meaning; the colour only agrees with it, so it is never colour alone.
  sheetSectionTitleDanger: { color: '#8A2F2F', fontSize: 17, fontWeight: '800' },
  sheetSubsection: { gap: 8 },
  sheetSubsectionTitle: { color: wsfTheme.colors.text, fontSize: 15, fontWeight: '700' },
  // One running goal's whole event block: its address and its screens, kept
  // visibly together and separated from the next goal's.
  eventGoal: {
    gap: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#D5DCE5',
  },
  manageIntro: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 20 },
  manageGoal: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#D5DCE5' },
  // Two controls side by side that drop to one column when the sheet is
  // narrow, rather than a fixed row that would push a label off a 195 px
  // screen.
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // ---- Set up kiosk: one card, one decision ----
  // The quiet card already used elsewhere on this screen (same surface, same
  // 16 px radius, same border), so the white option rows and inputs inside it
  // separate from their ground without a new token of any kind.
  setupCard: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  setupBody: { gap: 10 },
  // One action above its utility, never two buttons of equal weight side by
  // side: the primary takes the full width of the card, the quiet control
  // sits under it and keeps its own 44 px box.
  actionStack: { gap: 6, alignItems: 'stretch' },
  // Quiet text controls that share a line and give way before the viewport
  // does. The gap is wider than a button row's so two underlined labels do
  // not read as one.
  utilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  // The text column of a combined-activity pick row. Shrinks and wraps so a
  // long activity name cannot push the row past a 195 px viewport.
  combinedPickText: { flex: 1, minWidth: 0, gap: 4 },
  manageGoalTitle: { color: wsfTheme.colors.text, fontSize: 16, fontWeight: '700' },
  stationCodeInput: {
    borderWidth: 1.5,
    borderColor: '#D5DCE5',
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    color: wsfTheme.colors.text,
    fontSize: 18,
    letterSpacing: 4,
    fontWeight: '700',
    backgroundColor: '#FFFFFF',
  },
  stationSlotChosen: { backgroundColor: wsfTheme.colors.primary, borderColor: wsfTheme.colors.primary },
  stationSlotChosenText: { color: wsfTheme.colors.background },
  stationList: { gap: 8, paddingTop: 4 },

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
// Same reason: a ButtonLink demoted to a quiet utility in a wrapping row needs
// its two styles composed BEFORE the link merges them.
const UTILITY_LINK = StyleSheet.flatten([styles.tertiaryButton, styles.rowButton]);
const UTILITY_LINK_TEXT = StyleSheet.flatten([styles.tertiaryButtonText, styles.rowButtonText]);
