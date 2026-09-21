import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { HomeTarget } from './HomeTarget';
import { fillRatio, percentLabel, statusLine, totalOfTargetParts } from '../progressFormat';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
} from '../kit';

/**
 * TARGETS FOR THE MOVE FAMILY. NOT IMPLEMENTED PAGES.
 *
 * MOVE entry, the unified movement picker, the contribution flow and the
 * confirmed moment, built in real React Native against the real kit so they
 * cannot promise something the product could not render. Rendered only by the
 * gated preview route.
 *
 * WHAT THESE REFUSE TO TAKE FROM THE OWNER BOARD, each for a reason that
 * outlives the drawing:
 *
 *   NO PREDICTED SHARED TOTAL. The board's contribution screen says "your
 *   update would move the community to 261 / 500". It cannot: another member
 *   may be writing at the same moment, and the only authority on the shared
 *   total is the receipt. The target shows the member's own amount and the
 *   total AS IT IS, and the new total appears on the confirmation, where it is
 *   confirmed.
 *
 *   NO "COMBINED", NO PARENT/CHILD, NO SETUP OR ACCOUNTING LANGUAGE. The
 *   picker is one catalog. Choosing one movement makes a goal of one movement;
 *   choosing several makes a goal of several. The member is never told how
 *   that is stored.
 *
 *   SELECTION IS NEVER COLOUR ALONE. Every selected tile carries a check mark
 *   and a heavier border as well as the tint, so the state survives greyscale
 *   and colour blindness.
 *
 *   No invented identity, no counts of people, no health claim, no streak.
 */

const SAMPLE = {
  community: 'Alpharetta Morning Movers',
  goalTitle: 'October Squat Challenge',
  unit: 'squats',
  target: 5000,
  sharedTotal: 1847,
  amount: 20,
};

/** Measured, not asked for: these render inside a frame, not the window. */
function useBox() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (!box || box.width !== width || box.height !== height)) {
      setBox({ width, height });
    }
  };
  return {
    box,
    onLayout,
    compact: box !== null && box.height < 700,
    // Tall phones get the spare height spent on the content, not on a gap.
    roomy: box !== null && box.height >= 760,
  };
}

function Chrome({ right }: { right?: string }) {
  return (
    <View style={s.chrome}>
      <Text style={s.chromeBack}>✕ Close</Text>
      {right ? <Text style={s.chromeChip}>{right}</Text> : null}
    </View>
  );
}

/** A movement tile. Selection reads without colour: check mark and border. */
function MovementTile({
  label,
  unit,
  selected,
  roomy,
}: {
  label: string;
  unit: string;
  selected: boolean;
  roomy?: boolean;
}) {
  return (
    <View style={[s.tile, roomy ? s.tileRoomy : null, selected ? s.tileOn : null]}>
      <View style={s.tileTop}>
        <Text style={[s.tileLabel, selected ? s.tileLabelOn : null]} numberOfLines={2}>
          {label}
        </Text>
        <View style={[s.tick, selected ? s.tickOn : null]}>
          {selected ? <Text style={s.tickMark}>✓</Text> : null}
        </View>
      </View>
      <Text style={s.tileUnit}>{unit}</Text>
    </View>
  );
}

/* ── 1 · MOVE entry ─────────────────────────────────────────────────────── */

