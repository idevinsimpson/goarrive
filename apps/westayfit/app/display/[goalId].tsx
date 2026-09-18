import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { wsfTheme } from '../../src/theme';
import { PROGRESS_GREEN } from '../../src/ui/brandAssets';
import { formatClock, formatEndsAt, formatPeriod } from '../../src/ui/dates';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import {
  formatCount,
  percentLabel,
  progressPhase,
  statusLine,
} from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

// Response shape mirrors wsfGoalPulse in functions-westayfit: the four
// aggregate fields, and — since the owner's publication decision of
// 2026-09-18 — the five context fields a Champion's authorization also
// publishes. Nothing about this screen's context comes from the URL, the
// query string or browser storage; only the server's answer names anything.
type GoalPulse = {
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

export default function DisplayGoal() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = params.goalId;
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 900;
  const [state, setState] = useState<DisplayState>({ kind: 'loading' });
  // Bumping this starts a brand-new polling session. It is the ONLY way to
  // recover from a refusal, and it exists so that recovery is an explicit act
  // rather than something an outstanding old response can perform.
  const [pollSession, setPollSession] = useState(0);

  // A different goal is a different context. Clear what the previous goal put
  // on screen at once, rather than leaving its total up until the first
  // response for the new one lands.
  useEffect(() => {
    setState({ kind: 'loading' });
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

    const apply = (seq: number, next: DisplayState | ((prev: DisplayState) => DisplayState)) => {
      if (cancelled) return false;
      if (sessionClosed) return false;
      if (seq <= applied) return false;
      applied = seq;
      setState(next as DisplayState);
      return true;
    };

    const tick = async () => {
      const seq = ++issued;
      try {
        const fn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const result = await fn({ goalId });
        // Client receipt time. There is no public server timestamp, and this
        // label only has to say when THIS screen last heard a confirmed answer.
        apply(seq, { kind: 'ready', pulse: result.data, confirmedAt: new Date(), stale: false });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
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
      onPress={() => setPollSession((n) => n + 1)}
      style={styles.recheckButton}
      testID="wsf-display-recheck"
      accessibilityRole="button"
    >
      <Text style={styles.recheckButtonText}>Check again</Text>
    </Pressable>
  );

  const testNote = wsfUsingEmulators ? (
    <Text style={styles.testNote} testID="wsf-display-test-banner">
      Local synthetic test
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
        key={`generic-${wide ? 'wide' : 'phone'}`}
        style={[styles.canvas, wide ? styles.canvasWide : styles.canvasPhone]}
        testID={copy.testID}
        {...({ dataSet: { layout: wide ? 'wide' : 'phone' } } as Record<string, unknown>)}
      >
        <View style={styles.genericBlock}>
          <WsfWordmark variant="white" height={wide ? 44 : 22} testID="wsf-display-wordmark" />
          <Text style={[styles.genericHeadline, wide ? styles.genericHeadlineWide : null]}>
            {copy.headline}
          </Text>
          {copy.body ? (
            <Text style={[styles.genericBody, wide ? styles.genericBodyWide : null]}>{copy.body}</Text>
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
  const percentText = phase === 'closedUnreached' ? `${percent} of our goal` : `${percent} complete`;
  // The window is rendered in the GOAL's published zone, so every display —
  // phone or wide, in any local zone — shows the same period and the same
  // "ends" meaning. An unusable zone withholds the date rather than claiming
  // a calendar day from the wrong zone; the status stays "Open" / "Closed".
  const zone = { timeZone: pulse.timezone };
  const ends = formatEndsAt(pulse.endsAt, zone);
  const period = formatPeriod(pulse.startsAt, pulse.endsAt, zone);
  const periodText = closed ? period : ends ? `Open · ${ends}` : 'Open';
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
  const weWidth = wide ? Math.min(640, Math.round(windowWidth * 0.42)) : Math.min(320, windowWidth - 2 * 20 - 2 * 22);

  const totalLine = (
    <Text
      style={[styles.total, wide ? styles.totalWide : null]}
      testID="wsf-display-total-line"
    >
      <Text testID="wsf-display-shared-total">{formatCount(sharedTotal)}</Text>
      {` of ${formatCount(target)} ${unit}`}
    </Text>
  );

  const facts = (
    <View style={[styles.facts, wide ? styles.factsWide : null]}>
      {phase === 'closedReached' ? (
        <>
          <Text style={[styles.total, wide ? styles.totalWide : null]} testID="wsf-display-total-line">
            <Text testID="wsf-display-shared-total">{formatCount(sharedTotal)}</Text>
            {` ${unit} completed together.`}
          </Text>
          <Text style={[styles.percent, wide ? styles.percentWide : null]} testID="wsf-display-target">
            {`Goal: ${formatCount(target)} ${unit}`}
          </Text>
        </>
      ) : (
        <>
          {totalLine}
          <Text style={[styles.percent, wide ? styles.percentWide : null]} testID="wsf-display-percent">
            {percentText}
          </Text>
        </>
      )}
      <Text
        style={[styles.status, wide ? styles.statusWide : null, near ? styles.statusNear : null]}
        testID="wsf-display-remaining"
      >
        {statusLine(sharedTotal, target, status)}
      </Text>
      {together && phase !== 'closedReached' ? (
        <Text style={[styles.together, wide ? styles.togetherWide : null]} testID="wsf-display-together">
          {together}
        </Text>
      ) : null}
    </View>
  );

  const freshness = (
    <View style={[styles.freshness, stale ? styles.freshnessStale : null]} testID="wsf-display-freshness">
      {stale ? (
        <Text style={[styles.freshnessText, styles.freshnessStaleText]} testID="wsf-display-stale">
          Connection interrupted
        </Text>
      ) : null}
      <Text style={styles.freshnessText} testID="wsf-display-confirmed-at">
        {`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`}
      </Text>
    </View>
  );

  const identity = (
    <View style={[styles.identity, wide ? styles.identityWide : null]}>
      <Text style={[styles.community, wide ? styles.communityWide : null]} testID="wsf-display-community">
        {pulse.communityDisplayName}
      </Text>
      <Text style={[styles.goalTitle, wide ? styles.goalTitleWide : null]} testID="wsf-display-goal-title">
        {pulse.goalTitle}
      </Text>
      <View style={styles.periodRow}>
        {periodText ? (
          <Text style={[styles.period, wide ? styles.periodWide : null]} testID="wsf-display-period">
            {periodText}
          </Text>
        ) : null}
        {closed ? (
          <Text style={[styles.closedPill, wide ? styles.closedPillWide : null]} testID="wsf-display-closed">
            Closed
          </Text>
        ) : null}
      </View>
      {headline ? (
        <Text style={[styles.headline, wide ? styles.headlineWide : null]} testID="wsf-display-headline">
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
        {...({ dataSet: { layout: 'wide', phase, stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
      >
        <View style={styles.wideHeader}>
          <WsfWordmark variant="white" height={44} testID="wsf-display-wordmark" />
          {freshness}
        </View>
        <View style={styles.wideBody}>
          <View style={styles.wideLeft}>{identity}</View>
          <View style={styles.wideRight}>
            {we}
            {facts}
          </View>
        </View>
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
      {...({ dataSet: { layout: 'phone', phase, stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
    >
      <View style={styles.phoneHeader}>
        <WsfWordmark variant="navy" height={22} testID="wsf-display-wordmark" />
      </View>
      <View style={styles.phoneHero}>
        {identity}
        {we}
        {facts}
        {freshness}
      </View>
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
  freshness: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 4 },
  freshnessStale: {},
  freshnessText: { color: HERO_MUTED, fontSize: 13, letterSpacing: 0.3 },
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
