import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { TabGlyph } from '../TabGlyph';
import { memberCountLabel, roleCardLabel } from '../../labels';
import { fillRatio, formatCount, percentLabel, totalOfTargetLabel } from '../progressFormat';
import {
  ACTION_GREEN,
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
 * TARGETS FOR YOU (`/you`). NOT IMPLEMENTED PAGES.
 *
 * The route is `/you`. There is no `/profile` — `/profile-setup` is a step on
 * the way to having an account, not a place to return to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER BOARD DRAWS HERE, AND WHAT OF IT IS TRUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Board panel 5 is "PROFILE / PERSONAL IMPACT". Almost none of it can be
 * built today, and the reasons are worth keeping next to the drawing:
 *
 *   A MEMBER PHOTO and a MEMBER QUOTE — nothing in the product stores
 *   either. A placeholder face on the one screen that is about this person
 *   would be the most personal lie the product could tell.
 *
 *   "45 SQUATS THIS WEEK" and "3 CONTRIBUTIONS THIS WEEK" — both need a
 *   dated list of the member's own contributions. `wsfContributions` stores
 *   `createdAt` and `wsfGoalMemberTotals` stores `contributionCount`, but no
 *   callable returns either and firestore.rules denies the client a direct
 *   read. Same seam Page 4 stopped at.
 *
 *   "6 DAY STREAK" — the same, and a day needs a zone before it needs a
 *   count.
 *
 *   "YOU HELPED MOVE THE COMMUNITY FROM 216 TO 261 SQUATS" — this one is
 *   not a missing-callable problem, it is an ARITHMETIC one. 216 -> 261 is
 *   the community's movement, and it contains everyone who wrote in that
 *   window. Attributing it to one member is false however the data arrives.
 *   What IS attributable is the member's own confirmed credit, and the
 *   shared state as it stands. Both appear; the causal claim does not.
 *
 *   "RECENT ACTIVITY — added 20 squats 2h ago" — dated own history again.
 *
 *   TABS "WORKOUTS" and "FRIENDS" — neither exists. The shell is Home,
 *   Community, MOVE, Progress, You, and this target keeps it.
 *
 * WHAT IS LEFT IS STILL THE POINT OF THE SCREEN: who I am here, the
 * community I belong to, what I have actually put in, and the account
 * actions that really work.
 *
 * ALSO REFUSED, per the strategy boundaries: no personal health or fitness
 * score, no ranking, no comparison with another member, no body or health
 * data, no location trail, no coaching upsell, no forced sharing, no
 * invented achievement. And NO SHARE CONTROL: the only share path in the
 * codebase is `shareGoalDisplay`, which shares a GOAL's public display link.
 * There is nothing to share about a profile and no route that would.
 *
 * UNITS ARE NEVER SUMMED. 120 squats and 45 step-ups are two facts, not 165
 * of anything, and they stay separately labelled.
 */

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
    roomy: box !== null && box.height >= 820,
  };
}

/* ── fixture ─────────────────────────────────────────────────────────────── */

const ME = {
  displayName: 'Devin Simpson',
  email: 'devin@example.com',
  /** wsfMemberProfiles/{uid}.createdAt — owner-readable under the rules. */
  memberSince: 'August 2026',
  community: {
    name: 'Alpharetta Morning Movers',
    role: 'foundingChampion',
    memberCount: 14,
  },
  goal: {
    title: 'October Squat Challenge',
    unit: 'squats',
    target: 5000,
    sharedTotal: 1847,
    yourPart: 120,
  },
  second: { title: 'Step-ups round', unit: 'step-ups', target: 2000, yourPart: 45 },
  finished: [
    { title: 'September Push-up Push', unit: 'push-ups', yourPart: 260, reached: true },
    { title: 'Summer Step Round', unit: 'steps', yourPart: 8400, reached: true },
  ],
};

/* ── shared ──────────────────────────────────────────────────────────────── */

