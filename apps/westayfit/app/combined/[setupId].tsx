import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState, type SetStateAction } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COMBINED_REFUSAL_BODY, COMBINED_REFUSAL_HEADLINE } from '../../src/combinedSetup';
import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { CREAM, kit } from '../../src/ui/kit';
import { formatActiveWindowLabel, formatPeriod } from '../../src/ui/dates';
import { formatCount, percentLabel, statusLine } from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * COMBINED MOVEMENT GOAL — one screen, several activities, one shared total.
 *
 * THE TOTAL ON THIS SCREEN IS NOT STORED ANYWHERE. The server derives it at
 * read time by summing the children's own counters, so it cannot drift from
 * the activities it is made of, and an activity's own goal, contribute page
 * and display are completely unaffected by appearing here.
 *
 * WHAT THIS URL IS. A document name, and nothing else. It carries no
 * participant token and no administrative authority: opening it signs nobody
 * in, enrols no screen, writes nothing, and renders no Champion control of any
 * kind. The only callable it invokes is `wsfCombinedGoalPulse`, which can read
 * aggregates and nothing else.
 *
 * WHO MAY SEE IT. The server decides on every read, before its own cache: an
 * active member of the community, or anyone at all once EVERY activity in the
 * setup carries its Champion's public-display permission. Revoking any one
 * activity closes this screen on the next poll, through the existing control,
 * with no second switch to disagree with the first.
 *
 * WHY THE REFUSAL SAYS NOTHING. An unknown setup, an unauthorized one and a
 * corrupt one are the same two sentences — the same two the kiosk and the
 * public display use — so this page can never become an oracle for which
 * setups exist.
 *
 * NO UID, NO MEMBER NAME, NO CONTRIBUTOR COUNT is printed, because the
 * response carries none.
 */

type CombinedActivity = {
  goalId: string;
  title: string;
  unit: string;
  target: number;
  total: number;
  countsAs: 'repetition';
  status: string;
};

type CombinedPulse = {
  setupId: string;
  status: string;
  communityDisplayName: string;
  title: string;
  unit: string;
  target: number;
  combinedTotal: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  contributionRule: string;
  contributionRuleVersion: number;
  activities: CombinedActivity[];
};

type CombinedState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  // A transient failure before anything was ever confirmed: nothing to keep on
  // screen, and nothing to invent.
  | { kind: 'unreachable' }
  | { kind: 'ready'; pulse: CombinedPulse; stale: boolean };

/** The same 2 s cadence, and the same reason, as the display and the kiosk: it
 * matches the server-side cache TTL for this callable. */
const POLL_INTERVAL_MS = 2_000;

