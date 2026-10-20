import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import type { TogetherPresentation } from '../contributionFlow';
import { LivingWeProgress } from './LivingWeProgress';
import { percentLabel, statusLine, totalOfTargetParts } from './progressFormat';
import { runTogetherMotion, TOGETHER_COLORS } from './togetherMotion';
import {
  createNativeTogetherRun,
  startTogetherNativeMotion,
  TogetherNativeLayer,
  type NativeTogetherRun,
} from './togetherMotionNative';
import {
  decideTogetherPhase,
  NATIVE_START_DEADLINE_MS,
  nextTogetherPhase,
  settlesAtDeadline,
  settlesOnAppState,
  type TogetherPhase,
} from './togetherPhase';
import { useReducedMotionPreference } from './useReducedMotion';

/**
 * TOGETHER-COMPLETION-1 — the owner-selected completion on the confirmed
 * member receipt. One centred column: the member's exact addition, the
 * dominant WE, the two-line payoff, the exact shared result, and the screen's
 * own existing next actions (passed in, never re-implemented here).
 *
 * TRUTH IS RENDERED FIRST AND NEVER WAITS. Every number and every sentence is
 * on screen from the first frame; the motion only decorates it, and cancelling
 * the motion at any point leaves exactly the same receipt.
 *
 * FRESHNESS IS READ ONCE, AT MOUNT. `fresh` decides whether THIS instance may
 * play; the instance then tells its owner the eligibility is spent
 * (`onFreshConsumed`) so a re-render, a remount or a later reopen is static.
 * Nothing here stores it.
 *
 * TEST IDS ARE THE RECEIPT'S OWN. The heading, payoff, amount, shared total,
 * percent and status keep the ids every existing receipt spec reads.
 *
 * NATIVE-MOTION-1. iOS and Android play the same timeline as the web
 * (togetherMotionNative.tsx, from togetherMotion.ts's numbers). Native differs
 * only in how it reaches the same one decision (togetherPhase.ts): it waits —
 * showing the trusted before ratio, moving nothing — until the reduced-motion
 * preference has been read and the stage is measured, then plays or settles;
 * anything not ready within NATIVE_START_DEADLINE_MS settles. Leaving the
 * foreground settles it for good. The web path is unchanged.
 */
