import { router, useLocalSearchParams, useNavigation, usePathname } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { signOut } from 'firebase/auth';
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
  type StyleProp,
  type TextStyle,
  type ViewStyle,
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
import { getFirebaseAuth, getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import {
  KIOSK_TICK_MS,
  KIOSK_UNRESOLVED_NOTICE,
  KIOSK_UNRESOLVED_NOTICE_NO_RETRY,
  clearKioskReturnGoal,
  isKioskFlag,
  kioskMayFinishUnattended,
  kioskCountdownExpired,
  kioskCountdownLabel,
  kioskRemainingMs,
  kioskRemainingSeconds,
  runKioskFinish,
  type KioskOutcome,
} from '../../src/kioskSession';
import {
  SAME_LOAD_MS,
  forgetCommunity,
  noteConfirmedContribution,
  peekGoals,
  peekOwnCredit,
  readGoals,
  readMyCommunities,
  readOwnCredit,
} from '../../src/memberReads';
import { moveAttemptIdFor } from '../../src/moveSession';
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
  fillRatio,
  formatCount,
  percentLabel,
  progressPhase,
  statusLine,
  totalOfTargetLabel,
  totalOfTargetParts,
} from '../../src/ui/progressFormat';

import { ACTION_GREEN, ACTION_GREEN_DEEP, ON_ACTION, elevation } from '../../src/ui/kit';
import {
  MEMBER_TAB_MOVE_OVERHANG,
  shellAppliesTo,
} from '../../src/ui/MemberTabBar';
import { WsfWordmark } from '../../src/ui/WsfWordmark';
import { isMoveSheetRoute } from '../../src/ui/moveSheetRoute';
import {
  ensureSheetMotionCss,
  sheetData,
  takeSheetHandoff,
  SCRIM_PROPS,
  useSheetExit,
  useSheetFocusContainment,
} from '../../src/ui/sheetMotion';
import { useReducedMotion } from '../../src/ui/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/**
 * PERF-MOBILE-1. THE GOAL AS THIS ACCOUNT ALREADY KNOWS IT.
 *
 * Measured on `0b460ce3` (W7 Check 41B): opening MOVE on a goal the tab
 * beneath had just shown still waited on `wsfGoalPulse` and
 * `wsfMyContribution` before the movement step appeared. When this account's
 * own record (src/memberReads.ts) holds the goal -- open, with its confirmed
 * shared total, target and unit, from `wsfListGoals` -- and the member's own
 * confirmed part in it, the step opens on those at once. The fresh reads
 * below still run and replace them; the write itself is decided by the
 * server, never by this.
 *
 * Anything less is not known: no record, a goal not in it, a total the list
 * did not carry, a goal that is not open. Then the screen loads exactly as it
 * always did.
 */
function knownGoal(
  uid: string | null,
  goalId: string | undefined,
  groupId: string | null,
): { state: LoadState; guideKey: string | null; policy: RepeatPolicy } | null {
  if (!uid || !goalId || !groupId) return null;
  const goal = peekGoals<Record<string, unknown>>(uid, groupId)?.goals.find((g) => g.goalId === goalId);
  const own = peekOwnCredit(uid, goalId);
  if (!goal || !own || goal.status !== 'active') return null;
  const { sharedTotal, target, unit } = goal;
  if (typeof sharedTotal !== 'number' || typeof target !== 'number' || typeof unit !== 'string') return null;
  if (typeof own.ownCredit !== 'number') return null;
  return {
    state: { kind: 'ready', pulse: { sharedTotal, target, unit, status: 'active' }, ownCredit: own.ownCredit },
    guideKey: typeof own.activityGuideKey === 'string' ? own.activityGuideKey : null,
    policy: resolveRepeatPolicy(own.repeatPolicy),
  };
}

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

/**
 * BACK RETURNS TO WHERE THE MEMBER CAME FROM; IT DOES NOT BUILD A COPY OF IT.
 *
 * The contribution screen is a focused route presented over the tab
 * navigator. Following a plain link to `/community/<groupId>` from here
 * pushes a SECOND community screen and leaves the one the member came from
 * mounted but hidden behind it, with its scroll and loaded state lost —
 * measured on the receipt at `f2f901a`: two instances, the visible one not
 * the one the member left. The chrome control stopped doing that when the
 * shell migrated, and this is its rule: the arrow is "the step before this".
 * The labelled exits below go where their label says (`leaveFor`).
 *
 * `canGoBack()` is asked at press time. A cold or deep-linked arrival has
 * nothing beneath it and gets its canonical destination by `replace`, so a
 * contribution screen reached directly is not left in the history. Kiosk
 * sessions never reach this: every kiosk rest state renders Finish instead.
 */
function returnToMemberContext(href: string): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(href as never);
}

/**
 * A LABELLED EXIT GOES WHERE ITS LABEL SAYS, AND LANDS ON THE MEMBER'S
 * MOUNTED TABS RATHER THAN BUILDING A SECOND SET.
 *
 * `back()` is right for the chrome arrow, which means "the step before this".
 * It is not right for a button that says where it goes: this screen is also
 * reached from the MOVE sheet (which replaces itself with it, so the tab
 * beneath can be You or Progress), from the MOVE chooser, from Goal Setup's
 * receipt and from an event screen. From any of those, `back()` lands
 * somewhere other than the community the button promised.
 *
 * "BACK TO COMMUNITY" uses `dismissTo`: it pops every focused route above
 * the member's mounted tabs and opens the community there. When that
 * community is already the screen on top of the Home tab (the ordinary
 * journey), the router keeps its key: the same mounted screen, its scroll and
 * its loaded state, and no second instance.
 *
 * "BACK TO HOME" (the own-only receipt, a goal that could not be read, a
 * context not yet verified, and Goal Setup's receipt, whose link carries no
 * community) pops to the mounted tabs and selects the Home tab as it stands,
 * which is exactly what pressing Home in the tab bar does. It does not open
 * Home's index: over a mounted community that pushes the index, whose own
 * redirect then builds a second copy of the community beneath the member.
 *
 * With no tabs beneath (a cold or deep-linked arrival) both replace this
 * screen, so a dead-end contribution screen is not left in the history, and
 * a cold Home resolves the member's communities as it always has.
 *
 * Sign in is not one of these: it is its own destination and stays a link.
 */
type Dispatches = { dispatch: (action: never) => void };

function leaveFor(href: string, navigation: Dispatches): void {
  if (href === '/') {
    navigation.dispatch({ type: 'POP_TO', payload: { name: '(tabs)', params: { screen: '(home)' } } } as never);
    return;
  }
  router.dismissTo(href as never);
}

/**
 * RECOVERY-PORT-1. A LINK THAT IS NOT AN ANCHOR HAS TO ANSWER THE KEYBOARD
 * ITSELF. react-native-web leaves Enter on `role="link"` to the browser -- it
 * assumes an `<a href>` underneath -- and these exits have no href on purpose
 * (they pop or dismiss rather than push). So a focused exit ignored Enter:
 * measured on the base and on the port, the member pressed Enter on "Back to
 * community" and stayed where they were (WCAG 2.1.1). Enter is a link's key;
 * Space is left to the page, as it is for a real link.
 */
type KeyLike = { key?: string; repeat?: boolean; nativeEvent?: { key?: string; repeat?: boolean } };
function enterActivates(go: () => void): Record<string, unknown> {
  return {
    onKeyDown: (e: KeyLike) => {
      const key = e.key ?? e.nativeEvent?.key;
      const repeat = e.repeat ?? e.nativeEvent?.repeat;
      if (key === 'Enter' && !repeat) go();
    },
  };
}

