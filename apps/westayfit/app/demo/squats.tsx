import { Link, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { addSquats, resetDemo, useDemoState, type AddSquatsResult } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

type Screen = 'ready' | 'timing' | 'entering' | 'recorded';

const TIMER_DURATION_MS = 30_000;
const TICK_MS = 250;
const SIMULATE_COUNT = 20;
const ANIM_STEP_MS = 40;
const ANIM_MAX_STEPS = 40;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
    // Older Safari fallback
    mq.addListener(listener);
    return () => mq.removeListener(listener);
  }, []);
  return reduced;
}

export default function DemoSquats() {
  const { squats } = useDemoState();
  const [screen, setScreen] = useState<Screen>('ready');
  const [coachCount, setCoachCount] = useState(0);
  const [entryText, setEntryText] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(TIMER_DURATION_MS);
  const [lastResult, setLastResult] = useState<AddSquatsResult | null>(null);
  const [animatedTotal, setAnimatedTotal] = useState(squats.current);
  const startTsRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAnim = useCallback(() => {
    if (animRef.current) {
      clearInterval(animRef.current);
      animRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTimer();
      stopAnim();
    };
  }, [stopTimer, stopAnim]);

  useEffect(() => {
    if (screen !== 'timing') return;
    startTsRef.current = Date.now();
    setRemainingMs(TIMER_DURATION_MS);
    timerRef.current = setInterval(() => {
      const started = startTsRef.current ?? Date.now();
      const elapsed = Date.now() - started;
      const remaining = Math.max(0, TIMER_DURATION_MS - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        stopTimer();
      }
    }, TICK_MS);
    return stopTimer;
  }, [screen, stopTimer]);

  const goStartTimer = useCallback(() => {
    setCoachCount(0);
    setEntryError(null);
    setScreen('timing');
  }, []);

  const goSkipTimer = useCallback(() => {
    setCoachCount(0);
    setEntryText('');
    setEntryError(null);
    setScreen('entering');
  }, []);

  const bumpCoach = useCallback(() => setCoachCount((n) => n + 1), []);
  const undoCoach = useCallback(() => setCoachCount((n) => Math.max(0, n - 1)), []);

  const finishTimer = useCallback(() => {
    stopTimer();
    setEntryText(coachCount > 0 ? String(coachCount) : '');
    setEntryError(null);
    setScreen('entering');
  }, [coachCount, stopTimer]);

  const cancelToReady = useCallback(() => {
    stopTimer();
    setCoachCount(0);
    setEntryText('');
    setEntryError(null);
    setScreen('ready');
  }, [stopTimer]);

  function playAnimation(result: AddSquatsResult) {
    setAnimatedTotal(result.previousTotal);
    stopAnim();
    const delta = result.newTotal - result.previousTotal;
    if (delta <= 0 || reducedMotion) {
      setAnimatedTotal(result.newTotal);
      return;
    }
    const steps = Math.min(delta, ANIM_MAX_STEPS);
    const stepValue = delta / steps;
    let cursor = 0;
    animRef.current = setInterval(() => {
      cursor += 1;
      if (cursor >= steps) {
        setAnimatedTotal(result.newTotal);
        stopAnim();
        return;
      }
      setAnimatedTotal(Math.round(result.previousTotal + stepValue * cursor));
    }, ANIM_STEP_MS);
  }

  const submitEntry = useCallback(() => {
    if (submitting) return;
    const trimmed = entryText.trim();
    if (trimmed === '') {
      setEntryError('Enter how many squats you did.');
      return;
    }
    if (!/^\d+$/.test(trimmed)) {
      setEntryError('Enter a whole number of squats.');
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setEntryError('Enter a whole number of squats.');
      return;
    }
    if (parsed === 0) {
      setEntryError('Add at least 1 squat to log a set.');
      return;
    }
    setSubmitting(true);
    const result = addSquats(parsed);
    if (result.rejected) {
      setEntryError('That count could not be logged. Try a whole number like 12.');
      setSubmitting(false);
      return;
    }
    setLastResult(result);
    setScreen('recorded');
    playAnimation(result);
    setSubmitting(false);
  }, [entryText, submitting, reducedMotion]);

  const simulate = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    const result = addSquats(SIMULATE_COUNT);
    setLastResult(result);
    setScreen('recorded');
    playAnimation(result);
    setSubmitting(false);
  }, [submitting, reducedMotion]);

  const backToPicker = useCallback(() => {
    router.push('/demo');
  }, []);

  const resetAndReplay = useCallback(() => {
    stopAnim();
    resetDemo();
    setCoachCount(0);
    setEntryText('');
    setEntryError(null);
    setLastResult(null);
    setSubmitting(false);
    setAnimatedTotal(INITIAL_BASELINE);
    setScreen('ready');
  }, [stopAnim]);

  const addAnotherSet = useCallback(() => {
    setCoachCount(0);
    setEntryText('');
    setEntryError(null);
    setLastResult(null);
    setScreen('ready');
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
          Do a set at your own pace, then come back to log it. Honest counts only — this demo does
          not detect reps for you.
        </Text>

        <View style={styles.totalCard} testID="demo-squats-total">
          <Text style={styles.totalLabel}>Community squat count</Text>
          <Text style={styles.totalNumber}>{squats.current.toLocaleString()}</Text>
          <Text style={styles.totalGoal}>Goal {squats.goal.toLocaleString()} squats</Text>
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
          <ReadyPanel
            onStartTimer={goStartTimer}
            onSkipTimer={goSkipTimer}
            onSimulate={simulate}
            simulateDisabled={submitting}
          />
        ) : screen === 'timing' ? (
          <TimingPanel
            remainingMs={remainingMs}
            coachCount={coachCount}
            onBumpCoach={bumpCoach}
            onUndoCoach={undoCoach}
            onFinish={finishTimer}
            onCancel={cancelToReady}
          />
        ) : screen === 'entering' ? (
          <EnteringPanel
            value={entryText}
            onChange={(next: string) => {
              setEntryText(next);
              if (entryError) setEntryError(null);
            }}
            onBumpEntry={() => {
              const parsed = Number(entryText.trim());
              const base = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
              setEntryText(String(base + 1));
              if (entryError) setEntryError(null);
            }}
            onUndoEntry={() => {
              const parsed = Number(entryText.trim());
              const base = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
              setEntryText(String(Math.max(0, base - 1)));
              if (entryError) setEntryError(null);
            }}
            error={entryError}
            submitting={submitting}
            onSubmit={submitEntry}
            onCancel={cancelToReady}
          />
        ) : (
          <RecordedPanel
            result={lastResult}
            animatedTotal={animatedTotal}
            committedTotal={squats.current}
            goal={squats.goal}
            onAddMore={addAnotherSet}
            onReset={resetAndReplay}
            onBackToPicker={backToPicker}
          />
        )}
      </View>
    </ScrollView>
  );
}