export function TogetherCompletion({
  presentation: p,
  eyebrow,
  amountText,
  unit,
  shared,
  context,
  ownCredit,
  standing,
  actions,
  fresh,
  onFreshConsumed,
  windowWidth,
  windowHeight,
}: {
  presentation: TogetherPresentation;
  /** "Recorded" / "Already recorded", directly above the amount. */
  eyebrow: string;
  /** The exact recorded amount as the receipt states it ("+20", or "20" for a replay). */
  amountText: string;
  unit: string | null;
  shared: { total: number; target: number; unit: string; status: 'active' | 'closed' } | null;
  context: { communityName: string; goalTitle: string } | null;
  ownCredit: ReactNode;
  standing: ReactNode;
  actions: ReactNode;
  fresh: boolean;
  onFreshConsumed: () => void;
  windowWidth: number;
  windowHeight: number;
}) {
  const preference = useReducedMotionPreference();
  const reduced = preference.reduced;
  const web = Platform.OS === 'web';
  const short = windowHeight < 700;

  // The eligibility inputs AS THEY WERE AT MOUNT. The owner clears `fresh`
  // the moment it is consumed (and `p.animate` with it), so a native receipt
  // still waiting on its preference must not re-read them.
  const mountedWith = useRef({ fresh, animate: p.animate }).current;

  // ONE decision, at mount. Later prop changes cannot start it again; native
  // may only defer it (`pending`) until the reduced-motion answer arrives.
  const [phase, setPhase] = useState<TogetherPhase>(() =>
    decideTogetherPhase({
      fresh,
      animate: p.animate,
      reducedKnown: preference.known,
      reduced,
      platform: Platform.OS,
      appActive: web || !settlesOnAppState(AppState.currentState),
    })
  );
  const [displayRatio, setDisplayRatio] = useState<number | null>(() =>
    phase === 'settled' ? null : p.fromRatio
  );
  const consumedRef = useRef(false);
  // Whether this instance was ELIGIBLE when it appeared. The owner clears
  // `fresh` the moment it is consumed, so later renders must not read it.
  const eligibleAtMount = mountedWith.fresh && mountedWith.animate;
  const cancelRef = useRef<((finish: boolean) => void) | null>(null);
  const stageRef = useRef<View>(null);
  const markRef = useRef<View>(null);
  // Native only: the measured stage and mark, and whether the motion started.
  const stageSize = useRef<{ width: number; height: number } | null>(null);
  const markFrame = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [measured, setMeasured] = useState(false);
  const startedRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (fresh && !consumedRef.current) {
      consumedRef.current = true;
      onFreshConsumed();
    }
    // Mount only: freshness is a fact about the moment this receipt appeared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = useCallback(() => {
    cancelRef.current = null;
    setDisplayRatio(null);
    setPhase('settled');
  }, []);

  // Settle now, from wherever this instance is: a running motion is stopped
  // through its own cancel (final ratio, then settle); a waiting one settles.
  const finishNow = useCallback(() => {
    if (cancelRef.current) cancelRef.current(true);
    else settle();
  }, [settle]);

  useEffect(() => {
    if (phase !== 'playing' || !web) return;
    const stage = stageRef.current as unknown as HTMLElement | null;
    const mark = markRef.current as unknown as HTMLElement | null;
    if (!stage || !mark || typeof document === 'undefined') {
      settle();
      return;
    }
    const cancel = runTogetherMotion({
      stage,
      mark,
      crossed: p.crossed,
      from: p.fromRatio,
      to: p.toRatio,
      onRatio: (ratio) => setDisplayRatio(ratio),
      onSettled: settle,
    });
    cancelRef.current = cancel;
    // Close, route exit and unmount cancel every timer, frame and animation.
    return () => {
      cancel(false);
      cancelRef.current = null;
    };
    // Started once; the receipt's figures cannot change under a playing instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'playing']);

  // Reduced motion switched ON while playing settles THIS instance for good;
  // switching it OFF later finds a settled instance and replays nothing.
  // (Native: also an instance still waiting for its layout.)
  useEffect(() => {
    if (!reduced) return;
    if (cancelRef.current) cancelRef.current(true);
    else if (!web && phaseRef.current !== 'settled') settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // NATIVE: the deferred half of the one decision. Only `pending` moves, and
  // only on the mount-time eligibility: reduced → settled, not → playing.
  useEffect(() => {
    if (phase !== 'pending') return;
    const next = nextTogetherPhase(phase, {
      ...mountedWith,
      reducedKnown: preference.known,
      reduced: preference.reduced,
      platform: Platform.OS,
    });
    if (next === 'settled') settle();
    else if (next !== phase) setPhase(next);
  }, [phase, preference.known, preference.reduced, mountedWith, settle]);

  // NATIVE: the stage and the mark measure themselves; the motion needs both.
  const onStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    stageSize.current = { width, height };
    if (markFrame.current) setMeasured(true);
  }, []);
  const onMarkLayout = useCallback((e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    markFrame.current = { x, y, width, height };
    if (stageSize.current) setMeasured(true);
  }, []);
  const measuring = !web && phase !== 'settled';

  // NATIVE: one run per instance, built from the measurements at its start
  // (as the web measures at its start), and only while playing.
  const nativeRun = useMemo<NativeTogetherRun | null>(() => {
    const stage = stageSize.current;
    const mark = markFrame.current;
    if (web || phase !== 'playing' || !measured || !stage || !mark) return null;
    return createNativeTogetherRun({
      crossed: p.crossed,
      width: Math.max(1, stage.width),
      height: Math.max(1, stage.height),
      centerX: mark.x + mark.width / 2,
      centerY: mark.y + mark.height / 2,
      markWidth: mark.width,
      markHeight: mark.height,
    });
    // Built once when play begins; the receipt's figures cannot change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [web, phase === 'playing', measured]);

  useEffect(() => {
    if (!nativeRun) return;
    startedRef.current = true;
    const cancel = startTogetherNativeMotion({
      run: nativeRun,
      from: p.fromRatio,
      to: p.toRatio,
      onRatio: (ratio) => setDisplayRatio(ratio),
      onSettled: settle,
    });
    cancelRef.current = cancel;
    // Close, route exit and unmount stop every animation, timer and frame.
    return () => {
      cancel(false);
      cancelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeRun]);

  // NATIVE: anything not moving by the deadline settles instead of starting late.
  useEffect(() => {
    if (web || phase === 'settled') return;
    const timer = setTimeout(() => {
      if (settlesAtDeadline(phaseRef.current, startedRef.current)) finishNow();
    }, NATIVE_START_DEADLINE_MS);
    return () => clearTimeout(timer);
    // Mount only: the deadline is measured from the moment the receipt appeared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NATIVE: leaving the foreground settles for good; coming back replays nothing.
  const settledNow = phase === 'settled';
  useEffect(() => {
    if (web || settledNow) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (settlesOnAppState(next)) finishNow();
    });
    return () => sub?.remove?.();
  }, [web, settledNow, finishNow]);

  const columnWidth = Math.min(windowWidth, 430);
  const markWidth = Math.max(160, Math.min(columnWidth - 48, short ? 214 : 332));
  const lines = p.payoffLines;
  const we = shared ? (
    <LivingWeProgress
      completed={shared.total}
      target={shared.target}
      unit={shared.unit}
      width={markWidth}
      surface="dark"
      unfilledTint={TOGETHER_COLORS.unfilled}
      displayRatio={displayRatio}
      testID="wsf-contribute-we"
    />
  ) : null;

  return (
    <View
      style={styles.root}
      testID="wsf-together"
      {...({
        dataSet: {
          'together-phase': phase,
          'together-animate': eligibleAtMount ? 'eligible' : 'static',
          'together-crossed': p.crossed ? 'true' : 'false',
        },
      } as Record<string, unknown>)}
    >
      {context ? (
        <View style={styles.context}>
          {/* Wrapped, never truncated past the edge: a long name stays whole and readable. */}
          <Text style={styles.contextCommunity}>{context.communityName}</Text>
          <Text style={styles.contextGoal}>{context.goalTitle}</Text>
        </View>
      ) : null}

      <View ref={stageRef} style={styles.stage} onLayout={measuring ? onStageLayout : undefined}>
        <View style={styles.effort}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={[styles.amount, short ? styles.amountShort : null]} testID="wsf-contribute-result-amount">
            {amountText}
          </Text>
          {/* The receipt's heading, in words: the same sentence it has always been. */}
          <Text style={styles.headline} testID="wsf-contribute-result-headline" {...HEADING_1}>
            {p.headline}
          </Text>
        </View>

        {shared ? (
          <View
            ref={markRef}
            style={[styles.mark, short ? styles.markShort : null, { width: markWidth }]}
            testID="wsf-together-mark"
            onLayout={measuring ? onMarkLayout : undefined}
          >
            {web ? (
              we
            ) : (
              // Native: the pulse scales this wrapper (the web animates the mark itself).
              // Always present on native, so starting or ending the pulse never remounts the WE.
              <Animated.View style={nativeRun ? nativeRun.styles.pulse : undefined}>{we}</Animated.View>
            )}
          </View>
        ) : null}

        <Text
          style={[styles.payoff, short ? styles.payoffShort : null]}
          testID="wsf-contribute-result-subline"
          {...HEADING_2}
        >
          {lines ? `${lines[0]}\n${lines[1]}` : p.payoff}
        </Text>

        {/* Native: the web canvas's layer, on top of the stage, only while playing. */}
        {nativeRun ? <TogetherNativeLayer run={nativeRun} /> : null}
      </View>

      {shared ? (
        <View style={[styles.totals, short ? styles.tightTop : null]}>
          {/*
            NO BEFORE → AFTER PAIR IN TEXT. The donor prints "241 → 261"; the
            canonical receipt does not. Under concurrency the confirmed total
            includes other members' work, and a printed pair beside "+20" would
            read as this member's delta (the existing receipt invariant in
            ui-contribute.spec.ts). The reliable before drives only the visual
            fill tween; the exact confirmed total is the text.
          */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLine} testID="wsf-contribute-shared-total">
              <Text style={styles.totalCount}>{totalOfTargetParts(shared.total, shared.target, shared.unit).count}</Text>{' '}
              <Text style={styles.totalRest}>{totalOfTargetParts(shared.total, shared.target, shared.unit).rest}</Text>
            </Text>
          </View>
          <Text style={styles.detail}>
            <Text testID="wsf-contribute-percent">{`${percentLabel(shared.total, shared.target)} complete`}</Text>
            {' · '}
            <Text testID="wsf-contribute-status">{statusLine(shared.total, shared.target, shared.status)}</Text>
          </Text>
        </View>
      ) : null}

      <View style={[styles.facts, short ? styles.factsShort : null]}>
        {ownCredit}
        {standing}
      </View>

      <View style={[styles.actions, short ? styles.actionsShort : null]}>{actions}</View>
    </View>
  );
}

const HEADING_1 = { accessibilityRole: 'header', 'aria-level': 1 } as Record<string, unknown>;
const HEADING_2 = { accessibilityRole: 'header', 'aria-level': 2 } as Record<string, unknown>;

const styles = StyleSheet.create({
  root: { width: '100%', maxWidth: 430, alignSelf: 'center', alignItems: 'center', paddingBottom: 8 },
  context: { alignSelf: 'stretch', paddingHorizontal: 24, marginTop: 2 },
  contextCommunity: { color: TOGETHER_COLORS.text, fontSize: 14, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  contextGoal: { color: TOGETHER_COLORS.muted, fontSize: 12, lineHeight: 16, marginTop: 2, textAlign: 'center' },
  stage: { width: '100%', alignItems: 'center', position: 'relative', paddingTop: 6 },
  effort: { alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 24 },
  eyebrow: { color: TOGETHER_COLORS.muted, fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.9, marginTop: 6 },
  amount: {
    color: TOGETHER_COLORS.text,
    fontSize: 82,
    fontWeight: '600',
    lineHeight: 86,
    letterSpacing: -6,
    fontVariant: ['tabular-nums'],
  },
  amountShort: { fontSize: 64, lineHeight: 66, letterSpacing: -4.8 },
  headline: { color: TOGETHER_COLORS.muted, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  mark: { marginTop: 14, alignSelf: 'center' },
  markShort: { marginTop: 8 },
  tightTop: { marginTop: 6 },
  factsShort: { marginTop: 6, gap: 2 },
  actionsShort: { marginTop: 8 },
  payoff: {
    color: TOGETHER_COLORS.text,
    fontSize: 29,
    fontWeight: '700',
    lineHeight: 33,
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 24,
  },
  payoffShort: { fontSize: 27, lineHeight: 31, marginTop: 8 },
  totals: { alignItems: 'center', alignSelf: 'stretch', marginTop: 12, paddingHorizontal: 24 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'center' },
  totalLine: { color: TOGETHER_COLORS.text, fontVariant: ['tabular-nums'] },
  totalCount: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  totalRest: { color: TOGETHER_COLORS.muted, fontSize: 14 },
  detail: { color: TOGETHER_COLORS.muted, fontSize: 12, lineHeight: 16, marginTop: 4, textAlign: 'center' },
  facts: { alignItems: 'center', alignSelf: 'stretch', marginTop: 10, paddingHorizontal: 24, gap: 4 },
  actions: { width: '100%', paddingHorizontal: 24, marginTop: 14 },
});
