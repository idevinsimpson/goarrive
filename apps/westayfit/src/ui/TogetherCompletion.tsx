import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { TogetherPresentation } from '../contributionFlow';
import { LivingWeProgress } from './LivingWeProgress';
import { percentLabel, statusLine, totalOfTargetParts } from './progressFormat';
import { runTogetherMotion, TOGETHER_COLORS } from './togetherMotion';
import { useReducedMotion } from './useReducedMotion';

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
  const reduced = useReducedMotion();
  const short = windowHeight < 700;

  // ONE decision, at mount. Later prop changes cannot start it again.
  const [phase, setPhase] = useState<'playing' | 'settled'>(() =>
    fresh && p.animate && Platform.OS === 'web' && !reduced ? 'playing' : 'settled'
  );
  const [displayRatio, setDisplayRatio] = useState<number | null>(() =>
    phase === 'playing' ? p.fromRatio : null
  );
  const consumedRef = useRef(false);
  // Whether this instance was ELIGIBLE when it appeared. The owner clears
  // `fresh` the moment it is consumed, so later renders must not read it.
  const eligibleAtMount = useRef(fresh && p.animate).current;
  const cancelRef = useRef<((finish: boolean) => void) | null>(null);
  const stageRef = useRef<View>(null);
  const markRef = useRef<View>(null);

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

  useEffect(() => {
    if (phase !== 'playing') return;
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
  useEffect(() => {
    if (reduced && cancelRef.current) cancelRef.current(true);
  }, [reduced]);

  const columnWidth = Math.min(windowWidth, 430);
  const markWidth = Math.max(160, Math.min(columnWidth - 48, short ? 214 : 332));
  const lines = p.payoffLines;

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

      <View ref={stageRef} style={styles.stage}>
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
          <View ref={markRef} style={[styles.mark, short ? styles.markShort : null, { width: markWidth }]} testID="wsf-together-mark">
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
          </View>
        ) : null}

        <Text
          style={[styles.payoff, short ? styles.payoffShort : null]}
          testID="wsf-contribute-result-subline"
          {...HEADING_2}
        >
          {lines ? `${lines[0]}\n${lines[1]}` : p.payoff}
        </Text>
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
