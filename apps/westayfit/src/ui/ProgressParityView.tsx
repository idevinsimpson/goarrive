import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  bodyOf,
  heroEyebrow,
  orderedGoals,
  sharedCell,
  statusOf,
  summaryLine,
  unitTotals,
  type ProgressGoal,
  type ProgressReceipt,
  type ProgressState,
  type ProgressStatus,
} from '../progressParity';
import { ACTION_GREEN, NAVY, PROGRESS_GREEN, SURFACE, elevation } from './kit';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from './MemberTabBar';

/**
 * PROGRESS PARITY VIEW — the accepted Lovable Progress reference (`09b8a73c`,
 * `src/demo/screens/progress.tsx` + `src/styles.css`) as a PURE presentation
 * component (PROGRESS-PARITY-1, Director #451 `5840756702`, Phase A).
 *
 * It receives already-resolved canonical facts and callbacks. It makes NO
 * Firebase read, owns no route, touches no auth or storage, and carries none of
 * the prototype's demo authority. The route (`app/(tabs)/activity.tsx`, W9's
 * during PERF-MOBILE-1) resolves the state and renders this; the hook is
 * Phase B.
 *
 * ORDER, which is the claim: private to you → Your progress → the exact
 * recorded total, one per unit → the one quiet clarification → your receipts →
 * goals you helped, each with YOURS and SHARED apart and the reference's
 * lifecycle pill.
 *
 * THE RECEIPT SLOT. Dated receipts have no canonical source (see
 * src/progressParity.ts). With `receipts: null` the section keeps its place
 * and says so; it never draws a row nobody recorded. With an array — from a
 * future authorized source — it draws the reference's rows unchanged.
 *
 * The test ids keep the route's existing handles where the meaning is the same.
 */

export type ProgressParityActions = {
  onRetry: () => void;
  onStartMoving: () => void;
  onOpenCommunity: () => void;
  /** Opens one receipt. Unused while no receipt source exists. */
  onOpenReceipt: (id: string) => void;
};

export type ProgressParityViewProps = {
  state: ProgressState;
  actions: ProgressParityActions;
  /** The device's bottom safe area; the view already clears the tab bar. */
  bottomInset?: number;
};

/**
 * The reference's `@media (max-height: 700px)` block: a short phone tightens
 * the screen top, the heading and the state card. Same breakpoint, same values.
 */
export const PROGRESS_COMPACT_MAX_HEIGHT = 700;

/**
 * True on a phone no taller than the reference's breakpoint, once hydrated
 * (#418: the static export renders with no window, and React does not repair
 * attributes on hydration). A missing measurement never selects compact.
 */
export function useProgressCompact(): boolean {
  const { height } = useWindowDimensions();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated && height > 0 && height <= PROGRESS_COMPACT_MAX_HEIGHT;
}

const n = (v: number) => v.toLocaleString('en-US');

const CLARIFICATION =
  'This personal summary is only for you. Community activity follows your visibility settings.';

