import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
    // responses are not guaranteed to arrive in the order they were sent. Each
    // request carries the sequence number it was issued with, and a response is
    // only allowed to change the screen if it is newer than whatever is already
    // rendered.
    //
    // This is a privacy property, not a tidiness one. Without it, revoking
    // public display can be undone by physics: an older successful response
    // still in flight lands after the refusal and paints the protected total
    // back onto a screen that is no longer permitted to show it.
    let issued = 0;
    let applied = 0;
    const apply = (seq: number, next: DisplayState | ((prev: DisplayState) => DisplayState)) => {
      if (cancelled) return false;
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
          // A refusal is terminal for this display: stop polling whether or not
          // this response is the newest one, so no further request can be
          // issued against a goal the server has just refused. The `apply`
          // guard still decides what is rendered.
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          apply(seq, { kind: 'notFound' });
          return;
        }
        // Transient errors are surfaced once but do not stop the poll — the
        // next tick reconciles automatically. A total already on screen is
        // left alone; a transient network error is not evidence that the
        // permission changed.
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
  }, [goalId]);

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
