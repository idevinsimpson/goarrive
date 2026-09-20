import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { percentLabel, statusLine } from '../progressFormat';
import { TabGlyph } from '../TabGlyph';
import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  HAIRLINE,
  INK,
  INK_MUTED,
  INK_QUIET,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  targetRadius,
  targetShadow,
  targetType,
} from './targetTokens';

/**
 * TARGET, NOT AN IMPLEMENTED PAGE. Home / the community command centre.
 *
 * Built in real React Native against the real kit, so it cannot promise
 * something the product could not render, and captured through a preview route
 * that is gated off in any deployed build.
 *
 * SECOND PASS. The first was approved in direction and refused for
 * implementation. What changed and why:
 *
 *   1. The mint privacy panel is gone. The behaviour is mandatory; narrating
 *      the policy in a large panel on the home screen is compliance copy, not
 *      a product. What survives is four words where they have context:
 *      "private to you", on the member's own number.
 *   2. "MOVING NOW" is "MOMENTUM". The chips are confirmed additions with
 *      timestamps, which is not evidence anyone is moving at this instant.
 *   3. The hero has depth of its own: a green bloom behind the mark, a top
 *      light, and the progress area sunk into its own inset panel. Built from
 *      layered views, so it needs no gradient dependency and no photography.
 *   4. The community reads as people, not metrics: an eyebrow that says whose
 *      community this is, and the percentage carried as a sentence rather than
 *      two utility labels.
 *   5. The two equal KPI tiles are one flowing section with hierarchy: the
 *      member's own part leads, what the community has finished follows,
 *      separated by a hairline rather than by a gap between two boxes.
 *
 * WHAT IT STILL DOES NOT TAKE FROM THE BOARD, each substitute recorded in
 * docs/design-target/owner-north-star/README.md: no faces; no named
 * contributor; no count of distinct people; no predicted shared total; no
 * streak, health claim, Friends or Workouts.
 *
 * The Living WE keeps its semantics exactly: the owner-selected fill asset,
 * filled to the true confirmed ratio by the shipped area calibration. The
 * bloom sits BEHIND the mark and never touches it, and the bright action green
 * is a separate token from confirmed-progress green, so a button can never
 * restate what the mark says about the total.
 */

export type HomePhase =
  | 'zero'
  | 'ordinary'
  | 'near'
  | 'reachedOpen'
  | 'closedReached'
  | 'closedUnfinished'
  | 'noGoal'
  | 'stale'
  | 'unavailable';

export type HomeTargetProps = {
  communityName: string;
  /** Members in the community. A count of MEMBERS, never of people who moved. */
  memberCount: number;
  goalTitle: string;
  goalWindow: string;
  /** The confirmed shared total. Never a projection of one. */
  sharedTotal: number;
  target: number;
  unit: string;
  /** The member's own part, private to them. */
  yourPart: number;
  /** Goals this community has already finished together. */
  finishedGoals: number;
  /**
   * Recent movement, where the Champion has authorized public display. Amount
   * and time only -- the service publishes no person, and this renders none.
   * Empty where display is not authorized.
   */
  recent: { amount: number; when: string }[];
  phase?: HomePhase;
  /** Champions get the management affordance. Members do not. */
  isChampion?: boolean;
  /** Other goals running in this community, when one is explicitly featured. */
  otherGoals?: { title: string; completed: number; target: number; unit: string }[];
};

