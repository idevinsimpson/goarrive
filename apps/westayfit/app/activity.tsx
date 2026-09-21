import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../src/auth';
import { mapWithLimit } from '../src/concurrency';
import { getFirebaseFunctions } from '../src/firebase';
import {
  ACTION_GREEN,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
} from '../src/ui/kit';
import { LivingWeProgress } from '../src/ui/LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../src/ui/MemberTabBar';
import { fillRatio, formatCount, percentLabel, totalOfTargetLabel } from '../src/ui/progressFormat';
import { WsfWordmark } from '../src/ui/WsfWordmark';
import { formatEndedOn } from '../src/ui/dates';

/**
 * PROGRESS — the member's OWN recorded movement, and nobody else's.
 *
 * PRIVATE BY CONSTRUCTION. Every own-part number comes from
 * wsfMyContribution, whose Firestore path is built from request.auth.uid, so
 * a caller can only ever read their own. There is no ranking, no comparison,
 * no other member's figure, and no way to reach one from here.
 *
 * WHAT IS NOT HERE, AND WHY. There is no streak and no dated history of the
 * member's own contributions. `wsfContributions` does store `createdAt` on
 * every contribution — real, timestamped, personal — but no callable returns
 * it, and firestore.rules names only wsfMemberProfiles, wsfCommunityGroups
 * and wsfMemberships, so the collection falls to the catch-all deny. Nothing
 * can hand this client that history today, so this screen does not pretend
 * to have it. The contract for the callable that would is written down in
 * docs/design-target/review/page-04-progress/PRIVATE-HISTORY-CONTRACT.md.
 *
 * FINISHED GOALS STAY. The previous version filtered to `status === 'active'`,
 * so a goal the member contributed to and the community completed vanished
 * from the member's own record. That was the most rewarding thing this page
 * could hold, and it was being thrown away.
 *
 * NO TOTAL ACROSS GOALS. 120 squats and 45 step-ups do not add up to 165 of
 * anything. The summary counts GOALS, which is provable.
 *
 * "RECORDED" IS THE WORD. The system knows a contribution was recorded. It
 * has never known that a person exercised.
 */

/** At most this many community goal reads, and own-part reads, in flight. */
const READ_LIMIT = 4;

type Community = { groupId: string; displayName: string };
type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt?: string;
  reachedAt?: string | null;
  sharedTotal?: number;
};

type Row = {
  goalId: string;
  title: string;
  community: string;
  unit: string;
  yourPart: number;
  target: number;
  sharedTotal?: number;
  status: string;
  endsAt?: string;
  reached: boolean;
};

type Ready = {
  kind: 'ready';
  running: Row[];
  finished: Row[];
  /** Some read failed. What did load is still shown, and this says so. */
  partial: boolean;
};
type State = { kind: 'loading' } | { kind: 'error' } | Ready;

