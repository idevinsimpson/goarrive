import { signOut } from 'firebase/auth';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import { resolveCurrentCommunity } from '../../src/currentCommunity';
import { getFirebaseAuth } from '../../src/firebase';
import { UNKNOWN_SHARED, knownShared } from '../../src/goalTruth';
import {
  SAME_LOAD_MS,
  peekGoals,
  peekMemberProfile,
  peekMyCommunities,
  peekOwnCredit,
  readGoals,
  readMemberProfile,
  readMyCommunities,
  readOwnCredit,
  wasRefused,
  type MemberProfileAnswer,
} from '../../src/memberReads';
import { formatEndedOn, formatEndsAt, hasWindowEnded } from '../../src/ui/dates';
import { MOVE_HREF } from '../../src/ui/MemberTabBar';
import { YouParityView } from '../../src/ui/YouParityView';
import type { YouGoal } from '../../src/youParity';

/**
 * PAGE 5 — YOU. Implemented against the accepted target in
 * `docs/design-target/review/page-05-you/`.
 *
 * WHAT THIS PAGE IS FOR. Who you are, which community you move with, and what
 * you yourself have put in — separately from what the community has. Before
 * this it was a raw email address and a Sign out button over two thirds of
 * empty screen.
 *
 * ── EVERY VALUE HERE HAS A SOURCE, AND THE SOURCE DECIDED THE DESIGN ─────
 *
 *   displayName, createdAt   `wsfMemberProfiles/{uid}` read directly. The rule
 *                            is `allow read: if request.auth.uid == uid`, so
 *                            this is the member's own document and nobody
 *                            else's. `profile-setup` already reads it the same
 *                            way.
 *   community, role, count   `wsfMyCommunities`, resolved through
 *                            `resolveCurrentCommunity` — which returns null for
 *                            several memberships with none remembered. This
 *                            page NEVER silently picks the first.
 *   goals + shared total     `wsfListGoals({ includeHistory: true })`.
 *                            `sharedTotal` only arrives under includeHistory.
 *   your own part            `wsfMyContribution({ goalId })` -> ownCredit, unit.
 *
 * ── WHAT IT REFUSES, AND WHY EACH REFUSAL IS A FACT ABOUT THE PRODUCT ────
 *
 * NO STREAK, NO DATED ACTIVITY, NO PER-WEEK COUNT. `wsfContributions` and
 * `wsfGoalMemberTotals` are returned by no callable and `firestore.rules`
 * denies them, so there is nothing to read. Drawing it would require backend
 * work nobody has authorized.
 *
 * NO TOTAL ACROSS UNITS. Push-ups and movements do not add up. Own credit is
 * per goal, always with its unit.
 *
 * NO RATIO OF OWN PART TO SHARED TOTAL, no ranking, no comparison with another
 * member, and no "you moved us from X to Y" — that last is arithmetic over a
 * window containing everybody who wrote in it, not a fact about one person.
 * Own credit and shared state are shown side by side and separately labelled,
 * and nothing joins them into a claim about cause.
 *
 * NO PHOTO, NO QUOTE, NO SHARE, NO LEAVE. Nothing stores the first two; the
 * only share path shares a GOAL's public display; leaving lives on Community,
 * because duplicating a destructive action is how it gets pressed by accident.
 *
 * ── SIGN OUT SURVIVES EVERY FAILURE ──────────────────────────────────────
 *
 * It needs no read, so it is rendered from auth state alone and appears on the
 * failure state, the no-community state and the empty state alike. A page that
 * loses its way out when a callable fails is a page that traps somebody in it.
 */

const READ_LIMIT = 4;

/*
  YOU-PARITY-1 PHASE B. THIS ROUTE IS NOW AN ADAPTER.

  The page is drawn by the pure `YouParityView` (the accepted Lovable You
  reference `642f830b`; src/ui/YouParityView.tsx). This file keeps exactly what
  PERF-MOBILE-1 made it — the account's record first, one read path, the
  revalidation on return, checking / stale / Retry — and only maps the state it
  resolves into the view's props. Three facts are mapped here and nowhere else:
    · a shared total the list did not return is UNKNOWN, never 0 (goalTruth);
    · a goal's period is written in the goal's own time zone (src/ui/dates);
    · Start moving is offered only when this community has a goal that can
      take a contribution now: active, a positive target, its window not over.
*/

