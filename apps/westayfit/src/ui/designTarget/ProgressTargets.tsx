import { useState } from 'react';
import { type LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { TabGlyph } from '../TabGlyph';
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
 * TARGETS FOR PROGRESS (`/activity`). NOT IMPLEMENTED PAGES.
 *
 * PROGRESS IS THE PRIVATE ONE. Home is what I do next, MOVE is me adding to
 * it, Community is who the WE is. Progress is the only surface whose subject
 * is me, and the only one nobody else can see.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DATA AUDIT, DONE BEFORE ANYTHING WAS DRAWN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHAT EXISTS AND IS REACHABLE:
 *   wsfMyContribution  -> ownCredit, unit, repeatPolicy. The member's own
 *                         part on one goal. Private by construction: the
 *                         path is built from request.auth.uid, so a caller
 *                         can only ever read their own.
 *   wsfListGoals       -> title, target, unit, status, startsAt, endsAt,
 *                         reachedAt and, with includeHistory, sharedTotal
 *                         and closedAt. So ACTIVE vs COMPLETED is provable,
 *                         and so is whether a goal was reached and when it
 *                         ended.
 *   wsfMyCommunities   -> the community each goal belongs to.
 *
 * WHAT EXISTS IN STORAGE BUT IS NOT REACHABLE:
 *   `wsfContributions/{goalId}_{uid}_{attemptId}` stores `createdAt`, a
 *   server timestamp, one document per contribution — real, timestamped,
 *   personal history. And `wsfGoalMemberTotals` stores `contributionCount`.
 *
 *   NEITHER IS RETURNED BY ANY CALLABLE. wsfMyContribution answers with
 *   ownCredit, unit and repeatPolicy and nothing else. And the client cannot
 *   go around it: firestore.rules names only wsfMemberProfiles,
 *   wsfCommunityGroups and wsfMemberships, so wsfContributions and
 *   wsfGoalMemberTotals fall to `match /{document=**} { allow read: if false }`.
 *
 * THEREFORE THERE IS NO STREAK ON THIS SCREEN, and no "you moved on these
 * days", and no "you have recorded N times". Every one of those needs a
 * dated list of a member's own contributions, and today nothing can hand the
 * client one. A target that needs new backend behaviour to be true is a
 * target that lies. The seam is recorded in the README; a private
 * consistency view becomes possible the moment a callable publishes that
 * history, and not one screen before.
 *
 * ALSO REFUSED:
 *   NO TOTAL ACROSS GOALS. 120 squats and 45 step-ups do not add up to 165
 *   of anything. Counting GOALS is provable and is what the summary counts.
 *   NO RATIO OF YOUR PART TO THE SHARED TOTAL. Both numbers are real, but
 *   "your 120 of 1,847" invites a member to read 6% as a verdict on
 *   themselves, on the one screen that promises not to score them.
 *   NO RANKING, NO COMPARISON, NO OTHER MEMBER'S FIGURE — the data this
 *   screen can see does not contain anyone else, and it stays that way.
 *   NO RECENT-MOVEMENT TICKER. wsfGoalRecentAdditions is real but ANONYMOUS
 *   and community-wide; showing it here as "your recent movement" would be
 *   presenting other people's contributions as the member's own.
 *
 * "RECORDED" IS THE WORD THROUGHOUT, as it already is in the shipped screen.
 * The system knows a contribution was recorded. It has never known that a
 * person exercised, and Progress must not be the surface that implies it.
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
    roomy: box !== null && box.height >= 900,
  };
}

/* ── fixture ─────────────────────────────────────────────────────────────── */

const RUNNING = [
  {
    title: 'October Squat Challenge',
    community: 'Alpharetta Morning Movers',
    unit: 'squats',
    yourPart: 120,
    target: 5000,
    sharedTotal: 1847,
  },
  {
    title: 'Step-ups round',
    community: 'Alpharetta Morning Movers',
    unit: 'step-ups',
    yourPart: 45,
    target: 2000,
    sharedTotal: 612,
  },
];

