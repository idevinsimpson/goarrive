import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState, type SetStateAction } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  samePulse,
  type GoalPulse,
  type GoalRecentAddition,
  type GoalRecentAdditions,
} from '../../src/displayPulse';
import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { wsfTheme } from '../../src/theme';
import { PROGRESS_GREEN } from '../../src/ui/brandAssets';
import { formatActiveWindowLabel, formatClock, formatPeriod } from '../../src/ui/dates';
import {
  displayFreshnessSize,
  displayTier,
  displayTypeFactor,
  displayWeWidth,
  isWideTier,
} from '../../src/ui/displayLayout';
import { communityNameType, goalTitleType, totalLineType } from '../../src/ui/displayTypeScale';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import {
  formatCount,
  percentLabel,
  progressPhase,
  statusLine,
} from '../../src/ui/progressFormat';
import { additionLine } from '../../src/ui/relativeTime';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

type DisplayState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  // A transient failure before anything was ever confirmed: nothing to keep
  // on screen, and nothing to invent.
  | { kind: 'unreachable' }
  // `stale` is set when a later poll failed transiently. The confirmed values
  // and their receipt time stay exactly as they were; the screen just stops
  // presenting itself as current.
  | { kind: 'ready'; pulse: GoalPulse; confirmedAt: Date; stale: boolean };

// Polls wsfGoalPulse every 2 seconds. Matches the server-side 2s cache TTL
// so we do not pay a Firestore round-trip on every tick when multiple
// displays are pointed at the same goal.
const POLL_INTERVAL_MS = 2_000;

// The recent-additions list is fetched on the FIRST tick and then every fifth
// tick — once every 10 seconds, not once every 2. It is a second endpoint, so
// asking on every tick would have doubled this screen's request volume for a
// list that changes far more slowly than the total does; +20% is what it costs
// instead.
//
// The labels still move every minute without a request: they are computed from
// the device clock against the minute each addition carries, so the only thing
// a fetch brings is a NEW addition. A contribution therefore takes up to 10
// seconds to appear here, while the total it moved appears within 2. That is
// the intended trade for a list whose whole claim is "recently".
const RECENT_EVERY_N_TICKS = 5;

// At most five lines are shown of the ten the server keeps. The list is a
// glance at what is happening now, not a log to read down.
const RECENT_VISIBLE = 5;