type Community = {
  groupId: string;
  displayName: string;
  role: string;
  memberCount: number;
  /** Names the community's kind; the view prints it only when the product names it. */
  groupType?: string;
};

type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt?: string;
  /** The goal's IANA zone; its window is written in it. */
  timezone?: string;
  sharedTotal?: number;
};

/** `pending`: the profile has not been read yet; the name waits, it is not guessed. */
type Profile = { displayName: string | null; memberSince: string | null; pending?: boolean };

type Screen =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'noCommunity'; profile: Profile }
  /**
   * IN SEVERAL COMMUNITIES, WITH NONE PICKED — NOT THE SAME AS BEING IN NONE.
   *
   * `resolveCurrentCommunity` returns null in two quite different cases: the
   * member belongs to nothing, and the member belongs to several with no
   * remembered choice. Folding both into `noCommunity` told the second person
   * "You're not in a community yet", which is simply false about them. The
   * count comes with the state so the screen can say the true thing.
   */
  | { kind: 'pickCommunity'; profile: Profile; count: number }
  | { kind: 'failed'; profile: Profile }
  | {
      kind: 'member';
      profile: Profile;
      community: Community;
      open: YouGoal[];
      finished: YouGoal[];
      /** True when a read failed and this list is not the whole truth. */
      partial: boolean;
      /** This community has a goal that can take a contribution now. */
      eligible: boolean;
    };