export function ProgressParityView({ state, actions, bottomInset = 0 }: ProgressParityViewProps) {
  const compact = useProgressCompact();
  const memberName = state.kind === 'failed' || state.kind === 'ready' ? state.memberName : null;
  const goals = state.kind === 'ready' ? orderedGoals(state.open, state.finished) : [];
  const body = state.kind === 'ready' ? bodyOf(state) : null;
  const showTotals = state.kind === 'ready' && body === 'goals';
  const card = [s.card, compact && s.cardCompact];

  return (
    <View
      style={s.screen}
      testID="wsf-activity"
      {...({ dataSet: { compact: compact ? 'true' : 'false' } } as Record<string, unknown>)}
    >
      <ScrollView
        contentContainerStyle={[
          s.body,
          compact && s.bodyCompact,
          { paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + bottomInset },
        ]}
      >
        {/* THE HERO. Private to you, then what the page is, then — when there
            is something recorded — the exact totals, one per unit. */}
        <View style={s.hero} testID="wsf-activity-hero">
          <Text style={s.eyebrow}>{heroEyebrow(memberName)}</Text>
          <Text
            style={[s.h1, compact && s.h1Compact]}
            testID="wsf-activity-title"
            accessibilityRole="header"
          >
            Your progress
          </Text>
          <Text style={s.subtitle} testID="wsf-activity-subtitle">
            Your recorded contributions, by goal.
          </Text>
          {state.kind === 'loading' ? (
            <View testID="wsf-activity-loading" accessibilityLabel="Loading what you have recorded">
              <View style={[s.skel, { width: '30%', height: 52 }]} />
              <View style={[s.skel, { width: '40%', height: 13, marginTop: 8 }]} />
              <View style={[s.skel, { width: '76%', height: 13, marginTop: 14 }]} />
            </View>
          ) : null}
          {showTotals ? (
            <>
              <View style={s.totals} testID="wsf-activity-totals">
                {unitTotals(goals).map((t, i) => (
                  <View
                    key={t.unit}
                    testID={`wsf-activity-total-${i}`}
                    accessible
                    accessibilityLabel={`${n(t.total)} ${t.unit} recorded`}
                  >
                    <Text style={s.totalNumber}>{n(t.total)}</Text>
                    <Text style={s.totalUnit}>{`${t.unit} recorded`}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.personalSub} testID="wsf-activity-summary">
                {summaryLine(goals)}
              </Text>
            </>
          ) : null}
          {state.kind === 'signedOut' || state.kind === 'loading' ? null : (
            <Text
              style={[s.clarify, showTotals && s.clarifyAfterTotals]}
              testID="wsf-activity-privacy"
            >
              {CLARIFICATION}
            </Text>
          )}
        </View>

        {state.kind === 'signedOut' ? (
          <View style={card} testID="wsf-activity-signed-out">
            <Text style={s.cardEyebrow}>YOUR CONTRIBUTIONS</Text>
            <Text style={s.cardTitle}>Sign in to see your progress</Text>
            <Text style={s.cardBody}>What you record is kept here by goal, with its exact unit.</Text>
          </View>
        ) : null}

        {state.kind === 'failed' ? (
          <View style={card} testID="wsf-activity-error" accessibilityRole={'alert' as never}>
            <Text style={s.cardEyebrow}>YOUR CONTRIBUTIONS</Text>
            <Text style={s.cardTitle}>Your progress couldn’t be loaded</Text>
            <Text style={s.cardBody}>
              Your identity is still here. We won’t guess amounts or show them as zero. Try again.
            </Text>
            <View style={s.flowActions}>
              <PrimaryAction label="Retry" icon="refresh" onPress={actions.onRetry} testID="wsf-activity-retry" />
            </View>
          </View>
        ) : null}

        {state.kind === 'ready' && state.partial ? <Partial onRetry={actions.onRetry} /> : null}

        {state.kind === 'ready' && body === 'firstEligible' ? (
          <View
            style={card}
            testID="wsf-activity-empty"
            {...({ dataSet: { state: 'first-eligible' } } as Record<string, unknown>)}
          >
            <Text style={s.cardEyebrow}>YOUR CONTRIBUTIONS</Text>
            {state.partial ? (
              <>
                <Text style={s.cardTitle}>Nothing to show yet</Text>
                <Text style={s.cardBody}>
                  None of the goals that loaded has a contribution recorded for you. Pending or
                  unknown attempts never appear as recorded.
                </Text>
              </>
            ) : (
              <>
                <Text style={s.cardTitle}>
                  Your first contribution will appear here
                </Text>
                <Text style={s.cardBody}>
                  Once a contribution is confirmed, it’s kept here by goal with its exact unit. Pending
                  or unknown attempts never appear as recorded.
                </Text>
              </>
            )}
            <View style={s.flowActions}>
              <PrimaryAction label="Start moving" icon="arrow" onPress={actions.onStartMoving} testID="wsf-activity-start" />
            </View>
          </View>
        ) : null}

        {state.kind === 'ready' && body === 'noOpenGoal' ? (
          <View
            style={card}
            testID="wsf-activity-empty"
            {...({ dataSet: { state: 'no-open-goal' } } as Record<string, unknown>)}
          >
            <Text style={s.cardEyebrow}>YOUR CONTRIBUTIONS</Text>
            <Text style={s.cardTitle}>No goal is open for contributions</Text>
            <Text style={s.cardBody}>
              {state.partial
                ? 'None of the goals that loaded has a contribution recorded for you, and your community has no goal accepting contributions right now.'
                : 'Nothing is recorded for you yet, and your community has no goal accepting contributions right now.'}
            </Text>
            <View style={s.flowActions}>
              <SecondaryAction
                label="Open community"
                icon="arrow"
                onPress={actions.onOpenCommunity}
                testID="wsf-activity-open-community"
              />
            </View>
          </View>
        ) : null}

        {state.kind === 'ready' && body === 'goals' ? (
          <View style={s.grid} testID="wsf-activity-rows">
            <Receipts receipts={state.receipts} onOpen={actions.onOpenReceipt} />
            <View testID="wsf-activity-goals">
              <Text style={s.eyebrow}>BY GOAL</Text>
              <Text style={s.h2}>Goals you helped</Text>
              {goals.map((g) => (
                <GoalRow key={g.goalId} goal={g} />
              ))}
              <Text style={s.footnote}>No scores, streaks or rankings — just what was recorded.</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The reference's `.progress-partial`: says the list is short, offers Retry. */
function Partial({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={s.partial} testID="wsf-activity-partial" accessibilityRole={'status' as never}>
      <Text style={s.partialText}>
        <Text style={s.partialStrong}>This list is partial.</Text> Some goals couldn’t be read, so they
        aren’t shown or counted above.
      </Text>
      <SecondaryAction label="Retry" icon="refresh" onPress={onRetry} testID="wsf-activity-partial-retry" block />
    </View>
  );
}

/**
 * YOUR RECEIPTS. The slot is always here. `null` — no source — says so in one
 * line; an array draws the reference's rows.
 */
function Receipts({ receipts, onOpen }: { receipts: ProgressReceipt[] | null; onOpen: (id: string) => void }) {
  return (
    <View testID="wsf-activity-receipts">
      <Text style={s.eyebrow}>YOUR RECEIPTS</Text>
      <Text style={s.h2}>Recent contributions</Text>
      {receipts === null ? (
        <View style={s.receiptUnavailable} testID="wsf-activity-receipts-unavailable">
          <Text style={s.receiptUnavailableText}>
            Dated receipts aren’t available here yet. Your exact total for each goal is below.
          </Text>
        </View>
      ) : (
        receipts.slice(0, 8).map((r) => (
          <Pressable
            key={r.id}
            onPress={() => onOpen(r.id)}
            style={s.receipt}
            testID={`wsf-activity-receipt-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${n(r.amount)} ${r.unit}, ${r.goalTitle}, ${r.community}, ${r.whenLabel}`}
          >
            <View style={s.receiptAmtCol}>
              <Text style={s.receiptAmt}>{`+${n(r.amount)}`}</Text>
              <Text style={s.receiptUnit}>{r.unit}</Text>
            </View>
            <View style={s.receiptMeta}>
              <Text style={s.receiptTitle} numberOfLines={1}>
                {r.goalTitle}
              </Text>
              <Text style={s.receiptSub} numberOfLines={1}>{`${r.community} · ${r.whenLabel}`}</Text>
            </View>
            <StrokeGlyph size={18} color={MUTED_FG} segments={CHEVRON_RIGHT} />
          </Pressable>
        ))
      )}
    </View>
  );
}

function GoalRow({ goal }: { goal: ProgressGoal }) {
  return (
    <View style={s.goal} testID={`wsf-activity-goal-${goal.goalId}`}>
      <View style={s.goalTop}>
        <Text style={s.goalTitle}>{goal.title}</Text>
        <Pill status={statusOf(goal)} />
      </View>
      <Text style={s.goalComm}>{[goal.community, goal.periodLabel].filter(Boolean).join(' · ')}</Text>
      <View style={s.split}>
        <View style={s.splitCell} testID={`wsf-activity-goal-${goal.goalId}-yours`}>
          <Text style={s.splitLabel}>YOURS</Text>
          <Text style={s.splitValue}>{`${n(goal.yourPart)} ${goal.unit}`}</Text>
        </View>
        <View style={s.splitCell} testID={`wsf-activity-goal-${goal.goalId}-shared`}>
          <Text style={s.splitLabel}>SHARED</Text>
          <Text style={s.splitValue}>{sharedCell(goal)}</Text>
        </View>
      </View>
    </View>
  );
}

function Pill({ status }: { status: ProgressStatus }) {
  return (
    <View
      style={[
        s.pill,
        status.tone === 'closedReached' && s.pillClosedReached,
        status.tone === 'muted' && s.pillMuted,
      ]}
    >
      <Text
        style={[
          s.pillText,
          status.tone === 'closedReached' && s.pillTextClosedReached,
          status.tone === 'muted' && s.pillTextMuted,
        ]}
      >
        {status.label}
      </Text>
    </View>
  );
}

type Icon = 'arrow' | 'refresh';

function IconGlyph({ icon, size }: { icon: Icon; size: number }) {
  return <StrokeGlyph size={size} color={NAVY} segments={icon === 'arrow' ? ARROW_RIGHT : REFRESH_CW} />;
}

function PrimaryAction({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: Icon;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} style={s.primary} testID={testID} accessibilityRole="button" accessibilityLabel={label}>
      {/* The reference puts Retry's icon before the label and the arrow after. */}
      {icon === 'refresh' ? <IconGlyph icon={icon} size={20} /> : null}
      <Text style={s.primaryText}>{label}</Text>
      {icon === 'arrow' ? <IconGlyph icon={icon} size={20} /> : null}
    </Pressable>
  );
}

function SecondaryAction({
  label,
  icon,
  onPress,
  testID,
  block,
}: {
  label: string;
  icon: Icon;
  onPress: () => void;
  testID: string;
  block?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.secondary, block && s.secondaryBlock]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon === 'refresh' ? <IconGlyph icon={icon} size={17} /> : null}
      <Text style={s.secondaryText}>{label}</Text>
      {icon === 'arrow' ? <IconGlyph icon={icon} size={17} /> : null}
    </Pressable>
  );
}

/*
  LUCIDE ICONS, DRAWN FROM VIEWS. The app ships no SVG library, so each icon is
  its lucide path on the 24-unit grid as straight strokes (width 2, round caps);
  refresh-cw's two arcs are approximated by short chords.
*/
type Seg = readonly [number, number, number, number];

const ARROW_RIGHT: readonly Seg[] = [
  [5, 12, 19, 12],
  [12, 5, 19, 12],
  [19, 12, 12, 19],
];
const CHEVRON_RIGHT: readonly Seg[] = [
  [9, 6, 15, 12],
  [15, 12, 9, 18],
];

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, steps: number): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    const b = ((fromDeg + ((toDeg - fromDeg) * (i + 1)) / steps) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)]);
  }
  return out;
}

