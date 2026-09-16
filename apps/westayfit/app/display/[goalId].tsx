import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { barPercent, integerPercent } from '../../src/goalPercent';
import { wsfTheme } from '../../src/theme';

// Response shape mirrors wsfGoalPulse in functions-westayfit.
type GoalPulse = {
  sharedTotal: number;
  target: number;
  unit: string;
  status: 'active' | 'closed';
};

type DisplayState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; pulse: GoalPulse };

// Polls wsfGoalPulse every 2 seconds. Matches the server-side 2s cache TTL
// so we do not pay a Firestore round-trip on every tick when multiple
// displays are pointed at the same goal.
const POLL_INTERVAL_MS = 2_000;

// barPercent + integerPercent moved to src/goalPercent — see that module for
// the invariant (4999/5000 renders 99, never 100).

export default function DisplayGoal() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = params.goalId;
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
      setState({ kind: 'error', message: 'Missing goal id.' });
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
        apply(seq, { kind: 'ready', pulse: result.data });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          // Terminal for this session, and applied without consulting the
          // ordering guard: a refusal is not competing with the successes, it
          // is ending the session they belong to. Marking `sessionClosed`
          // before rendering means a success that resolves in the very same
          // tick of the event loop is already inadmissible.
          if (sessionClosed) return;
          sessionClosed = true;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          setState({ kind: 'notFound' });
          return;
        }
        // Transient errors are surfaced once but do not stop the poll — the
        // next tick reconciles automatically. A total already on screen is
        // left alone; a transient network error is not evidence that the
        // permission changed.
        if (sessionClosed) return;
        if (seq <= applied) return;
        applied = seq;
        setState((prev) =>
          prev.kind === 'ready'
            ? prev
            : {
                kind: 'error',
                message: e instanceof Error ? e.message : 'Failed to load.',
              }
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

  if (state.kind === 'loading') {
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>Waking up display…</Text>
      </View>
    );
  }
  if (state.kind === 'notFound') {
    // PACKAGE E: one screen for "no such goal" and "not authorized for public
    // display", deliberately. Telling them apart would make this display an
    // oracle for which goal ids exist, which is exactly what the server's
    // byte-identical not-found refuses to do.
    return (
      <View style={styles.screen} testID="wsf-display-not-available">
        <Text style={styles.heading}>Nothing to show here</Text>
        <Text style={styles.body}>
          This display is not set up, or its community has not turned on public
          display for this goal.
        </Text>
        {/*
          The only route back. A display on a wall whose permission is restored
          needs a way to resume without someone finding a keyboard, and this
          starts a FRESH session: a new generation of requests, checked from
          scratch. No response from the refused session can perform this.
        */}
        <Pressable
          onPress={() => setPollSession((n) => n + 1)}
          style={styles.recheckButton}
          testID="wsf-display-recheck"
          accessibilityRole="button"
        >
          <Text style={styles.recheckButtonText}>Check again</Text>
        </Pressable>
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

  const { sharedTotal, target, unit, status } = state.pulse;
  const pct = barPercent(sharedTotal, target);
  const truePct = integerPercent(sharedTotal, target);
  const remaining = Math.max(0, target - sharedTotal);
  const overshoot = sharedTotal > target;

  return (
    <View style={styles.screen} testID="wsf-display-screen">
      {wsfUsingEmulators ? (
        <Text style={styles.testPill} testID="wsf-display-test-banner">
          LOCAL SYNTHETIC TEST
        </Text>
      ) : null}
      <Text style={styles.subheading}>We stay fit — together</Text>
      <Text style={styles.giantNumber} testID="wsf-display-shared-total">
        {sharedTotal}
      </Text>
      <Text style={styles.unitLabel}>{unit}</Text>
      <Text style={styles.body} testID="wsf-display-percent">
        {truePct}%
      </Text>
      <View style={styles.barTrack} accessibilityLabel={`${truePct}% of goal`}>
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
      <Text style={styles.body} testID="wsf-display-target">
        Goal: {target} {unit}
      </Text>
      <Text style={styles.caption} testID="wsf-display-remaining">
        {overshoot
          ? `Past the goal by ${sharedTotal - target}`
          : remaining === 0
            ? 'Goal reached'
            : `${remaining} to go`}
      </Text>
      {status === 'closed' ? (
        <Text style={styles.closedPill} testID="wsf-display-closed">
          Closed
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: wsfTheme.spacing.xl,
    gap: wsfTheme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: wsfTheme.colors.background,
  },
  heading: {
    ...wsfTheme.typography.heading,
    color: wsfTheme.colors.text,
    textAlign: 'center',
  },
  subheading: {
    ...wsfTheme.typography.subheading,
    color: wsfTheme.colors.textMuted,
    textAlign: 'center',
  },
  body: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.text,
    textAlign: 'center',
  },
  caption: {
    ...wsfTheme.typography.caption,
    color: wsfTheme.colors.textMuted,
    textAlign: 'center',
  },
  giantNumber: {
    fontSize: 128,
    fontWeight: '700',
    color: wsfTheme.colors.primary,
    lineHeight: 140,
  },
  unitLabel: {
    fontSize: 24,
    fontWeight: '400',
    color: wsfTheme.colors.textMuted,
    textAlign: 'center',
  },
  barTrack: {
    width: '90%',
    maxWidth: 600,
    height: 24,
    backgroundColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.pill,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: wsfTheme.radius.pill,
  },
  closedPill: {
    ...wsfTheme.typography.caption,
    color: wsfTheme.colors.surface,
    backgroundColor: wsfTheme.colors.primary,
    paddingHorizontal: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.xs,
    borderRadius: wsfTheme.radius.pill,
    overflow: 'hidden',
  },
  recheckButton: {
    backgroundColor: wsfTheme.colors.primary,
    paddingHorizontal: wsfTheme.spacing.lg,
    paddingVertical: wsfTheme.spacing.sm,
    borderRadius: wsfTheme.radius.pill,
  },
  recheckButtonText: {
    ...wsfTheme.typography.body,
    color: wsfTheme.colors.surface,
    fontWeight: '600',
    textAlign: 'center',
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
  },
});