/** Month and year only. A join date is identity, not activity. */
function monthAndYear(value: unknown): string | null {
  const d =
    value && typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** How long a revalidation may take before the page says it is checking. */
const CHECKING_AFTER_MS = 400;

function toProfile(answer: MemberProfileAnswer): Profile {
  return { displayName: answer.displayName, memberSince: monthAndYear(answer.createdAt) };
}

/** The goal's window, written in its own zone; null when it cannot be read. */
function periodLabelOf(goal: Goal, open: boolean): string | null {
  if (!goal.endsAt) return null;
  const opts = { timeZone: goal.timezone ?? null };
  // An `active` goal whose end instant has passed says so, rather than "Ends".
  return open && !hasWindowEnded(goal.endsAt)
    ? formatEndsAt(goal.endsAt, opts)
    : formatEndedOn(goal.endsAt, opts);
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

/** The member's page from their goals and own parts. `null`: that read failed. */
function composeMember(
  profile: Profile,
  community: Community,
  goals: Goal[],
  owned: Array<{ goal: Goal; own: { ownCredit?: unknown; unit?: unknown } | null } | null>,
): Screen {
  let partial = false;
  const open: Array<{ row: YouGoal; endsAt: string }> = [];
  const finished: Array<{ row: YouGoal; endsAt: string }> = [];
  for (const item of owned) {
    if (!item) {
      partial = true;
      continue;
    }
    const { goal, own } = item;
    const yourPart = typeof own?.ownCredit === 'number' ? own.ownCredit : 0;
    // ONLY GOALS THIS MEMBER ACTUALLY PUT SOMETHING INTO. A goal they never
    // touched is the community's business, not a row on their own page.
    if (yourPart <= 0) continue;
    const isOpen = goal.status === 'active';
    const row: YouGoal = {
      goalId: goal.goalId,
      title: goal.title,
      communityName: community.displayName,
      unit: (typeof own?.unit === 'string' && own.unit) || goal.unit,
      target: goal.target,
      yourPart,
      // Not answered is not zero (goalTruth): no number, no Living WE.
      shared: typeof goal.sharedTotal === 'number' ? knownShared(goal.sharedTotal) : UNKNOWN_SHARED,
      open: isOpen,
      periodLabel: periodLabelOf(goal, isOpen),
    };
    (isOpen ? open : finished).push({ row, endsAt: goal.endsAt ?? '' });
  }
  // Soonest to end leads: it is the one with something still to do in it.
  open.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  finished.sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  return {
    kind: 'member',
    profile,
    community,
    open: open.map((o) => o.row),
    finished: finished.map((f) => f.row),
    partial,
    eligible: goals.some(takesContributions),
  };
}

/**
 * The page from this account's record alone, or `null` when the record does
 * not hold every fact the page needs (src/memberReads.ts).
 */
function youFromRecord(uid: string): Screen | null {
  const mine = peekMyCommunities(uid);
  if (!mine) return null;
  const known = peekMemberProfile(uid);
  const profile: Profile = known ? toProfile(known) : { displayName: null, memberSince: null, pending: true };
  const communities = mine.items as unknown as Community[];
  if (communities.length === 0) return { kind: 'noCommunity', profile };
  const currentId = resolveCurrentCommunity(
    uid,
    communities.map((c) => c.groupId),
  );
  const community = communities.find((c) => c.groupId === currentId) ?? null;
  if (!community) return { kind: 'pickCommunity', profile, count: communities.length };
  const goals = peekGoals<Goal>(uid, community.groupId)?.goals;
  if (!goals) return null;
  const owned: Array<{ goal: Goal; own: { ownCredit?: unknown; unit?: unknown } }> = [];
  for (const goal of goals) {
    const own = peekOwnCredit(uid, goal.goalId);
    if (!own) return null;
    owned.push({ goal, own });
  }
  return composeMember(profile, community, goals, owned);
}

export default function You() {
  const { ready, user } = useWsfAuth();
  // The first frame already stands on the account's record when it can: a
  // loading state painted for one frame and then replaced is still a flash.
  const [screen, setScreen] = useState<Screen>(
    () => (ready && user ? youFromRecord(user.uid) : null) ?? { kind: 'loading' },
  );
  const [signingOut, setSigningOut] = useState(false);
  const [reloads, setReloads] = useState(0);
  /** Guards a landed read against a newer one, and against an unmounted tree. */
  const live = useRef(0);

  /*
    PERF-MOBILE-1. YOU OPENS ON WHAT THIS ACCOUNT ALREADY KNOWS.

    Measured on `0b460ce3` (W7 Check 41B): the first visit painted a full
    skeleton behind four serial reads -- the profile, then the communities,
    then the goals, then each own part -- three of which Home had read a
    moment before. Now:
      · when this account's record (src/memberReads.ts) holds the member's
        communities, the current community's goals and the own part in each,
        the page opens on them at once (`youFromRecord`); the name waits in
        its place until the profile is read, it is never guessed;
      · every read runs through the same record, the profile alongside the
        rest instead of before it, and an answer from this load is reused;
      · what was opened on stays in place while this revalidates. If that
        takes longer than a moment the page says it is checking; if it fails
        the page keeps what was last read and says so, with a Retry. A Retry
        reads everything fresh.
    Nothing is synthesized: a fact the record does not hold means the page
    loads exactly as before.
  */
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);

  /*
    PERF-MOBILE-1 SUCCESSOR (Director #494 `5841250834`, `5841341300`).
    EVERY RETURN TO THIS MOUNTED SCREEN RECOMPOSES FROM THE ACCOUNT'S RECORD
    FIRST: a confirmed receipt has already written the new own part there, so
    closing MOVE shows it with no read. When the record no longer holds
    everything, the page keeps what it shows and revalidates -- except a
    community a fresh server answer refused, whose figures go at once. A warm
    return with a whole record makes no call.
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
      const recorded = youFromRecord(uid);
      if (recorded) {
        setScreen(recorded);
        return;
      }
      setScreen((prev) =>
        prev.kind === 'member' && wasRefused(uid, prev.community.groupId) ? { kind: 'loading' } : prev,
      );
      keepOnScreen.current = true;
      setRevalidate((n) => n + 1);
    }, [ready, user]),
  );

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setScreen({ kind: 'signedOut' });
      return;
    }
    const token = ++live.current;
    const uid = user.uid;
    const reuse = reloads > 0 ? 0 : SAME_LOAD_MS;
    const recorded = reloads > 0 ? null : youFromRecord(uid);
    const keep = keepOnScreen.current;
    keepOnScreen.current = false;
    setScreen((prev) => recorded ?? (keep && prev.kind !== 'loading' ? prev : { kind: 'loading' }));
    setStale(false);
    setChecking(false);
    const slow = recorded || keep
      ? setTimeout(() => {
          if (live.current === token) setChecking(true);
        }, CHECKING_AFTER_MS)
      : null;
    const settle = () => {
      if (slow) clearTimeout(slow);
      if (live.current === token) setChecking(false);
    };

    void (async () => {
      // THE PROFILE ALONGSIDE THE REST. It is the member's own document and
      // needs no callable, so an identity is on screen even when every goal
      // read fails -- but nothing else has to wait for it.
      const profileRead: Promise<Profile> = readMemberProfile(uid, reuse).then(toProfile, () => ({
        displayName: null,
        memberSince: null,
      }));
      const fail = async () => {
        const profile = await profileRead;
        if (live.current !== token) return;
        settle();
        if (recorded && recorded.kind === 'member') {
          setScreen({ ...recorded, profile });
          setStale(true);
          return;
        }
        if (keep) {
          setStale(true);
          return;
        }
        setScreen({ kind: 'failed', profile });
      };

      let communities: Community[] = [];
      try {
        communities = (await readMyCommunities(uid, reuse)).items as unknown as Community[];
      } catch {
        await fail();
        return;
      }
      if (live.current !== token) return;

      if (communities.length === 0) {
        const profile = await profileRead;
        if (live.current !== token) return;
        settle();
        setScreen({ kind: 'noCommunity', profile });
        return;
      }

      // NEVER SILENTLY THE FIRST. `resolveCurrentCommunity` returns null when
      // there are several and none is remembered; this page then has no single
      // community to speak for and says so rather than choosing one.
      const currentId = resolveCurrentCommunity(
        uid,
        communities.map((c) => c.groupId),
      );
      const community = communities.find((c) => c.groupId === currentId) ?? null;
      if (!community) {
        const profile = await profileRead;
        if (live.current !== token) return;
        settle();
        setScreen({ kind: 'pickCommunity', profile, count: communities.length });
        return;
      }

      let goals: Goal[] = [];
      try {
        goals = (await readGoals<Goal>(uid, community.groupId, reuse)).goals ?? [];
      } catch {
        await fail();
        return;
      }
      if (live.current !== token) return;

      // Bounded and parallel, with each failure isolated — the pattern Progress
      // was accepted on. One goal that will not load must not empty the page.
      const owned = await mapWithLimit(goals, READ_LIMIT, async (goal) => ({
        goal,
        own: await readOwnCredit(uid, goal.goalId, reuse),
      }));
      const profile = await profileRead;
      if (live.current !== token) return;
      settle();
      setScreen(composeMember(profile, community, goals, owned.map((o) => (o.ok ? o.value : null))));
    })();
    return () => {
      if (slow) clearTimeout(slow);
    };
  }, [ready, user, reloads, revalidate]);

  const onSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut(getFirebaseAuth())
      .then(() => router.replace('/'))
      .finally(() => setSigningOut(false));
  }, []);

  const reload = useCallback(() => setReloads((v) => v + 1), []);

  return (
    <YouParityView
      state={screen}
      email={user?.email ?? null}
      signingOut={signingOut}
      refresh={{ checking, stale, onRetry: reload }}
      actions={{
        onSettings: () => router.push('/settings'),
        onSignOut,
        onSignIn: () => router.push('/signin'),
        onCommunity: () => router.push('/community'),
        onRetry: reload,
        onStartMoving: () => router.push(MOVE_HREF),
      }}
    />
  );
}
