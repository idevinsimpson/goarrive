import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { TabGlyph } from '../TabGlyph';
import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  ACTION_GREEN_WASH,
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
 * TARGET, NOT AN IMPLEMENTED PAGE.
 *
 * The Home / community command centre as OWNER-BOARD-2 asks for it, built in
 * real React Native against the real kit so it cannot promise something the
 * product could not render. It is rendered only by the gated preview route and
 * is not reachable from the member shell.
 *
 * WHAT IT TAKES FROM THE BOARD
 *   - a cream ground with the goal hero as the ONE dominant navy object,
 *     rather than a navy page
 *   - the Living WE large and emotionally central inside that hero
 *   - the shared total as "241 / 500" with the percentage under the bar
 *   - real density: identity, hero, primary action, momentum and community all
 *     above the fold, instead of a heading and one card
 *   - a bright green primary action, the only filled control on the screen
 *   - persistent app navigation
 *
 * WHAT IT DELIBERATELY DOES NOT TAKE. Each of these is drawn on the board and
 * cannot ship; the substitute is the one recorded in
 * docs/design-target/owner-north-star/README.md.
 *   - no member face avatars anywhere, invented or otherwise
 *   - no named contributor: the board's "Morgan added 20" is "+20 squats"
 *   - no count of distinct people: no "12 people contributed today", no "+18"
 *   - no predicted shared total: the total shown is the confirmed one
 *   - no streak, no health claim, no Friends or Workouts destination
 *
 * Every value is sample data for the target only.
 */

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
  /**
   * Recent movement, where the Champion has authorized public display. Amount,
   * unit and time only -- the service publishes no person, and this renders
   * none. Empty where display is not authorized, which is its own target.
   */
  recent: { amount: number; unit: string; when: string }[];
};

function percentText(completed: number, total: number): string {
  if (!(total > 0)) return '0%';
  return `${Math.round((completed / total) * 1000) / 10}%`;
}

