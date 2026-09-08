import { Link, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addSquats, resetDemo, useDemoState, type AddSquatsResult } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

type Screen = 'ready' | 'counting' | 'recorded';

const COUNT_DURATION_MS = 30_000;
const TICK_MS = 250;
const SIMULATE_COUNT = 20;

export default function DemoSquats() {
  const { squats } = useDemoState();
  const [screen, setScreen] = useState<Screen>('ready');
  const [reps, setReps] = useState(0);
  const [remainingMs, setRemainingMs] = useState(COUNT_DURATION_MS);
  const [lastResult, setLastResult] = useState<AddSquatsResult | null>(null);
  const [animatedTotal, setAnimatedTotal] = useState(squats.current);
  const startTsRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      if (animRef.current) clearInterval(animRef.current);
    };
  }, [stopTimer]);

  useEffect(() => {
    if (screen !== 'counting') return;
    startTsRef.current = Date.now();
    setRemainingMs(COUNT_DURATION_MS);
    intervalRef.current = setInterval(() => {
      const started = startTsRef.current ?? Date.now();
      const elapsed = Date.now() - started;
      const remaining = Math.max(0, COUNT_DURATION_MS - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        stopTimer();
      }
    }, TICK_MS);
    return stopTimer;
  }, [screen, stopTimer]);

  const beginCount = useCallback(() => {
    setReps(0);
    setScreen('counting');
  }, []);

  const bumpRep = useCallback(() => {
    setReps((prev) => prev + 1);
  }, []);

  const undoRep = useCallback(() => {
    setReps((prev) => Math.max(0, prev - 1));
  }, []);

  const finishManual = useCallback(() => {
    stopTimer();
    if (reps <= 0) {
      setScreen('ready');
      return;
    }
    animateResult(addSquats(reps));
  }, [reps, stopTimer]);

  const simulate = useCallback(() => {
    animateResult(addSquats(SIMULATE_COUNT));
  }, []);

  function animateResult(result: AddSquatsResult) {
    setLastResult(result);
    setScreen('recorded');
    setAnimatedTotal(result.previousTotal);
    if (animRef.current) clearInterval(animRef.current);
    const delta = result.newTotal - result.previousTotal;
    if (delta <= 0) {
      setAnimatedTotal(result.newTotal);
      return;
    }
    const steps = Math.min(delta, 40);
    const stepValue = delta / steps;
    let cursor = 0;
    animRef.current = setInterval(() => {
      cursor += 1;
      if (cursor >= steps) {
        setAnimatedTotal(result.newTotal);
        if (animRef.current) clearInterval(animRef.current);
        return;
      }
      setAnimatedTotal(Math.round(result.previousTotal + stepValue * cursor));
    }, 40);
  }

  const backToPicker = useCallback(() => {
    router.push('/demo');
  }, []);

  const resetAndStay = useCallback(() => {
    resetDemo();
    setReps(0);
    setLastResult(null);
    setAnimatedTotal(0);
    setScreen('ready');
    // reflect after reset
    setTimeout(() => setAnimatedTotal(980), 0);
  }, []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      testID="demo-squats"
    >
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Pressable
            onPress={backToPicker}
            style={styles.backLink}
            testID="demo-squats-back"
            accessibilityRole="button"
          >
            <Text style={styles.backLinkText}>← Back to activities</Text>
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>Squats</Text>
        <Text style={styles.heading}>Add your reps to the WE total.</Text>
        <Text style={styles.subline}>
          Do a set now, then log what you actually did. Honest counts only — this demo does not
          detect reps for you.
        </Text>

        <View style={styles.totalCard} testID="demo-squats-total">
          <Text style={styles.totalLabel}>Community squat count</Text>
          <Text style={styles.totalNumber}>{squats.current.toLocaleString()}</Text>
          <Text style={styles.totalGoal}>of {squats.goal.toLocaleString()} squats</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, Math.round((squats.current / squats.goal) * 100))}%` },
              ]}
            />
          </View>
        </View>

        {screen === 'ready' ? (
          <ReadyPanel onBegin={beginCount} onSimulate={simulate} />
        ) : screen === 'counting' ? (
          <CountingPanel
            reps={reps}
            remainingMs={remainingMs}
            onBump={bumpRep}
            onUndo={undoRep}
            onDone={finishManual}
            onCancel={() => {
              stopTimer();
              setScreen('ready');
              setReps(0);
            }}
          />
        ) : (
          <RecordedPanel
            result={lastResult}
            animatedTotal={animatedTotal}
            committedTotal={squats.current}
            goal={squats.goal}
            onAddMore={() => {
              setReps(0);
              setScreen('ready');
            }}
            onReset={resetAndStay}
            onBackToPicker={backToPicker}
          />
        )}
      </View>
    </ScrollView>
  );
}

function ReadyPanel({ onBegin, onSimulate }: { onBegin: () => void; onSimulate: () => void }) {
  return (
    <View style={styles.panel} testID="demo-squats-ready">
      <Text style={styles.panelTitle}>Ready when you are</Text>
      <Text style={styles.panelBody}>
        Tap Begin, do your squats, and tap the big button each time you complete a rep. When you're
        done, tap Done and we'll add your reps to the community total.
      </Text>
      <View style={styles.actionsCol}>
        <Pressable
          onPress={onBegin}
          style={styles.primaryButton}
          testID="demo-squats-begin"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Begin — 30 second window</Text>
        </Pressable>
        <Pressable
          onPress={onSimulate}
          style={styles.secondaryButton}
          testID="demo-squats-simulate"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Simulate 20 squats for the demo</Text>
        </Pressable>
      </View>
      <Text style={styles.helper}>
        Simulate is a demo shortcut so the audience can see the total climb without waiting 30
        seconds. Real logging happens through Begin.
      </Text>
    </View>
  );
}

function CountingPanel({
  reps,
  remainingMs,
  onBump,
  onUndo,
  onDone,
  onCancel,
}: {
  reps: number;
  remainingMs: number;
  onBump: () => void;
  onUndo: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const done = remainingMs <= 0;
  return (
    <View style={styles.panel} testID="demo-squats-counting">
      <View style={styles.countingHeader}>
        <View>
          <Text style={styles.panelTitle}>{done ? 'Time' : `${seconds}s left`}</Text>
          <Text style={styles.helper}>
            {done ? 'Tap Done to log your reps.' : 'Tap for each squat you complete.'}
          </Text>
        </View>
        <View style={styles.repsPill}>
          <Text style={styles.repsPillLabel}>Reps</Text>
          <Text style={styles.repsPillCount}>{reps}</Text>
        </View>
      </View>

      <Pressable
        onPress={onBump}
        style={[styles.repButton, done && styles.repButtonDone]}
        disabled={done}
        testID="demo-squats-bump"
        accessibilityRole="button"
      >
        <Text style={styles.repButtonText}>{done ? 'Time is up' : 'Count one squat'}</Text>
        <Text style={styles.repButtonHint}>{done ? 'Tap Done below' : 'Big tap target'}</Text>
      </Pressable>

      <View style={styles.actionsRow}>
        <Pressable
          onPress={onUndo}
          disabled={reps <= 0}
          style={[styles.tertiaryButton, reps <= 0 && styles.tertiaryButtonDisabled]}
          testID="demo-squats-undo"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Undo last rep</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={styles.tertiaryButton}
          testID="demo-squats-cancel"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          style={styles.primaryButton}
          testID="demo-squats-done"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Done — add {reps} to WE total</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RecordedPanel({
  result,
  animatedTotal,
  committedTotal,
  goal,
  onAddMore,
  onReset,
  onBackToPicker,
}: {
  result: AddSquatsResult | null;
  animatedTotal: number;
  committedTotal: number;
  goal: number;
  onAddMore: () => void;
  onReset: () => void;
  onBackToPicker: () => void;
}) {
  // goalReached reflects committed state, not the mid-count-up animation
  // value, so the "Add another set" button and the helper copy stay honest
  // during the ~1.6s count-up animation right after a milestone add.
  const goalReached = committedTotal >= goal;
  const displayTotal = goalReached ? goal : animatedTotal;
  return (
    <View style={styles.panel} testID="demo-squats-recorded">
      {result?.crossedMilestone || (result && result.newTotal >= goal && result.addedCount > 0) ? (
        <MilestoneCard result={result} goal={goal} />
      ) : (
        <Text style={styles.panelTitle}>
          Nice — added {result?.addedCount ?? 0} to the WE total.
        </Text>
      )}
      <Text style={styles.helper}>
        {goalReached
          ? 'The community hit the goal. Reset the demo to run it again.'
          : `Community squat count is now ${displayTotal.toLocaleString()} of ${goal.toLocaleString()}.`}
      </Text>

      <View style={styles.actionsCol}>
        {goalReached ? null : (
          <Pressable
            onPress={onAddMore}
            style={styles.primaryButton}
            testID="demo-squats-add-more"
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Add another set</Text>
          </Pressable>
        )}
        <Link
          href="/demo/display"
          style={styles.secondaryLink}
          testID="demo-squats-open-display"
        >
          Open community display
        </Link>
        <Pressable
          onPress={onReset}
          style={styles.tertiaryButton}
          testID="demo-squats-reset"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Reset demo</Text>
        </Pressable>
        <Pressable
          onPress={onBackToPicker}
          style={styles.tertiaryButton}
          testID="demo-squats-back-to-picker"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Back to activities</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MilestoneCard({ result, goal }: { result: AddSquatsResult; goal: number }) {
  return (
    <View style={styles.milestoneCard} testID="demo-squats-milestone">
      <Text style={styles.milestoneEyebrow}>Milestone reached</Text>
      <Text style={styles.milestoneHeadline}>The community just hit {goal.toLocaleString()}.</Text>
      <Text style={styles.milestoneBody}>
        Your set of {result.addedCount} squats pushed the WE total from {result.previousTotal.toLocaleString()}{' '}
        to {result.newTotal.toLocaleString()}. That's the goal — together.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
  },
  scrollContent: {
    padding: wsfTheme.spacing.lg,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 720,
  },
  topRow: {
    marginBottom: wsfTheme.spacing.md,
  },
  backLink: {
    alignSelf: 'flex-start',
  },
  backLinkText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  eyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.xs,
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    marginBottom: wsfTheme.spacing.sm,
  },
  subline: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  totalCard: {
    backgroundColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.lg,
    padding: wsfTheme.spacing.lg,
    marginBottom: wsfTheme.spacing.lg,
    alignItems: 'flex-start',
  },
  totalLabel: {
    color: wsfTheme.colors.accent,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.xs,
  },
  totalNumber: {
    color: wsfTheme.colors.surface,
    fontSize: 52,
    fontWeight: '800',
    lineHeight: 56,
  },
  totalGoal: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    marginBottom: wsfTheme.spacing.md,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    backgroundColor: wsfTheme.colors.accent,
  },
  panel: {
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.lg,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    padding: wsfTheme.spacing.lg,
  },
  panelTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize + 4,
    fontWeight: '700',
    marginBottom: wsfTheme.spacing.sm,
  },
  panelBody: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  helper: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    lineHeight: 18,
    marginTop: wsfTheme.spacing.sm,
  },
  actionsCol: {
    flexDirection: 'column',
    gap: wsfTheme.spacing.sm,
    marginTop: wsfTheme.spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
    marginTop: wsfTheme.spacing.md,
  },
  primaryButton: {
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  secondaryLink: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.primary,
    color: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
    fontWeight: '700',
    textDecorationLine: 'none' as const,
  },
  tertiaryButton: {
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    borderRadius: wsfTheme.radius.sm,
  },
  tertiaryButtonDisabled: {
    opacity: 0.4,
  },
  tertiaryButtonText: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  countingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: wsfTheme.spacing.md,
    gap: wsfTheme.spacing.md,
  },
  repsPill: {
    backgroundColor: wsfTheme.colors.background,
    borderWidth: 2,
    borderColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.md,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    alignItems: 'center',
    minWidth: 96,
  },
  repsPillLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  repsPillCount: {
    color: wsfTheme.colors.text,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  repButton: {
    backgroundColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.lg,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: wsfTheme.spacing.md,
  },
  repButtonDone: {
    backgroundColor: wsfTheme.colors.border,
  },
  repButtonText: {
    color: wsfTheme.colors.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  repButtonHint: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    marginTop: 4,
    fontWeight: '600',
    opacity: 0.7,
  },
  milestoneCard: {
    backgroundColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.lg,
    padding: wsfTheme.spacing.lg,
    marginBottom: wsfTheme.spacing.md,
  },
  milestoneEyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.xs,
  },
  milestoneHeadline: {
    color: wsfTheme.colors.primary,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: wsfTheme.spacing.sm,
  },
  milestoneBody: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
  },
});