export default function ActivityScreen() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const safeArea = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  /* The shell's own footprint, measured. The raised MOVE control lifts above
     the bar's body, so content that stops at its own padding sits under it. */
  const barInset = MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom;

  const liveRef = useRef(0);

  useEffect(() => {
    if (!ready || !user) return;
    const token = ++liveRef.current;
    setState({ kind: 'loading' });

    (async () => {
      const fns = getFirebaseFunctions();
      let communities: Community[];
      try {
        const mine = await httpsCallable<Record<string, never>, { items: Community[] }>(
          fns,
          'wsfMyCommunities',
        )({});
        communities = Array.isArray(mine.data?.items) ? mine.data.items : [];
      } catch {
        if (liveRef.current === token) setState({ kind: 'error' });
        return;
      }

      if (communities.length === 0) {
        if (liveRef.current === token) {
          setState({ kind: 'ready', running: [], finished: [], partial: false });
        }
        return;
      }

      let partial = false;

      // Bounded and parallel. The previous version awaited every community, then
      // every goal, then every own-part read one at a time — an N+1 chain
      // whose latency grew with the member's whole history.
      const listGoals = httpsCallable<
        { groupId: string; includeHistory: boolean },
        { goals: Goal[] }
      >(fns, 'wsfListGoals');
      const perCommunity = await mapWithLimit(communities, READ_LIMIT, async (c) => {
        const r = await listGoals({ groupId: c.groupId, includeHistory: true });
        return { community: c, goals: Array.isArray(r.data?.goals) ? r.data.goals : [] };
      });

      const pairs: Array<{ community: Community; goal: Goal }> = [];
      for (const settled of perCommunity) {
        if (!settled.ok) {
          // One community that will not load must not erase the rest.
          partial = true;
          continue;
        }
        for (const goal of settled.value.goals) pairs.push({ community: settled.value.community, goal });
      }

      const myContribution = httpsCallable<{ goalId: string }, { ownCredit: number; unit: string }>(
        fns,
        'wsfMyContribution',
      );
      const owned = await mapWithLimit(pairs, READ_LIMIT, async ({ community, goal }) => {
        const own = await myContribution({ goalId: goal.goalId });
        return { community, goal, own: own.data };
      });

      const running: Row[] = [];
      const finished: Row[] = [];
      for (const settled of owned) {
        if (!settled.ok) {
          // A goal this member cannot read is simply not one of their rows,
          // but the screen says that something is missing rather than
          // presenting a short list as the whole truth.
          partial = true;
          continue;
        }
        const { community, goal, own } = settled.value;
        const yourPart = typeof own?.ownCredit === 'number' ? own.ownCredit : 0;
        // Only goals with a real recorded own part.
        if (yourPart <= 0) continue;
        const row: Row = {
          goalId: goal.goalId,
          title: goal.title,
          community: community.displayName,
          unit: own?.unit || goal.unit,
          yourPart,
          target: goal.target,
          sharedTotal: goal.sharedTotal,
          status: goal.status,
          endsAt: goal.endsAt,
          reached: Boolean(goal.reachedAt),
        };
        if (goal.status === 'active') running.push(row);
        else finished.push(row);
      }

      // Most recently ended first, so the newest thing the member finished is
      // the one they see.
      finished.sort((a, b) => (b.endsAt ?? '').localeCompare(a.endsAt ?? ''));

      if (liveRef.current === token) {
        setState({ kind: 'ready', running, finished, partial });
      }
    })();

    return () => {
      liveRef.current += 1;
    };
  }, [ready, user, attempt]);

  // Every state arrives at its own top.
  const phase = state.kind;
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [phase, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: barInset + 16 }]}
      testID="wsf-activity"
    >
      <View style={styles.column}>
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          style={styles.wordmarkTap}
          testID="wsf-activity-wordmark-home"
        >
          <WsfWordmark variant="navy" height={22} testID="wsf-activity-wordmark" />
        </Pressable>
        <Text style={[display.md, styles.pageTitle]} testID="wsf-activity-title">
          Your progress
        </Text>
        {/* Said once, plainly, at the top: this is private. */}
        <Text style={styles.privacy} testID="wsf-activity-privacy">
          Only you can see this. It is what you have recorded, not a score, and it is never
          compared with anyone else.
        </Text>

        {!ready || !user ? (
          <Text style={styles.note} testID="wsf-activity-signed-out">
            Sign in to see what you have recorded.
          </Text>
        ) : state.kind === 'loading' ? (
          <LoadingBody />
        ) : state.kind === 'error' ? (
          <FailureBody onRetry={retry} />
        ) : state.running.length === 0 && state.finished.length === 0 ? (
          <EmptyBody partial={state.partial} />
        ) : (
          <ReadyBody state={state} />
        )}
      </View>
    </ScrollView>
  );
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/** The skeleton is the real structure: summary, running rows, finished rows. */
function LoadingBody() {
  return (
    <View style={styles.stateWrap} testID="wsf-activity-loading">
      <View style={styles.skeletonPanel}>
        <View style={[styles.bone, { width: '44%', height: 26 }]} />
        <View style={[styles.bone, { width: '74%', height: 15 }]} />
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={[styles.bone, { width: '38%', height: 22 }]} />
          <View style={[styles.bone, { width: '66%', height: 13 }]} />
          <View style={[styles.bone, { width: '50%', height: 12 }]} />
          <View style={[styles.bone, { width: '100%', height: 6 }]} />
        </View>
      ))}
      <View style={[styles.bone, { width: '52%', height: 12, marginTop: 4 }]} />
      {[0, 1].map((i) => (
        <View key={`d${i}`} style={styles.skeletonRowShort}>
          <View style={[styles.bone, { width: '30%', height: 18 }]} />
          <View style={[styles.bone, { width: '58%', height: 12 }]} />
        </View>
      ))}
      <Text style={styles.note}>Loading what you have recorded…</Text>
    </View>
  );
}

