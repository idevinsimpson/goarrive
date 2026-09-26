import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import {
  SAME_LOAD_MS,
  peekGoals,
  peekMyCommunities,
  peekOwnCredit,
  readGoals,
  readMyCommunities,
  readOwnCredit,
  wasRefused,
} from '../../src/memberReads';
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
} from '../../src/ui/kit';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../src/ui/MemberTabBar';
import {
  fillRatio,
  formatCount,
  isReached,
  percentLabel,
  totalOfTargetLabel,
} from '../../src/ui/progressFormat';
import { formatEndedOn } from '../../src/ui/dates';

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
  groupId: string;
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

/** How long a revalidation may take before the page says it is checking. */
const CHECKING_AFTER_MS = 400;

type Owned = { community: Community; goal: Goal; own: { ownCredit?: unknown; unit?: unknown } | null };

/** The member's rows from their goals and own parts. `null`: that read failed. */
function composeProgress(owned: Array<Owned | null>, partialAlready: boolean): Ready {
  let partial = partialAlready;
  const running: Row[] = [];
  const finished: Row[] = [];
  for (const item of owned) {
    if (!item) {
      // A goal this member cannot read is simply not one of their rows,
      // but the screen says that something is missing rather than
      // presenting a short list as the whole truth.
      partial = true;
      continue;
    }
    const { community, goal, own } = item;
    const yourPart = typeof own?.ownCredit === 'number' ? own.ownCredit : 0;
    // Only goals with a real recorded own part.
    if (yourPart <= 0) continue;
    const row: Row = {
      goalId: goal.goalId,
      groupId: community.groupId,
      title: goal.title,
      community: community.displayName,
      unit: (typeof own?.unit === 'string' && own.unit) || goal.unit,
      yourPart,
      target: goal.target,
      sharedTotal: goal.sharedTotal,
      status: goal.status,
      endsAt: goal.endsAt,
      /*
        THE CURRENT TOTAL DECIDES, NOT THE HISTORICAL STAMP.

        `reachedAt` records that a goal crossed its target once. It is an
        EVENT, and events do not un-happen — so it survives a correction
        that takes the shared total back below the target. Reading it as
        the present state meant a goal corrected down to 380 of 500 still
        wore REACHED, and still drew the celebratory Living WE, because of
        something that had been true a week earlier.

        `isReached` over the confirmed total is the same rule Home already
        applies: `community/[groupId]/index.tsx` prints the reached DATE
        only when `reachedAt` exists AND the current phase is `reachedOpen`
        or `closedReached`. This was the one surface trusting the stamp
        alone.

        An unconfirmed total is not a reached goal. `sharedTotal` is absent
        when the aggregate read did not answer, and claiming the target was
        met on a number the product does not have is the same error in a
        different costume.
      */
      reached: typeof goal.sharedTotal === 'number' && isReached(goal.sharedTotal, goal.target),
    };
    if (goal.status === 'active') running.push(row);
    else finished.push(row);
  }
  // Most recently ended first, so the newest thing the member finished is
  // the one they see.
  finished.sort((a, b) => (b.endsAt ?? '').localeCompare(a.endsAt ?? ''));
  return { kind: 'ready', running, finished, partial };
}

/**
 * The page from this account's record alone, or `null` when the record does
 * not hold every community's goals and the own part in each goal
 * (src/memberReads.ts).
 */
function progressFromRecord(uid: string): Ready | null {
  const mine = peekMyCommunities(uid);
  if (!mine) return null;
  const owned: Owned[] = [];
  for (const community of mine.items as unknown as Community[]) {
    const goals = peekGoals<Goal>(uid, community.groupId)?.goals;
    if (!goals) return null;
    for (const goal of goals) {
      const own = peekOwnCredit(uid, goal.goalId);
      if (!own) return null;
      owned.push({ community, goal, own });
    }
  }
  return composeProgress(owned, false);
}