/** lucide `refresh-cw`: two arcs of the r 9 circle, each ending in an arrowhead. */
const REFRESH_CW: readonly Seg[] = [
  ...arc(12, 12, 9, 180, 317, 6),
  [18.6, 5.9, 21, 8],
  [21, 3, 21, 8],
  [21, 8, 16, 8],
  ...arc(12, 12, 9, 0, 137, 6),
  [5.4, 18.1, 3, 16],
  [8, 16, 3, 16],
  [3, 16, 3, 21],
];

function StrokeGlyph({ size, color, segments }: { size: number; color: string; segments: readonly Seg[] }) {
  const k = size / 24;
  const stroke = 2 * k;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {segments.map(([x1, y1, x2, y2], i) => {
        const len = Math.hypot(x2 - x1, y2 - y1) * k + stroke;
        const cx = ((x1 + x2) / 2) * k;
        const cy = ((y1 + y2) / 2) * k;
        const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: cx - len / 2,
              top: cy - stroke / 2,
              width: len,
              height: stroke,
              borderRadius: stroke / 2,
              backgroundColor: color,
              transform: [{ rotate: `${deg}deg` }],
            }}
          />
        );
      })}
    </View>
  );
}

/*
  TOKENS FROM THE ACCEPTED REFERENCE (Lovable `09b8a73c`, src/styles.css),
  converted from oklch to hex so this view reads the same without editing the
  shared kit. Navy, action green and confirmed green are the kit's own.
*/
const BG = '#FBFAF4';
const MUTED_BG = '#EFEFE6';
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const EYEBROW_GREEN = '#00741E';
const UNIT_GREEN = '#005E19';
const PILL_TEXT = '#014210';
const PILL_BG = '#E0F0DB';
const CONFIRMED = PROGRESS_GREEN;