export function MoveEntryTarget({ state }: { state: 'choose' | 'noGoal' }) {
  const { onLayout, roomy } = useBox();
  /*
    MOVE IS A SHEET, NOT A PAGE. MOVE is the one-tap action in the middle of
    the tab bar, and what it opens is a short list. A full page for two rows
    leaves most of a tall phone empty, and empty is the flat, website-like
    feeling the owner board moves away from. A sheet over the dimmed app is
    the size of the question being asked, and it is the same size on every
    phone -- nothing has to be inflated to fill a screen.
  */
  return (
    <View style={s.sheetScreen} onLayout={onLayout} testID={`wsf-target-move-${state}`}>
      {/*
        The screen the sheet rises over is the real page-01 target, dimmed, so
        the frame shows what a member actually sees at the moment they tap
        MOVE -- and so the sheet and the screen behind it tell one story with
        one set of numbers.
      */}
      <View style={s.behind} pointerEvents="none">
        <HomeTarget
          communityName={SAMPLE.community}
          memberCount={23}
          goalTitle={SAMPLE.goalTitle}
          goalWindow="Open · ends Fri, Oct 31"
          phase={state === 'choose' ? 'ordinary' : 'noGoal'}
          sharedTotal={SAMPLE.sharedTotal}
          target={SAMPLE.target}
          unit={SAMPLE.unit}
          yourPart={120}
          finishedGoals={2}
          recent={[
            { amount: 20, when: '2h ago' },
            { amount: 15, when: '5h ago' },
          ]}
          otherGoals={
            state === 'choose'
              ? [{ title: 'Step-ups round', completed: 612, target: 2000, unit: 'step-ups' }]
              : []
          }
        />
      </View>
      <View style={s.scrim} pointerEvents="none" />
      <View style={[s.sheet, roomy ? s.sheetRoomy : null]}>
        <View style={s.grabber} />
        {state === 'choose' ? (
          <>
            <Text style={s.eyebrow}>{SAMPLE.community}</Text>
            <Text style={s.h1}>What are you moving toward?</Text>
            <Text style={s.intro}>
              Two goals are open here. Pick the one this counts toward.
            </Text>
            {[
              { title: SAMPLE.goalTitle, total: 1847, target: 5000, unit: 'squats' },
              { title: 'Step-ups round', total: 612, target: 2000, unit: 'step-ups' },
            ].map((g) => (
              <View key={g.title} style={[s.goalCard, roomy ? s.goalCardRoomy : null]}>
                <View style={s.goalRow}>
                  <View style={s.goalRowText}>
                    <Text style={s.goalRowTitle}>{g.title}</Text>
                    <Text style={s.goalRowMeta}>
                      {g.total.toLocaleString()} of {g.target.toLocaleString()} {g.unit} ·{' '}
                      {percentLabel(g.total, g.target)}
                    </Text>
                  </View>
                  <View style={s.goalRowAction}>
                    <Text style={s.goalRowActionText}>Move</Text>
                  </View>
                </View>
                {/* Where the community already is, on the row you would join. */}
                <View style={s.trackLight}>
                  <View
                    style={[s.trackLightFill, { width: `${fillRatio(g.total, g.target) * 100}%` }]}
                  />
                </View>
              </View>
            ))}
            <Text style={s.note}>
              Nothing is recorded until you choose a goal and confirm an amount.
            </Text>
          </>
        ) : (
          <>
            <Text style={s.eyebrow}>{SAMPLE.community}</Text>
            <Text style={s.h1}>Nothing is running right now</Text>
            <Text style={s.intro}>
              When a Champion opens a goal, this is where you will record what you did.
            </Text>
            <View style={s.quiet}>
              <Text style={s.quietTitle}>What you can still do</Text>
              <Text style={s.quietBody}>
                Your own movement is yours to keep. Progress holds everything you have
                recorded, whether or not a goal is open.
              </Text>
            </View>
            <View style={s.ghost}>
              <Text style={s.ghostText}>Go to your community</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/* ── 2 · the unified movement picker ────────────────────────────────────── */

const CATALOG = [
  { label: 'Squats', unit: 'squats' },
  { label: 'Step-ups', unit: 'step-ups' },
  { label: 'Walking', unit: 'minutes' },
  { label: 'Push-ups', unit: 'push-ups' },
  { label: 'Stretching', unit: 'minutes' },
  { label: 'Cycling', unit: 'minutes' },
  { label: 'Rowing', unit: 'metres' },
  { label: 'Swimming', unit: 'lengths' },
  { label: 'Dancing', unit: 'minutes' },
];

export function PickerTarget({ chosen }: { chosen: number }) {
  const { onLayout, roomy } = useBox();
  const picked = CATALOG.slice(0, chosen);
  return (
    <View style={s.screen} onLayout={onLayout} testID="wsf-target-picker">
      <ScrollView contentContainerStyle={[s.body, roomy ? s.bodyRoomy : null]}>
        <Chrome right="Step 2 of 3" />
        <Text style={s.eyebrow}>{SAMPLE.community}</Text>
        <Text style={s.h1}>What will the community count?</Text>
        <Text style={s.intro}>
          Pick one movement, or several. Each one is counted in its own units.
        </Text>
        <View style={s.grid}>
          {CATALOG.map((m, i) => (
            <MovementTile key={m.label} {...m} selected={i < chosen} roomy={roomy} />
          ))}
        </View>
        <View style={s.summary}>
          <Text style={s.summaryLead}>
            {chosen === 1
              ? `One movement: ${picked[0]?.label.toLowerCase()}`
              : `${chosen} movements together`}
          </Text>
          <Text style={s.summaryBody}>
            {chosen === 1
              ? `The community's goal will be counted in ${picked[0]?.unit}.`
              : `${picked
                  .map((p) => p.label.toLowerCase())
                  .join(' and ')} are counted separately, each in its own units. The community sees every one of them.`}
          </Text>
        </View>
        <View style={s.spacer} />
        <View style={s.action}>
          <Text style={s.actionText}>Continue</Text>
        </View>
        <Text style={s.note}>
          You can add or remove a movement later without starting the goal again.
        </Text>
      </ScrollView>
    </View>
  );
}

/* ── 3 · the contribution ───────────────────────────────────────────────── */

export function ContributeTarget() {
  const { onLayout, compact, roomy } = useBox();
  const parts = totalOfTargetParts(SAMPLE.sharedTotal, SAMPLE.target, SAMPLE.unit);
  return (
    <View style={s.screen} onLayout={onLayout} testID="wsf-target-contribute">
      <ScrollView contentContainerStyle={[s.body, roomy ? s.bodyRoomy : null]}>
        <Chrome right={SAMPLE.goalTitle} />

        {/* Where it counts, said once and quietly, before the number. */}
        <Text style={s.eyebrow}>{SAMPLE.community}</Text>
        <Text style={s.h1}>How many squats?</Text>

        <View style={[s.amountWrap, compact ? s.amountWrapCompact : null]}>
          <Text style={s.amountUnit}>squats</Text>
          <Text
            style={[
              display.xl,
              s.amount,
              compact ? s.amountCompact : null,
              roomy ? s.amountRoomy : null,
            ]}
          >
            {SAMPLE.amount}
          </Text>
        </View>
        <View style={s.stepRow}>
          {['−10', '−1', '+1', '+10'].map((t) => (
            <View key={t} style={[s.step, roomy ? s.stepRoomy : null]}>
              <Text style={s.stepText}>{t}</Text>
            </View>
          ))}
        </View>

        <Text style={s.sectionLabel}>Counted in</Text>
        <View style={s.pairRow}>
          <MovementTile label="Squats" unit="this goal" selected />
          <MovementTile label="Step-ups" unit="same goal" selected={false} />
        </View>

        {/*
          THE TOTAL AS IT IS, NEVER AS IT WOULD BE. A predicted shared total is
          a promise another member can break between the render and the write.
        */}
        <View style={s.nowPanel}>
          <Text style={s.nowLabel}>Where it counts right now</Text>
          <Text style={s.nowValue}>
            {parts.count} {parts.rest}
          </Text>
          <View style={s.track}>
            <View
              style={[
                s.trackFill,
                { width: `${fillRatio(SAMPLE.sharedTotal, SAMPLE.target) * 100}%` },
              ]}
            />
          </View>
          <Text style={s.nowMeta}>
            {statusLine(SAMPLE.sharedTotal, SAMPLE.target, 'active')} · your {SAMPLE.amount} is
            added when it is confirmed
          </Text>
        </View>

        <View style={s.spacer} />
        <View style={s.action}>
          <Text style={s.actionText}>Record {SAMPLE.amount} squats</Text>
        </View>
        <View style={s.ghost}>
          <Text style={s.ghostText}>Use a kiosk instead</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ── 4 · confirmed ──────────────────────────────────────────────────────── */

export function ConfirmedTarget() {
  const { onLayout, compact, roomy } = useBox();
  const after = SAMPLE.sharedTotal + SAMPLE.amount;
  return (
    <View style={s.screenDark} onLayout={onLayout} testID="wsf-target-confirmed">
      <ScrollView contentContainerStyle={[s.body, s.bodyCentred]}>
        {/* A receipt sits in the middle of its screen, not at the top of one. */}
        {roomy ? <View style={s.spacer} /> : null}
        <Text style={s.confirmedEyebrow}>Recorded</Text>
        <Text style={[display.xl, s.confirmedAmount, compact ? s.amountCompact : null]}>
          +{SAMPLE.amount}
        </Text>
        <Text style={s.confirmedUnit}>squats, yours and confirmed</Text>
        <Text style={s.confirmedLead}>You moved us closer.</Text>

        {/* The mark answers, at the CONFIRMED total — the receipt's own number. */}
        <View style={[s.weWrap, roomy ? s.weWrapRoomy : null]}>
          <View pointerEvents="none" style={s.glowLayer}>
            <View style={[s.glowRing, s.glow3, roomy ? s.glow3Roomy : null]}>
              <View style={[s.glowRing, s.glow2, roomy ? s.glow2Roomy : null]}>
                <View style={[s.glowRing, s.glow1, roomy ? s.glow1Roomy : null]} />
              </View>
            </View>
          </View>
          <LivingWeProgress
            completed={after}
            target={SAMPLE.target}
            unit={SAMPLE.unit}
            width={compact ? 150 : roomy ? 248 : 210}
            surface="dark"
          />
        </View>

        <View style={s.confirmedPanel}>
          <Text style={s.confirmedPanelLabel}>Together now</Text>
          <Text style={s.confirmedPanelValue}>
            {after.toLocaleString()} <Text style={s.confirmedPanelOf}>of {SAMPLE.target.toLocaleString()} {SAMPLE.unit}</Text>
          </Text>
          <View style={s.track}>
            <View style={[s.trackFill, { width: `${fillRatio(after, SAMPLE.target) * 100}%` }]} />
          </View>
          <Text style={s.confirmedPanelMeta}>
            {percentLabel(after, SAMPLE.target)} · {statusLine(after, SAMPLE.target, 'active')}
          </Text>
        </View>

        <Text style={s.confirmedPrivacy}>
          Your {SAMPLE.amount} is yours. The community total is what everyone sees.
        </Text>

        <View style={s.spacer} />
        <View style={s.action}>
          <Text style={s.actionText}>Back to the community</Text>
        </View>
        <View style={s.ghostDark}>
          <Text style={s.ghostDarkText}>Record more squats</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  screenDark: { flex: 1, backgroundColor: NAVY },
  body: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 22, gap: 10 },
  spacer: { flex: 1, minHeight: 8 },
  bodyRoomy: { gap: 15, paddingTop: 16 },
  bodyCentred: { alignItems: 'center' },
  // MOVE entry: a sheet over the dimmed app, sized by what it asks.
  sheetScreen: { flex: 1, backgroundColor: CREAM, justifyContent: 'flex-end' },
  behind: { ...StyleSheet.absoluteFillObject },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,18,33,0.62)' },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 26,
    gap: 10,
  },
  sheetRoomy: { paddingBottom: 32, gap: 12 },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D7D2C8',
    marginBottom: 4,
  },

  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 },
  chromeBack: { color: NAVY, fontSize: 13, fontWeight: '700' },
  chromeChip: {
    color: NAVY,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#ECE8E0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },

  eyebrow: {
    color: ACTION_GREEN_DEEP,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  h1: { color: NAVY, fontSize: 26, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6 },
  intro: { color: INK_QUIET, fontSize: 13.5, lineHeight: 19 },
  sectionLabel: {
    color: ACTION_GREEN_DEEP,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  note: { color: INK_QUIET, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },

  goalCard: {
    gap: 11,
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...elevation.card,
  },
  goalCardRoomy: { paddingVertical: 17, gap: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalRowText: { flex: 1, gap: 3 },
  goalRowTitle: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  goalRowMeta: { color: INK_QUIET, fontSize: 12, lineHeight: 16 },
  goalRowAction: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 999,
    paddingHorizontal: 18,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalRowActionText: { color: ON_ACTION, fontSize: 14, fontWeight: '900' },

  quiet: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 16,
    gap: 5,
    ...elevation.card,
  },
  quietTitle: { color: NAVY, fontSize: 15, fontWeight: '800' },
  quietBody: { color: INK_QUIET, fontSize: 13, lineHeight: 19 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pairRow: { flexDirection: 'row', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 11,
    gap: 1,
  },
  tileRoomy: { paddingTop: 13, paddingBottom: 15, minHeight: 82 },
  tileOn: { borderColor: ACTION_GREEN_DEEP, borderWidth: 2.5, backgroundColor: '#EFF9F1' },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },

  // The tick is the part that survives greyscale.
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: ACTION_GREEN_DEEP, borderColor: ACTION_GREEN_DEEP },
  tickMark: { color: '#FFFFFF', fontSize: 11, lineHeight: 14, fontWeight: '900' },
  tileLabel: { flex: 1, color: NAVY, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  tileLabelOn: { color: ACTION_GREEN_DEEP },
  tileUnit: { color: INK_QUIET, fontSize: 11, lineHeight: 15 },

  summary: {
    backgroundColor: '#EFF9F1',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#CBEBD4',
    padding: 13,
    gap: 3,
  },
  summaryLead: { color: ACTION_GREEN_DEEP, fontSize: 14, fontWeight: '900' },
  summaryBody: { color: NAVY, fontSize: 12.5, lineHeight: 18 },

  amountWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  amountWrapCompact: { paddingTop: 4 },
  amountUnit: { color: INK_QUIET, fontSize: 12.5, fontWeight: '600', letterSpacing: 1 },
  amount: { color: NAVY, fontSize: 76, lineHeight: 82, letterSpacing: -3 },
  amountCompact: { fontSize: 58, lineHeight: 64 },
  amountRoomy: { fontSize: 96, lineHeight: 102, letterSpacing: -4 },
  stepRow: { flexDirection: 'row', gap: 8 },
  step: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepRoomy: { minHeight: 60, borderRadius: 16 },
  stepText: { color: NAVY, fontSize: 16, fontWeight: '800' },

  nowPanel: {
    backgroundColor: NAVY,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 3,
    marginTop: 4,
    ...elevation.hero,
  },
  nowLabel: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  nowValue: { color: ON_NAVY, fontSize: 20, lineHeight: 25, fontWeight: '900', letterSpacing: -0.5 },
  nowMeta: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 17 },

  action: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  actionText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },
  ghost: {
    borderRadius: 16,
    minHeight: 44,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
  },
  ghostText: { color: NAVY, fontSize: 14, fontWeight: '700' },

  confirmedEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginTop: 18,
  },
  confirmedAmount: { color: ON_NAVY, fontSize: 76, lineHeight: 82, letterSpacing: -3 },
  confirmedUnit: { color: ON_NAVY_MUTED, fontSize: 13.5 },
  confirmedLead: { color: PROGRESS_GREEN, fontSize: 18, fontWeight: '900', marginTop: 6 },
  weWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  weWrapRoomy: { paddingVertical: 24 },
  glowLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  glowRing: { alignItems: 'center', justifyContent: 'center' },
  glow3: { width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(145,203,125,0.07)' },
  glow2: { width: 182, height: 182, borderRadius: 91, backgroundColor: 'rgba(145,203,125,0.09)' },
  glow1: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(145,203,125,0.11)' },
  glow3Roomy: { width: 306, height: 306, borderRadius: 153 },
  glow2Roomy: { width: 214, height: 214, borderRadius: 107 },
  glow1Roomy: { width: 132, height: 132, borderRadius: 66 },
  confirmedPanel: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  confirmedPanelLabel: {
    color: ON_NAVY_MUTED,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  confirmedPanelValue: { color: ON_NAVY, fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -0.6 },
  confirmedPanelOf: { color: ON_NAVY_MUTED, fontSize: 14, fontWeight: '700' },
  track: { height: 8, borderRadius: 999, backgroundColor: ON_NAVY_RULE, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: PROGRESS_GREEN },
  trackLight: { height: 7, borderRadius: 999, backgroundColor: '#E8E4DC', overflow: 'hidden' },
  trackLightFill: { height: '100%', borderRadius: 999, backgroundColor: ACTION_GREEN },
  confirmedPanelMeta: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 17 },
  confirmedPrivacy: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  ghostDark: {
    borderRadius: 16,
    minHeight: 44,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: ON_NAVY_RULE,
  },
  ghostDarkText: { color: ON_NAVY, fontSize: 14, fontWeight: '700' },
});