const FINISHED = [
  {
    title: 'September Push-up Push',
    community: 'Alpharetta Morning Movers',
    unit: 'push-ups',
    yourPart: 260,
    target: 3000,
    sharedTotal: 3142,
    when: 'Ended Aug 31',
    reached: true,
  },
  {
    title: 'Summer Step Streak',
    community: 'Westside Walkers',
    unit: 'steps',
    yourPart: 8400,
    target: 100000,
    sharedTotal: 104820,
    when: 'Ended Aug 6',
    reached: true,
  },
  {
    title: 'Spring Lap Round',
    community: 'Westside Walkers',
    unit: 'laps',
    yourPart: 46,
    target: 800,
    sharedTotal: 617,
    when: 'Ended Jun 21',
    reached: false,
  },
];

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
            <TabGlyph name={glyph} color={label === 'Progress' ? NAVY : '#98A5B5'} />
          </View>
          <Text style={[s.tabLabel, label === 'Progress' ? s.tabLabelOn : null]}>{label}</Text>
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

function Header() {
  return (
    <>
      <View style={s.wordmarkRow}>
        <Text style={s.wordmark}>WE STAY FIT</Text>
      </View>
      <Text style={[display.md, s.pageTitle]}>Your progress</Text>
      <Text style={s.privacy}>
        Only you can see this. It is what you have recorded, not a score, and it is never compared
        with anyone else.
      </Text>
    </>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function ProgressTarget({
  state,
}: {
  state: 'rows' | 'running-only' | 'none' | 'loading' | 'failed';
}) {
  const { onLayout, compact, roomy } = useBox();
  const finished = state === 'rows' ? FINISHED.slice(0, compact ? 1 : roomy ? 3 : 2) : [];
  const running = state === 'rows' || state === 'running-only' ? RUNNING : [];
  const lead = finished.find((f) => f.reached);

  return (
    <View style={s.screen} onLayout={onLayout}>
      <ScrollView style={s.scroll} contentContainerStyle={[s.body, compact ? s.bodyCompact : null]}>
        <Header />

        {state === 'loading' ? (
          <View style={s.stateWrap}>
            <View style={s.skeletonPanel}>
              <View style={[s.bone, { width: '44%', height: 26 }]} />
              <View style={[s.bone, { width: '74%', height: 15 }]} />
              <View style={[s.bone, { width: '52%', height: 12 }]} />
              <View style={[s.bone, { width: '100%', height: 6, marginTop: 6 }]} />
            </View>
            {[0, 1].map((i) => (
              <View key={i} style={s.skeletonRow}>
                <View style={[s.bone, { width: '38%', height: 22 }]} />
                <View style={[s.bone, { width: '66%', height: 13 }]} />
              </View>
            ))}
            <Text style={s.note}>Loading what you have recorded…</Text>
          </View>
        ) : state === 'failed' ? (
          <View style={s.stateWrap}>
            <View style={s.failPanel}>
              <Text style={s.failTitle}>Your progress could not be loaded just now.</Text>
              <Text style={s.failBody}>
                Nothing has changed — this is the reading, not the record. What you recorded is
                still recorded.
              </Text>
              <View style={s.failPrimary}>
                <Text style={s.primaryText}>Try again</Text>
              </View>
            </View>
          </View>
        ) : state === 'none' ? (
          <View style={s.stateWrap}>
            <View style={s.emptyPanel}>
              <Text style={[display.lg, s.emptyTitle]}>Nothing recorded yet</Text>
              <Text style={s.emptyBody}>
                When you add what you did to a goal, it lands here — your part, kept to yourself.
              </Text>
              <View style={s.primary}>
                <Text style={s.primaryText}>Start moving</Text>
              </View>
            </View>
            <View style={s.fact}>
              <Text style={s.factTitle}>This page is only ever yours</Text>
              <Text style={s.factBody}>
                It shows what you recorded. It is not a ranking, and nobody else can see it.
              </Text>
            </View>
          </View>
        ) : (
          <>
            {/*
              THE SUMMARY COUNTS GOALS, NEVER UNITS. 120 squats and 45
              step-ups do not add up to 165 of anything, and a composite
              number would be the one invented figure on a page whose whole
              promise is that it is not making anything up.
            */}
            <View style={s.summary}>
              <Text style={s.summaryLead}>
                {formatCount(running.length + finished.length)} goals you have added to
              </Text>
              <Text style={s.summaryMeta}>
                {formatCount(running.length)} running · {formatCount(finished.length)} finished
              </Text>
            </View>

            <View style={s.section}>
              <Text style={s.eyebrow}>WHAT YOU&apos;RE PART OF NOW</Text>
              {running.map((g) => (
                <View key={g.title} style={s.runRow}>
                  <View style={s.runTop}>
                    <Text style={s.yourPart}>
                      {formatCount(g.yourPart)} <Text style={s.yourPartUnit}>{g.unit}</Text>
                    </Text>
                    <Text style={s.recordedTag}>RECORDED</Text>
                  </View>
                  <Text style={s.runTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Text style={s.runCommunity} numberOfLines={1}>
                    {g.community}
                  </Text>
                  {/*
                    The goal's own state sits under your part so it has
                    somewhere to belong — but never as a ratio of the two.
                  */}
                  <View style={s.runGoalState}>
                    <Text style={s.runGoalText}>
                      {totalOfTargetLabel(g.sharedTotal, g.target, g.unit)} ·{' '}
                      {percentLabel(g.sharedTotal, g.target)}
                    </Text>
                    <Track total={g.sharedTotal} target={g.target} />
                  </View>
                </View>
              ))}
            </View>

            {finished.length > 0 ? (
              <View style={s.section}>
                <Text style={s.eyebrow}>WHAT YOU&apos;VE BEEN PART OF</Text>
                {finished.map((g) => (
                  <View
                    key={g.title}
                    style={[s.doneRow, g.reached ? s.doneRowReached : null]}
                  >
                    {/*
                      THE ONE LIVING WE ON THIS SCREEN, on the most recent goal
                      the community actually finished, filled by that goal's
                      REAL final shared total against its target. A mark filled
                      to the top is the celebration; it is not decoration and it
                      is not attached to anything invented.
                    */}
                    {g === lead ? (
                      <LivingWeProgress
                        completed={g.sharedTotal}
                        target={g.target}
                        unit={g.unit}
                        width={compact ? 48 : 58}
                        surface="light"
                      />
                    ) : null}
                    <View style={s.doneText}>
                      <Text style={s.donePart}>
                        {formatCount(g.yourPart)} <Text style={s.donePartUnit}>{g.unit}</Text>
                      </Text>
                      <Text style={s.doneTitle} numberOfLines={2}>
                        {g.title}
                      </Text>
                      <Text style={s.doneWhen}>
                        {g.community} · {g.when}
                      </Text>
                    </View>
                    {g.reached ? (
                      <View style={s.reachedBadge}>
                        <Text style={s.reachedText}>REACHED</Text>
                      </View>
                    ) : (
                      <Text style={s.notReached}>
                        {percentLabel(g.sharedTotal, g.target)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ) : null}
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

  wordmarkRow: { height: 26, justifyContent: 'center' },
  wordmark: { color: NAVY, fontSize: 17, fontWeight: '900', letterSpacing: 1.2 },
  pageTitle: { color: NAVY, marginTop: -2 },
  privacy: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  stateWrap: { gap: 12 },
  section: { gap: 8 },
  eyebrow: { color: '#2F7D4F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  summary: {
    backgroundColor: NAVY,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 3,
    ...elevation.card,
  },
  summaryLead: { color: ON_NAVY, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  summaryMeta: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },

  runRow: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 3,
  },
  runTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  yourPart: { color: NAVY, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  yourPartUnit: { fontSize: 17, fontWeight: '800', color: INK_QUIET },
  recordedTag: {
    color: '#1C5E38',
    backgroundColor: '#E4F3EA',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  runTitle: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  runCommunity: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  runGoalState: { gap: 5, paddingTop: 7 },
  runGoalText: { color: INK_QUIET, fontSize: 12, lineHeight: 16 },

  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  doneRowReached: { borderColor: '#BFE3CC', backgroundColor: '#F2FAF5' },
  doneText: { flex: 1, gap: 1 },
  donePart: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  donePartUnit: { fontSize: 13, fontWeight: '800', color: INK_QUIET },
  doneTitle: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  doneWhen: { color: TEXT_MUTED, fontSize: 11, lineHeight: 15 },
  reachedBadge: {
    backgroundColor: PROGRESS_GREEN,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  reachedText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  notReached: { color: TEXT_MUTED, fontSize: 12, fontWeight: '800' },

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

  skeletonPanel: {
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