export function HomeTarget({
  communityName,
  memberCount,
  goalTitle,
  goalWindow,
  sharedTotal,
  target,
  unit,
  yourPart,
  recent,
}: HomeTargetProps) {
  const ratio = target > 0 ? Math.min(1, Math.max(0, sharedTotal / target)) : 0;
  const remaining = Math.max(0, target - sharedTotal);
  const { height, width } = useWindowDimensions();
  /*
    SHORT PHONE. On a 390x640 screen the full rhythm pushed the shared total
    past the fold, and a first viewport that does not reach the number the
    screen exists to show is not the app-like opening the board asks for. The
    mark and the type step down; nothing is removed, because what scrolls off
    is what a member scrolls to anyway.
  */
  const compact = height < 700;
  // A large phone gets a larger mark rather than the same one in more cream.
  const weWidth = compact ? 156 : width >= 420 ? 232 : 196;

  return (
    <View style={s.screen} testID="wsf-target-home">
      {/* The body scrolls; the tab bar is chrome and stays put. Without this
          it was pushed off the bottom of a short screen. */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.body, compact ? s.bodyCompact : null]}
        showsVerticalScrollIndicator={false}
      >
        {/* Chrome: compact, the wordmark small, one quiet control. */}
        <View style={s.chrome}>
          <WsfWordmark variant="navy" height={20} />
          <View style={s.chromeRight}>
            <Text style={s.chromeAction}>Manage</Text>
          </View>
        </View>

        {/* Community identity: alive and prominent, with no face and no
            count of people who moved. */}
        <View style={s.identity}>
          <Text
            style={[targetType.h1, s.identityName, compact ? s.identityNameCompact : null]}
            numberOfLines={2}
          >
            {communityName}
          </Text>
          <Text style={[targetType.body, s.identitySub]}>Moving together this week</Text>
          <View style={s.presence}>
            <View style={s.presenceDot} />
            <Text style={[targetType.meta, s.presenceText]}>
              {memberCount} members
            </Text>
          </View>
        </View>

        {/* THE HERO: the one dominant navy object on a cream screen. */}
        <View style={[s.hero, compact ? s.heroCompact : null]}>
          <Text style={[targetType.eyebrow, s.heroEyebrow]}>Together we go further</Text>
          <Text style={[targetType.h2, s.heroTitle]}>{goalTitle}</Text>
          <Text style={[targetType.meta, s.heroWindow]}>{goalWindow}</Text>

          <View style={s.weWrap}>
            <LivingWeProgress
              completed={sharedTotal}
              target={target}
              unit={unit}
              width={weWidth}
              surface="dark"
            />
          </View>

          <View style={s.totalRow}>
            <Text style={[targetType.display, s.total, compact ? s.totalCompact : null]}>
              {sharedTotal.toLocaleString()}
            </Text>
            <Text style={[targetType.h3, s.totalOf]}>/ {target.toLocaleString()}</Text>
          </View>
          <Text style={[targetType.meta, s.totalUnit]}>{unit}</Text>

          <View style={s.track}>
            <View style={[s.trackFill, { width: `${ratio * 100}%` }]} />
          </View>
          <View style={s.trackLabels}>
            <Text style={[targetType.meta, s.percent]}>
              {percentText(sharedTotal, target)} complete
            </Text>
            <Text style={[targetType.meta, s.remaining]}>
              {remaining.toLocaleString()} to go
            </Text>
          </View>

          {recent.length > 0 ? (
            <View style={s.heroMomentum}>
              <Text style={[targetType.eyebrow, s.heroMomentumLabel]}>Moving now</Text>
              <View style={s.heroMomentumRow}>
                {recent.slice(0, 3).map((r) => (
                  <View key={`${r.amount}-${r.when}`} style={s.mchip}>
                    <Text style={s.mchipAmount}>
                      +{r.amount.toLocaleString()}
                    </Text>
                    <Text style={s.mchipWhen}>{r.when}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* The one unmistakable action. The only filled control on the page. */}
        <View style={s.action}>
          <Text style={s.actionText}>Start moving</Text>
        </View>
        <View style={s.secondary}>
          <Text style={s.secondaryText}>Already moved? Record {unit}</Text>
        </View>

        {/* Density below the fold line the board sets: your own part, kept
            private, and what the community has done. */}
        <View style={s.cards}>
          <View style={s.card}>
            <Text style={[targetType.eyebrow, s.cardEyebrow]}>Your part</Text>
            <Text style={[targetType.h2, s.cardFigure]}>{yourPart.toLocaleString()}</Text>
            <Text style={[targetType.meta, s.cardMeta]}>{unit} · private to you</Text>
          </View>
          <View style={s.card}>
            <Text style={[targetType.eyebrow, s.cardEyebrow]}>What we have done</Text>
            <Text style={[targetType.h2, s.cardFigure]}>2</Text>
            <Text style={[targetType.meta, s.cardMeta]}>goals finished together</Text>
          </View>
        </View>

        <View style={s.note}>
          <Text style={[targetType.meta, s.noteText]}>
            Movement only — never a name. Your own numbers stay private to you.
          </Text>
        </View>
      </ScrollView>

      {/* Persistent app navigation: five destinations, MOVE at the centre. */}
      <View style={s.tabs}>
        {/* The product's own glyphs, not stand-ins. Progress takes the
            activity glyph: it is the same destination, renamed. */}
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
  body: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, gap: 10 },
  bodyCompact: { paddingTop: 8, gap: 8 },

  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chromeRight: { flexShrink: 1, minWidth: 0 },
  chromeAction: {
    color: INK,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#ECE8E0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: targetRadius.pill,
    overflow: 'hidden',
  },

  identity: { gap: 3 },
  identityName: { color: INK, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 },
  identityNameCompact: { fontSize: 23, lineHeight: 28 },
  identitySub: { color: INK_MUTED },
  presence: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  presenceDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: ACTION_GREEN },
  presenceText: { color: INK_QUIET },

  hero: {
    backgroundColor: NAVY,
    borderRadius: targetRadius.hero,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    ...targetShadow.hero,
  },
  heroCompact: { paddingTop: 12, paddingBottom: 12 },
  heroEyebrow: { color: PROGRESS_GREEN },
  heroTitle: { color: ON_NAVY, marginTop: 6 },
  heroWindow: { color: ON_NAVY_MUTED, marginTop: 3 },
  weWrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8 },
  total: { color: ON_NAVY, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  totalCompact: { fontSize: 29, lineHeight: 33, letterSpacing: -1 },
  totalOf: { color: ON_NAVY_MUTED },
  totalUnit: { color: ON_NAVY_MUTED, textAlign: 'center', marginTop: 2 },
  track: {
    height: 8,
    borderRadius: targetRadius.pill,
    backgroundColor: 'rgba(247,245,240,0.16)',
    marginTop: 10,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: targetRadius.pill, backgroundColor: PROGRESS_GREEN },
  trackLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 7,
  },
  percent: { color: PROGRESS_GREEN, fontWeight: '800' },
  remaining: { color: ON_NAVY_MUTED },
  heroMomentum: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: ON_NAVY_RULE,
    gap: 8,
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

  cards: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: targetRadius.card,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 1,
    ...targetShadow.card,
  },
  cardEyebrow: { color: ACTION_GREEN_DEEP },
  cardFigure: { color: INK, marginTop: 2 },
  cardMeta: { color: INK_QUIET },

  note: {
    backgroundColor: ACTION_GREEN_WASH,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noteText: { color: ACTION_GREEN_DEEP, fontWeight: '600' },

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