export default function ActivityScreen() {
  const { ready, user } = useWsfAuth();
  // The first frame already stands on the account's record when it can: a
  // loading state painted for one frame and then replaced is still a flash.
  const [state, setState] = useState<State>(
    () => (ready && user ? progressFromRecord(user.uid) : null) ?? { kind: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  const safeArea = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  /* The shell's own footprint, measured. The raised MOVE control lifts above
     the bar's body, so content that stops at its own padding sits under it. */
  const barInset = MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom;

  const liveRef = useRef(0);

  /*
    PERF-MOBILE-1. PROGRESS OPENS ON WHAT THIS ACCOUNT ALREADY KNOWS.

    Measured on `0b460ce3` (W7 Check 41B): the first visit painted the full
    skeleton behind three serial stages -- communities, then goals, then each
    own part -- all of which Home had usually read a moment before. Now, when
    this account's record (src/memberReads.ts) holds every community, every
    goal and the member's own part in each, the page opens on those rows at
    once (`progressFromRecord`) and revalidates through the same record, an
    answer from this load reused. What is on screen stays while it does: if
    that takes longer than a moment the page says it is checking; if it fails
    the page keeps what was last read and says so, with a Retry, which reads
    everything fresh. A fact the record does not hold means the page loads
    exactly as before; nothing is synthesized.
  */
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);

  /*
    PERF-MOBILE-1 SUCCESSOR (Director #494 `5841250834`, `5841341300`).
    THIS SCREEN STAYS MOUNTED UNDER MOVE AND BEHIND OTHER TABS, SO EVERY
    RETURN TO IT RECOMPOSES FROM THE ACCOUNT'S RECORD FIRST.
    A confirmed receipt has already written the member's new own part there,
    so closing MOVE shows it at once, with no read. When the record no longer
    holds everything (a refusal forgot a community; a receipt removed a list
    it could not patch), the rows of a refused community go at once and the
    rest stay while a revalidation reads what is missing. A warm return with
    a whole record makes no call at all.
  */
  const [revalidate, setRevalidate] = useState(0);
  const keepOnScreen = useRef(false);
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      if (!ready || !user) return;
      const uid = user.uid;
      const recorded = progressFromRecord(uid);
      if (recorded) {
        setState(recorded);
        return;
      }
      setState((prev) =>
        prev.kind === 'ready'
          ? {
              ...prev,
              running: prev.running.filter((r) => !wasRefused(uid, r.groupId)),
              finished: prev.finished.filter((r) => !wasRefused(uid, r.groupId)),
            }
          : prev,
      );
      keepOnScreen.current = true;
      setRevalidate((n) => n + 1);
    }, [ready, user]),
  );

  useEffect(() => {
    if (!ready || !user) return;
    const token = ++liveRef.current;
    const uid = user.uid;
    const reuse = attempt > 0 ? 0 : SAME_LOAD_MS;
    const recorded = attempt > 0 ? null : progressFromRecord(uid);
    const keep = keepOnScreen.current;
    keepOnScreen.current = false;
    setState((prev) => recorded ?? (keep && prev.kind === 'ready' ? prev : { kind: 'loading' }));
    setStale(false);
    setChecking(false);
    const slow = recorded || keep
      ? setTimeout(() => {
          if (liveRef.current === token) setChecking(true);
        }, CHECKING_AFTER_MS)
      : null;
    const settle = () => {
      if (slow) clearTimeout(slow);
      if (liveRef.current === token) setChecking(false);
    };

    (async () => {
      let communities: Community[];
      try {
        communities = (await readMyCommunities(uid, reuse)).items as unknown as Community[];
      } catch {
        if (liveRef.current !== token) return;
        settle();
        if (recorded || keep) setStale(true);
        else setState({ kind: 'error' });
        return;
      }

      if (communities.length === 0) {
        if (liveRef.current === token) {
          settle();
          setState({ kind: 'ready', running: [], finished: [], partial: false });
        }
        return;
      }

      // Bounded and parallel. The previous version awaited every community, then
      // every goal, then every own-part read one at a time — an N+1 chain
      // whose latency grew with the member's whole history.
      const perCommunity = await mapWithLimit(communities, READ_LIMIT, async (c) => {
        const r = await readGoals<Goal>(uid, c.groupId, reuse);
        return { community: c, goals: r.goals ?? [] };
      });

      let partial = false;
      const pairs: Array<{ community: Community; goal: Goal }> = [];
      for (const settled of perCommunity) {
        if (!settled.ok) {
          // One community that will not load must not erase the rest.
          partial = true;
          continue;
        }
        for (const goal of settled.value.goals) pairs.push({ community: settled.value.community, goal });
      }

      const owned = await mapWithLimit(pairs, READ_LIMIT, async ({ community, goal }) => {
        const own = await readOwnCredit(uid, goal.goalId, reuse);
        return { community, goal, own };
      });

      if (liveRef.current === token) {
        settle();
        setState(composeProgress(owned.map((o) => (o.ok ? o.value : null)), partial));
      }
    })();

    return () => {
      liveRef.current += 1;
      if (slow) clearTimeout(slow);
    };
  }, [ready, user, attempt, revalidate]);

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
        {/* THE WORDMARK IS THE SHELL'S NOW. The persistent member top bar in
            app/(tabs)/_layout.tsx carries it, and its tap is the one gesture
            that goes Home. A second copy here stacked two wordmarks down the
            page and gave the member two different Home gestures -- and this
            one navigated INTO the tab tree from inside it, which pushed a new
            community screen instead of returning to the mounted one. */}
        <Text style={[display.md, styles.pageTitle]} testID="wsf-activity-title">
          Your progress
        </Text>
        {/* What the page is, contribution first. Who can see what is said once,
            quietly, at the foot of the summary -- not promised up here. */}
        <Text style={styles.privacy} testID="wsf-activity-subtitle">
          Your recorded contributions, by goal.
        </Text>
        {checking && state.kind === 'ready' ? (
          <Text style={styles.note} testID="wsf-activity-checking">
            Checking for updates…
          </Text>
        ) : null}
        {stale && state.kind === 'ready' ? (
          <View style={styles.staleRow} testID="wsf-activity-stale">
            <Text style={[styles.note, styles.staleText]}>
              Couldn’t check for updates just now. This is what was last read.
            </Text>
            <Pressable
              onPress={retry}
              accessibilityRole="button"
              style={styles.staleRetry}
              testID="wsf-activity-stale-retry"
            >
              <Text style={styles.staleRetryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

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
            What you recorded is still recorded. This screen could not read it just now.
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
    </View>
  );
}

/* ── nothing recorded ────────────────────────────────────────────────────── */

function EmptyBody({ partial }: { partial: boolean }) {
  return (
    <View style={[styles.stateWrap, styles.spread]} testID="wsf-activity-empty">
      <View style={styles.group}>
        <View style={styles.emptyPanel}>
          <Text style={[display.lg, styles.emptyTitle]}>
            Your first contribution will appear here
          </Text>
          <Text style={styles.emptyBody}>
            Add what you did to a goal, and it is recorded here under that goal.
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
          <Text style={styles.factTitle}>Finished goals stay here</Text>
          <Text style={styles.factBody}>
            When a goal you added to ends, your part in it does not disappear.
          </Text>
        </View>
        <PersonalNote />
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

/**
 * THE ONE CLARIFICATION, said once per screen and no louder than a footnote.
 *
 * The earlier copy promised "nobody else can see it" several times over. That
 * was true of this summary and wrong about the member's contributions, which
 * appear in community activity by default. This says both halves precisely.
 */
function PersonalNote() {
  return (
    <Text style={styles.personalNote} testID="wsf-activity-privacy">
      This personal summary is only for you. Community activity follows your visibility settings.
    </Text>
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

      <PersonalNote />
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
  staleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  staleText: { flexShrink: 1 },
  staleRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  staleRetryText: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  scroll: { flex: 1, backgroundColor: CREAM },
  page: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 10 },
  column: { flexGrow: 1, gap: 14 },
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
  personalNote: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17, paddingHorizontal: 2 },

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
