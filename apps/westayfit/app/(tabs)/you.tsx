import { signOut } from 'firebase/auth';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import {
  currentCommunityReady,
  isCurrentCommunityReady,
  resolveCurrentCommunity,
  useCurrentCommunityReady,
} from '../../src/currentCommunity';
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
// W16-5 (INT-17): on a phone the native twin names the opener focus returns to.
import { armTabsFocusReturnTo } from '../../src/ui/focusReturn';
import { MOVE_HREF } from '../../src/ui/MemberTabBar';
import { nativeErrorBoundary } from '../../src/ui/RouteErrorFallback';
import { signOutToSignedOutHome } from '../../src/ui/signOutReset';
import { YOU_SETTINGS_TARGET, YouParityView } from '../../src/ui/YouParityView';
import { RESUME_MIN_AWAY_MS, useResumeRefresh } from '../../src/useResumeRefresh';
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
  resolves into the view's props. Four facts are mapped here and nowhere else:
    · a shared total the list did not return is UNKNOWN, never 0 (goalTruth);
    · a goal's period is written in the goal's own time zone (src/ui/dates);
    · Start moving is offered only when this community has a goal that can
      take a contribution now: active, a positive target, its window not over;
    · goals the member helped in their OTHER communities are listed under
      their own community's name when the account's record holds them, never
      as the lead, and the list is partial until it does (elsewhereFromRecord).
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
  /**
   * `community` is present only when the failure came after this exact
   * current community was resolved (Director #503 `5844877801`, W7 Y-F10):
   * the page keeps what it knows and guesses nothing else.
   */
  | { kind: 'failed'; profile: Profile; community?: Community }
  | {
      kind: 'member';
      profile: Profile;
      community: Community;
      /** This community's open credited goals; the first leads. */
      open: YouGoal[];
      /** Open credited goals in the member's other communities; never the lead. */
      otherOpen: YouGoal[];
      finished: YouGoal[];
      /**
       * True when this list is not the whole truth: a read failed, or another
       * community's goals are not in the account's record yet.
       */
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

type Own = { ownCredit?: unknown; unit?: unknown };
type Placed = { row: YouGoal; endsAt: string };

/**
 * One goal as a row on this member's page, under the community it belongs to;
 * `null` when the member put nothing into it. ONLY GOALS THIS MEMBER ACTUALLY
 * PUT SOMETHING INTO: a goal they never touched is the community's business,
 * not a row on their own page.
 */
function placeRow(goal: Goal, own: Own | null, communityName: string): Placed | null {
  const yourPart = typeof own?.ownCredit === 'number' ? own.ownCredit : 0;
  if (yourPart <= 0) return null;
  const isOpen = goal.status === 'active';
  const row: YouGoal = {
    goalId: goal.goalId,
    title: goal.title,
    communityName,
    unit: (typeof own?.unit === 'string' && own.unit) || goal.unit,
    target: goal.target,
    yourPart,
    // Not answered is not zero (goalTruth): no number, no Living WE.
    shared: typeof goal.sharedTotal === 'number' ? knownShared(goal.sharedTotal) : UNKNOWN_SHARED,
    open: isOpen,
    periodLabel: periodLabelOf(goal, isOpen),
  };
  return { row, endsAt: goal.endsAt ?? '' };
}

/** What the member helped in their OTHER communities, and whether that is all of it. */
type Elsewhere = { placed: Placed[]; partial: boolean };

/*
  THE MEMBER'S OTHER COMMUNITIES, FROM THE ACCOUNT'S RECORD ONLY (Director #365
  `5841997009`). A goal the member helped in another community is theirs too
  and is listed under "Other goals you helped" with that community's own name.
  This page reads nothing extra for it: no cold fan-out across communities
  (MEMBER-SNAPSHOT-1 later brings those facts in one call). A community whose
  goals, or a goal whose own part, the record does not hold makes the list
  PARTIAL — never a current-community-only list presented as complete.
*/
function elsewhereFromRecord(uid: string, communities: Community[], currentId: string): Elsewhere {
  const placed: Placed[] = [];
  let partial = false;
  for (const c of communities) {
    if (c.groupId === currentId) continue;
    const goals = peekGoals<Goal>(uid, c.groupId)?.goals;
    if (!goals) {
      partial = true;
      continue;
    }
    for (const goal of goals) {
      const own = peekOwnCredit(uid, goal.goalId);
      if (!own) {
        partial = true;
        continue;
      }
      const p = placeRow(goal, own, c.displayName);
      if (p) placed.push(p);
    }
  }
  return { placed, partial };
}

// Soonest to end leads: it is the one with something still to do in it.
const soonestFirst = (a: Placed, b: Placed) => a.endsAt.localeCompare(b.endsAt);
const latestFirst = (a: Placed, b: Placed) => b.endsAt.localeCompare(a.endsAt);

/**
 * The member's page from this community's goals and own parts (`null`: that
 * read failed) and what they helped elsewhere. The lead is only ever this
 * community's: it sits under this community's band.
 */
function composeMember(
  profile: Profile,
  community: Community,
  goals: Goal[],
  owned: Array<{ goal: Goal; own: Own | null } | null>,
  elsewhere: Elsewhere,
): Screen {
  let partial = elsewhere.partial;
  const open: Placed[] = [];
  const otherOpen: Placed[] = [];
  const finished: Placed[] = [];
  for (const item of owned) {
    if (!item) {
      partial = true;
      continue;
    }
    const p = placeRow(item.goal, item.own, community.displayName);
    if (p) (p.row.open ? open : finished).push(p);
  }
  for (const p of elsewhere.placed) (p.row.open ? otherOpen : finished).push(p);
  open.sort(soonestFirst);
  otherOpen.sort(soonestFirst);
  finished.sort(latestFirst);
  return {
    kind: 'member',
    profile,
    community,
    open: open.map((o) => o.row),
    otherOpen: otherOpen.map((o) => o.row),
    finished: finished.map((f) => f.row),
    partial,
    eligible: goals.some(takesContributions),
  };
}

type ComposeArgs = Parameters<typeof composeMember>;

/**
 * The page from this account's record alone, with the inputs a member page
 * was composed from (heads-11 NB-3: kept, so a later failed revalidation can
 * recompose THAT page against now), or `null` when the record does not hold
 * every fact the page needs (src/memberReads.ts).
 */
function recordedYou(uid: string): { screen: Screen; args: ComposeArgs | null } | null {
  const mine = peekMyCommunities(uid);
  if (!mine) return null;
  const known = peekMemberProfile(uid);
  const profile: Profile = known ? toProfile(known) : { displayName: null, memberSince: null, pending: true };
  const communities = mine.items as unknown as Community[];
  if (communities.length === 0) return { screen: { kind: 'noCommunity', profile }, args: null };
  // Not before the phone's remembered choice is read, where it can change the
  // answer: with several communities "none chosen" would be a guess. With one,
  // the answer is that one either way.
  if (communities.length > 1 && !isCurrentCommunityReady()) return null;
  const currentId = resolveCurrentCommunity(
    uid,
    communities.map((c) => c.groupId),
  );
  const community = communities.find((c) => c.groupId === currentId) ?? null;
  if (!community) return { screen: { kind: 'pickCommunity', profile, count: communities.length }, args: null };
  const goals = peekGoals<Goal>(uid, community.groupId)?.goals;
  if (!goals) return null;
  const owned: Array<{ goal: Goal; own: Own }> = [];
  for (const goal of goals) {
    const own = peekOwnCredit(uid, goal.goalId);
    if (!own) return null;
    owned.push({ goal, own });
  }
  const args: ComposeArgs = [profile, community, goals, owned, elsewhereFromRecord(uid, communities, community.groupId)];
  return { screen: composeMember(...args), args };
}

/*
  NATIVE-MEMBER-1 F-1 (MF-03). A SCREEN BELONGS TO THE ACCOUNT IT WAS READ FOR.

  The tab stays mounted across a menu Sign out (`freezeOnBlur: false`), so a
  read still in flight when the account goes away used to land afterwards and
  draw the previous account's name, community and amounts on a signed-out
  screen, or under the next account's email. Two guards, each on its own:
    · the effect's cleanup advances `live`, so a read issued for one session
      neither lands nor issues the next read once that session has ended;
    · every screen is stored with the uid it was composed for, and the page
      draws it only while that uid is the signed-in one. Signed out it draws
      the signed-out card, from auth state alone, from the very first frame.
*/
type Owned = { uid: string | null; screen: Screen };
const LOADING: Screen = { kind: 'loading' };
const SIGNED_OUT: Screen = { kind: 'signedOut' };

/** What the page may draw now: never a screen read for another account, or for none. */
function screenForAccount(ready: boolean, uid: string | null, held: Owned): Screen {
  if (ready && !uid) return SIGNED_OUT;
  if (uid && held.uid !== uid) return LOADING;
  return held.screen;
}

/** NATIVE-MEMBER-1 W16-13 (INT-01 CS-4). On a phone a throw in You is contained inside the You tab, as Progress's is; undefined on the web. */
export const ErrorBoundary = nativeErrorBoundary('tab');

/**
 * RV15-639-N2. WHETHER A PAGE A FAILED LOAD WOULD KEEP IS ONE ITS FRESH READ
 * STILL SHOWS. A load that fails keeps a member page already on screen (one
 * drawn at mount from the record, or by the readiness repaint) and marks it
 * stale, rather than replacing it with the failed page. That is right only
 * while nothing the load did read contradicts the page:
 *   - `resolved` absent: the membership read itself failed, no fresh list was
 *     read, and nothing contradicts the page: keep it;
 *   - otherwise the list was read (`listed`) and resolved a community whose
 *     goals then failed: keep the page only if that list still holds its
 *     community AND it is the community resolved. A page for a community the
 *     list no longer holds, or for another one, is not kept; the caller draws
 *     the failed page for the resolved community.
 * (`resolved` is taken from `listed`, so today the second condition implies
 * the first.) Anything but a member page is never kept by this rule.
 */
function keptPageStillShown(
  page: Screen | null,
  resolved: Community | undefined,
  listed: readonly Community[],
): page is Extract<Screen, { kind: 'member' }> {
  if (!page || page.kind !== 'member') return false;
  if (!resolved) return true;
  const groupId = page.community.groupId;
  return listed.some((c) => c.groupId === groupId) && groupId === resolved.groupId;
}

export default function You() {
  const { ready, user } = useWsfAuth();
  // The first frame already stands on the account's record when it can: a
  // loading state painted for one frame and then replaced is still a flash.
  const [firstRecord] = useState(() => (ready && user ? recordedYou(user.uid) : null));
  const [held, setHeld] = useState<Owned>(() => ({
    uid: ready && user ? user.uid : null,
    screen: firstRecord?.screen ?? LOADING,
  }));
  /**
   * W16-17 (RV16-C15-1): the page on screen and the account it is for,
   * mirrored wherever `held` changes (only setScreen sets it), so a failed load
   * can test the page ON SCREEN against its fresh read: a focus may have
   * redrawn it since the load began, and fail() runs outside any updater.
   */
  const shownRef = useRef<Owned>(held);
  /**
   * Sets the screen for `uid`; an updater sees another account's screen as
   * loading. W16-17: the next screen is worked out here, against the mirror,
   * and the mirror is set at once; `held` follows it.
   */
  const setScreen = useCallback((uid: string | null, next: Screen | ((prev: Screen) => Screen)) => {
    const base = shownRef.current.uid === uid ? shownRef.current.screen : LOADING;
    const out: Owned = { uid, screen: typeof next === 'function' ? next(base) : next };
    shownRef.current = out;
    setHeld(out);
  }, []);
  const [signingOut, setSigningOut] = useState(false);
  const [reloads, setReloads] = useState(0);
  // A page that came up before the phone's remembered community was read
  // shows loading (recordedYou above); once the read lands, the frame the
  // record could not give then is given now. Not after a Retry, which reads
  // everything fresh. The load below still replaces it.
  const communityReady = useCurrentCommunityReady();
  // heads-11 F2: what that repaint drew. It lets the load in flight keep the
  // page on screen if it fails, under the same gate as a page drawn at mount
  // (`fail` below).
  const repainted = useRef<{ uid: string; screen: Screen } | null>(null);
  useEffect(() => {
    if (!communityReady || !ready || !user || reloads > 0) return;
    const warmNow = recordedYou(user.uid)?.screen ?? null;
    repainted.current = warmNow ? { uid: user.uid, screen: warmNow } : null;
    const uid = user.uid;
    setScreen(uid, (prev) => (prev.kind === 'loading' ? recordedYou(uid)?.screen ?? prev : prev));
  }, [communityReady, ready, user, reloads, setScreen]);
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
        the page opens on them at once (`recordedYou`); the name waits in
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
  /** INT-12 (W16-2): the next revalidation reads fresh (a return to the app), not from the record. */
  const freshNext = useRef(false);
  /**
   * INT-12 case 4 (review 1343247d-N3): what the member page on screen was
   * composed from, when it came from a NETWORK read, for this account only,
   * so a failed revalidation that keeps the page can recompose it against
   * NOW. A goal whose end passed while the app slept must stop offering
   * "Start moving" even when the server could not be asked (hasWindowEnded
   * is pure). heads-10 F-1 and heads-11 NB-3: these are ALWAYS the inputs of
   * the page on screen, whatever drew it: a network read, or the account's
   * record (the focus path, the effect's recorded branch, which also covers
   * the first frame's record page on the same mount, and a kept page
   * recomposed from the record). So they are never older than the page, and
   * a page drawn from the record can still be recomposed against now after
   * the record has lost a fact.
   */
  const composedFrom = useRef<{ uid: string; args: ComposeArgs } | null>(null);
  /** The page on screen was drawn from the record: its inputs become the record's. */
  const drawnFromRecord = (uid: string, rec: { args: ComposeArgs | null }) => {
    composedFrom.current = rec.args ? { uid, args: rec.args } : null;
  };
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      if (!ready || !user) return;
      const uid = user.uid;
      const rec = recordedYou(uid);
      if (rec) {
        drawnFromRecord(uid, rec);
        setScreen(uid, rec.screen);
        return;
      }
      setScreen(uid, (prev) =>
        prev.kind === 'member' && wasRefused(uid, prev.community.groupId) ? { kind: 'loading' } : prev,
      );
      keepOnScreen.current = true;
      setRevalidate((n) => n + 1);
    }, [ready, user, setScreen]),
  );

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      composedFrom.current = null;
      setScreen(null, SIGNED_OUT);
      return;
    }
    const token = ++live.current;
    repainted.current = null;
    const uid = user.uid;
    const fresh = reloads > 0 || freshNext.current;
    freshNext.current = false;
    const reuse = fresh ? 0 : SAME_LOAD_MS;
    const rec = fresh ? null : recordedYou(uid);
    const recorded = rec?.screen ?? null;
    const keep = keepOnScreen.current;
    keepOnScreen.current = false;
    if (rec) drawnFromRecord(uid, rec);
    setScreen(uid, (prev) => recorded ?? (keep && prev.kind !== 'loading' ? prev : { kind: 'loading' }));
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
      // NB-4: whether this load's profile read answered (its failure fallback
      // is not a profile, so a kept page does not take it for one).
      let profileAnswered = false;
      const profileRead: Promise<Profile> = readMemberProfile(uid, reuse).then(
        (answer) => {
          profileAnswered = true;
          return toProfile(answer);
        },
        () => ({ displayName: null, memberSince: null }),
      );
      const fail = async (community?: Community) => {
        const profile = await profileRead;
        if (live.current !== token) return;
        settle();
        /*
          WHICH PAGE A FAILED LOAD KEEPS (RV16-C15-1, RV16-C15-2, RV16-639-1).
          A load may keep what is on screen, marked stale, when it began on a
          member page from the record (`recorded`), when the readiness repaint
          drew a member page while it was in flight (`painted`, heads-11 F2),
          or when it is a return's revalidation (`keep`). ONE GATE decides,
          on the page ON SCREEN now (`shownRef`), not on the page the load
          began on, which a focus may have replaced since:
            · a member page is kept only while the fresh read still shows it
              (`keptPageStillShown`, RV15-639-N2);
            · pick, none and failed pages are kept, as before; 'loading' never
              is: a skeleton is never left up as a stale page (a refused
              community's page dropped to loading, then a failed revalidation).
          Otherwise the failed page for the resolved community, with Retry,
          and nothing is marked stale. The condition is member's (W16-17),
          with the repainted page added: only this tree keeps it apart.
        */
        const painted = !recorded && !keep && repainted.current?.uid === uid ? repainted.current.screen : null;
        // Candidate-17 composition: the repainted page joins the one gate below
        // (W13-12), so it is judged on the page on screen like the others and
        // kept through member's keep body, whose head never falls back to the
        // read's failure fallback (RV16-C15-3).
        // heads-13 RV15-642-B2: a load that drew the record's member page
        // fails the same way as a kept one. It used to put back the page it
        // drew when it STARTED, so a focus that had since drawn a newer page
        // or another community (a switch, a receipt) was undone, and a failed
        // profile read replaced the recorded name with "You".
        //
        // W16-17 (RV15-639-N2, RV16-C15-1, RV16-C15-2): ONE GATE, ON THE PAGE
        // ON SCREEN (a focus may have redrawn it since this load began; the
        // keep body below keeps and recomposes that page, so it is the one
        // tested). A member page is kept only while this load's fresh read
        // still shows it (`keptPageStillShown`, above, verbatim from state-1
        // c2992bef; with no list read nothing contradicts it); a page the
        // fresh read contradicts falls through to the failed page for the
        // community resolved, with Retry and no stale mark. A 'loading' page
        // (the focus dropped a refused community's figures) is never kept: it
        // falls through to the failed page with Retry, not a skeleton marked
        // stale. Pick, none and failed pages are kept and marked stale, as
        // before.
        const shown = shownRef.current.uid === uid ? shownRef.current.screen : LOADING;
        if (
          (keep || (recorded && recorded.kind === 'member') || (painted && painted.kind === 'member')) &&
          (shown.kind === 'member' ? keptPageStillShown(shown, community, communities) : shown.kind !== 'loading')
        ) {
          // Kept, but recomposed against now (N3). heads-10 F-1: from the
          // account's record first, which is never older than the page (a
          // receipt, a focus and a switch all write or read it); only when it
          // no longer holds every fact, from the inputs the page on screen was
          // composed from (NB-3: never older than it). And only ever as the
          // same community: a failed read never swaps the community on screen.
          const from = composedFrom.current?.uid === uid ? composedFrom.current.args : null;
          const rec = recordedYou(uid);
          const again = rec?.screen ?? (from ? composeMember(...from) : null);
          if (again?.kind === 'member') {
            setScreen(uid, (prev) => {
              if (prev.kind !== 'member' || prev.community.groupId !== again.community.groupId) return prev;
              if (rec) drawnFromRecord(uid, rec);
              // NB-4: the head is the freshest profile there is: this load's
              // read if it answered, else the record's, else the one the page
              // already shows. Never a pending bar over a name, or over the
              // "You" header, on a page kept as last read. heads-13
              // RV15-642-N1: "the record's" is the account's recorded profile
              // even when the page was recomposed from `composedFrom` (the
              // record could not), which may hold an older name; and those
              // inputs take the head shown, so they stay the page's own.
              // W16-20 (heads-14 RV16-642-N1): the chain never ends on a
              // pending profile. A record with no profile composes a pending
              // head, and so may the page on screen; with both pending, the
              // head is this load's failure fallback (`profile`), the "You"
              // header, not the pending bar.
              const known = peekMemberProfile(uid);
              const head = profileAnswered
                ? profile
                : known
                  ? toProfile(known)
                  : !again.profile.pending
                    ? again.profile
                    : !prev.profile.pending
                      ? prev.profile
                      : profile;
              if (!rec && from) composedFrom.current = { uid, args: [head, ...from.slice(1)] as ComposeArgs };
              return { ...again, profile: head };
            });
          }
          setStale(true);
          return;
        }
        setScreen(uid, community ? { kind: 'failed', profile, community } : { kind: 'failed', profile });
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
        setScreen(uid, { kind: 'noCommunity', profile });
        return;
      }

      // NEVER SILENTLY THE FIRST. `resolveCurrentCommunity` returns null when
      // there are several and none is remembered; this page then has no single
      // community to speak for and says so rather than choosing one. On a
      // phone the remembered choice is read from storage at launch; wait for
      // that read (immediate on web) rather than mistake "not read yet" for
      // "none remembered".
      await currentCommunityReady();
      if (live.current !== token) return;
      const currentId = resolveCurrentCommunity(
        uid,
        communities.map((c) => c.groupId),
      );
      const community = communities.find((c) => c.groupId === currentId) ?? null;
      if (!community) {
        const profile = await profileRead;
        if (live.current !== token) return;
        settle();
        setScreen(uid, { kind: 'pickCommunity', profile, count: communities.length });
        return;
      }

      let goals: Goal[] = [];
      try {
        goals = (await readGoals<Goal>(uid, community.groupId, reuse)).goals ?? [];
      } catch {
        // The current community is already resolved: keep it on screen.
        await fail(community);
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
      const args: Parameters<typeof composeMember> = [
        profile,
        community,
        goals,
        owned.map((o) => (o.ok ? o.value : null)),
        elsewhereFromRecord(uid, communities, community.groupId),
      ];
      composedFrom.current = { uid, args };
      setScreen(uid, composeMember(...args));
    })();
    return () => {
      // MF-03: whatever this run still has in flight belongs to a session or
      // a load that is over -- the signed-out branch above takes no token.
      live.current += 1;
      if (slow) clearTimeout(slow);
    };
  }, [ready, user, reloads, revalidate, setScreen]);

  // NATIVE-MEMBER-1 SH-7 (INT-05). You's own Sign out lands where the menu's
  // does: on a phone, after a SUCCESSFUL sign-out, the root stack is reset to
  // signed-out Home as one route with nothing behind it
  // (src/ui/signOutReset.ts). The reset goes to the root stack -- this tab's
  // parent, the same navigation object the shell's menu dispatches on -- and
  // a failed sign-out moves nothing. On the web You has always gone to Home
  // after signing out; it still does, and only after a successful one.
  const navigation = useNavigation();
  const onSignOut = useCallback(() => {
    setSigningOut(true);
    void signOutToSignedOutHome({
      signOut: () => signOut(getFirebaseAuth()),
      dispatch: (action) => (navigation.getParent() ?? navigation).dispatch(action as never),
      platform: Platform.OS,
    })
      .then((signedOut) => {
        if (signedOut && Platform.OS === 'web') router.replace('/');
      })
      .finally(() => setSigningOut(false));
  }, [navigation]);

  const reload = useCallback(() => setReloads((v) => v + 1), []);

  const screen = screenForAccount(ready, user?.uid ?? null, held);

  /*
    NATIVE-MEMBER-1 W16-2 (INT-12). COMING BACK TO THE APP READS FRESH, as
    Progress does (activity.tsx). A tab return recomposes from the account's
    record; a return to the app after at least 30 s away
    (src/useResumeRefresh.ts) asks the server, because a goal may have ended
    while the app slept and You would otherwise keep offering "Start moving"
    for it. What is on screen stays while it reads ("Checking…" after a
    moment); a failed read keeps it, marked as last read, with Retry. A failed
    screen is retried on any return.
  */
  useResumeRefresh(
    () => {
      if (!ready || !user) return;
      if (screen.kind === 'failed') {
        setReloads((n) => n + 1);
        return;
      }
      freshNext.current = true;
      keepOnScreen.current = true;
      setRevalidate((n) => n + 1);
    },
    { minAwayMs: screen.kind === 'failed' ? 0 : RESUME_MIN_AWAY_MS },
  );

  return (
    <YouParityView
      state={screen}
      email={user?.email ?? null}
      signingOut={signingOut}
      refresh={{ checking, stale, onRetry: reload }}
      actions={{
        onSettings: () => {
          // W16-5 (INT-17). On a phone, when Settings closes the screen
          // reader's focus comes back to this row (YouHead registers it), not
          // to the top bar's menu button. The web finds its own opener in the
          // document and is left exactly as it was.
          if (Platform.OS !== 'web') armTabsFocusReturnTo(YOU_SETTINGS_TARGET);
          router.push('/settings');
        },
        onSignOut,
        onSignIn: () => router.push('/signin'),
        onCommunity: () => router.push('/community'),
        onRetry: reload,
        onStartMoving: () => router.push(MOVE_HREF),
      }}
    />
  );
}