export function HomeTarget({
  communityName,
  memberCount,
  goalTitle,
  goalWindow,
  sharedTotal,
  target,
  unit,
  yourPart,
  finishedGoals,
  recent,
  phase = 'ordinary',
  isChampion = false,
  otherGoals = [],
}: HomeTargetProps) {
  /*
    SHORT PHONE. The first viewport keeps the three things that carry this
    screen -- who the community is, the mark at meaningful progress, and the
    movement action. It is the rhythm that gives, never the emotional core.

    MEASURED, NOT ASKED FOR. useWindowDimensions reported a stale height here
    and every viewport came back under the threshold, so the large phone and
    the ordinary phone both silently rendered the SHORT phone's mark -- the
    exact failure of shrinking the emotional core to solve a small screen, and
    invisible unless you measure the rendered element. onLayout reports what
    the container actually got. Until it has, the screen renders at its full
    rhythm: a missing measurement must never be the one that shrinks the mark.
  */
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0 && (box === null || box.width !== w || box.height !== h)) {
      setBox({ width: w, height: h });
    }
  };
  const compact = box !== null && box.height < 700;
  const weWidth = compact ? 158 : box !== null && box.width >= 420 ? 232 : 198;

  const ratio = target > 0 ? Math.min(1, Math.max(0, sharedTotal / target)) : 0;
  const closed = phase === 'closedReached' || phase === 'closedUnfinished';
  const goalStatus = closed ? 'closed' : 'active';
  const reached = phase === 'reachedOpen' || phase === 'closedReached';
  const canMove = !closed && phase !== 'noGoal' && phase !== 'unavailable';

  return (
    <View style={s.screen} onLayout={onLayout} testID="wsf-target-home">
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.body, compact ? s.bodyCompact : null]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.chrome}>
          <WsfWordmark variant="navy" height={20} />
          {isChampion ? (
            <View style={s.chromeChip}>
              <Text style={s.chromeChipText}>Manage</Text>
            </View>
          ) : null}
        </View>

        {/* Whose community this is, said as people rather than as a metric. */}
        <View style={s.identity}>
          <Text style={[targetType.eyebrow, s.identityEyebrow]}>Your community</Text>
          <Text
            style={[targetType.h1, s.identityName, compact ? s.identityNameCompact : null]}
            numberOfLines={2}
          >
            {communityName}
          </Text>
          <Text style={[targetType.meta, s.identitySub]}>
            {memberCount} members · moving together this week
          </Text>
        </View>

        {phase === 'noGoal' ? (
          <View style={s.quietHero}>
            <Text style={[targetType.h2, s.quietHeroTitle]}>Nothing running right now</Text>
            <Text style={[targetType.body, s.quietHeroBody]}>
              {isChampion
                ? 'Start a goal and the community has something to move toward together.'
                : 'When a Champion starts a goal, it appears here.'}
            </Text>
          </View>
        ) : (
          <View style={s.hero}>
            {/* Top light. Depth without a gradient dependency. */}
            <View pointerEvents="none" style={s.heroTopLight} />

            <Text style={[targetType.eyebrow, s.heroEyebrow]}>
              {reached ? 'Goal reached' : 'Together we go further'}
            </Text>
            <Text style={[targetType.h2, s.heroTitle]}>{goalTitle}</Text>
            <Text style={[targetType.meta, s.heroWindow]}>{goalWindow}</Text>

            {phase === 'unavailable' ? (
              <View style={s.heroUnavailable}>
                <Text style={[targetType.body, s.heroUnavailableText]}>
                  Progress couldn&apos;t be loaded just now.
                </Text>
                <View style={s.heroOutline}>
                  <Text style={s.heroOutlineText}>Try again</Text>
                </View>
              </View>
            ) : (
              <>
                <View style={s.weWrap}>
                  {/* The bloom sits BEHIND the mark and never touches it. */}
                  <View pointerEvents="none" style={s.glowLayer}>
                    <View style={s.glow3}>
                      <View style={s.glow2}>
                        <View style={s.glow1} />
                      </View>
                    </View>
                  </View>
                  <LivingWeProgress
                    completed={sharedTotal}
                    target={target}
                    unit={unit}
                    width={weWidth}
                    surface="dark"
                  />
                </View>

                <View style={s.progressPanel}>
                  <View style={s.totalRow}>
                    <Text style={[targetType.display, s.total, compact ? s.totalCompact : null]}>
                      {sharedTotal.toLocaleString()}
                    </Text>
                    <Text style={[targetType.h3, s.totalOf]}>
                      / {target.toLocaleString()} {unit}
                    </Text>
                  </View>

                  <View style={s.track}>
                    <View style={[s.trackFill, { width: `${ratio * 100}%` }]} />
                  </View>

                  {/*
                    THE PRODUCT'S OWN FORMATTERS, NOT THE TARGET'S. A first
                    draft rolled its own percentage here and printed "102.4%"
                    for a goal that had been exceeded -- while the shipped
                    percentLabel clamps at 100%. A target that disagrees with
                    the product about a number is the drift a real-RN target
                    exists to prevent, so the numbers come from the same
                    helpers the product uses and the target only supplies the
                    connective words.
                  */}
                  <Text style={[targetType.meta, s.story]}>
                    {reached || closed
                      ? statusLine(sharedTotal, target, goalStatus)
                      : `${percentLabel(sharedTotal, target)} of the way there · ${statusLine(
                          sharedTotal,
                          target,
                          goalStatus,
                        )}`}
                  </Text>

                  {phase === 'stale' ? (
                    <Text style={[targetType.meta, s.stale]}>
                      Last confirmed 3:46 PM · Refresh
                    </Text>
                  ) : null}
                </View>

                {recent.length > 0 ? (
                  <View style={s.heroMomentum}>
                    <Text style={[targetType.eyebrow, s.heroMomentumLabel]}>Momentum</Text>
                    <View style={s.heroMomentumRow}>
                      {recent.slice(0, 3).map((r) => (
                        <View key={`${r.amount}-${r.when}`} style={s.mchip}>
                          <Text style={s.mchipAmount}>+{r.amount.toLocaleString()}</Text>
                          <Text style={s.mchipWhen}>{r.when}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </View>
        )}

        {canMove ? (
          <>
            <View style={s.action}>
              <Text style={s.actionText}>
                {phase === 'zero' ? 'Be the first to move' : 'Start moving'}
              </Text>
            </View>
            <View style={s.secondary}>
              <Text style={s.secondaryText}>Already moved? Record {unit}</Text>
            </View>
          </>
        ) : closed ? (
          <View style={s.closedNote}>
            <Text style={[targetType.h3, s.closedNoteLead]}>
              {phase === 'closedReached'
                ? `You reached ${target.toLocaleString()} ${unit} together.`
                : `Closed at ${sharedTotal.toLocaleString()} of ${target.toLocaleString()} ${unit}.`}
            </Text>
            <Text style={[targetType.meta, s.closedNoteBody]}>
              This goal is closed. Nothing more can be added to it.
            </Text>
          </View>
        ) : null}

        {otherGoals.length > 0 ? (
          <View style={s.alsoWrap}>
            <Text style={[targetType.eyebrow, s.alsoLabel]}>Also running here</Text>
            {otherGoals.map((g) => (
              <View key={g.title} style={s.alsoRow}>
                <Text style={[targetType.h3, s.alsoTitle]} numberOfLines={1}>
                  {g.title}
                </Text>
                <Text style={[targetType.meta, s.alsoMeta]}>
                  {g.completed.toLocaleString()} of {g.target.toLocaleString()} {g.unit}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* One flowing section with hierarchy, not two equal KPI tiles. */}
        <View style={s.strip}>
          <View style={s.stripLead}>
            <View style={s.stripAccent} />
            <View style={s.stripLeadText}>
              <Text style={[targetType.eyebrow, s.stripEyebrow]}>Your part</Text>
              <View style={s.stripFigureRow}>
                <Text style={[targetType.h2, s.stripFigure]}>{yourPart.toLocaleString()}</Text>
                <Text style={[targetType.meta, s.stripFigureUnit]}>{unit} · private to you</Text>
              </View>
            </View>
          </View>
          <View style={s.stripRule} />
          <Text style={[targetType.meta, s.stripFooter]}>
            Together you have finished {finishedGoals} goals
          </Text>
        </View>
      </ScrollView>

      <View style={s.tabs}>
        {([
          ['Home', 'home'],
          ['Community', 'community'],
        ] as const).map(([label, glyph]) => (
          <View key={label} style={s.tab}>
            <View style={s.tabGlyphWrap}>
              <TabGlyph name={glyph} color={label === 'Home' ? NAVY : '#98A5B5'} />
            </View>
            <Text style={[s.tabLabel, label === 'Home' ? s.tabLabelOn : null]}>{label}</Text>
          </View>
        ))}
        <View style={s.move}>
          <Text style={s.moveText}>MOVE</Text>
        </View>
        {([
          ['Progress', 'activity'],
          ['You', 'you'],
        ] as const).map(([label, glyph]) => (
          <View key={label} style={s.tab}>
            <View style={s.tabGlyphWrap}>
              <TabGlyph name={glyph} color="#98A5B5" />
            </View>
            <Text style={s.tabLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, gap: 12 },
  bodyCompact: { paddingTop: 8, gap: 9 },

  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  chromeChip: {
    backgroundColor: '#ECE8E0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: targetRadius.pill,
  },
  chromeChipText: { color: INK, fontSize: 12, fontWeight: '700' },

  identity: { gap: 2 },
  identityEyebrow: { color: ACTION_GREEN_DEEP },
  identityName: { color: INK, fontSize: 26, lineHeight: 31, letterSpacing: -0.6, marginTop: 2 },
  identityNameCompact: { fontSize: 23, lineHeight: 28 },
  identitySub: { color: INK_QUIET, marginTop: 1 },

  hero: {
    backgroundColor: NAVY,
    borderRadius: targetRadius.hero,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    overflow: 'hidden',
    ...targetShadow.hero,
  },
  // A light falling across the top of the card. A rectangle drew a hard seam
  // straight through the mark -- an artifact, not depth. A very large, very
  // faint circle anchored above the card has no edge inside it.
  heroTopLight: {
    position: 'absolute',
    top: -280,
    left: -60,
    width: 520,
    height: 420,
    borderRadius: 260,
    backgroundColor: 'rgba(143,224,138,0.06)',
  },
  heroEyebrow: { color: PROGRESS_GREEN },
  heroTitle: { color: ON_NAVY, marginTop: 6 },
  heroWindow: { color: ON_NAVY_MUTED, marginTop: 3 },

  weWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingBottom: 4 },
  // Three nested circles approximate a radial bloom without a gradient
  // dependency, and without touching the mark itself.
  glowLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  glow3: {
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(145,203,125,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow2: {
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(145,203,125,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow1: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(145,203,125,0.09)',
  },

  // The numbers sink into their own panel, so the progress area reads as a
  // recessed instrument rather than as text floating on the card.
  progressPanel: {
    backgroundColor: 'rgba(0,0,0,0.20)',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 11,
    marginTop: 6,
  },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 7 },
  total: { color: ON_NAVY, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  totalCompact: { fontSize: 29, lineHeight: 33, letterSpacing: -1 },
  totalOf: { color: ON_NAVY_MUTED },
  track: {
    height: 8,
    borderRadius: targetRadius.pill,
    backgroundColor: 'rgba(247,245,240,0.14)',
    marginTop: 10,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: targetRadius.pill, backgroundColor: PROGRESS_GREEN },
  story: { color: ON_NAVY, marginTop: 8, textAlign: 'center', fontWeight: '600' },
  stale: { color: ON_NAVY_MUTED, marginTop: 5, textAlign: 'center' },

  heroUnavailable: { alignItems: 'center', gap: 10, paddingTop: 16, paddingBottom: 8 },
  heroUnavailableText: { color: ON_NAVY, textAlign: 'center' },
  heroOutline: {
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.45)',
    borderRadius: targetRadius.pill,
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: 'center',
  },
  heroOutlineText: { color: ON_NAVY, fontSize: 14, fontWeight: '700' },

  heroMomentum: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: ON_NAVY_RULE,
    gap: 7,
  },
  heroMomentumLabel: { color: ON_NAVY_MUTED },
  heroMomentumRow: { flexDirection: 'row', gap: 7 },
  mchip: {
    flex: 1,
    backgroundColor: 'rgba(247,245,240,0.07)',
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  mchipAmount: { color: PROGRESS_GREEN, fontSize: 14, lineHeight: 18, fontWeight: '800' },
  mchipWhen: { color: ON_NAVY_MUTED, fontSize: 10, lineHeight: 14, marginTop: 1 },

  quietHero: {
    backgroundColor: SURFACE,
    borderRadius: targetRadius.card,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 6,
    ...targetShadow.card,
  },
  quietHeroTitle: { color: INK },
  quietHeroBody: { color: INK_MUTED },

  action: {
    backgroundColor: ACTION_GREEN,
    borderRadius: targetRadius.control,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    ...targetShadow.action,
  },
  actionText: { color: '#04260F', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  secondary: {
    borderRadius: targetRadius.control,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
  },
  secondaryText: { color: INK, fontSize: 14, lineHeight: 19, fontWeight: '700' },

  closedNote: { gap: 3, paddingHorizontal: 2 },
  closedNoteLead: { color: INK },
  closedNoteBody: { color: INK_QUIET },

  alsoWrap: { gap: 5 },
  alsoLabel: { color: INK_QUIET },
  alsoRow: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    ...targetShadow.card,
  },
  alsoTitle: { color: INK },
  alsoMeta: { color: INK_QUIET, marginTop: 2 },

  strip: {
    backgroundColor: SURFACE,
    borderRadius: targetRadius.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    ...targetShadow.card,
  },
  stripLead: { flexDirection: 'row', gap: 11 },
  stripAccent: { width: 3, borderRadius: 2, backgroundColor: PROGRESS_GREEN },
  stripLeadText: { flex: 1, gap: 2 },
  stripEyebrow: { color: ACTION_GREEN_DEEP },
  stripFigureRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  stripFigure: { color: INK },
  stripFigureUnit: { color: INK_QUIET },
  stripRule: { height: 1, backgroundColor: HAIRLINE, marginTop: 10, marginBottom: 8 },
  stripFooter: { color: INK_MUTED },

  tabs: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    paddingBottom: 10,
  },
  tab: { width: 60, alignItems: 'center', gap: 5 },
  tabGlyphWrap: { height: 22, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', color: INK_QUIET },
  tabLabelOn: { color: INK },
  move: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -22,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: SURFACE,
    ...targetShadow.action,
  },
  moveText: { color: '#04260F', fontSize: 11, lineHeight: 14, fontWeight: '900', letterSpacing: 0.5 },
});