export default function DisplayGoal() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = params.goalId;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // The static export renders the phone layout (no window at export time),
  // so the first client render must produce the same tree or React reports a
  // hydration mismatch (#418) and re-renders from scratch. The wide layout is
  // chosen only once hydrated; a wide display shows the phone loading card
  // for a single frame before its first poll answers.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  /*
    FOUR TIERS, NOT ONE BOOLEAN. `displayTier` is display-only and carries the
    reasoning; the two names below are what this file needs from it.

      wide      two columns on one axis  — booth and collective
      big       distance typography      — everything except a phone

    They are separate because PORTRAIT is the tier that has neither shape: one
    column like a phone, sized for a room like a booth. Keeping them apart is
    what stops a picture frame being handed the phone card, without handing a
    phone the frame's composition.
  */
  const tier = displayTier(windowWidth, windowHeight, hydrated);
  const wide = isWideTier(tier);
  const big = tier !== 'phone';
  /*
    Applied AFTER the stylesheet entry it refines, exactly like the
    length-tiered sizes below, so the wide styles stay the single source of
    the distance hierarchy and the room only scales it. 1 for booth and phone,
    so neither moves by a pixel.
  */
  const tf = displayTypeFactor(tier);
  const freshnessSize = displayFreshnessSize(tier);
  const roomType = (fontSize: number, lineHeight?: number) =>
    tf === 1
      ? null
      : {
          fontSize: Math.round(fontSize * tf),
          ...(lineHeight === undefined ? null : { lineHeight: Math.round(lineHeight * tf) }),
        };
  const [state, setState] = useState<DisplayState>({ kind: 'loading' });
  // Bumping this starts a brand-new polling session. It is the ONLY way to
  // recover from a refusal, and it exists so that recovery is an explicit act
  // rather than something an outstanding old response can perform.
  const [pollSession, setPollSession] = useState(0);
  // Null until an answer lands; the empty array is a real answer meaning
  // "nothing has happened", and both render nothing.
  const [recent, setRecent] = useState<GoalRecentAddition[] | null>(null);
  // The device's current minute. Held in state so the age labels move on their
  // own between fetches; stored as a MINUTE rather than an instant so an
  // unchanged minute is a state bail-out rather than a repaint every 2s.
  const [nowMinute, setNowMinute] = useState(() => Math.floor(Date.now() / 60_000));

  // A different goal is a different context. Clear what the previous goal put
  // on screen at once, rather than leaving its total up until the first
  // response for the new one lands.
  useEffect(() => {
    setState({ kind: 'loading' });
    setRecent(null);
  }, [goalId]);

  useEffect(() => {
    if (!goalId) {
      setState({ kind: 'notFound' });
      return;
    }
    // Scoped to this polling session rather than held in a ref across runs, so
    // a new goal id starts from a clean sequence and a stale run can never
    // resurrect itself.
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    // Ticks overlap: the poll fires every 2s but a request can take longer, so
    // responses are not guaranteed to arrive in the order they were sent.
    //
    // TWO SEPARATE RULES, because ordering alone is not enough.
    //
    // 1. ORDER. Each request carries the sequence it was issued with, and a
    //    response may only change the screen if it is newer than what is
    //    already rendered. This stops an earlier-issued success that arrives
    //    after a later-issued refusal from repainting the total.
    //
    // 2. A REFUSAL CLOSES THE SESSION. Issue order is not server processing
    //    order, so rule 1 does not cover the case where the refusal was issued
    //    FIRST and the success second: request 1 stalls before its
    //    authorization lookup, request 2 reaches the server while publication
    //    is still authorized and its success is held in flight, the Champion
    //    revokes, request 1 then runs and returns not-found. The refusal has a
    //    lower sequence, so under rule 1 alone the held success — with the
    //    higher sequence — would still be allowed to repaint the total.
    //
    //    Stopping the timer does not help: it prevents new requests, it does
    //    not invalidate outstanding ones. So a refusal marks the session
    //    CLOSED, and every outstanding response from that session is refused
    //    admission from that moment on, whatever sequence it carries.
    //
    // This is about what the running application renders once it has learned
    // that access is refused. It makes no claim about anything already
    // received elsewhere — a screenshot, a recording, a number someone wrote
    // down — which this application cannot reach and does not pretend to.
    //
    // Recovery is deliberately not automatic. A closed session stays closed;
    // getting back to a live display takes a fresh session, which only the
    // explicit re-check action below starts.
    let issued = 0;
    let applied = 0;
    let sessionClosed = false;

    // `next` may be a value OR an updater. The updater form is what lets an
    // unchanged tick return the state object already on screen: `applied`
    // still advances (the response WAS admitted, and an older one must still
    // be refused after it), but React sees the identical object and commits
    // nothing.
    const apply = (seq: number, next: SetStateAction<DisplayState>) => {
      if (cancelled) return false;
      if (sessionClosed) return false;
      if (seq <= applied) return false;
      applied = seq;
      setState(next);
      return true;
    };

    // NOT GUARDED AGAINST OVERLAP, deliberately. Skipping a tick while the
    // previous request is still outstanding would cost fewer requests behind
    // a slow server — but overlap is exactly what this screen's admission
    // rules exist for, and what proves them: a response held open from before
    // a revocation must be OVERTAKEN by a later poll that gets the refusal
    // (tests-e2e/e5-display-authorization.spec.ts, CASE 3 and CASE 4). With
    // one request at a time a held response wedges the poll until it settles,
    // the refusal never arrives, and a revoked display keeps showing a total
    // it is no longer entitled to. The contribution screen's poll has no such
    // rule and is guarded; this one is not.
    // The recent-additions read. It rides the pulse's session guards — a
    // closed session admits nothing from it either — but it is deliberately
    // NOT allowed to close that session or to touch `state`. A refusal here
    // empties the list and leaves the total alone; the pulse is the one read
    // that decides whether this screen may show anything at all, and a list
    // that failed for its own reasons must not be able to blank a total the
    // pulse is still confirming.
    let recentIssued = 0;
    let recentApplied = 0;
    const tickRecent = async () => {
      const seq = ++recentIssued;
      try {
        const fn = httpsCallable<{ goalId: string }, GoalRecentAdditions>(
          getFirebaseFunctions(),
          'wsfGoalRecentAdditions'
        );
        const result = await fn({ goalId });
        if (cancelled || sessionClosed) return;
        if (seq <= recentApplied) return;
        recentApplied = seq;
        // Nothing is invented and nothing is merged with what was there
        // before: the server's list replaces this screen's list whole.
        setRecent(Array.isArray(result.data?.additions) ? result.data.additions : []);
      } catch {
        if (cancelled || sessionClosed) return;
        if (seq <= recentApplied) return;
        recentApplied = seq;
        // Refusal and transient failure are treated the same way ON PURPOSE.
        // Keeping the last list up would be claiming it is still current, and
        // this screen has no way to tell a revoked authorization from a
        // dropped connection without asking the pulse — which is already
        // asking, every 2 seconds, and will end the session if it is refused.
        setRecent([]);
      }
    };

    const tick = async () => {
      const seq = ++issued;
      // The age labels are a pure function of this minute and the minutes the
      // server sent, so advancing it here is what makes "2 min ago" become
      // "3 min ago" with no request at all. An unchanged minute returns the
      // identical value and React commits nothing.
      setNowMinute((prev) => {
        const minute = Math.floor(Date.now() / 60_000);
        return prev === minute ? prev : minute;
      });
      if (seq === 1 || seq % RECENT_EVERY_N_TICKS === 1) void tickRecent();
      try {
        const fn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const result = await fn({ goalId });
        // Client receipt time. There is no public server timestamp, and this
        // label only has to say when THIS screen last heard a confirmed answer.
        const at = new Date();
        // A wall display looks at an unchanged goal nearly all the time. An
        // identical answer with the same printed clock minute would render
        // byte-for-byte the same screen, so keep the state object that is
        // already there rather than allocate an equal one every 2 seconds.
        // The moment ANY published field moves — or the minute on the
        // freshness line turns over — this falls through to the new object.
        apply(seq, (prev) =>
          prev.kind === 'ready' &&
          !prev.stale &&
          samePulse(prev.pulse, result.data) &&
          formatClock(prev.confirmedAt) === formatClock(at)
            ? prev
            : { kind: 'ready', pulse: result.data, confirmedAt: at, stale: false }
        );
      } catch (e) {
        if (cancelled) return;
        // A malformed id in the URL can never become a goal, so it is the same
        // terminal refusal as an unknown one — not a connection problem to be
        // polled for ever.
        if (
          e instanceof FirebaseError &&
          (e.code === 'functions/not-found' || e.code === 'functions/invalid-argument')
        ) {
          // Terminal for this session, and applied without consulting the
          // ordering guard: a refusal is not competing with the successes, it
          // is ending the session they belong to. Marking `sessionClosed`
          // before rendering means a success that resolves in the very same
          // tick of the event loop is already inadmissible. Every protected
          // value — totals AND context — leaves the screen with it.
          if (sessionClosed) return;
          sessionClosed = true;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          setState({ kind: 'notFound' });
          // Every protected value leaves with the refusal, the list included.
          setRecent([]);
          return;
        }
        // A transient failure is not evidence that the permission changed. The
        // poll continues and the next success reconciles. What changes is the
        // screen's honesty about itself: a confirmed total stays exactly as it
        // was, marked as no longer current; before any confirmation there is
        // nothing to keep, so a neutral connection state shows instead.
        if (sessionClosed) return;
        if (seq <= applied) return;
        applied = seq;
        setState((prev) =>
          prev.kind === 'ready' ? { ...prev, stale: true } : { kind: 'unreachable' }
        );
      }
    };

    void tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [goalId, pollSession]);

  const recheck = (
    <Pressable
      onPress={() => {
        // Back to `loading` in the same act that starts the new session.
        // Bumping the session alone left the refusal on screen for a whole
        // round trip, so the press looked like it had done nothing and a
        // second press restarted the session that was already running.
        setState({ kind: 'loading' });
        setPollSession((n) => n + 1);
      }}
      style={styles.recheckButton}
      testID="wsf-display-recheck"
      accessibilityRole="button"
    >
      <Text style={styles.recheckButtonText}>Check again</Text>
    </Pressable>
  );

  const testNote = wsfUsingEmulators ? (
    <Text style={styles.testNote} testID="wsf-display-test-banner">
      Sample data
    </Text>
  ) : null;

  // Root elements are keyed per layout and state. The statically exported
  // page hydrates the loading root, and React does not repair attribute
  // mismatches on hydration; a keyed root remounts, so its data-* attributes
  // are always the ones this render computed.
  // Every non-ready state is generic on purpose. No goal, no authorization
  // and a revoked authorization all look the same here: telling them apart
  // would make this display an oracle for which goal ids exist.
  if (state.kind !== 'ready') {
    // A9. LOADING IS PART OF THE READY PAGE, NOT A DIFFERENT PRODUCT. On a
    // phone the ready display is a cream page carrying a navy hero card, so a
    // navy full-bleed loading state made every cold load — and every Check
    // again — flash navy and then repaint cream. The loading state now uses
    // the same page chrome as the state it is on its way to: cream canvas,
    // navy wordmark, the block inside the navy hero card.
    //
    // The refusal states are deliberately NOT changed. They are approved as
    // they stand, they are terminal rather than transitional, and they are
    // the one place where looking unlike the ready page is the point.
    if (state.kind === 'loading' && tier === 'phone') {
      return (
        <View
          key="loading-phone"
          style={[styles.canvas, styles.canvasPhonePage]}
          testID="wsf-display-loading"
          {...({ dataSet: { layout: 'phone', tier } } as Record<string, unknown>)}
        >
          <View style={styles.phoneHeader}>
            <WsfWordmark variant="navy" height={22} testID="wsf-display-wordmark" />
          </View>
          <View style={styles.phoneHero} testID="wsf-display-phone-hero">
            <View style={[styles.genericBlock, big ? { maxWidth: Math.round(720 * tf) } : null]}>
              <Text
                style={styles.genericHeadline}
                accessibilityRole="header"
                {...({ 'aria-level': 1 } as Record<string, unknown>)}
              >
                Loading display…
              </Text>
            </View>
          </View>
          {testNote}
        </View>
      );
    }
    const copy =
      state.kind === 'loading'
        ? { headline: 'Loading display…', body: null, testID: 'wsf-display-loading', action: false }
        : state.kind === 'unreachable'
          ? {
              headline: 'Connection interrupted',
              body: 'Nothing has been confirmed yet. Check again when you’re connected.',
              testID: 'wsf-display-unreachable',
              action: true,
            }
          : {
              headline: 'Nothing to show here',
              body: 'This display isn’t currently available.',
              testID: 'wsf-display-not-available',
              action: true,
            };
    return (
      <View
        key={`generic-${tier}`}
        /*
          D-11. A REFUSAL ON A WALL IS THE WHOLE SCREEN'S MESSAGE.

          The ready wide canvas is `space-between` because it has a header, a
          body and a footer to push apart. The generic states have neither, so
          the same style pinned "Nothing to show here" to the top edge of a
          booth or a 1920 and left two thirds of the glass empty under it.
          They get a centred canvas of their own; the phone's was already
          centred, and is untouched.
        */
        style={[styles.canvas, wide ? styles.canvasGenericWide : styles.canvasPhone]}
        testID={copy.testID}
        {...({ dataSet: { layout: wide ? 'wide' : 'phone', tier } } as Record<string, unknown>)}
      >
        <View style={styles.genericBlock}>
          <WsfWordmark
            variant="white"
            height={tier === 'collective' ? 64 : tier === 'booth' ? 44 : tier === 'portrait' ? 34 : 22}
            testID="wsf-display-wordmark"
          />
          {/*
            D-1 / R7b. Loading, unavailable and unreachable are whole surfaces
            of their own, and this sentence is what each one is. It is their
            only heading, so it is the level-1 one — role and level only, the
            size is unchanged.
          */}
          <Text
            style={[styles.genericHeadline, big ? styles.genericHeadlineWide : null, roomType(56, 64)]}
            accessibilityRole="header"
            {...({ 'aria-level': 1 } as Record<string, unknown>)}
          >
            {copy.headline}
          </Text>
          {copy.body ? (
            <Text style={[styles.genericBody, big ? styles.genericBodyWide : null, roomType(26, 34)]}>{copy.body}</Text>
          ) : null}
          {copy.action ? recheck : null}
        </View>
        {testNote}
      </View>
    );
  }

  const { pulse, confirmedAt, stale } = state;
  const { sharedTotal, target, unit, status } = pulse;
  const phase = progressPhase(sharedTotal, target, status);
  const closed = status === 'closed';
  const percent = percentLabel(sharedTotal, target);
  // Same percent language as Community Home and the contribution flow.
  const percentText = `${percent} complete`;
  // The window is rendered in the GOAL's published zone, so every display —
  // phone or wide, in any local zone — shows the same period and the same
  // "ends" meaning. An unusable zone withholds the date rather than claiming
  // a calendar day from the wrong zone; the status stays "Open" / "Closed".
  //
  // An open goal whose end instant has already passed says so: nothing closes
  // a goal automatically, so `active` outlives the window and "Open · Ends
  // Mon, Sep 14" would be a claim the clock contradicts. The label is the only
  // thing that changes — the status line below still speaks for the server,
  // which still calls this goal active.
  const zone = { timeZone: pulse.timezone };
  const period = formatPeriod(pulse.startsAt, pulse.endsAt, zone);
  const periodText = closed ? period : formatActiveWindowLabel(pulse.endsAt, zone);
  const headline =
    phase === 'reachedOpen'
      ? 'WE did it.'
      : phase === 'closedReached'
        ? 'Look what WE did.'
        : phase === 'openAtZero'
          ? 'See what WE can do.'
          : null;
  const together = closed ? `${formatCount(sharedTotal)} ${unit} completed together.` : null;
  const near = phase === 'nearGoal';
  const weWidth = displayWeWidth(tier, windowWidth);

  // D-6 / D-7. THE DISPLAY CANNOT SCROLL. The wide canvas is a fixed
  // two-column page and the phone page is a single unscrollable card, so a
  // community name, goal title or unit longer than the ones on the approved
  // fixtures does not push the page down — it grows the column past the
  // viewport, and the wide body centres its rows, so the overflow is clipped
  // off BOTH ends. These sizes are pure functions of the strings the server
  // confirmed (src/ui/displayTypeScale.ts); the first tier of each scale is
  // the approved size exactly, so every reviewed fixture is untouched, and
  // each is applied AFTER the stylesheet entry it refines.
  const layout = big ? 'wide' : 'phone';
  const roomScale = <T extends Record<string, number>>(t: T): T =>
    tf === 1
      ? t
      : (Object.fromEntries(
          Object.entries(t).map(([k, v]) => [
            k,
            k === 'letterSpacing' ? Number((v * tf).toFixed(2)) : Math.round(v * tf),
          ])
        ) as T);
  const titleType = roomScale(goalTitleType(pulse.goalTitle, layout));
  const communityType = roomScale(communityNameType(pulse.communityDisplayName, layout));
  const openTotalText = `${formatCount(sharedTotal)} of ${formatCount(target)} ${unit}`;
  const closedTotalText = `${formatCount(sharedTotal)} ${unit} completed together.`;

  const totalLine = (
    <Text
      style={[styles.total, big ? styles.totalWide : null, roomScale(totalLineType(openTotalText, layout))]}
      testID="wsf-display-total-line"
    >
      <Text testID="wsf-display-shared-total">{formatCount(sharedTotal)}</Text>
      {` of ${formatCount(target)} ${unit}`}
    </Text>
  );

  const facts = (
    <View style={[styles.facts, big ? styles.factsWide : null]}>
      {phase === 'closedReached' ? (
        <>
          <Text
            style={[styles.total, big ? styles.totalWide : null, roomScale(totalLineType(closedTotalText, layout))]}
            testID="wsf-display-total-line"
          >
            <Text testID="wsf-display-shared-total">{formatCount(sharedTotal)}</Text>
            {` ${unit} completed together.`}
          </Text>
          <Text style={[styles.percent, big ? styles.percentWide : null, roomType(36, 44)]} testID="wsf-display-target">
            {`Goal: ${formatCount(target)} ${unit}`}
          </Text>
        </>
      ) : (
        <>
          {totalLine}
          <Text style={[styles.percent, big ? styles.percentWide : null, roomType(36, 44)]} testID="wsf-display-percent">
            {percentText}
          </Text>
        </>
      )}
      <Text
        style={[styles.status, big ? styles.statusWide : null, roomType(30, 38), near ? styles.statusNear : null]}
        testID="wsf-display-remaining"
      >
        {statusLine(sharedTotal, target, status)}
      </Text>
      {together && phase !== 'closedReached' ? (
        <Text style={[styles.together, big ? styles.togetherWide : null, roomType(24, 30)]} testID="wsf-display-together">
          {together}
        </Text>
      ) : null}
    </View>
  );

  const freshness = (
    <View
      style={styles.freshness}
      testID="wsf-display-freshness"
      // D-2. The stale pill appears WITHOUT any action by the viewer — the
      // poll simply stopped succeeding — so nothing would announce it. Polite:
      // it is a change of standing, not an interruption.
      aria-live="polite"
    >
      {stale ? (
        <Text
          style={[styles.freshnessText, { fontSize: freshnessSize }, styles.freshnessStaleText]}
          testID="wsf-display-stale"
        >
          Connection interrupted
        </Text>
      ) : null}
      <Text style={[styles.freshnessText, { fontSize: freshnessSize }]} testID="wsf-display-confirmed-at">
        {`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`}
      </Text>
    </View>
  );

  // RECENT ADDITIONS. Shown only when there is something to show: an empty
  // list, a list that has not answered yet, and a list whose every line was
  // unusable all render nothing at all — no empty heading, no "no activity
  // yet" placeholder standing in for an answer this screen does not have.
  //
  // Each line is an amount and how long ago it landed, and that is the whole
  // of it. The server sends nothing else, so there is nothing else here to
  // leak: no name, no photo, no ordinal, and in particular no count of how
  // many people these lines represent — five lines may be five people or one.
  const recentLines = (recent ?? [])
    .slice(0, RECENT_VISIBLE)
    .map((addition) => additionLine(addition, new Date(nowMinute * 60_000)))
    .filter((line): line is string => line !== null);
  const recentPanel =
    recentLines.length > 0 ? (
      <View
        style={[styles.recent, big ? styles.recentWide : null]}
        testID="wsf-display-recent"
        // D-2's rule, same reason: lines appear because other people acted,
        // never because the viewer did anything. Polite — a wall display
        // announcing each contribution as an alert would interrupt whatever
        // else a screen reader user is doing.
        aria-live="polite"
      >
        {/*
          The goal title is this page's level-1 heading, so the list's own
          label sits under it at level 2. Role and level only; the size is the
          stylesheet's.
        */}
        <Text
          style={[styles.recentHeading, big ? styles.recentHeadingWide : null, roomType(15)]}
          testID="wsf-display-recent-heading"
          accessibilityRole="header"
          {...({ 'aria-level': 2 } as Record<string, unknown>)}
        >
          Recent
        </Text>
        {recentLines.map((line, i) => (
          <Text
            // The list is positional and its entries carry no id by design, so
            // the index is the only key available — and it is the right one:
            // position in the list is exactly what this row is.
            key={`${i}-${line}`}
            style={[styles.recentLine, big ? styles.recentLineWide : null, roomType(20, 30)]}
            testID="wsf-display-recent-line"
          >
            {line}
          </Text>
        ))}
      </View>
    ) : null;

  const identity = (
    <View style={[styles.identity, big ? styles.identityWide : null]}>
      <Text style={[styles.community, big ? styles.communityWide : null, communityType]} testID="wsf-display-community">
        {pulse.communityDisplayName}
      </Text>
      {/*
        D-1. The goal is what this display is OF, so it is the page's one
        top-level heading. Role and level only: the size comes from the same
        styles as before.
      */}
      <Text
        style={[styles.goalTitle, big ? styles.goalTitleWide : null, titleType]}
        testID="wsf-display-goal-title"
        accessibilityRole="header"
        {...({ 'aria-level': 1 } as Record<string, unknown>)}
      >
        {pulse.goalTitle}
      </Text>
      <View style={styles.periodRow}>
        {periodText ? (
          <Text style={[styles.period, big ? styles.periodWide : null, roomType(26, 32)]} testID="wsf-display-period">
            {periodText}
          </Text>
        ) : null}
        {closed ? (
          <Text style={[styles.closedPill, big ? styles.closedPillWide : null, roomType(18)]} testID="wsf-display-closed">
            Closed
          </Text>
        ) : null}
      </View>
      {headline ? (
        <Text style={[styles.headline, big ? styles.headlineWide : null, roomType(52, 60)]} testID="wsf-display-headline">
          {headline}
        </Text>
      ) : null}
    </View>
  );

  const we = (
    <View style={styles.weWrap}>
      <LivingWeProgress
        completed={sharedTotal}
        target={target}
        unit={unit}
        width={weWidth}
        surface="dark"
        testID="wsf-display-we"
      />
    </View>
  );

  if (wide) {
    // Distant display: one navy canvas, two columns, nothing to scroll. Who
    // is moving and what they are working toward on the left; the WE and the
    // exact result on the right, sized to read from across a room.
    return (
      <View
        key="ready-wide"
        style={[styles.canvas, styles.canvasWide]}
        testID="wsf-display-screen"
        {...({ dataSet: { layout: 'wide', tier, phase, stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
      >
        <View style={styles.wideHeader}>
          <WsfWordmark
            variant="white"
            height={tier === 'collective' ? 64 : 44}
            testID="wsf-display-wordmark"
          />
          {freshness}
        </View>
        <View style={styles.wideBody}>
          <View style={styles.wideLeft}>{identity}</View>
          <View style={styles.wideRight}>
            {we}
            {facts}
            {recentPanel}
          </View>
        </View>
        {testNote}
      </View>
    );
  }

  /*
    PORTRAIT: a picture frame on a wall.

    One column like the phone, distance typography like the booth, on a navy
    canvas of its own. It is not a resize of either: the phone's cream page
    with a hero card inside it reads as a phone screenshot blown up when it is
    two feet wide, and the booth's two columns leave a portrait frame with a
    column of air down one side.

    NO QR AND NO JOIN CONTROL. The accepted target draws that seam at the foot
    of this composition, and it is deliberately not built: there is no join URL
    or encoder on this route, and shipping a placeholder or a dead control
    would be a capability claim the product cannot honour. The space it would
    have taken is closed up rather than left as a hole — the body centres, so
    the column breathes instead of leaving a gap where a code is not.
  */
  if (tier === 'portrait') {
    return (
      <View
        key="ready-portrait"
        style={[styles.canvas, styles.canvasPortrait]}
        testID="wsf-display-screen"
        {...({ dataSet: { layout: 'portrait', tier, phase, stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
      >
        <View style={styles.wideHeader}>
          <WsfWordmark variant="white" height={34} testID="wsf-display-wordmark" />
          {freshness}
        </View>
        <View style={styles.portraitBody}>
          {identity}
          {we}
          {facts}
        </View>
        {recentPanel}
        {testNote}
      </View>
    );
  }

  // Phone / public page: the Community Home language — cream page, the navy
  // hero carrying the WE and the result, identity above it.
  return (
    <View
      key="ready-phone"
      style={[styles.canvas, styles.canvasPhonePage]}
      testID="wsf-display-screen"
      {...({ dataSet: { layout: 'phone', tier, phase, stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
    >
      <View style={styles.phoneHeader}>
        <WsfWordmark variant="navy" height={22} testID="wsf-display-wordmark" />
      </View>
      <View style={styles.phoneHero} testID="wsf-display-phone-hero">
        {identity}
        {we}
        {facts}
        {freshness}
      </View>
      {recentPanel}
      {testNote}
    </View>
  );
}

const NAVY = wsfTheme.colors.primary;
const CREAM = wsfTheme.colors.background;
const HERO_MUTED = 'rgba(247,245,240,0.78)';

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  canvasWide: {
    backgroundColor: NAVY,
    paddingHorizontal: 64,
    paddingVertical: 40,
    justifyContent: 'space-between',
  },
  canvasPhone: {
    backgroundColor: NAVY,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  // Loading, unavailable and unreachable on a wide screen: centred, because
  // the sentence IS the screen. See D-11 at the generic root.
  canvasGenericWide: {
    backgroundColor: NAVY,
    paddingHorizontal: 64,
    paddingVertical: 40,
    justifyContent: 'center',
  },
  // A picture frame: one navy column at frame scale. Not the phone's cream
  // page, and not the booth's two columns.
  canvasPortrait: {
    backgroundColor: NAVY,
    paddingHorizontal: 44,
    paddingVertical: 44,
    justifyContent: 'space-between',
  },
  portraitBody: { flex: 1, justifyContent: 'center', alignItems: 'stretch', gap: 18 },
  canvasPhonePage: {
    backgroundColor: CREAM,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },

  // generic (loading / unavailable / unreachable)
  genericBlock: { alignItems: 'center', gap: 16, maxWidth: 720, alignSelf: 'center' },
  genericHeadline: { color: CREAM, fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 36 },
  genericHeadlineWide: { fontSize: 56, lineHeight: 64 },
  genericBody: { color: HERO_MUTED, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  genericBodyWide: { fontSize: 26, lineHeight: 34 },
  recheckButton: {
    backgroundColor: PROGRESS_GREEN,
    paddingHorizontal: 28,
    minHeight: 54,
    justifyContent: 'center',
    borderRadius: 14,
    marginTop: 8,
  },
  recheckButtonText: { color: NAVY, fontSize: 18, fontWeight: '800', textAlign: 'center' },

  // wide layout
  wideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wideBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 48, paddingVertical: 16 },
  wideLeft: { flex: 5, gap: 16 },
  wideRight: { flex: 6, alignItems: 'center', gap: 20 },

  // phone layout
  phoneHeader: { minHeight: 40, justifyContent: 'center' },
  phoneHero: {
    flex: 1,
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: 14,
    justifyContent: 'center',
  },

  // identity
  identity: { gap: 6 },
  identityWide: { gap: 12 },
  community: { color: PROGRESS_GREEN, fontSize: 15, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  communityWide: { fontSize: 30, letterSpacing: 2 },
  goalTitle: { color: CREAM, fontSize: 30, fontWeight: '800', lineHeight: 36, letterSpacing: -0.4 },
  goalTitleWide: { fontSize: 68, lineHeight: 76, letterSpacing: -1 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  period: { color: HERO_MUTED, fontSize: 15, lineHeight: 20 },
  periodWide: { fontSize: 26, lineHeight: 32 },
  closedPill: {
    color: NAVY,
    backgroundColor: CREAM,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  closedPillWide: { fontSize: 18, paddingHorizontal: 16, paddingVertical: 6 },
  headline: { color: PROGRESS_GREEN, fontSize: 26, fontWeight: '800', lineHeight: 32, marginTop: 4 },
  headlineWide: { fontSize: 52, lineHeight: 60, marginTop: 12 },

  // the mark and the result
  weWrap: { alignItems: 'center', paddingVertical: 8 },
  facts: { alignItems: 'center', gap: 4 },
  factsWide: { gap: 8 },
  total: { color: CREAM, fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  totalWide: { fontSize: 64, lineHeight: 72, letterSpacing: -1 },
  percent: { color: PROGRESS_GREEN, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  percentWide: { fontSize: 36, lineHeight: 44 },
  status: { color: HERO_MUTED, fontSize: 17, lineHeight: 22, textAlign: 'center' },
  statusWide: { fontSize: 30, lineHeight: 38 },
  statusNear: { color: CREAM, fontWeight: '800' },
  together: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center', paddingTop: 4 },
  togetherWide: { fontSize: 24, lineHeight: 30 },

  // freshness
  // The stale pill and the clock share a row on a wide screen and stack on a
  // phone; neither is allowed to break mid-phrase.
  freshness: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 4 },
  freshnessText: { color: HERO_MUTED, fontSize: 13, letterSpacing: 0.3, textAlign: 'center' },
  // Quiet by construction. The list sits UNDER the hero on the phone page
  // (cream, so navy text) and under the facts column on the wide canvas
  // (navy, so the muted hero tone). It is smaller than every number above it
  // and never competes with the total, which is the thing the display is of.
  recent: { paddingTop: 16, alignItems: 'center', gap: 2 },
  recentWide: { alignItems: 'flex-start', paddingTop: 24 },
  recentHeading: {
    color: NAVY,
    opacity: 0.7,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingBottom: 4,
  },
  recentHeadingWide: { color: HERO_MUTED, opacity: 1, fontSize: 15 },
  recentLine: { color: NAVY, opacity: 0.75, fontSize: 14, letterSpacing: 0.2 },
  recentLineWide: { color: HERO_MUTED, opacity: 1, fontSize: 20, lineHeight: 30 },
  freshnessStaleText: {
    color: NAVY,
    backgroundColor: '#F2C94C',
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  testNote: {
    color: HERO_MUTED,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 8,
  },
});