export default function CombinedGoalScreen() {
  const params = useLocalSearchParams<{ setupId: string }>();
  const setupId = params.setupId;

  // The static export has no window, so the first client render must produce
  // the same tree the export did or React re-renders from scratch (#418).
  // Nothing on this screen branches on width, so the guard only gates the
  // poll's first paint.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const [state, setState] = useState<CombinedState>({ kind: 'loading' });
  // Bumping this starts a brand-new polling session. It is the ONLY way to
  // recover from a refusal, so recovery is an explicit act rather than
  // something an outstanding old response can perform.
  const [pollSession, setPollSession] = useState(0);

  // A different setup is a different context: clear what the previous one put
  // on screen rather than leaving its total up until the first answer lands.
  useEffect(() => {
    setState({ kind: 'loading' });
  }, [setupId]);

  useEffect(() => {
    if (!hydrated) return;
    if (!setupId) {
      setState({ kind: 'notFound' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // The display's two admission rules, unchanged. (1) A response may only
    // paint if it is newer than what is on screen. (2) A refusal CLOSES the
    // session, so an earlier-issued success still in flight can never repaint
    // a total this screen is no longer entitled to show — issue order is not
    // server processing order, so rule 1 alone does not cover it.
    let issued = 0;
    let applied = 0;
    let sessionClosed = false;

    const apply = (seq: number, next: SetStateAction<CombinedState>) => {
      if (cancelled) return;
      if (sessionClosed) return;
      if (seq <= applied) return;
      applied = seq;
      setState(next);
    };

    const tick = async () => {
      const seq = ++issued;
      try {
        const fn = httpsCallable<{ setupId: string }, CombinedPulse>(
          getFirebaseFunctions(),
          'wsfCombinedGoalPulse'
        );
        const result = await fn({ setupId });
        apply(seq, { kind: 'ready', pulse: result.data, stale: false });
      } catch (e) {
        if (cancelled) return;
        // A malformed id in the URL can never become a setup, so it is the
        // same terminal refusal as an unknown one — not a connection problem
        // to be polled for ever.
        if (
          e instanceof FirebaseError &&
          (e.code === 'functions/not-found' || e.code === 'functions/invalid-argument')
        ) {
          if (sessionClosed) return;
          sessionClosed = true;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          setState({ kind: 'notFound' });
          return;
        }
        // A transient failure is not evidence that the permission changed. A
        // confirmed total stays exactly as it was, marked as no longer
        // current; before any confirmation there is nothing to keep.
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
  }, [setupId, pollSession, hydrated]);

  const recheck = (
    <Pressable
      onPress={() => {
        // Back to `loading` in the same act that starts the new session, so
        // the press visibly does something instead of leaving the refusal up
        // for a whole round trip.
        setState({ kind: 'loading' });
        setPollSession((n) => n + 1);
      }}
      style={kit.secondaryButton}
      testID="wsf-combined-recheck"
      accessibilityRole="button"
    >
      <Text style={kit.secondaryButtonText}>Check again</Text>
    </Pressable>
  );

  const testNote = wsfUsingEmulators ? (
    <Text style={kit.badge} testID="wsf-combined-test-banner">
      Sample data
    </Text>
  ) : null;

  const chrome = (
    <View style={kit.chrome}>
      <WsfWordmark variant="navy" height={22} testID="wsf-combined-wordmark" />
    </View>
  );

  if (state.kind !== 'ready') {
    // Every non-ready state is generic on purpose. No setup, no authorization
    // and a revoked authorization all look the same here.
    const copy =
      state.kind === 'loading'
        ? { headline: 'Loading…', body: null, testID: 'wsf-combined-loading', action: false }
        : state.kind === 'unreachable'
          ? {
              headline: 'Connection interrupted',
              body: 'Nothing has been confirmed yet. Check again when you’re connected.',
              testID: 'wsf-combined-unreachable',
              action: true,
            }
          : {
              headline: COMBINED_REFUSAL_HEADLINE,
              body: COMBINED_REFUSAL_BODY,
              testID: 'wsf-combined-not-available',
              action: true,
            };
    return (
      <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
        <View style={kit.column} testID="wsf-combined-screen">
          {chrome}
          <View style={kit.card} testID={copy.testID}>
            <Text
              style={kit.heading}
              accessibilityRole="header"
              {...({ 'aria-level': 1 } as Record<string, unknown>)}
            >
              {copy.headline}
            </Text>
            {copy.body ? <Text style={kit.intro}>{copy.body}</Text> : null}
            {copy.action ? recheck : null}
          </View>
          {testNote}
        </View>
      </ScrollView>
    );
  }

  const { pulse, stale } = state;
  const closed = pulse.status === 'closed';
  const zone = { timeZone: pulse.timezone };
  const period = formatPeriod(pulse.startsAt, pulse.endsAt, zone);
  // An open setup whose end instant has already passed says so: nothing closes
  // a combined goal automatically, so "ends" would be a claim the clock
  // contradicts. Same rule, same helper, as the public display.
  const periodText = closed ? period : formatActiveWindowLabel(pulse.endsAt, zone);

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
      <View style={kit.column} testID="wsf-combined-screen">
        {chrome}
        <View style={kit.hero}>
          <Text style={kit.eyebrowOnNavy} testID="wsf-combined-community">
            {pulse.communityDisplayName}
          </Text>
          <Text
            style={kit.heroTitle}
            testID="wsf-combined-title-text"
            accessibilityRole="header"
            {...({ 'aria-level': 1 } as Record<string, unknown>)}
          >
            {pulse.title}
          </Text>
          {periodText ? (
            <Text style={kit.heroMeta} testID="wsf-combined-period">
              {periodText}
            </Text>
          ) : null}
          {/*
            The one number this screen exists for. It is the exact sum of the
            activities listed below — the server derived it from their own
            counters in the same response, so the total and the parts can never
            disagree with each other.
          */}
          <Text style={styles.total} testID="wsf-combined-shared-total">
            {formatCount(pulse.combinedTotal)} of {formatCount(pulse.target)} {pulse.unit}
          </Text>
          <Text style={kit.heroMeta} testID="wsf-combined-status">
            {statusLine(pulse.combinedTotal, pulse.target, pulse.status)} ·{' '}
            {percentLabel(pulse.combinedTotal, pulse.target)} complete
          </Text>
          {closed ? (
            <Text style={kit.heroMeta} testID="wsf-combined-closed">
              This combined goal has closed.
            </Text>
          ) : null}
        </View>

        <Text style={kit.eyebrow}>Activities</Text>
        {/*
          Each activity keeps its OWN goal. The target beside it is that
          activity's own target, not a share of the combined one, and its total
          is its own — appearing here changed neither.
        */}
        {pulse.activities.map((activity) => (
          <View
            key={activity.goalId}
            style={kit.card}
            testID={`wsf-combined-activity-${activity.goalId}`}
          >
            <Text style={kit.cardTitle}>{activity.title}</Text>
            <Text style={kit.cardMeta} testID={`wsf-combined-activity-total-${activity.goalId}`}>
              {formatCount(activity.total)} of {formatCount(activity.target)} {activity.unit}
            </Text>
            {activity.status === 'closed' ? (
              <Text style={kit.cardMeta} testID={`wsf-combined-activity-closed-${activity.goalId}`}>
                Closed. What it counted still counts here.
              </Text>
            ) : null}
          </View>
        ))}

        {stale ? (
          <Text style={kit.statusText} testID="wsf-combined-stale">
            This is the last confirmed total. It may be out of date.
          </Text>
        ) : null}
        {stale ? recheck : null}
        {testNote}
      </View>
    </ScrollView>
  );
}

// Layout only this screen needs; everything else is the shared kit.
const styles = StyleSheet.create({
  total: {
    color: CREAM,
    // The total is the largest thing on the screen, and it wraps rather than
    // clipping: at 195 px "1,000,000 of 2,000 movements" has to go somewhere.
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    flexShrink: 1,
    minWidth: 0,
  },
});