/*
  Line heights are the reference's literal ones: its own where styles.css sets
  one, otherwise the 1.5 every element inherits from the Tailwind preflight.
  React Native's default ("normal") is shorter.
*/
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 14 },
  bodyCompact: { paddingTop: 10 },

  eyebrow: { color: EYEBROW_GREEN, fontSize: 11, lineHeight: 16.5, fontWeight: '800', letterSpacing: 1.32 },

  // .personal-hero
  hero: { paddingTop: 6, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  h1: { color: NAVY, fontSize: 29, lineHeight: 43.5, fontWeight: '400', marginTop: 2, marginBottom: 12 },
  h1Compact: { fontSize: 25, lineHeight: 37.5, marginBottom: 8 },
  subtitle: { color: NAVY, fontSize: 15, lineHeight: 22.5, fontWeight: '700', marginTop: -6, marginBottom: 12 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 22 },
  totalNumber: { color: NAVY, fontSize: 58, lineHeight: 55.1, fontWeight: '700', letterSpacing: -1.16 },
  totalUnit: { color: UNIT_GREEN, fontSize: 13, lineHeight: 19.5, fontWeight: '700', marginTop: 4 },
  // max-width 46ch / 52ch at the reference's metrics (Arial "0": 0.556 em).
  personalSub: { color: MUTED_FG, fontSize: 13, lineHeight: 19.5, marginTop: 12, maxWidth: 332 },
  clarify: { color: MUTED_FG, fontSize: 12, lineHeight: 17.4, maxWidth: 347 },
  clarifyAfterTotals: { marginTop: 12 },

  // .progress-empty (the state card). Its `p` rule also restyles the eyebrow.
  card: { marginTop: 18, padding: 20, borderRadius: 18, backgroundColor: MUTED_BG },
  cardCompact: { marginTop: 12, padding: 16 },
  cardEyebrow: {
    color: MUTED_FG,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: 1.68,
    marginBottom: 14,
  },
  cardTitle: { color: NAVY, fontSize: 22, lineHeight: 25.3, fontWeight: '400', marginBottom: 8 },
  cardBody: { color: MUTED_FG, fontSize: 14, lineHeight: 21 },
  flowActions: { flexDirection: 'row', gap: 8, marginTop: 16 },

  // .progress-partial
  partial: {
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 3,
    borderLeftColor: NAVY,
    borderRadius: 10,
    backgroundColor: MUTED_BG,
    gap: 10,
  },
  partialText: { color: NAVY, fontSize: 13, lineHeight: 18.85 },
  partialStrong: { fontWeight: '700' },

  // .progress-grid and its sections
  grid: { paddingTop: 18, gap: 26 },
  h2: { color: NAVY, fontSize: 21, lineHeight: 31.5, fontWeight: '400', marginTop: 2, marginBottom: 8 },

  receipt: {
    minHeight: 60,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  receiptAmtCol: { width: 64 },
  receiptAmt: { color: NAVY, fontSize: 20, lineHeight: 30, fontWeight: '800' },
  receiptUnit: { color: MUTED_FG, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  receiptMeta: { flex: 1, minWidth: 0 },
  receiptTitle: { color: NAVY, fontSize: 13, lineHeight: 19.5, fontWeight: '700' },
  receiptSub: { color: MUTED_FG, fontSize: 11, lineHeight: 16.5, marginTop: 2 },
  receiptUnavailable: {
    minHeight: 60,
    paddingVertical: 8,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  receiptUnavailableText: { color: MUTED_FG, fontSize: 13, lineHeight: 18.85 },

  // .goal-history
  goal: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  goalTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalTitle: { flex: 1, minWidth: 0, color: NAVY, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  goalComm: { color: MUTED_FG, fontSize: 12, lineHeight: 18, marginTop: 2 },
  split: { flexDirection: 'row', gap: 10, marginTop: 8 },
  splitCell: { flex: 1, minWidth: 0 },
  splitLabel: { color: MUTED_FG, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 0.8 },
  splitValue: { color: NAVY, fontSize: 14, lineHeight: 21, fontWeight: '800' },
  footnote: { color: MUTED_FG, fontSize: 12, lineHeight: 17.4 },

  // .status.tone-light
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: PILL_BG },
  pillText: { color: PILL_TEXT, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  pillClosedReached: { backgroundColor: NAVY },
  pillTextClosedReached: { color: CONFIRMED },
  pillMuted: { backgroundColor: MUTED_BG },
  pillTextMuted: { color: MUTED_FG },

  primary: {
    flex: 1,
    minHeight: 54,
    borderRadius: 10,
    backgroundColor: ACTION_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    ...elevation.action,
  },
  primaryText: { color: NAVY, fontSize: 16, fontWeight: '800' },
  secondary: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: SURFACE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  secondaryBlock: { flex: 0, alignSelf: 'stretch' },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '800' },

  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },
});