/** Looks like `ButtonLink`; lands on the member's mounted tabs. */
function ReturnButton({
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
  const navigation = useNavigation<Dispatches>();
  return (
    <Pressable
      style={StyleSheet.flatten(style)}
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => leaveFor(href, navigation)}
      {...enterActivates(() => leaveFor(href, navigation))}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

export default function ContributeToGoal() {
  const params = useLocalSearchParams<{
    goalId: string;
    groupId?: string;
    mode?: string;
    kiosk?: string;
    attempt?: string;
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  /*
    THE SHELL'S BAR IS BELOW THIS SCREEN, NOT OVER IT -- EXCEPT FOR THE RAISED
    ACTION.

    The app shell lays the member tab bar out AFTER the screen in one column,
    so the screen's box ends where the bar's begins: at every height the
    scroll view's bottom edge is the bar's top edge, measured. What does reach
    into the screen is the raised MOVE circle, which rises
    MEMBER_TAB_MOVE_OVERHANG above that edge and covers the bottom of the
    scroll view at EVERY scroll position. A control the first screenful
    happens to place in that band reads as available and hands its tap to
    MOVE instead. At 390x664 that was the MOVE step's "Skip timer", its label
    fully visible and its own centre untappable; at 390x640 the same control,
    peeking from under the circle.

    An earlier version reserved the bar's whole footprint as padding at the
    END of the content. That kept the last control clear once the member had
    scrolled all the way down and did nothing for the first screenful,
    because padding at the end of the content is off screen until then -- and
    it reserved 88px for a bar body that never overlaps this screen at all.
    The reservation now sits where the overlap actually is: the scroll view
    itself stops above the raised action, so the band the circle covers is
    never scrollable content, at rest or after any scroll, and the content
    keeps its own ordinary end padding. It is reserved only while the bar is
    rendered, by the shell's own rule, because without the bar there is
    nothing to clear.
  */
  const pathname = usePathname() || '/';
  // The kiosk flag is part of the answer: the shell does not render over a
  // kiosk session (src/ui/MemberTabBar.tsx), so there is no raised action to
  // clear and reserving space for one would leave a band of nothing at the
  // bottom of a screen that has no bar.
  const shellBarShown = Boolean(user) && shellAppliesTo(pathname, { kiosk: params.kiosk });
  /*
    APP-FEEL-PARITY-1. MOVE'S FLOW IS A SHEET OVER THE MEMBER'S TAB.

    The root stack presents this route as a transparent modal exactly when
    `isMoveSheetRoute` holds (move mode, not a kiosk, the member's tabs or the
    MOVE sheet directly beneath), and this screen asks the same question so
    it draws what the stack presents: a scrim over the tab, which stays
    mounted, painted and inert, and a bounded panel with one named Close.
    Every step runs inside it -- the timer, the count, the review, pending,
    unknown and the receipt -- because a member who pressed MOVE is still on
    their tab until they leave it. Anything else is the page it always was.

    Asked once, when the flow opens: nothing beneath a route is removed while
    it is open, and a flow that changed presentation mid-journey would be a
    worse surprise than either.
  */
  const rootNavigation = useNavigation();
  const [asSheet] = useState<boolean>(() => {
    const st = rootNavigation.getState() as
      | { index?: number; routes: { key: string; name: string; params?: object }[] }
      | undefined;
    const me = st?.routes?.[st.index ?? 0];
    return Boolean(me) && isMoveSheetRoute(me!, st);
  });
  // Over MOVE's chooser, which already dims the tab: one dim, not two.
  const [overMoveSheet] = useState<boolean>(() => {
    if (!asSheet) return false;
    const st = rootNavigation.getState() as { index?: number; routes: { name: string }[] } | undefined;
    return st?.routes?.[(st.index ?? 0) - 1]?.name === 'move/index';
  });
  // Installed before the first paint of the sheet, so its entry is animated
  // from the first frame rather than from whenever an effect ran.
  const [sheetHandoff] = useState<boolean>(() => {
    if (!asSheet) return false;
    ensureSheetMotionCss();
    return takeSheetHandoff();
  });
  const reducedMotion = useReducedMotion();
  const safeArea = useSafeAreaInsets();
  const { phase: sheetPhase, exit: exitSheet } = useSheetExit(reducedMotion);
  const sheetRef = useRef<View>(null);
  // The dialog panel itself: focus enters, stays and re-orients here (F2).
  const sheetPanelRef = useRef<View>(null);
  const closeSheetRef = useRef<() => void>(() => undefined);
  /*
    ESCAPE IS CLOSE, while this sheet is the screen in front: the same path as
    the Close control and the scrim.
  */
  useEffect(() => {
    if (!asSheet || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !rootNavigation.isFocused()) return;
      e.preventDefault();
      closeSheetRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asSheet, rootNavigation]);
  const [known] = useState(() => knownGoal(user?.uid ?? null, goalId, groupIdHint));
  const [state, setState] = useState<LoadState>(() => known?.state ?? { kind: 'loading' });
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
  const [activityGuideKey, setActivityGuideKey] = useState<string | null>(() => known?.guideKey ?? null);
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
  const [repeatPolicy, setRepeatPolicy] = useState<RepeatPolicy>(() => known?.policy ?? 'once');
  const [pending, setPending] = useState<PendingContribution | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Ref instead of state — the in-flight attempt id must NOT trigger a
  // re-render (would risk generating a new id mid-submit and defeat
  // idempotency). Cleared on each fresh "Record" tap.
  /**
   * THE SCREEN CHANGES STATE IN PLACE, SO IT HAS TO RETURN TO ITS OWN TOP.
   *
   * Move, entry, review and every outcome replace each other inside ONE
   * ScrollView rather than by navigating, and a ScrollView keeps its offset
   * across a re-render. A member who scrolled down to reach Review therefore
   * arrived at the review BODY, with the wordmark and the goal anchor already
   * scrolled off -- and the same for the outcomes, which is the worst place
   * to start a member halfway down. Forcing the screenshot to the top would
   * have hidden this rather than fixed it.
   */
  const scrollRef = useRef<ScrollView>(null);
  const attemptRef = useRef<string | null>(null);
  // THE FOLLOW-ALONG ROUND THIS ENTRY BELONGS TO, if the route named one.
  //
  // A round on /move/<goalId> mints one id and hands it here, so the SAME
  // person finishing that round on a second device — scanning the station
  // panel's QR onto their own phone, or reloading this page — sends the same
  // attemptId and `wsfContribute` counts it exactly once. Nothing about the
  // callable, its (goal, uid, attemptId) idempotency or its receipt changes:
  // this only decides what this screen's FIRST attempt id is called.
  //
  // Derived as `<round>_<uid>` by src/moveSession.ts, never the bare round id
  // — see the note there on the server's per-attempt recent-additions doc.
  //
  // CONSUMED EXACTLY ONCE. "Record more" is a genuinely new contribution, so
  // it must not replay this one; taking the value out of the ref means the
  // next Record mints an ordinary random attempt id exactly as it always did.
  const roundAttemptRef = useRef<string | null>(null);
  const takeRoundAttemptId = useCallback(() => {
    const held = roundAttemptRef.current;
    roundAttemptRef.current = null;
    return held;
  }, []);
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
    roundAttemptRef.current = moveAttemptIdFor(params.attempt, uid);
    inFlightRef.current = false;
    // Nothing from the previous context stays on screen while the new one
    // loads: not the pending screen, not the receipt, not the typed entry,
    // not an error, not a refusal, and not the previous ready-state totals.
    // What this account's record already knows about this goal (PERF-MOBILE-1,
    // `knownGoal`); nothing, for a context it does not know.
    const recorded = knownGoal(uid, goalId, groupIdHint);
    setPending(null);
    setLastResult(null);
    setRepeatPolicy(recorded?.policy ?? 'once');
    setLegacyOrphan(null);
    setRefusal(null);
    sharedBeforeRef.current = null;
    setEntry('');
    setEntryError(null);
    setReviewCount(null);
    setActivityGuideKey(recorded?.guideKey ?? null);
    setGuideOpen(false);
    setSubmitting(false);
    setStep(initialStep);
    setContext({ kind: 'none' });
    setState(recorded?.state ?? { kind: 'loading' });
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
        // Own credit comes from the server on every load — authenticated,
        // keyed by the caller's uid — so a reload, a closed goal or an
        // authorized correction never shows a stale or invented number. It is
        // read through this account's record (src/memberReads.ts): fresh, and
        // the answer is then the record every surface opens on.
        const [pulseRes, mineRes] = await Promise.all([
          pulseFn({ goalId }),
          readOwnCredit(user.uid, goalId).then((data) => ({ data: data as unknown as MyContribution })),
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
        /*
          PERF-MOBILE-1. THE SAME AUTHORIZED ANSWERS MOVE HAS JUST READ.
          This asked `wsfListGoals` a second time (without history, so it could
          not even share the first) and read the group document for its name.
          Both facts are in this account's own record: its goals list from
          `wsfListGoals` (which refuses a non-member, exactly as before) and
          its communities from `wsfMyCommunities` (which lists only this
          account's active memberships). A read from this load is reused; a
          cold link reads them.
        */
        const [listed, mine] = await Promise.all([
          readGoals<ListedGoal>(user.uid, groupIdHint, SAME_LOAD_MS),
          readMyCommunities(user.uid, SAME_LOAD_MS),
        ]);
        if (cancelled) return;
        const goal = listed.goals.find((g) => g.goalId === goalId);
        if (!goal) return;
        const name = mine.items.find((i) => i.groupId === groupIdHint)?.displayName;
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
        // An own-only receipt: the server no longer shows this account the
        // community's figures. What its record holds for that community goes.
        if (groupIdHint) forgetCommunity(owner, groupIdHint);
        attemptRef.current = null;
        setReviewCount(null);
        return;
      }
      // PERF-MOBILE-1: the account's record takes exactly what this confirmed
      // receipt states (src/memberReads.ts, `noteConfirmedContribution`).
      noteConfirmedContribution(owner, {
        goalId: startedGoal,
        groupId: groupIdHint,
        ownCredit: data.ownCredit,
        sharedTotal: data.sharedTotal,
        target: data.target,
        unit: data.unit,
        status: data.status,
      });
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
    [goalId, groupIdHint]
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

    if (!attemptRef.current) attemptRef.current = takeRoundAttemptId() ?? mintAttemptId();
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
  }, [state, submitting, reviewCount, goalId, uid, sendContribute, takeRoundAttemptId]);

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
  /*
    WHICH SCREENS A SESSION MAY END ITSELF FROM. The rule is in
    src/kioskSession.ts, where it can be read and tested without mounting this
    screen; these are the three facts it decides from.

    `loadSettled` is the part this screen used to be missing. A goal that
    closed, one that cannot be found and a load that failed are screens where
    nothing further happens without somebody acting -- and they carried a
    manual Finish with no deadline, so a shared device left on one of them
    stayed exactly as the last visitor left it.

    `attemptInFlight` is stricter than the condition it replaces: a submission
    in progress now refuses the deadline as well as a stored row still in
    `sending`, so the timer can never fire out from under a request that has
    not answered.
  */
  const kioskAttemptInFlight = submitting || (pending != null && pending.state === 'sending');
  const kioskLoadSettled =
    state.kind === 'closed' || state.kind === 'notFound' || state.kind === 'error';
  const kioskTerminal =
    kiosk &&
    kioskMayFinishUnattended({
      outcome: kioskOutcome,
      attemptInFlight: kioskAttemptInFlight,
      loadSettled: kioskLoadSettled,
    });
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
  /*
    CLOSE TRAVELS OUT, THEN GOES BACK. It returns exactly where the Back of
    the page flow does (`returnToMemberContext`: the tab the member pressed
    MOVE on, with its scroll, or the MOVE chooser), after the reference's
    180 ms exit. One press is one exit: Close, Escape and the scrim pressed
    together still pop once. Reduced motion goes straight there.
  */
  const closeSheet = () => exitSheet(() => returnToMemberContext(backHref));
  closeSheetRef.current = closeSheet;
  /*
    THE RECEIPT ON A SHORT PHONE. The mark was sized from WIDTH alone, so on a
    390x640 the celebration filled the viewport and pushed "Record more" and
    "Back to community" below the fold -- the member is congratulated and then
    has to go looking for the way on. The rhythm gives on a short screen and
    the emotional core does not: the mark shrinks, it does not disappear.
  */
  const heroWeWidth = Math.max(
    96,
    Math.min(windowHeight < 700 ? 118 : 280, windowWidth - 2 * 20 - 2 * 22),
  );
  /*
    THE ANCHOR AT 195px. A fixed 88px mark beside a text column overflowed the
    card at the narrowest supported width -- ui-a11y R1 and ui-qa caught it,
    the same way they caught Home's fixed-size bloom. The mark is sized from
    what is actually available, and below 260px the row becomes a column so
    the text gets the whole width instead of a sliver.
  */
  const anchorStacked = windowWidth < 260;
  /*
    THE ANCHOR GIVES ON A SHORT PHONE. Captured honestly from the top, a
    390x640 still had the primary action under the tab bar. The anchor is
    CONTEXT -- who and what this counts toward -- so it is what yields: a
    smaller mark, tighter padding, and the freshness line dropped. The
    community, the goal, the total, the track and the status line all stay,
    because those are the context itself rather than its trim.
  */
  const anchorShort = windowHeight < 700;
  const contextWeWidth = Math.max(
    56,
    Math.min(anchorShort ? 66 : 88, windowWidth - 2 * 20 - 2 * 16 - (anchorStacked ? 0 : 130)),
  );

  /*
    One string for "which screen am I looking at", so the reset fires on every
    transition between them and on none of the polls in between.
  */
  const renderedPhase = [
    state.kind,
    step,
    lastResult ? 'result' : '',
    refusal ? 'refused' : '',
    pending?.state ?? '',
  ].join(':');
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [renderedPhase]);
  // In MOVE's sheet: focus enters the panel on Close, Tab stays in the panel,
  // and a step that replaces the member's step re-orients focus inside it.
  useSheetFocusContainment(sheetPanelRef, asSheet, asSheet ? renderedPhase : null);

  const renderChrome = (showBack: boolean, tone: 'light' | 'dark' = 'light') =>
    // In the sheet, its own header carries the title and Close: a wordmark and
    // a Back inside it would be a second masthead over the member's own tab.
    asSheet ? null : (
    <View style={styles.chrome}>
      <WsfWordmark
        variant={tone === 'dark' ? 'white' : 'navy'}
        height={22}
        testID="wsf-contribute-wordmark"
      />
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
          {/* NAVY ON NAVY WAS INVISIBLE. The ordinary Back link below already
              switches to the dark colourway; the kiosk's Finish did not, so on
              the navy receipt the one control in the chrome rendered at the
              background's exact colour. Measured on the delivered frame: the
              whole right half of the chrome band was rgb(11,31,58). */}
          <Text style={[styles.chromeLinkText, tone === 'dark' ? styles.chromeLinkTextDark : null]}>
            {kioskFinishing ? 'Finishing…' : 'Finish'}
          </Text>
        </Pressable>
      ) : showBack ? (
        /*
          BACK POPS THE FOCUSED FLOW; IT DOES NOT NAVIGATE TO A COPY OF WHERE
          YOU CAME FROM.

          This was a `ButtonLink` to `/community/<groupId>`. Under the member
          shell the contribution screen is a focused route presented OVER the
          tab navigator, so following that href pushed a SECOND community
          screen and left the original mounted but hidden behind it — measured:
          two instances in the document, the visible one without the marker the
          test had planted on the tab the member actually came from. The member
          did not come back to their community; they arrived at another copy of
          it, with its scroll and its loaded state reset.

          So when there is a focused route to pop, this pops it and reveals the
          exact instance underneath. `router.canGoBack()` is the question that
          distinguishes the two journeys, and it is asked at press time rather
          than at render, because whether there is something to go back to is a
          property of the moment the member presses.

          THE COLD / DEEP-LINK JOURNEY KEEPS ITS EXPLICIT DESTINATION. Somebody
          who opened this URL directly has nothing beneath it, so `canGoBack()`
          is false and the fallback navigates to the canonical destination —
          `replace`, not `push`, because a contribution screen arrived at cold
          is not somewhere a member should have to press back through.

          NOTHING ABOUT KIOSK CHANGES. A kiosk session renders `Finish` instead
          of this control (`showBack` is false there), so neither branch is
          reachable in kiosk mode and the confinement, deadline and
          unresolved-attempt behaviour are untouched.

          IT SAYS "Back", NOT WHERE. Warm, it returns to whatever opened this
          screen, and that need not be the community: MOVE opened from You
          returns to You (measured). Only the outcome exits, which really do go
          to the community or Home (`leaveFor`), name a place (Director #474
          `5824349240`).
        */
        <Pressable
          style={styles.chromeLink}
          testID="wsf-contribute-back"
          accessibilityRole="link"
          accessibilityLabel="Back"
          onPress={() => returnToMemberContext(backHref)}
          {...enterActivates(() => returnToMemberContext(backHref))}
        >
          <Text style={[styles.chromeLinkText, tone === 'dark' ? styles.chromeLinkTextDark : null]}>
            Back
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  // The prominent end-of-session control, shown on every screen a kiosk
  // session can come to rest on. It carries the countdown that performs the
  // same Finish when nobody is standing there, and — when the outcome is
  // UNKNOWN — the one sentence the visitor needs before they walk away.
  /**
   * `canRetryHere` is not a style choice. The accepted unresolved notice points
   * at "Confirm this contribution", and a screen has to be able to keep that
   * promise: the load-error branch returns BEFORE the pending one, so it can
   * show an unresolved session with no reconcile control on it at all. Screens
   * that offer the retry say so; the one that cannot says why instead.
   */
  const renderKioskFinish = (
    outcome: KioskOutcome,
    tone: 'light' | 'dark' = 'light',
    canRetryHere = true
  ) =>
    kiosk ? (
      <View style={styles.kioskBar} testID="wsf-kiosk-finish-bar">
        {outcome === 'unresolved' ? (
          <Text style={styles.kioskNotice} testID="wsf-kiosk-unresolved-note">
            {canRetryHere ? KIOSK_UNRESOLVED_NOTICE : KIOSK_UNRESOLVED_NOTICE_NO_RETRY}
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
        {/* These two lines are the instructions: what Finish does to the
            visitor's account, and how long they have. On a shared device that
            is not decoration, so on the navy screen they take the same muted
            colourway the kiosk's own display uses rather than the light one. */}
        <Text
          style={[styles.caption, tone === 'dark' ? styles.captionOnDark : null]}
          testID="wsf-kiosk-finish-explainer"
        >
          Finish signs you out and returns this device to its start screen.
        </Text>
        <View style={styles.kioskCountdownRow}>
          {/* D-2. The countdown changes without anybody acting, so it
              announces itself politely rather than interrupting. */}
          <Text
            style={[styles.caption, tone === 'dark' ? styles.captionOnDark : null]}
            testID="wsf-kiosk-countdown"
            aria-live="polite"
          >
            {kioskCountdownLabel(kioskRemainingSeconds(kioskRemaining))}
          </Text>
          <Pressable
            onPress={() => setKioskStay((n) => n + 1)}
            accessibilityRole="button"
            style={styles.tertiaryButton}
            testID="wsf-kiosk-stay"
          >
            {/* On the navy receipt this was navy on navy: present, focusable
                and operable, and invisible. Measured at a contrast ratio of
                1:1 on the delivered Board 11 frames. */}
            <Text style={[styles.tertiaryButtonText, tone === 'dark' ? styles.tertiaryButtonTextDark : null]}>
              Stay
            </Text>
          </Pressable>
        </View>
        {/* The one string on a shared device that has to be read: the device
            did not sign the last visitor out. At #8A1C1C on navy it measured
            1.47:1 -- present, and barely readable. */}
        {kioskError ? (
          <Text
            style={[styles.kioskError, tone === 'dark' ? styles.kioskErrorDark : null]}
            testID="wsf-kiosk-finish-error"
            aria-live="polite"
          >
            {kioskError}
          </Text>
        ) : null}
      </View>
    ) : null;

  /*
    RECOVERY-PORT-1. THE RECOVERY STATES SIT ON ONE SURFACE, AS THE ACCEPTED
    REFERENCE DRAWS THEM (Lovable `02cb35c4`, `move.tsx` / `ui.tsx`): a white
    sheet with a header that names what it holds, a hairline under it, then the
    step. The reference is a bottom sheet over Home; this route is a whole
    screen, so the sheet is a surface on the page rather than an overlay, and
    it has no Close in its header -- the ways out stay the route's own labelled
    exits (Director ruling `5821650392` §3, recorded as a difference on #474).
  */
  /*
    In MOVE's sheet the step's title moves up into the sheet's own header,
    beside Close, as the reference draws it: one surface, one header. The
    branch below names its title while it builds its children, and `screen()`
    reads it when it wraps them -- both in the same render, in that order.
  */
  let sheetTitle = params.mode === 'move' ? 'Start moving' : 'Already moved';
  const renderSheetHead = (title: string) => {
    sheetTitle = title;
    return asSheet ? null : (
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>{title}</Text>
      </View>
    );
  };

  const renderTestNote = () =>
    wsfUsingEmulators ? (
      <Text style={styles.testNote} testID="wsf-contribute-test-banner">
        Sample data
      </Text>
    ) : null;

  // The community/goal labels, shown together only when verified.
  /**
   * `tone: 'dark'` paints the WHOLE page navy rather than putting a navy card
   * on cream. The confirmed receipt is the one screen that earns it: a
   * celebration inside a card is a card, and the approved target has the
   * moment owning the screen.
   */
  const screen = (children: React.ReactNode, testID?: string, tone: 'light' | 'dark' = 'light') =>
    asSheet ? (
      /*
        THE SHEET. The scrim is the whole viewport, which is what keeps the
        tab behind from being touched as well as what dims it; pressing it is
        Close. It is not a stop in the keyboard order -- Close is. The panel
        is bounded, so the member's tab stays identifiable above it, and it
        takes the step's tone: the confirmed receipt is navy here too.
      */
      <View ref={sheetRef} style={styles.sheetRoot} testID="wsf-contribute-sheet">
        <Pressable
          style={[styles.sheetScrim, overMoveSheet ? styles.sheetScrimClear : null]}
          onPress={closeSheet}
          {...SCRIM_PROPS}
          testID="wsf-contribute-scrim"
          {...(sheetData('scrim', sheetPhase === 'out' ? 'out' : sheetHandoff ? 'rest' : 'in') as object)}
        />
        <View
          ref={sheetPanelRef}
          style={[
            styles.sheetPanel,
            tone === 'dark' ? styles.sheetPanelDark : null,
            { paddingBottom: safeArea.bottom + 8 },
          ]}
          testID="wsf-contribute-sheet-panel"
          {...({ role: 'dialog', 'aria-modal': true, 'aria-label': sheetTitle } as Record<string, unknown>)}
          {...(sheetData('panel', sheetPhase) as object)}
        >
          <View style={[styles.sheetBar, tone === 'dark' ? styles.sheetBarDark : null]}>
            <View pointerEvents="none" style={styles.sheetGrabber} />
            <Text
              style={[styles.sheetBarTitle, tone === 'dark' ? styles.sheetBarTitleDark : null]}
              testID="wsf-contribute-sheet-title"
              numberOfLines={1}
            >
              {sheetTitle}
            </Text>
            {/*
              CLOSE, NOT A DESTINATION. It returns to whatever the sheet is
              over. Its own testID: `wsf-contribute-back` stays the name of
              the page flow's Back and of the outcome exits ("Back to
              community" / "Back to home"), which the receipt still carries
              inside this sheet. One name for two different controls on one
              screen made "the exit" ambiguous (measured: a receipt spec
              reading the first `wsf-contribute-back` got "Close").
            */}
            <Pressable
              onPress={closeSheet}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.sheetClose}
              testID="wsf-contribute-close"
            >
              <Text style={[styles.sheetCloseText, tone === 'dark' ? styles.sheetCloseTextDark : null]}>
                Close
              </Text>
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.sheetScroll}
            contentContainerStyle={[
              styles.container,
              styles.sheetContainer,
              tone === 'dark' ? styles.containerDark : null,
            ]}
            keyboardShouldPersistTaps="handled"
            testID={testID}
          >
            <View style={styles.inner}>{children}</View>
          </ScrollView>
        </View>
      </View>
    ) : (
    /*
      The wrapper paints the band below the scroll view in the screen's own
      tone, so the raised action sits on the page's ground exactly as it did
      when the scroll view ran underneath it -- the receipt stays navy to the
      bar's edge -- and only the overlap is gone.
    */
    <View style={[styles.screen, tone === 'dark' ? styles.screenDark : null]}>
      <ScrollView
        ref={scrollRef}
        style={[
          styles.scroll,
          tone === 'dark' ? styles.scrollDark : null,
          shellBarShown ? styles.scrollAboveMove : null,
        ]}
        contentContainerStyle={[styles.container, tone === 'dark' ? styles.containerDark : null]}
        keyboardShouldPersistTaps="handled"
        testID={testID}
      >
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </View>
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
          {/* NOT ON A SHARED DEVICE. "Back to home" is the member home of the
              account signed in right now, so on a kiosk it is a door out of the
              session and into somebody's account for whoever walks up next.
              What the kiosk gets instead is the same end-of-session treatment
              every other settled screen has: Finish, its sentence, and the
              90-second deadline that performs it when nobody is standing here.
              The outcome passed is the LIVE one, not a hardcoded `none`: this
              branch returns before the pending ones, so a load failure can
              coincide with an unresolved attempt, and finishing as `none`
              would erase the reminder that attempt exists. */}
          {kiosk ? (
            renderKioskFinish(kioskOutcome, 'light', false)
          ) : (
            <ReturnButton
              href="/"
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              testID="wsf-contribute-home"
              label="Back to home"
            />
          )}
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
  /**
   * The goal as the anchor needs it, available to EVERY screen below rather
   * than only to the ones that run after `const pulse`. A refusal or an
   * unknown outcome can render with no goal loaded at all, and the anchor has
   * to say nothing then rather than throw.
   */
  const anchorPulse = state.kind === 'ready' || state.kind === 'closed' ? state.pulse : null;
  const anchorOwnCredit =
    state.kind === 'ready' || state.kind === 'closed' ? state.ownCredit : 0;
  const effortLabel = (count: number, u: string | null) =>
    u ? `${formatCount(count)} ${u}` : formatCount(count);

  const ownCreditLine = (value: number, u: string | null) => (
    <Text style={styles.ownCredit} testID="wsf-contribute-own-credit">
      {`Your total on this goal: ${effortLabel(value, u)}`}
    </Text>
  );

  /**
   * THE GOAL ANCHOR. One navy panel that every screen in this flow opens on:
   * the community, the goal, the Living WE at the CONFIRMED total, the total
   * itself, a track at the ratio the mark fills by, and the shipped status
   * line. It replaces a pale context label stacked on a pale progress row.
   *
   * WHY IT IS HERE AT ALL. The number a member types is a number inside a
   * community's effort, and the screen used to say so in two grey lines above
   * a form. The panel is the context, the brand's own mark doing work no card
   * can do, and -- on a tall phone -- real content where a spacer used to be.
   *
   * Every testID the old two-part context carried is carried here, so the
   * specs that assert this screen's truth keep asserting it.
   */
  const renderGoalAnchor = (opts: { status?: 'active' | 'closed' } = {}) => {
    const p = anchorPulse;
    if (!p) return null;
    return (
    <View
      style={[
        styles.anchor,
        anchorShort ? styles.anchorShort : null,
        anchorStacked ? styles.anchorStacked : null,
      ]}
      testID="wsf-contribute-context"
    >
      <View pointerEvents="none" style={styles.anchorGlow} />
      <View style={styles.anchorWe}>
        <LivingWeProgress
          completed={p.sharedTotal}
          target={p.target}
          unit={p.unit}
          width={contextWeWidth}
          surface="dark"
          testID="wsf-contribute-context-we"
        />
      </View>
      <View style={styles.anchorText}>
        {context.kind === 'verified' ? (
          <Text style={styles.anchorEyebrow} testID="wsf-contribute-community">
            {context.communityName}
          </Text>
        ) : null}
        {context.kind === 'verified' ? (
          <Text style={styles.anchorTitle} numberOfLines={2} testID="wsf-contribute-goal-title">
            {context.goalTitle}
          </Text>
        ) : null}
        <Text style={styles.anchorTotal} testID="wsf-contribute-shared-total">
          {totalOfTargetLabel(p.sharedTotal, p.target, p.unit)}
        </Text>
        <View style={styles.anchorTrack}>
          <View
            style={[
              styles.anchorTrackFill,
              { width: `${fillRatio(p.sharedTotal, p.target) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.anchorPercent} testID="wsf-contribute-context-percent">
          {`${percentLabel(p.sharedTotal, p.target)} complete`}
        </Text>
        <Text style={styles.anchorStatusLine}>
          {statusLine(p.sharedTotal, p.target, opts.status ?? p.status)}
        </Text>
        {/*
          A6. The total is live (a 2s poll), so it needs the same "as of"
          honesty Community Home and the public display carry. No refresh
          control: nothing here is waiting to be asked.
        */}
        {pulseAt && !anchorShort ? (
          <Text style={styles.anchorUpdated} testID="wsf-contribute-context-updated">
            {`Confirmed ${formatClock(pulseAt)}`}
          </Text>
        ) : null}
      </View>
    </View>
    );
  };

  /**
   * THE MEMBER'S OWN PART, AND ONLY THAT.
   *
   * The owner board previews the SHARED total a contribution would produce.
   * It cannot: another member may be writing in the same moment, and the only
   * authority on the shared total is the receipt. What nobody else's write can
   * change is this member's own credit on this goal, so that is what is
   * previewed -- before and after -- with the community's confirmed total
   * stated separately, as it is, in the anchor above.
   */
  const renderYourPart = (pending: number | null) => (
    <View style={styles.yoursPanel} testID="wsf-contribute-your-part">
      <Text style={styles.yoursLabel}>Your part on this goal</Text>
      <View style={styles.yoursRow}>
        <Text style={styles.yoursNow}>{formatCount(anchorOwnCredit)}</Text>
        {pending != null && pending > 0 ? (
          <>
            <Text style={styles.yoursArrow}>→</Text>
            <Text style={styles.yoursNext} testID="wsf-contribute-your-part-next">
              {formatCount(anchorOwnCredit + pending)}
            </Text>
          </>
        ) : null}
        <Text style={styles.yoursUnit}>{unitKnown ?? ''}</Text>
      </View>
      {/* The shipped sentence, unchanged and still addressable. */}
      {ownCreditLine(anchorOwnCredit, unitKnown)}
      {windowHeight < 700 ? null : (
        <Text style={styles.yoursNote}>
          Private to you. The community total above is what everyone sees.
        </Text>
      )}
    </View>
  );

  // ---- confirmed result: the signature moment -------------------------------
  if (lastResult) {
    const r = lastResult;
    const variant = resultVariant(r, sharedBeforeRef.current);
    const copy = resultCopy(r, communityName, unitKnown, sharedBeforeRef.current);
    const hasShared = variant !== 'ownOnly';
    const ownUnit = hasShared ? r.unit : (r.unit ?? unitKnown);
    const addMore = canAddMore(repeatPolicy, r);
    /*
      RECOVERY-PORT-1. THE RECEIPT IN THE REFERENCE'S ORDER: what was recorded
      (a badge, then the addition as the heading), the member's own numbers
      (their addition and their total in this goal, side by side), the
      community's standing in a navy panel with the Living WE, and then the way
      on. It was a whole navy page with the member's own total as a caption
      under everything; the reference puts the member's part before the
      community's, and the one navy object on the sheet is the shared one.

      Every figure is the server's own, from this receipt: `addedCount`,
      `ownCredit`, `sharedTotal` / `target` / `unit` / `status`. An own-only
      receipt (membership lost) has no shared fields, so it has no panel, no
      standing and no community -- exactly what it lacked before.
    */
    // Below 360px the column beside the mark is too narrow for a seven-digit
    // total, which would break inside the number; the panel stacks instead.
    const panelStacked = windowWidth < 360;
    const receiptWeWidth = windowHeight < 700 ? 96 : 104;
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.sheet}>
          {renderSheetHead('Contribution receipt')}
          <View
            style={[styles.sheetBody, windowHeight < 700 ? styles.sheetBodyShort : null]}
            testID="wsf-contribute-receipt"
            // D-2. The outcome replaces the form in place rather than by
            // navigating, so the receipt has to announce itself.
            aria-live="polite"
            {...({ dataSet: { variant } } as Record<string, unknown>)}
          >
            <View style={styles.badge}>
              <View style={styles.badgeCheck} />
              <Text style={styles.badgeText}>{r.alreadyRecorded ? 'Already recorded' : 'Recorded'}</Text>
            </View>
            <Text style={styles.stepHeading} testID="wsf-contribute-result-headline" {...HEADING_1}>
              {copy.headline}
            </Text>
            <Text style={styles.receiptSubline} testID="wsf-contribute-result-subline">
              {copy.subline}
            </Text>
            <View style={styles.tiles}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>Your addition</Text>
                {/* The exact number recorded -- theirs, not the community's. */}
                <Text style={styles.tileValue} testID="wsf-contribute-result-amount">
                  {r.alreadyRecorded ? formatCount(r.addedCount) : `+${formatCount(r.addedCount)}`}
                </Text>
              </View>
              {/* The shipped sentence, kept whole under its testID: the label
                  and the figure are one line for every reader and spec. */}
              <View style={styles.tile} testID="wsf-contribute-own-credit">
                <Text style={styles.tileLabel}>{'Your total on this goal: '}</Text>
                <Text style={styles.tileValue}>
                  {formatCount(r.ownCredit)}
                  {ownUnit ? <Text style={styles.tileUnit}>{` ${ownUnit}`}</Text> : null}
                </Text>
              </View>
            </View>
            {hasShared ? (
              <>
                <View style={[styles.sharedPanel, panelStacked ? styles.sharedPanelStacked : null]}>
                  <View style={styles.sharedWe}>
                    <LivingWeProgress
                      completed={r.sharedTotal}
                      target={r.target}
                      unit={r.unit}
                      width={receiptWeWidth}
                      surface="dark"
                      testID="wsf-contribute-we"
                    />
                  </View>
                  <View style={styles.sharedText}>
                    <Text style={styles.sharedLabel}>
                      {context.kind === 'verified' ? `Shared total · ${context.goalTitle}` : 'Shared total'}
                    </Text>
                    <Text style={styles.sharedTotal} testID="wsf-contribute-shared-total">
                      <Text style={styles.sharedCount}>
                        {totalOfTargetParts(r.sharedTotal, r.target, r.unit).count}
                      </Text>
                      {' '}
                      <Text style={styles.sharedRest}>
                        {totalOfTargetParts(r.sharedTotal, r.target, r.unit).rest}
                      </Text>
                    </Text>
                    <View style={styles.sharedTrack}>
                      <View
                        style={[
                          styles.sharedTrackFill,
                          { width: `${fillRatio(r.sharedTotal, r.target) * 100}%` },
                        ]}
                      />
                    </View>
                    <View style={styles.sharedMeta}>
                      <Text style={styles.sharedPercent} testID="wsf-contribute-percent">
                        {`${percentLabel(r.sharedTotal, r.target)} complete`}
                      </Text>
                      <Text
                        style={[
                          styles.sharedStatus,
                          progressPhase(r.sharedTotal, r.target, r.status) === 'nearGoal'
                            ? styles.sharedStatusNear
                            : null,
                        ]}
                        testID="wsf-contribute-status"
                      >
                        {statusLine(r.sharedTotal, r.target, r.status)}
                      </Text>
                    </View>
                  </View>
                </View>
                {copy.standing ? (
                  <Text style={styles.stepBody} testID="wsf-contribute-result-standing">
                    {copy.standing}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          {/* The receipt carries its own numbers; the anchor would repeat them. */}
          <View style={[styles.sheetActions, windowHeight < 700 ? styles.sheetActionsShort : null]}>
            {kiosk ? (
              renderKioskFinish('confirmed')
            ) : (
              /*
                REPEAT POLICY. The goal now publishes one, so the result can offer
                a second contribution where the server will actually accept it --
                'multiple', goal still active, and a receipt that carried shared
                state. Under 'once' this is absent and the result ends where it
                always did.

                RECOVERY-PORT-1. The reference ends its receipt on one green
                action, the way back to the community, with the other choice
                beside it in outline. The labelled exit is that action here; the
                offer to record more is the outlined one.
              */
              <View style={styles.pair}>
                {addMore ? (
                  <Pressable
                    onPress={onAddMore}
                    accessibilityRole="button"
                    style={[
                      styles.secondaryButton,
                      styles.pairButton,
                      windowHeight < 700 ? styles.pairButtonShort : null,
                    ]}
                    testID="wsf-contribute-record-more"
                  >
                    <Text style={styles.secondaryButtonText}>
                      {recordMoreLabel(hasShared ? r.unit : unitKnown)}
                    </Text>
                  </Pressable>
                ) : null}
                <ReturnButton
                  href={hasShared ? backHref : '/'}
                  style={[
                    styles.primaryButton,
                    styles.pairButton,
                    windowHeight < 700 && addMore ? styles.pairButtonShort : null,
                  ]}
                  textStyle={styles.primaryButtonText}
                  testID="wsf-contribute-back"
                  label={hasShared ? backLabel : 'Back to home'}
                />
              </View>
            )}
          </View>
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
        {renderGoalAnchor()}
        {/* RECOVERY-PORT-1. The same sheet as the other outcomes; the words,
            the controls and where they go are unchanged. */}
        <View
          style={styles.sheet}
          testID="wsf-contribute-refused"
          aria-live="polite"
          {...({ dataSet: { reason: refusal.reason } } as Record<string, unknown>)}
        >
          {renderSheetHead('Your attempt')}
          <View style={styles.sheetBody}>
          <Text style={styles.eyebrowMuted}>Not recorded</Text>
          <Text style={styles.stepHeading} testID="wsf-contribute-refused-headline" {...HEADING_1}>
            {copy.headline}
          </Text>
          <Text style={styles.stepBody} testID="wsf-contribute-refused-body">
            {copy.body}
          </Text>
          <View style={styles.sheetActionsInline}>
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
              refusal.reason === 'signedOut' ? (
                <ButtonLink
                  href="/signin"
                  style={styles.primaryButton}
                  textStyle={styles.primaryButtonText}
                  testID="wsf-contribute-back"
                  label="Sign in"
                />
              ) : (
                <ReturnButton
                  href={backHref}
                  style={refusal.reason === 'invalid' ? styles.secondaryButton : styles.primaryButton}
                  textStyle={refusal.reason === 'invalid' ? styles.secondaryButtonText : styles.primaryButtonText}
                  testID="wsf-contribute-back"
                  label={backLabel}
                />
              )
            )}
          </View>
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
        <View style={styles.sheet} testID="wsf-contribute-recording" aria-live="polite">
          {renderSheetHead('Your attempt')}
          <View style={styles.sheetBody}>
            <ActivityIndicator color={NAVY} size="large" />
            <Text style={styles.stepHeading} {...HEADING_1}>Recording your contribution…</Text>
            <Text style={styles.stepBody}>{effortLabel(pending.count, unitKnown)}</Text>
          </View>
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
        {/*
          NO ANCHOR HERE, DELIBERATELY. The anchor paints the shared total, and
          on an unknown outcome this screen must not narrate one: the member's
          effort may or may not be inside it, the poll is switched off for the
          whole unknown period on purpose, and a total shown beside "we don't
          know whether this was recorded" invites exactly the arithmetic the
          member cannot safely do. The target drew the anchor here; that was
          wrong, and ui-contribute-torture-2 caught it.
        */}
        {/*
          RECOVERY-PORT-1. THE REFERENCE'S ORDER, ON THE ACCEPTED WORDS: a plain
          title, the attempt that is kept and its amount, the one sentence about
          what is and is not known, ONE action, and the honest caption under it.

          THE REFERENCE'S TRUTH IS NOT PORTED WITH ITS SHAPE (Director ruling
          `5821650392` §1). Its button reads a simulated ledger and cannot
          write; ours sends the same attempt again, which records it if it never
          landed. So the words stay the canonical ones: nothing here says the
          shared total is untouched, nothing offers to discard the attempt, and
          nothing says "nothing was counted" -- none of that is known.
        */}
        <View style={styles.sheet} testID="wsf-contribute-pending" aria-live="polite">
          {renderSheetHead('Your attempt')}
          <View style={styles.sheetBody}>
            <Text style={styles.stepHeading} {...HEADING_1}>We couldn’t confirm your contribution yet.</Text>
            <Text style={styles.stepBody} testID="wsf-contribute-pending-count">
              {'You entered '}
              <Text style={styles.pendingAmount}>{effortLabel(pending.count, unitKnown)}</Text>
              {'.'}
            </Text>
            <Text style={styles.stepBody}>
              We don’t know whether this effort was recorded. Don’t record it again.
            </Text>
            <View style={styles.sheetActionsInline}>
              <Pressable
                onPress={onReconcile}
                disabled={submitting}
                accessibilityRole="button"
                style={styles.primaryButton}
                testID="wsf-contribute-reconcile"
              >
                <Text style={styles.primaryButtonText}>Confirm this contribution</Text>
              </Pressable>
            </View>
            <Text style={styles.stepBody}>
              This sends the same attempt again. If it already reached us, it will not count twice.
            </Text>
            {/* Not true on a shared device: the visitor is about to be signed
                out of it. The kiosk says where the attempt actually is instead
                (KIOSK_UNRESOLVED_NOTICE, on the Finish bar below). */}
            {kiosk ? null : (
              <Text style={styles.stepBody}>
                You can leave this page. The same attempt will be here when you come back.
              </Text>
            )}
          </View>
        </View>
        <View style={styles.actions}>
          {kiosk ? (
            renderKioskFinish('unresolved')
          ) : (
            <ReturnButton
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
          {/* NOT ON A SHARED DEVICE. "Back to home" is the member home of the
              account signed in right now, so on a kiosk it is a door out of the
              session and into somebody's account for whoever walks up next.
              What the kiosk gets instead is the same end-of-session treatment
              every other settled screen has: Finish, its sentence, and the
              90-second deadline that performs it when nobody is standing here.
              The outcome passed is the LIVE one, not a hardcoded `none`: this
              branch returns before the pending ones, so a load failure can
              coincide with an unresolved attempt, and finishing as `none`
              would erase the reminder that attempt exists. */}
          {kiosk ? (
            renderKioskFinish(kioskOutcome)
          ) : (
            <ReturnButton
              href="/"
              style={styles.secondaryButton}
              textStyle={styles.secondaryButtonText}
              testID="wsf-contribute-home"
              label="Back to home"
            />
          )}
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
  // ---- closed goal ------------------------------------------------------------
  if (state.kind === 'closed') {
    return screen(
      <>
        {renderChrome(false)}
        <View style={styles.hero} testID="wsf-contribute-closed">
          {context.kind === 'verified' ? (
            <Text style={styles.heroEyebrow} testID="wsf-contribute-community">
              {context.communityName}
            </Text>
          ) : null}
          {context.kind === 'verified' ? (
            <Text style={styles.closedGoalTitle} testID="wsf-contribute-goal-title">
              {context.goalTitle}
            </Text>
          ) : null}
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
          {/* Same door, same reason -- a goal can close while somebody is
              standing at the kiosk, and this link goes to the community of the
              account that is signed in. And the same replacement: a closed goal
              is a settled screen, so it gets the deadline too. */}
          {kiosk ? (
            renderKioskFinish(kioskOutcome)
          ) : (
            <ReturnButton
              href={backHref}
              style={styles.primaryButton}
              textStyle={styles.primaryButtonText}
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

  // ---- review ---------------------------------------------------------------
  if (step === 'review' && reviewCount != null) {
    return screen(
      <>
        {renderChrome(false)}
        {renderGoalAnchor()}
        {/*
          RECOVERY-PORT-1. The reference's review: a sheet named for the way in,
          the step as its heading, the amount in its own box with what it will
          be recorded as, then Edit and the green action side by side. The
          words, the controls and the no-write-before-Record boundary are
          unchanged.
        */}
        <View style={styles.sheet} testID="wsf-contribute-review-screen">
          {renderSheetHead(params.mode === 'move' ? 'Start moving' : 'Already moved')}
          <View style={styles.sheetBody}>
            <Text style={styles.stepHeading} {...HEADING_1}>Review your contribution</Text>
            <View style={styles.reviewBox}>
              <Text style={styles.reviewQuantity} testID="wsf-contribute-review-quantity">
                {formatCount(reviewCount)}
                <Text style={styles.reviewUnit}>{` ${unit}`}</Text>
              </Text>
              <Text style={styles.reviewNote} testID="wsf-contribute-repeat-notice">
                {repeatNotice(repeatPolicy)}
              </Text>
            </View>
            <View style={[styles.sheetActionsInline, styles.pair]}>
              <Pressable
                onPress={onEdit}
                disabled={submitting}
                accessibilityRole="button"
                style={[styles.secondaryButton, styles.pairButton]}
                testID="wsf-contribute-edit"
              >
                <Text style={styles.secondaryButtonText}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={onRecord}
                disabled={submitting}
                accessibilityRole="button"
                style={[styles.primaryButton, styles.pairButton]}
                testID="wsf-contribute-submit"
              >
                <Text style={styles.primaryButtonText}>{`Record ${formatCount(reviewCount)} ${unit}`}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        {renderYourPart(reviewCount)}
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
        {renderGoalAnchor()}
        <View style={styles.card} testID="wsf-contribute-move-screen">
          <Text style={styles.heading} {...HEADING_1}>Ready when you are.</Text>
          <Text style={styles.body}>
            {`Count your own ${unit}. When you’re finished, enter the number you completed.`}
          </Text>
          {/*
            SHORT PHONE. The timer is explicitly optional and explicitly does
            not record anything, so it is what the rhythm takes: a tighter box
            and a smaller clock, and the sentence explaining it goes. Without
            that, at 390x640 the screen's primary action sat 57px under the
            shell's bar -- visible, and not fully touchable.
          */}
          <View
            style={[styles.timerBox, windowHeight < 700 ? styles.timerBoxShort : null]}
            testID="wsf-contribute-timer"
          >
            <Text style={styles.eyebrowMuted}>Optional timer</Text>
            <Text
              style={[styles.timerClock, windowHeight < 700 ? styles.timerClockShort : null]}
              testID="wsf-contribute-timer-clock"
            >
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
            {windowHeight < 700 ? null : (
              <Text style={styles.caption}>
                For your own reference. It doesn’t record anything or change the community total.
              </Text>
            )}
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
        {/* Their own standing on this goal, before they have entered anything. */}
        {renderYourPart(null)}
        {renderTestNote()}
      </>,
      'wsf-contribute-screen'
    );
  }

  // ---- enter result -----------------------------------------------------------
  return screen(
    <>
      {renderChrome(true)}
      {renderGoalAnchor()}
      <View style={styles.card} testID="wsf-contribute-entry-screen">
        <Text style={styles.entryHeading} {...HEADING_1}>{`How many ${unit} did you complete?`}</Text>
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
              style={[styles.entryInput, windowHeight < 700 ? styles.entryInputShort : null]}
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
        {/*
          SHORT PHONE. The quick chips are convenience the stepper already
          covers, so they are what the rhythm takes first. Captured honestly
          from the top of the page, a 390x640 had "Review my contribution"
          below the fold with them in; it does not without. Never the number,
          the context or the action.
        */}
        <View style={[styles.quickRow, windowHeight < 700 ? styles.hidden : null]}>
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
        {/*
          SHORT PHONE. The unit is already in the question above ("How many
          squats did you complete?") and in the panel below ("0 -> 20 squats"),
          so this line is the redundant one at 390x640 -- and dropping it is
          what puts the primary action fully clear of the shell's bar.
        */}
        {windowHeight < 700 ? null : (
          <Text style={styles.countedIn} testID="wsf-contribute-counted-in">
            Counted in <Text style={styles.countedInUnit}>{unit}</Text> · this goal
          </Text>
        )}
        {renderYourPart(Number.isFinite(Number(entry)) ? Math.trunc(Number(entry)) : null)}
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
      {/*
        ONE CONFIGURED UNIT, SO NO CHOICE TO MAKE. A goal on this route has
        exactly one unit -- there is no activity list here and nothing to pick
        between, so the screen names what this counts toward and moves on. The
        several-activity case belongs to the combined goal, which is a
        different route and is not in this slice. The target drew a pair of
        movement tiles here; that was a choice the product does not offer, and
        drawing it would have taught the member a control that does not exist.
      */}
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

  // ---- MOVE's sheet (APP-FEEL-PARITY-1) ----------------------------------
  /* The route's own ground is transparent (set on the root stack), so the
     panel sits at the bottom with the member's tab above it. */
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  /* The same scrim as the MOVE resolver's sheet, so the hand-off between the
     two is one continuous dim rather than two. */
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,31,53,0.42)' },
  sheetScrimClear: { backgroundColor: 'transparent' },
  sheetPanel: {
    /* Tall enough for the count and its keypad on a 390x640, bounded so the
       tab behind stays identifiable. */
    maxHeight: '92%',
    backgroundColor: CREAM,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: '#E3E7E1',
    overflow: 'hidden',
    ...elevation.hero,
  },
  sheetPanelDark: { backgroundColor: NAVY, borderColor: NAVY },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingLeft: 20,
    paddingRight: 10,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E6E2DA',
  },
  sheetBarDark: { borderBottomColor: 'rgba(247,245,240,0.14)' },
  sheetGrabber: {
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E6E2DA',
  },
  sheetBarTitle: { flex: 1, color: NAVY, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  sheetBarTitleDark: { color: CREAM },
  /* 44x44 at least, the label centred in it: the target is the control. */
  sheetClose: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  sheetCloseTextDark: { color: CREAM },
  /* Grows to its content and no further; scrolls inside the panel beyond it. */
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContainer: { backgroundColor: 'transparent', paddingTop: 14, paddingBottom: 20 },

  screen: { flex: 1, backgroundColor: CREAM },
  screenDark: { backgroundColor: NAVY },
  scroll: { flex: 1, backgroundColor: CREAM },
  scrollDark: { backgroundColor: NAVY },
  // The scroll view ends where the raised MOVE action begins (see the note at
  // `shellBarShown`), so nothing scrollable is ever under the circle.
  scrollAboveMove: { marginBottom: MEMBER_TAB_MOVE_OVERHANG },
  containerDark: { backgroundColor: NAVY },
  container: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    // Ordinary end padding. The bar is below the scroll view, not over it,
    // so the content owes it nothing beyond its own rhythm.
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
  // ---- the goal anchor ---------------------------------------------------
  anchor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: NAVY,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    overflow: 'hidden',
    ...elevation.hero,
  },
  /*
    BOUND TO THE CARD'S WIDTH, NOT A FIXED CIRCLE.

    A 260px circle inside a card with overflow:hidden still REPORTS a 260px
    box, so at a 195px viewport the overflow checks saw an element past the
    right edge -- and they were right to: they cannot know the paint is
    clipped. Home's top light learned this first. left/right 0 means the
    decoration can never be wider than what contains it, at any width.
  */
  anchorGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -140,
    height: 240,
    borderBottomLeftRadius: 200,
    borderBottomRightRadius: 200,
    backgroundColor: 'rgba(145,203,125,0.09)',
  },
  anchorShort: { paddingVertical: 11, gap: 11 },
  anchorStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  anchorWe: { alignItems: 'center', justifyContent: 'center' },
  /* minWidth 0 lets the column shrink inside the row; without it a long goal
     title makes the flex child refuse to go below its content width and the
     card runs past the screen. */
  anchorText: { flex: 1, minWidth: 0, gap: 4 },
  anchorEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  anchorTitle: { color: CREAM, fontSize: 17, lineHeight: 21, fontWeight: '900', letterSpacing: -0.4 },
  anchorTotal: { color: CREAM, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  anchorTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
  },
  anchorTrackFill: { height: '100%', borderRadius: 999, backgroundColor: PROGRESS_GREEN },
  anchorPercent: { color: PROGRESS_GREEN, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },
  anchorStatusLine: { color: HERO_MUTED, fontSize: 11.5, lineHeight: 16 },
  anchorUpdated: { color: HERO_MUTED, fontSize: 11, lineHeight: 15, letterSpacing: 0.3 },

  // ---- the member's own part, previewed -----------------------------------
  yoursPanel: {
    backgroundColor: '#EFF9F1',
    borderWidth: 1.5,
    borderColor: '#CBEBD4',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  yoursLabel: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  yoursRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  yoursNow: { color: wsfTheme.colors.textMuted, fontSize: 20, fontWeight: '800' },
  yoursArrow: { color: '#15803D', fontSize: 17, fontWeight: '900' },
  yoursNext: { color: NAVY, fontSize: 27, fontWeight: '900', letterSpacing: -0.8 },
  yoursUnit: { color: wsfTheme.colors.textMuted, fontSize: 13, fontWeight: '700' },
  yoursNote: { color: wsfTheme.colors.textMuted, fontSize: 11.5, lineHeight: 16 },

  closedGoalTitle: { color: CREAM, fontSize: 20, fontWeight: '900', lineHeight: 26, textAlign: 'center' },
  hidden: { display: 'none' },
  countedIn: { color: wsfTheme.colors.textMuted, fontSize: 12.5, lineHeight: 17, fontWeight: '600' },
  countedInUnit: { color: '#15803D', fontWeight: '900' },

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
  // RECOVERY-PORT-1. The kept attempt's amount, bold inside its sentence, as
  // the reference sets "+20 squats" inside its paragraph.
  pendingAmount: { color: wsfTheme.colors.text, fontWeight: '700' },

  /* ---- RECOVERY-PORT-1: the sheet the recovery states sit on -------------
     Read off the frozen reference (Lovable `02cb35c4`, `styles.css` and the
     six recovery frames, measured): a white surface with an 18px top corner
     and an 8px bottom one; a header that names what it holds over a hairline;
     the step in a 24px regular heading; 14/21 muted sentences; one 54px green
     action. Tokens are this product's own (NAVY, CREAM, the kit's greens). */
  sheet: {
    backgroundColor: wsfTheme.colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    // Nothing inside paints into the corners, so nothing needs clipping, and
    // clipping cut the green action's shadow off at a hard edge.
    ...elevation.card,
  },
  sheetHead: {
    minHeight: 56,
    justifyContent: 'center',
    paddingTop: 13,
    paddingBottom: 10,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  sheetTitle: { color: wsfTheme.colors.text, fontSize: 22, lineHeight: 28, fontWeight: '400' },
  // 16 at the sides, not the reference's 20: the page already keeps 20 from
  // the screen's edge, where the reference's sheet keeps 12.
  sheetBody: { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 22, gap: 12 },
  // A short phone gives the sheet's air, never its content.
  sheetBodyShort: { paddingTop: 12, paddingBottom: 12, gap: 8 },
  sheetActions: { paddingHorizontal: 16, paddingBottom: 22 },
  sheetActionsShort: { paddingBottom: 14 },
  sheetActionsInline: { marginTop: 4, gap: 10 },
  stepHeading: { color: wsfTheme.colors.text, fontSize: 24, lineHeight: 27, fontWeight: '400' },
  stepBody: { color: wsfTheme.colors.textMuted, fontSize: 14, lineHeight: 21 },
  // Two actions share a row, the outline one first and the green one last, as
  // the reference sets them; below about 300px of room they stack.
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Each action is as wide as its label and the pair wraps when both labels
  // do not fit one row, so a label never breaks inside its button: the
  // review's Edit and Record share a row, the receipt's longer pair stacks.
  // react-native-web Views default to flexShrink 0, so it is set.
  pairButton: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, minHeight: 54, paddingHorizontal: 12 },
  // A short phone keeps the receipt's pair on one row even though its labels
  // then wrap: stacked, the way back would fall below a 640px screen.
  pairButtonShort: { flexBasis: 130, paddingHorizontal: 10 },

  // The receipt's badge: the reference's pill, carrying the canonical eyebrow.
  // Progress green at 30% on white is the reference's own badge colour.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(145,203,125,0.30)',
  },
  // A tick drawn from two borders, so nothing depends on a font's glyph.
  badgeCheck: {
    width: 6,
    height: 10,
    marginTop: -3,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: ON_ACTION,
    transform: [{ rotate: '45deg' }],
  },
  badgeText: {
    color: ON_ACTION,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  // On white the progress green is too pale to read; its deep action edge is not.
  receiptSubline: { color: ACTION_GREEN_DEEP, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexShrink: 1,
    // Two tiles side by side from about 150px each; narrower, they stack, so
    // a seven-digit figure never breaks inside itself.
    flexBasis: 150,
    minWidth: 0,
    backgroundColor: CREAM,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  tileLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tileValue: { color: NAVY, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  tileUnit: { color: wsfTheme.colors.textMuted, fontSize: 15, fontWeight: '700' },
  // The one navy object on the sheet is the community's: the Living WE beside
  // the shared total, its track and where it stands.
  sharedPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: NAVY,
    borderRadius: 14,
    padding: 14,
  },
  sharedPanelStacked: { flexDirection: 'column', alignItems: 'stretch', gap: 10 },
  sharedWe: { alignItems: 'center', justifyContent: 'center' },
  sharedText: { flex: 1, minWidth: 0, gap: 3 },
  sharedLabel: {
    color: HERO_MUTED,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sharedTotal: { color: CREAM },
  sharedCount: { color: CREAM, fontSize: 26, lineHeight: 32, fontWeight: '700' },
  sharedRest: { color: HERO_MUTED, fontSize: 13, fontWeight: '700' },
  sharedTrack: {
    height: 8,
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.18)',
    overflow: 'hidden',
  },
  sharedTrackFill: { height: '100%', borderRadius: 999, backgroundColor: PROGRESS_GREEN },
  sharedMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: 14,
    rowGap: 2,
    marginTop: 2,
  },
  sharedPercent: { color: PROGRESS_GREEN, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  sharedStatus: { color: HERO_MUTED, fontSize: 11, lineHeight: 15 },
  // A4. Same near-goal emphasis as Community Home's hero and the public
  // display: the last stretch is the one line worth leaning on.
  sharedStatusNear: { color: CREAM, fontWeight: '700' },

  // The review's amount in its own box, with what it will be recorded as.
  reviewBox: { backgroundColor: CREAM, borderRadius: 14, padding: 16, gap: 8 },
  reviewUnit: { color: wsfTheme.colors.textMuted, fontSize: 15, fontWeight: '800', letterSpacing: 0 },
  reviewNote: { color: wsfTheme.colors.textMuted, fontSize: 13, lineHeight: 19 },
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
  /* The card's lead, not a page title: the NUMBER is what the eye should
     land on here, and a 26px two-line question above it pushed the member's
     own part below the fold on a 390x844 phone. */
  entryHeading: {
    color: wsfTheme.colors.text,
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 25,
    letterSpacing: -0.2,
    textAlign: 'center',
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
  weWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 6 },
  heroFacts: { alignItems: 'center', gap: 2 },
  heroTotal: { color: CREAM, fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
  heroStatus: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  // A4. Same near-goal emphasis as Community Home's hero and the public
  // display: the last stretch is the one line worth leaning on.
  heroStatusNear: { color: CREAM, fontWeight: '700' },

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
  /* The number stays large enough to read at a glance; the BOX around it is
     what gives on a short phone, which is the last 30 points the primary
     action needed to clear the tab bar at 390x640. */
  entryInputShort: { minHeight: 56, fontSize: 34 },
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
  timerBoxShort: { padding: 10, gap: 4 },
  timerClock: { color: wsfTheme.colors.text, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerClockShort: { fontSize: 26 },
  timerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // buttons
  actions: { gap: 10, marginTop: 4 },
  // RECOVERY-PORT-1. The reference's action: 54 tall at a 12 corner (Home's).
  primaryButton: {
    backgroundColor: ACTION_GREEN,
    borderRadius: wsfTheme.radius.md,
    minHeight: 54,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  primaryButtonText: { color: ON_ACTION, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  secondaryButton: {
    alignSelf: 'stretch',
    backgroundColor: wsfTheme.colors.surface,
    borderWidth: 1.5,
    borderColor: NAVY,
    borderRadius: wsfTheme.radius.md,
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: NAVY, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  chromeLinkTextDark: { color: CREAM },
  /* The dark colourways for the kiosk's end-of-session controls. The light
     ones are unchanged: the unresolved and refusal screens are cream, and
     what reads there must keep reading there. */
  tertiaryButtonTextDark: { color: CREAM },
  /* The muted-on-navy the kiosk's own resting screen already uses. Measured
     composited over the navy it sits on, not as an unblended colour. */
  captionOnDark: { color: HERO_MUTED },
  kioskErrorDark: { color: '#FFB4AE' },

  tertiaryButton: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  tertiaryButtonText: { color: NAVY, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  testNote: { color: wsfTheme.colors.textMuted, fontSize: 11, textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase' },
});