/* ── failure ─────────────────────────────────────────────────────────────── */

function FailureBody({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={[styles.stateWrap, styles.spread]} testID="wsf-activity-error">
      <View style={styles.group}>
        <View style={styles.failPanel}>
          <Text style={styles.failTitle}>Your progress could not be loaded just now.</Text>
          <Text style={styles.failBody}>
            Nothing has changed — this is the reading, not the record. What you recorded is still
            recorded.
          </Text>
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try loading your progress again"
            style={styles.failPrimary}
            testID="wsf-activity-retry"
          >
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        </View>
        <View style={styles.actionRow}>
          <Pill label="Go to Home" testID="wsf-activity-home" onPress={() => router.replace('/')} />
          <Pill
            label="Start moving"
            testID="wsf-activity-move"
            onPress={() => router.replace('/move')}
          />
        </View>
      </View>
      <View style={styles.fact}>
        <Text style={styles.factTitle}>Nothing was lost</Text>
        <Text style={styles.factBody}>
          Every amount you recorded is stored against its goal. This screen could not read it just
          now; it is still there.
        </Text>
      </View>
    </View>
  );
}

/* ── nothing recorded ────────────────────────────────────────────────────── */

function EmptyBody({ partial }: { partial: boolean }) {
  return (
    <View style={[styles.stateWrap, styles.spread]} testID="wsf-activity-empty">
      <View style={styles.group}>
        <View style={styles.emptyPanel}>
          <Text style={[display.lg, styles.emptyTitle]}>Nothing recorded yet</Text>
          <Text style={styles.emptyBody}>
            When you add what you did to a goal, it lands here — your part, kept to yourself.
          </Text>
          <Pressable
            onPress={() => router.replace('/move')}
            accessibilityRole="link"
            accessibilityLabel="Start moving"
            style={styles.primary}
            testID="wsf-activity-start"
          >
            <Text style={styles.primaryText}>Start moving</Text>
          </Pressable>
        </View>
        {partial ? <PartialNote /> : null}
      </View>
      <View style={styles.group}>
        <View style={styles.fact}>
          <Text style={styles.factTitle}>This page is only ever yours</Text>
          <Text style={styles.factBody}>
            It shows what you recorded. It is not a ranking, and nobody else can see it.
          </Text>
        </View>
        <View style={styles.fact}>
          <Text style={styles.factTitle}>Finished goals stay here</Text>
          <Text style={styles.factBody}>
            When a goal you added to ends, your part in it does not disappear.
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Something did not load. Saying so is the difference between a short list and
 * a short list presented as the whole truth.
 */
function PartialNote() {
  return (
    <View style={styles.partialNote} testID="wsf-activity-partial">
      <Text style={styles.partialText}>
        Some of your goals could not be read just now, so this may not be everything.
      </Text>
    </View>
  );
}

/* ── ready ───────────────────────────────────────────────────────────────── */

function ReadyBody({ state }: { state: Ready }) {
  const lead = state.finished.find((f) => f.reached && typeof f.sharedTotal === 'number');
  const total = state.running.length + state.finished.length;

  return (
    <View style={styles.stateWrap} testID="wsf-activity-rows">
      {/* The summary counts GOALS. Units do not add up across goals. */}
      <View style={styles.summary}>
        <Text style={styles.summaryLead}>
          {formatCount(total)} {total === 1 ? 'goal' : 'goals'} you have added to
        </Text>
        <Text style={styles.summaryMeta}>
          {formatCount(state.running.length)} running · {formatCount(state.finished.length)}{' '}
          finished
        </Text>
      </View>

      {state.partial ? <PartialNote /> : null}

      {state.running.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>WHAT YOU&apos;RE PART OF NOW</Text>
          {state.running.map((g) => (
            <View key={g.goalId} style={styles.runRow} testID={`wsf-activity-row-${g.goalId}`}>
              <View style={styles.runTop}>
                <Text style={styles.yourPart}>
                  {formatCount(g.yourPart)} <Text style={styles.yourPartUnit}>{g.unit}</Text>
                </Text>
                <Text style={styles.recordedTag}>RECORDED</Text>
              </View>
              <Text style={styles.runTitle} numberOfLines={1}>
                {g.title}
              </Text>
              <Text style={styles.runCommunity} numberOfLines={1}>
                {g.community}
              </Text>
              {typeof g.sharedTotal === 'number' ? (
                <View style={styles.runGoalState}>
                  <Text style={styles.runGoalText}>
                    {totalOfTargetLabel(g.sharedTotal, g.target, g.unit)} ·{' '}
                    {percentLabel(g.sharedTotal, g.target)}
                  </Text>
                  <Track total={g.sharedTotal} target={g.target} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.eyebrow}>WHAT YOU&apos;VE BEEN PART OF</Text>
        {state.finished.length === 0 ? (
          <View style={styles.quietPanel}>
            <Text style={styles.quietTitle}>Nothing finished yet</Text>
            <Text style={styles.quietBody}>
              When a goal you have added to ends, it stays here — your part in it, and whether the
              community reached it.
            </Text>
          </View>
        ) : (
          state.finished.map((g) => (
            <View
              key={g.goalId}
              style={[styles.doneRow, g.reached ? styles.doneRowReached : null]}
              testID={`wsf-activity-done-${g.goalId}`}
            >
              {/* The one Living WE, on the most recent goal the community
                  finished, filled by that goal's real final shared total. */}
              {g === lead && typeof g.sharedTotal === 'number' ? (
                <LivingWeProgress
                  completed={g.sharedTotal}
                  target={g.target}
                  unit={g.unit}
                  width={58}
                  surface="light"
                  testID="wsf-activity-we"
                />
              ) : null}
              <View style={styles.doneText}>
                <Text style={styles.donePart}>
                  {formatCount(g.yourPart)} <Text style={styles.donePartUnit}>{g.unit}</Text>
                </Text>
                <Text style={styles.doneTitle} numberOfLines={2}>
                  {g.title}
                </Text>
                <Text style={styles.doneWhen}>
                  {g.community}
                  {endedLabel(g.endsAt)}
                </Text>
              </View>
              {g.reached ? (
                <View style={styles.reachedBadge}>
                  <Text style={styles.reachedText}>REACHED</Text>
                </View>
              ) : typeof g.sharedTotal === 'number' ? (
                <Text style={styles.notReached}>{percentLabel(g.sharedTotal, g.target)}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.fact}>
        <Text style={styles.factTitle}>This page is only ever yours</Text>
        <Text style={styles.factBody}>
          It shows what you recorded. It is not a ranking, and nobody else can see it.
        </Text>
      </View>
    </View>
  );
}

/** " · Ended Aug 31", or nothing at all rather than a half-sentence. */
function endedLabel(endsAt: string | undefined): string {
  if (!endsAt) return '';
  const label = formatEndedOn(endsAt);
  return label ? ` · ${label}` : '';
}

function Track({ total, target }: { total: number; target: number }) {
  return (
    <View style={styles.track}>
      <View
        style={[styles.trackFill, { width: `${Math.round(fillRatio(total, target) * 100)}%` }]}
      />
    </View>
  );
}

function Pill({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={styles.pill}
      testID={testID}
    >
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: CREAM },
  page: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 10 },
  column: { flexGrow: 1, gap: 14 },
  wordmarkTap: { minHeight: 44, justifyContent: 'center' },
  pageTitle: { color: NAVY, marginTop: -2 },
  privacy: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  stateWrap: { gap: 12 },
  spread: { flexGrow: 1, justifyContent: 'space-between' },
  group: { gap: 12 },
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

  partialNote: {
    backgroundColor: '#FBF3E2',
    borderColor: '#E7D5A8',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  partialText: { color: '#6A5220', fontSize: 12.5, lineHeight: 17 },

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
  skeletonRowShort: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 7,
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

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', paddingTop: 2 },
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
  trackFill: { height: '100%', borderRadius: 3, backgroundColor: PROGRESS_GREEN },
});