const INITIAL_BASELINE = 980;

function ReadyPanel({
  onStartTimer,
  onSkipTimer,
  onSimulate,
  simulateDisabled,
}: {
  onStartTimer: () => void;
  onSkipTimer: () => void;
  onSimulate: () => void;
  simulateDisabled: boolean;
}) {
  return (
    <View style={styles.panel} testID="demo-squats-ready">
      <Text style={styles.panelTitle}>Two ways to log your set</Text>
      <Text style={styles.panelBody}>
        Start the 30-second timer, do your squats wherever feels good, and come back to enter how
        many you did. Or skip the timer and enter your count directly.
      </Text>
      <View style={styles.actionsCol}>
        <Pressable
          onPress={onStartTimer}
          style={styles.primaryButton}
          testID="demo-squats-start-timer"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Start 30-second timer</Text>
        </Pressable>
        <Pressable
          onPress={onSkipTimer}
          style={styles.secondaryButton}
          testID="demo-squats-skip-timer"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Skip timer — log reps now</Text>
        </Pressable>
        <Pressable
          onPress={onSimulate}
          disabled={simulateDisabled}
          style={[styles.tertiaryPill, simulateDisabled && styles.tertiaryButtonDisabled]}
          testID="demo-squats-simulate"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryPillText}>Simulate 20 squats for the demo</Text>
        </Pressable>
      </View>
      <Text style={styles.helper}>
        Simulate is a demo shortcut so the audience can see the total climb without waiting. Real
        logging happens through the timer or manual entry.
      </Text>
    </View>
  );
}

