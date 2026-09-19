/**
 * FOLLOW ALONG — the movement screen.
 *
 * A timed, illustrated follow-along for one goal's activity. It is WSF's own:
 * there is no movement video catalog in this repository, and the only
 * follow-along video state that exists here belongs to GoArrive, behind
 * GoArrive's coach auth and Firestore. So this screen draws rather than plays,
 * and `src/followAlong.ts` carries a media seam for the day a catalog exists.
 *
 * Three things it deliberately does NOT do:
 *  - It never records anything. The member counts their own repetitions and
 *    adds them on the contribute screen, exactly as they do today.
 *  - It never coaches. Every string it can show passes the same banned-word
 *    guard the activity guides hold themselves to.
 *  - It never counts for anyone. `SELF_COUNT_NOTE` is on screen throughout.
 *
 * The timer runs off elapsed wall-clock time rather than a decremented
 * counter, so a browser that throttled a background tab catches up instead of
 * drifting — the same reasoning the kiosk's own timer uses.
 */
import { useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { type GoalPulse } from '../../src/displayPulse';
import { getFirebaseFunctions } from '../../src/firebase';
import { buildFollowAlongPlan, secondsLeft, stepAt } from '../../src/followAlong';
import { wsfTheme } from '../../src/theme';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { kit } from '../../src/ui/kit';
import { figureKindFor, moveFigureLabel, moveFigureSvgDataUriRaw } from '../../src/ui/moveFigure';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/** How often the screen re-reads the clock. Fine enough to look alive. */
const TICK_MS = 250;
/** How fast the two poses alternate while a move step is running. */
const POSE_MS = 1_200;

type Screen =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; unit: string; goalTitle: string };

