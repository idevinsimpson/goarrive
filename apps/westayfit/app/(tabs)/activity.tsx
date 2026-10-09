import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import { UNKNOWN_SHARED, knownShared } from '../../src/goalTruth';
import {
  SAME_LOAD_MS,
  peekGoals,
  peekMemberProfile,
  peekMyCommunities,
  peekOwnCredit,
  readGoals,
  readMyCommunities,
  readOwnCredit,
  wasRefused,
} from '../../src/memberReads';
import type { ProgressGoal, ProgressState } from '../../src/progressParity';
import { formatEndedOn, formatEndsAt, hasWindowEnded } from '../../src/ui/dates';
import { ProgressParityView } from '../../src/ui/ProgressParityView';
import { isReached } from '../../src/ui/progressFormat';

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

/*
  PROGRESS-PARITY-1 PHASE B. THIS ROUTE IS NOW AN ADAPTER.

  The page is drawn by the pure `ProgressParityView` (the accepted Lovable
  Progress reference `09b8a73c`; src/ui/ProgressParityView.tsx). This file keeps
  exactly what PERF-MOBILE-1 made it — the account's record first, bounded
  parallel reads, the revalidation on return, checking / stale / Retry — and
  maps what it resolves into the view's props. Mapped here and nowhere else:
    · a shared total the list did not return is UNKNOWN, never 0 (goalTruth);
    · a goal's period is written in the goal's own time zone (src/ui/dates);
    · Start moving only when some goal can take a contribution now: active,
      a positive target, its window not over;
    · the member's name only from what this account already read — no read;
    · dated receipts: none (no canonical source), so `receipts: null`.
*/

type Community = { groupId: string; displayName: string };
type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt?: string;
  /** The goal's IANA zone; its window is written in it. */
  timezone?: string;
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
  timezone?: string;
  reached: boolean;
};

type Ready = {
  kind: 'ready';
  running: Row[];
  finished: Row[];
  /** Some read failed. What did load is still shown, and this says so. */
  partial: boolean;
  /** Some goal that was read can take a contribution now. */
  canStart: boolean;
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
      timezone: goal.timezone,
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
  const canStart = owned.some((item) => item !== null && takesContributions(item.goal));
  return { kind: 'ready', running, finished, partial, canStart };
}

/** A goal that can take a contribution now: Start moving is only offered for one. */
function takesContributions(goal: Goal): boolean {
  return (
    goal.status === 'active' &&
    typeof goal.target === 'number' &&
    goal.target > 0 &&
    !(goal.endsAt && hasWindowEnded(goal.endsAt))
  );
}

/** A row as the view takes it: shared known or not, the period in the goal's zone. */
function toProgressGoal(row: Row): ProgressGoal {
  const open = row.status === 'active';
  const opts = { timeZone: row.timezone ?? null };
  const periodLabel = !row.endsAt
    ? null
    : open && !hasWindowEnded(row.endsAt)
      ? formatEndsAt(row.endsAt, opts)
      : formatEndedOn(row.endsAt, opts);
  return {
    goalId: row.goalId,
    title: row.title,
    communityId: row.groupId,
    community: row.community,
    unit: row.unit,
    yourPart: row.yourPart,
    target: row.target,
    // Not answered is not zero (goalTruth): no number, never reached.
    shared: typeof row.sharedTotal === 'number' ? knownShared(row.sharedTotal) : UNKNOWN_SHARED,
    open,
    periodLabel,
  };
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
          setState({ kind: 'ready', running: [], finished: [], partial: false, canStart: false });
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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const memberName = ready && user ? (peekMemberProfile(user.uid)?.displayName ?? null) : null;
  // From the record the effect just read, not a new read: a member in no
  // community has nothing open, and must not be told "your community" does.
  const noCommunity = ready && user ? peekMyCommunities(user.uid)?.items.length === 0 : false;
  const view: ProgressState = !ready
    ? { kind: 'loading' }
    : !user
      ? { kind: 'signedOut' }
      : state.kind === 'loading'
        ? { kind: 'loading' }
        : state.kind === 'error'
          ? { kind: 'failed', memberName }
          : {
              kind: 'ready',
              memberName,
              // Soonest to end first, as You orders them: the goal with the
              // least time left to act in leads.
              open: state.running
                .slice()
                .sort((a, b) => (a.endsAt ?? '').localeCompare(b.endsAt ?? ''))
                .map(toProgressGoal),
              finished: state.finished.map(toProgressGoal),
              partial: state.partial,
              canStart: state.canStart,
              receipts: null,
              noCommunity,
            };

  return (
    <ProgressParityView
      // Every state arrives at its own top: a new phase or a Retry mounts the
      // view's scroller afresh, as PERF's scroll-to-top did.
      key={`${view.kind}-${attempt}`}
      state={view}
      bottomInset={safeArea.bottom}
      refresh={{ checking, stale, onRetry: retry }}
      actions={{
        onRetry: retry,
        onStartMoving: () => router.replace('/move'),
        onOpenCommunity: () => router.push('/community'),
        // No canonical receipt source exists; the view draws no receipt rows.
        onOpenReceipt: () => {},
      }}
    />
  );
}