function TimingPanel({
  remainingMs,
  coachCount,
  onBumpCoach,
  onUndoCoach,
  onFinish,
  onCancel,
}: {
  remainingMs: number;
  coachCount: number;
  onBumpCoach: () => void;
  onUndoCoach: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const done = remainingMs <= 0;
  return (
    <View style={styles.panel} testID="demo-squats-timing">
      <Text style={styles.panelTitle}>{done ? 'Time' : `${seconds} seconds left`}</Text>
      <Text style={styles.panelBody}>
        Do your squats at your own pace. You don't have to stay at the screen. When you're ready,
        tap the button and enter your count.
      </Text>

      <View style={styles.timerBig}>
        <Text style={styles.timerBigNumber}>{seconds}</Text>
        <Text style={styles.timerBigLabel}>{done ? 'time is up' : 'seconds'}</Text>
      </View>

      <View style={styles.coachRow}>
        <View style={styles.coachTextCol}>
          <Text style={styles.coachTitle}>Optional coach counter</Text>
          <Text style={styles.coachHelper}>
            Have someone tap along as you squat. You can also skip this and just enter the total
            after.
          </Text>
        </View>
        <View style={styles.coachControls}>
          <Pressable
            onPress={onUndoCoach}
            disabled={coachCount <= 0}
            style={[styles.stepButton, coachCount <= 0 && styles.stepButtonDisabled]}
            testID="demo-squats-coach-minus"
            accessibilityRole="button"
          >
            <Text style={styles.stepButtonText}>−</Text>
          </Pressable>
          <View style={styles.stepValue}>
            <Text style={styles.stepValueNumber}>{coachCount}</Text>
          </View>
          <Pressable
            onPress={onBumpCoach}
            style={styles.stepButton}
            testID="demo-squats-coach-plus"
            accessibilityRole="button"
          >
            <Text style={styles.stepButtonText}>+</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.actionsCol}>
        <Pressable
          onPress={onFinish}
          style={styles.primaryButton}
          testID="demo-squats-finish-timer"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>I'm done — enter my reps</Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={styles.tertiaryButton}
          testID="demo-squats-cancel-timer"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EnteringPanel({
  value,
  onChange,
  onBumpEntry,
  onUndoEntry,
  error,
  submitting,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (next: string) => void;
  onBumpEntry: () => void;
  onUndoEntry: () => void;
  error: string | null;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const parsed = Number(value.trim());
  const validForSubmit = /^\d+$/.test(value.trim()) && Number.isFinite(parsed) && parsed > 0;
  return (
    <View style={styles.panel} testID="demo-squats-entering">
      <Text style={styles.panelTitle}>How many squats did you do?</Text>
      <Text style={styles.panelBody}>
        Enter your honest count. This adds to the community WE total.
      </Text>

      <View style={styles.entryRow}>
        <Pressable
          onPress={onUndoEntry}
          style={styles.stepButton}
          testID="demo-squats-entry-minus"
          accessibilityRole="button"
        >
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="0"
          style={styles.entryInput}
          testID="demo-squats-entry-input"
          accessibilityLabel="Number of squats"
          maxLength={4}
        />
        <Pressable
          onPress={onBumpEntry}
          style={styles.stepButton}
          testID="demo-squats-entry-plus"
          accessibilityRole="button"
        >
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={styles.errorText} testID="demo-squats-entry-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.actionsCol}>
        <Pressable
          onPress={onSubmit}
          disabled={!validForSubmit || submitting}
          style={[
            styles.primaryButton,
            (!validForSubmit || submitting) && styles.primaryButtonDisabled,
          ]}
          testID="demo-squats-log"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {submitting ? 'Logging…' : validForSubmit ? `Log ${parsed} to WE total` : 'Log to WE total'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          style={styles.tertiaryButton}
          testID="demo-squats-cancel-entry"
          accessibilityRole="button"
        >
          <Text style={styles.tertiaryButtonText}>Cancel</Text>
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
  // YOU → WE transition stays visible even when the goal is crossed. The
  // animation plays through overshoot; we never snap the display to `goal`.
  const showMilestone = !!result && result.crossedMilestone;
  const overGoal = committedTotal > goal;
  const displayTotal = animatedTotal;
  return (
    <View style={styles.panel} testID="demo-squats-recorded">
      {showMilestone ? <MilestoneCard result={result!} goal={goal} /> : null}

      <View style={styles.youBlock} testID="demo-squats-you-block">
        <Text style={styles.youLabel}>YOU added</Text>
        <Text style={styles.youNumber}>{result?.addedCount ?? 0}</Text>
        <Text style={styles.youUnit}>squats</Text>
      </View>

      <View style={styles.weBlock} testID="demo-squats-we-block">
        <Text style={styles.weLabel}>WE total is now</Text>
        <Text style={styles.weNumber}>{displayTotal.toLocaleString()}</Text>
        <Text style={styles.weFrom}>
          from {result?.previousTotal.toLocaleString() ?? '—'} · goal {goal.toLocaleString()}
          {overGoal ? ` · +${(committedTotal - goal).toLocaleString()} past goal` : ''}
        </Text>
      </View>

      <View style={styles.actionsCol}>
        <Pressable
          onPress={onAddMore}
          style={styles.primaryButton}
          testID="demo-squats-add-more"
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Log another set</Text>
        </Pressable>
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
      <Text style={styles.milestoneHeadline}>
        The community just crossed {goal.toLocaleString()}.
      </Text>
      <Text style={styles.milestoneBody}>
        Your set of {result.addedCount} squats moved the WE total from{' '}
        {result.previousTotal.toLocaleString()} to {result.newTotal.toLocaleString()}. Together —
        that's the point.
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
  primaryButton: {
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
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
  tertiaryPill: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tertiaryPillText: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
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
  timerBig: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: wsfTheme.spacing.lg,
    marginVertical: wsfTheme.spacing.sm,
    backgroundColor: wsfTheme.colors.background,
    borderRadius: wsfTheme.radius.lg,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
  },
  timerBigNumber: {
    color: wsfTheme.colors.primary,
    fontSize: 72,
    fontWeight: '800',
    lineHeight: 76,
  },
  timerBigLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginTop: wsfTheme.spacing.xs,
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.md,
    marginTop: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    backgroundColor: wsfTheme.colors.background,
    borderRadius: wsfTheme.radius.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    flexWrap: 'wrap',
  },
  coachTextCol: {
    flexBasis: 240,
    flexGrow: 1,
    flexShrink: 1,
  },
  coachTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  coachHelper: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    lineHeight: 18,
    marginTop: 4,
  },
  coachControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.sm,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: wsfTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepButtonText: {
    color: wsfTheme.colors.surface,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
  },
  stepValue: {
    minWidth: 64,
    alignItems: 'center',
  },
  stepValueNumber: {
    color: wsfTheme.colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: wsfTheme.spacing.md,
    marginVertical: wsfTheme.spacing.md,
  },
  entryInput: {
    flexGrow: 0,
    minWidth: 120,
    borderWidth: 2,
    borderColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.md,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
    color: wsfTheme.colors.text,
    backgroundColor: wsfTheme.colors.surface,
  },
  errorText: {
    color: '#B00020',
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    marginTop: wsfTheme.spacing.xs,
  },
  youBlock: {
    borderRadius: wsfTheme.radius.lg,
    backgroundColor: wsfTheme.colors.background,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    padding: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.sm,
    alignItems: 'flex-start',
  },
  youLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  youNumber: {
    color: wsfTheme.colors.primary,
    fontSize: 44,
    fontWeight: '900',
    lineHeight: 48,
    marginVertical: 4,
  },
  youUnit: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  weBlock: {
    borderRadius: wsfTheme.radius.lg,
    backgroundColor: wsfTheme.colors.primary,
    padding: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.md,
  },
  weLabel: {
    color: wsfTheme.colors.accent,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.xs,
  },
  weNumber: {
    color: wsfTheme.colors.surface,
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 60,
    marginBottom: 4,
  },
  weFrom: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
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