export default function MoveScreen() {
  const { goalId: goalIdParam } = useLocalSearchParams<{ goalId?: string }>();
  const goalId = typeof goalIdParam === 'string' ? goalIdParam : '';

  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [length, setLength] = useState<'short' | 'full'>('short');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pausedElapsed, setPausedElapsed] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The activity this goal counts, read from the same public pulse the kiosk
  // and the display use. A goal this caller may not read simply has no
  // follow-along; the screen says so rather than guessing an activity.
  useEffect(() => {
    let cancelled = false;
    if (!goalId) {
      setScreen({ kind: 'unavailable' });
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const fn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const { data } = await fn({ goalId });
        if (cancelled) return;
        setScreen({ kind: 'ready', unit: data.unit ?? '', goalTitle: data.goalTitle ?? '' });
      } catch {
        if (!cancelled) setScreen({ kind: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goalId]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        if (!cancelled) setReducedMotion(Boolean(on));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // One interval, only while something is running.
  useEffect(() => {
    if (startedAt === null) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return undefined;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [startedAt]);

  const unit = screen.kind === 'ready' ? screen.unit : '';
  const plan = useMemo(() => buildFollowAlongPlan({ unit, length }), [unit, length]);

  const elapsedMs = startedAt === null ? pausedElapsed : pausedElapsed + (now - startedAt);
  const at = stepAt(plan, elapsedMs);
  const running = startedAt !== null;

  const onStart = useCallback(() => {
    setStartedAt(Date.now());
  }, []);

  const onPause = useCallback(() => {
    setStartedAt((was) => {
      if (was !== null) setPausedElapsed((held) => held + (Date.now() - was));
      return null;
    });
  }, []);

  // Stop means stop: back to the beginning, nothing kept, nothing recorded.
  const onStop = useCallback(() => {
    setStartedAt(null);
    setPausedElapsed(0);
  }, []);

  const kind = figureKindFor(unit);
  const alternating = running && at.step.kind === 'move' && !reducedMotion;
  const pose = alternating && Math.floor(elapsedMs / POSE_MS) % 2 === 1 ? 'end' : 'start';

  if (screen.kind === 'loading') {
    return (
      <Page>
        <Text style={kit.statusText} testID="wsf-move-loading">
          Loading…
        </Text>
      </Page>
    );
  }

  if (screen.kind === 'unavailable') {
    return (
      <Page>
        <Text style={kit.heading} testID="wsf-move-not-available">
          This follow-along isn’t available
        </Text>
        <Text style={kit.body}>
          The goal it belongs to could not be found, or it isn’t open to this screen.
        </Text>
      </Page>
    );
  }

  return (
    <Page>
      <Text style={kit.eyebrow} testID="wsf-move-heading">
        Follow along
      </Text>
      <Text style={kit.heading}>{screen.goalTitle || plan.unit}</Text>

      <View style={kit.card}>
        <Text style={kit.cardTitle} testID="wsf-move-step-title">
          {at.step.title}
        </Text>
        <Text style={kit.body} testID="wsf-move-step-rule">
          {at.step.detail}
        </Text>

        <View style={styles.figureRow} testID="wsf-move-figure">
          <Image
            source={{ uri: moveFigureSvgDataUriRaw({ kind, pose }) }}
            style={styles.figure}
            resizeMode="contain"
            accessibilityLabel={moveFigureLabel(kind, pose)}
            testID="wsf-move-figure-image"
          />
          {/*
            With reduced motion asked for, nothing alternates: both positions
            are shown side by side instead, so the shape still reads.
          */}
          {reducedMotion ? (
            <Image
              source={{ uri: moveFigureSvgDataUriRaw({ kind, pose: 'end', accent: true }) }}
              style={styles.figure}
              resizeMode="contain"
              accessibilityLabel={moveFigureLabel(kind, 'end')}
              testID="wsf-move-reduced-motion"
            />
          ) : null}
        </View>

        <Text style={styles.timer} testID="wsf-move-timer">
          {at.step.kind === 'done' ? 'Done' : `${secondsLeft(at.remainingMs)}s`}
        </Text>
        <Text style={kit.cardMeta} testID="wsf-move-round">
          Step {at.index + 1} of {plan.steps.length} · {plan.totalSeconds}s in total
        </Text>
      </View>

      <View style={kit.card}>
        <Text style={kit.cardTitle}>How long</Text>
        <View style={styles.row}>
          <Choice
            label="Short"
            selected={length === 'short'}
            onPress={() => {
              onStop();
              setLength('short');
            }}
            testID="wsf-move-length-short"
          />
          <Choice
            label="Full round"
            selected={length === 'full'}
            onPress={() => {
              onStop();
              setLength('full');
            }}
            testID="wsf-move-length-full"
          />
        </View>
      </View>

      <View style={styles.row}>
        {running ? (
          <Pressable onPress={onPause} style={kit.primaryButton} testID="wsf-move-pause">
            <Text style={kit.primaryButtonText}>Pause</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onStart} style={kit.primaryButton} testID="wsf-move-start">
            <Text style={kit.primaryButtonText}>
              {elapsedMs > 0 ? 'Resume' : 'Start'}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onStop} style={kit.secondaryButton} testID="wsf-move-stop">
          <Text style={kit.secondaryButtonText}>Stop</Text>
        </Pressable>
      </View>

      {/*
        The whole point, stated on screen and never implied: this screen does
        not count and does not record. The member adds their own number where
        they always have.
      */}
      <Text style={kit.caption} testID="wsf-move-self-count">
        {plan.selfCountNote}
      </Text>
      <ButtonLink
        href={`/contribute/${goalId}`}
        label="Add what you counted"
        style={kit.secondaryButton}
        textStyle={kit.secondaryButtonText}
        testID="wsf-move-contribute"
      />
    </Page>
  );
}

function Choice(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[kit.pill, props.selected ? styles.pillSelected : null]}
      testID={props.testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      {...({ 'aria-checked': props.selected } as Record<string, unknown>)}
    >
      <Text style={props.selected ? styles.pillTextSelected : kit.pillText}>{props.label}</Text>
    </Pressable>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
      <View style={kit.column} testID="wsf-move-screen">
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-move-wordmark" />
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  figure: { width: 100, height: 120 },
  timer: {
    color: wsfTheme.colors.text,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pillSelected: { backgroundColor: wsfTheme.colors.text, borderColor: wsfTheme.colors.text },
  pillTextSelected: { color: '#F7F5F0', fontSize: 15, fontWeight: '700' },
});