function Tabs() {
  return (
    <View style={s.tabs}>
      {(
        [
          ['Home', 'home'],
          ['Community', 'community'],
        ] as const
      ).map(([label, glyph]) => (
        <View key={label} style={s.tab}>
          <View style={s.tabGlyphWrap}>
            <TabGlyph name={glyph} color="#98A5B5" />
          </View>
          <Text style={s.tabLabel}>{label}</Text>
        </View>
      ))}
      <View style={s.move}>
        <Text style={s.moveText}>MOVE</Text>
      </View>
      {(
        [
          ['Progress', 'activity'],
          ['You', 'you'],
        ] as const
      ).map(([label, glyph]) => (
        <View key={label} style={s.tab}>
          <View style={s.tabGlyphWrap}>
            <TabGlyph name={glyph} color={label === 'You' ? NAVY : '#98A5B5'} />
          </View>
          <Text style={[s.tabLabel, label === 'You' ? s.tabLabelOn : null]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function Track({ total, target, dark }: { total: number; target: number; dark?: boolean }) {
  return (
    <View style={[s.track, dark ? s.trackDark : null]}>
      <View style={[s.trackFill, { width: `${Math.round(fillRatio(total, target) * 100)}%` }]} />
    </View>
  );
}

/** The wordmark, full and prominent, on every state. */
function Wordmark({ onNavy }: { onNavy?: boolean }) {
  return (
    <Text style={[s.wordmark, onNavy ? s.wordmarkOnNavy : null]}>WE STAY FIT</Text>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function YouTarget({
  state,
}: {
  state: 'member' | 'noCommunity' | 'loading' | 'failed' | 'signedOut';
}) {
  const { onLayout, compact, roomy } = useBox();

  return (
    <View style={s.screen} onLayout={onLayout}>
      <ScrollView style={s.scroll} contentContainerStyle={[s.body, compact ? s.bodyCompact : null]}>
        {state === 'signedOut' ? (
          <View style={[s.stateWrap, s.spread]}>
            <View style={s.group}>
              <View style={s.wordmarkRow}>
                <Wordmark />
              </View>
              <Text style={[display.md, s.pageTitle]}>You</Text>
              <View style={s.emptyPanel}>
                <Text style={[display.lg, s.emptyTitle]}>You are not signed in</Text>
                <Text style={s.emptyBody}>
                  Sign in to see your communities and what you have recorded.
                </Text>
                <View style={s.primary}>
                  <Text style={s.primaryText}>Sign in</Text>
                </View>
              </View>
            </View>
            <View style={s.fact}>
              <Text style={s.factTitle}>Nothing here is public</Text>
              <Text style={s.factBody}>
                What you record is yours. It is never ranked and never compared with anyone else.
              </Text>
            </View>
          </View>
        ) : state === 'loading' ? (
          <View style={s.stateWrap}>
            <View style={s.wordmarkRow}>
              <Wordmark />
            </View>
            <Text style={[display.md, s.pageTitle]}>You</Text>
            <View style={s.skeletonMast}>
              <View style={[s.bone, { width: '58%', height: 30 }]} />
              <View style={[s.bone, { width: '40%', height: 14 }]} />
              <View style={[s.boneRule]} />
              <View style={[s.bone, { width: '70%', height: 16 }]} />
              <View style={[s.bone, { width: '46%', height: 13 }]} />
            </View>
            {[0, 1].map((i) => (
              <View key={i} style={s.skeletonRow}>
                <View style={[s.bone, { width: '34%', height: 20 }]} />
                <View style={[s.bone, { width: '64%', height: 13 }]} />
              </View>
            ))}
            <Text style={s.note}>Loading your profile…</Text>
          </View>
        ) : state === 'failed' ? (
          <View style={[s.stateWrap, s.spread]}>
            <View style={s.group}>
              <View style={s.wordmarkRow}>
                <Wordmark />
              </View>
              <Text style={[display.md, s.pageTitle]}>You</Text>
              <View style={s.failPanel}>
                <Text style={s.failTitle}>Your profile could not be loaded just now.</Text>
                <Text style={s.failBody}>
                  Nothing has changed — this is the reading, not the record.
                </Text>
                <View style={s.failPrimary}>
                  <Text style={s.primaryText}>Try again</Text>
                </View>
              </View>
              {/*
                Signing out must work even when nothing else on the screen
                loaded. It is the one action a member may urgently want here,
                and it needs no read at all.
              */}
              <View style={s.actionRow}>
                <View style={s.pill}>
                  <Text style={s.pillText}>Sign out</Text>
                </View>
              </View>
            </View>
            <View style={s.fact}>
              <Text style={s.factTitle}>Your record is safe</Text>
              <Text style={s.factBody}>
                Everything you recorded is stored against its goal. This screen could not read it
                just now; it is still there.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/*
              IDENTITY FIRST, and it is the member's NAME — the product stores
              one and the member typed it, yet today this screen shows a raw
              email address instead. The email stays, quietly, because it is
              the credential they can check.
            */}
            <View style={s.masthead}>
              <Wordmark onNavy />
              <Text style={[display.lg, s.name]} numberOfLines={2}>
                {ME.displayName}
              </Text>
              <View style={s.mastFacts}>
                <Text style={s.mastFact}>Member since {ME.memberSince}</Text>
              </View>
              <Text style={s.email} numberOfLines={1}>
                {ME.email}
              </Text>
            </View>

            {state === 'noCommunity' ? (
              <View style={s.quietPanel}>
                <Text style={s.quietTitle}>You are not in a community yet</Text>
                <Text style={s.quietBody}>
                  A community is the people you move with. Join one with an invite link, or start
                  your own.
                </Text>
              </View>
            ) : (
              <>
                {/*
                  WHERE YOU MOVE — the enduring identity. A community is who
                  the WE is; a goal is its current story, so the community
                  leads and the goal sits inside it.
                */}
                <View style={s.section}>
                  <Text style={s.eyebrow}>WHERE YOU MOVE</Text>
                  <View style={s.communityCard}>
                    {/* The community's name is identity, so it wraps rather
                        than truncating; the role sits under it instead of
                        competing for the same line. */}
                    <Text style={s.communityName} numberOfLines={2}>
                      {ME.community.name}
                    </Text>
                    <View style={s.communityTop}>
                      <Text style={s.communityMeta}>
                        {memberCountLabel(ME.community.memberCount)}
                      </Text>
                      {roleCardLabel(ME.community.role) ? (
                        <Text style={s.rolePill}>{roleCardLabel(ME.community.role)}</Text>
                      ) : null}
                    </View>
                    <View style={s.communityRule} />
                    <View style={s.goalRow}>
                      {/* The WE as the instrument: filled by the goal's real
                          shared total, which is the community's progress and
                          is never presented as this member's doing. */}
                      <LivingWeProgress
                        completed={ME.goal.sharedTotal}
                        target={ME.goal.target}
                        unit={ME.goal.unit}
                        width={compact ? 56 : 68}
                        surface="light"
                      />
                      <View style={s.goalText}>
                        <Text style={s.goalTitle} numberOfLines={1}>
                          {ME.goal.title}
                        </Text>
                        <Text style={s.goalTotal}>
                          {totalOfTargetLabel(ME.goal.sharedTotal, ME.goal.target, ME.goal.unit)}
                        </Text>
                        <Track total={ME.goal.sharedTotal} target={ME.goal.target} />
                        <Text style={s.goalPct}>
                          {percentLabel(ME.goal.sharedTotal, ME.goal.target)} — together
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/*
                  YOUR PART — exact own confirmed credit, beside the shared
                  state, and never a claim that one produced the other. The
                  board says "you moved the community from 216 to 261"; that
                  window holds everyone who wrote in it.
                */}
                <View style={s.section}>
                  <Text style={s.eyebrow}>YOUR PART</Text>
                  <View style={s.partRow}>
                    <Text style={s.partAmount}>
                      {formatCount(ME.goal.yourPart)}{' '}
                      <Text style={s.partUnit}>{ME.goal.unit}</Text>
                    </Text>
                    <Text style={s.partGoal} numberOfLines={1}>
                      {ME.goal.title}
                    </Text>
                  </View>
                  <View style={s.partRow}>
                    <Text style={s.partAmount}>
                      {formatCount(ME.second.yourPart)}{' '}
                      <Text style={s.partUnit}>{ME.second.unit}</Text>
                    </Text>
                    <Text style={s.partGoal} numberOfLines={1}>
                      {ME.second.title}
                    </Text>
                  </View>
                  <Text style={s.partNote}>
                    Counted per goal, in its own unit. Yours alone, and never compared.
                  </Text>
                </View>

                {roomy ? (
                  <View style={s.section}>
                    <Text style={s.eyebrow}>YOU WERE PART OF</Text>
                    {ME.finished.map((f) => (
                      <View key={f.title} style={s.doneRow}>
                        <View style={s.doneText}>
                          <Text style={s.donePart}>
                            {formatCount(f.yourPart)} <Text style={s.doneUnit}>{f.unit}</Text>
                          </Text>
                          <Text style={s.doneTitle} numberOfLines={1}>
                            {f.title}
                          </Text>
                        </View>
                        {f.reached ? (
                          <View style={s.reachedBadge}>
                            <Text style={s.reachedText}>REACHED</Text>
                          </View>
                        ) : null}
                      </View>
                    ))}
                    <Text style={s.partNote}>Your full record is on Progress.</Text>
                  </View>
                ) : null}
              </>
            )}

            {/*
              ACCOUNT — only what actually works. Changing the name calls
              wsfSaveProfile, which exists. Signing out exists. There is no
              share control, because there is no route that shares a profile;
              no delete-account, because no callable deletes one; and no
              notification settings, because there are no notifications.
            */}
            <View style={s.section}>
              <Text style={s.eyebrow}>ACCOUNT</Text>
              <View style={s.actionRow}>
                <View style={s.pill}>
                  <Text style={s.pillText}>Change your name</Text>
                </View>
                <View style={s.pill}>
                  <Text style={s.pillText}>Sign out</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
      <Tabs />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  scroll: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 46, gap: 14 },
  bodyCompact: { paddingTop: 8, gap: 10 },
  stateWrap: { gap: 12 },
  spread: { flexGrow: 1, justifyContent: 'space-between' },
  group: { gap: 12 },
  section: { gap: 8 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  eyebrow: { color: '#2F7D4F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  wordmarkRow: { height: 26, justifyContent: 'center' },
  wordmark: { color: NAVY, fontSize: 17, fontWeight: '900', letterSpacing: 1.2 },
  wordmarkOnNavy: { color: ON_NAVY, fontSize: 15, letterSpacing: 1.1 },
  pageTitle: { color: NAVY, marginTop: -2 },

  masthead: {
    backgroundColor: NAVY,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 4,
    ...elevation.card,
  },
  name: { color: ON_NAVY, marginTop: 4 },
  mastFacts: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mastFact: { color: PROGRESS_GREEN, fontSize: 12.5, lineHeight: 17, fontWeight: '800' },
  email: { color: ON_NAVY_MUTED, fontSize: 12.5, lineHeight: 17 },

  communityCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  communityTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  communityName: { color: NAVY, fontSize: 17, lineHeight: 22, fontWeight: '900' },
  rolePill: {
    color: '#1C5E38',
    backgroundColor: '#E4F3EA',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  communityMeta: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
  communityRule: { height: 1, backgroundColor: HAIRLINE, marginVertical: 8 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalText: { flex: 1, gap: 3 },
  goalTitle: { color: NAVY, fontSize: 14.5, lineHeight: 19, fontWeight: '800' },
  goalTotal: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
  goalPct: { color: '#1C5E38', fontSize: 12, lineHeight: 16, fontWeight: '800' },

  partRow: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 15,
    paddingVertical: 12,
    gap: 1,
  },
  partAmount: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '900' },
  partUnit: { fontSize: 15, fontWeight: '800', color: INK_QUIET },
  partGoal: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
  partNote: { color: TEXT_MUTED, fontSize: 11.5, lineHeight: 16 },

  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F2FAF5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFE3CC',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  doneText: { flex: 1, gap: 1 },
  donePart: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  doneUnit: { fontSize: 12, fontWeight: '800', color: INK_QUIET },
  doneTitle: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  reachedBadge: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  reachedText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  quietPanel: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 15,
    paddingVertical: 15,
    gap: 4,
  },
  quietTitle: { color: NAVY, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  quietBody: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },

  emptyPanel: { backgroundColor: NAVY, borderRadius: 22, padding: 20, gap: 10, ...elevation.card },
  emptyTitle: { color: ON_NAVY },
  emptyBody: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },

  fact: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 15,
    paddingVertical: 14,
    gap: 3,
  },
  factTitle: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  factBody: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },

  skeletonMast: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
    gap: 9,
  },
  skeletonRow: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  bone: { backgroundColor: '#E3E0D8', borderRadius: 6 },
  boneRule: { height: 1, backgroundColor: '#E3E0D8', marginVertical: 2 },

  failPanel: {
    backgroundColor: NAVY,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 10,
  },
  failTitle: { color: ON_NAVY, fontSize: 20, lineHeight: 27, fontWeight: '900' },
  failBody: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },
  failPrimary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    ...elevation.action,
  },
  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    ...elevation.action,
  },
  primaryText: { color: ON_ACTION, fontSize: 15, fontWeight: '900' },

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    borderWidth: 1.5,
    borderColor: '#C9C5BC',
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  pillText: { color: NAVY, fontSize: 13, fontWeight: '800' },

  track: { height: 6, borderRadius: 3, backgroundColor: '#DFDCD4', overflow: 'hidden' },
  trackDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  trackFill: { height: '100%', borderRadius: 3, backgroundColor: PROGRESS_GREEN },

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
  tabLabelOn: { color: NAVY },
  move: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -22,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  moveText: {
    color: '#04260F',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
