import { router, useFocusEffect } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../../src/auth';
import { mapWithLimit } from '../../../src/concurrency';
import { rememberCurrentCommunity, resolveCurrentCommunity } from '../../../src/currentCommunity';
import { getFirebaseFunctions } from '../../../src/firebase';
import { groupTypeCardLabel, joinPolicyLabel, memberCountLabel } from '../../../src/labels';
import { InitialsAvatar, isChampionRole } from '../../../src/ui/CommunityPresence';
import { formatPeriod, formatSinceShort } from '../../../src/ui/dates';
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
} from '../../../src/ui/kit';
import { LivingWeProgress } from '../../../src/ui/LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../../src/ui/MemberTabBar';
import {
  fillRatio,
  formatCount,
  isReached,
  percentLabel,
  statusLine,
  totalOfTargetLabel,
  totalOfTargetParts,
} from '../../../src/ui/progressFormat';
import { peekGoals, peekMyCommunities, readGoals, readMyCommunities } from '../../../src/memberReads';
import { onPrivacySettled } from '../../../src/ui/CommunityPrivacyControls';

/**
 * COMMUNITY — who "we" is, and which community Home opens.
 *
 * Community is `/community`. Home is `/community/[groupId]`. That split is the
 * whole shape of this screen: Home is where a member ACTS in the community
 * they are in, and this is where they see who they belong to and change which
 * one that is. It is not a second command centre and it is not a directory.
 *
 * WHICH ONE IS CURRENT IS NOT THIS SCREEN'S GUESS. `resolveCurrentCommunity()`
 * returns null when a member belongs to several and has opened none of them,
 * and this screen asks rather than picking the first. Marking a row CURRENT by
 * convenience would be the interface inventing a fact.
 *
 * WHO IS HERE IS WHAT MEMBERS CHOSE TO SHOW. The roster is
 * `wsfCommunityMembers`: the names of members whose "Show my name" is on, and
 * -- only when that list is complete -- how many are here without a name. The
 * recent-movement strip is amounts, units and coarse times; its callable
 * rebuilds every row from `amount` and `at` alone, so no uid or name can ride
 * out of it. There are no photos, reactions or rankings.
 *
 * ONE BAD READ MUST NOT EMPTY THE SCREEN. Goals are enriched per community,
 * bounded and in parallel, and each community's failure is its own. A member
 * whose third community will not load still sees the first two and still has
 * their way back into the one they were in.
 *
 * JOIN GOES WHERE A CODE IS TAKEN. `/join/[joinCode]` takes the code from the
 * route, and the one place a typed code is accepted is Home's list ("Join
 * with a code", `/?view=communities`). The Join chip opens exactly that and
 * is named for it.
 */

/** At most this many community goal reads are in flight at once. */
const GOAL_READ_LIMIT = 4;
/** Recent movement is read for at most this many of the current community's goals. */
const MOMENTUM_GOAL_LIMIT = 3;
/** And at most this many entries are shown, newest first. */
const MOMENTUM_ROWS = 4;

type Membership = {
  groupId: string;
  displayName: string;
  memberCount: number;
  role: string;
  /** Stored enums; the banner states them through the shared labels or not at all. */
  groupType?: string;
  joinPolicy?: string;
};

type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  sharedTotal?: number;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
};

/**
 * The current community's roster, from `wsfCommunityMembers`: the members who
 * chose to be named, and whether that list is the whole of them. The server
 * applies each member's privacy choice; this screen never sees a private name.
 */
type Roster =
  | { groupId: string; people: { displayName: string; role: string }[]; complete: boolean }
  | { groupId: string; failed: true }
  | 'pending';

type Addition = { amount: number; unit: string; at: string };

/**
 * A membership plus whatever could be read about it. `failed` is its own.
 * `pending` is the warm first frame's honest gap: this account has not read
 * this community's goals yet in this session, and the row says so rather
 * than guessing "no goal".
 */
type Enriched = Membership & { goals: Goal[] | 'failed' | 'pending' };

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: Enriched[]; currentId: string | null; momentum: Addition[]; roster: Roster };

/*
  COMMUNITY-SETTINGS-PARITY-1. THE ROSTER, AS THE REFERENCE DRAWS IT LAST:
  who is in the current community, by the names they chose to show.
  `wsfCommunityMembers` applies every member's privacy choice server-side; a
  failure says so rather than guessing a list. The answer carries the
  community it was read for, so it can never be drawn under another
  community's heading.
*/
async function readRoster(groupId: string): Promise<Roster> {
  try {
    const r = await httpsCallable<
      { groupId: string },
      { members: { displayName: string; role: string }[]; nextCursor: string | null }
    >(getFirebaseFunctions(), 'wsfCommunityMembers')({ groupId });
    return {
      groupId,
      people: Array.isArray(r.data?.members) ? r.data.members : [],
      complete: (r.data?.nextCursor ?? null) === null,
    };
  } catch {
    return { groupId, failed: true };
  }
}

function activeGoals(goals: Goal[] | 'failed' | 'pending'): Goal[] {
  return goals === 'failed' || goals === 'pending' ? [] : goals.filter((g) => g.status === 'active');
}

/*
  APP-FEEL-PARITY-1 CHECKPOINT 2. THE FIRST VISIT OPENS ON WHAT IS KNOWN.

  Measured on `91392f9d`: the first visit to this tab after Home showed the
  whole-page skeleton for about 2.5 s, while re-reading the membership list
  Home had just read. When this account's list is already in the shared
  record (src/memberReads.ts), the page opens on it -- the real rows, the
  current community, the counts -- with each community's goals as far as they
  were read (the current one usually was, by its own Home) and `pending`
  where they were not. The fresh reads below run exactly as before and
  replace all of it. Nothing is fetched ahead; a first visit with nothing
  read still shows the skeleton.
*/
function warmState(uid: string | null): State | null {
  const mine = peekMyCommunities(uid);
  if (!mine || !uid) return null;
  const items = mine.items as unknown as Membership[];
  if (items.length === 0) return null;
  const enriched: Enriched[] = items.map((m) => ({
    ...m,
    goals: (peekGoals<Goal>(uid, m.groupId)?.goals as Goal[] | undefined) ?? 'pending',
  }));
  return {
    kind: 'ready',
    items: enriched,
    currentId: resolveCurrentCommunity(uid, items.map((m) => m.groupId)),
    momentum: [],
    roster: 'pending',
  };
}

export default function CommunityIndexScreen() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>(
    () => (ready && user ? warmState(user.uid) : null) ?? { kind: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);
  /*
    APP-FEEL-PARITY-1 CHECKPOINT 3. WHICH COMMUNITY IS CURRENT IS RE-ASKED,
    NOT REMEMBERED BY THIS SCREEN.

    This tab stays mounted, and it used to decide CURRENT once, when it first
    loaded. A member who then switched community -- from its own rows, from
    Home's Switch, from a chip -- came back to a tab still naming the old one
    as CURRENT and offering only it as the other row (measured on `91392f9d`
    and after it). Now a chip, or any focus of this tab that finds the
    remembered choice (`resolveCurrentCommunity`) has moved, re-renders the
    tab around the member's actual choice: at once from what this account
    already read (src/memberReads.ts), then from the fresh reads.
  */
  const [selection, setSelection] = useState(0);
  const retrying = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const safeArea = useSafeAreaInsets();

  /*
    THE SHELL'S OWN FOOTPRINT, measured rather than guessed. The raised MOVE
    control lifts above the bar's body, so content that stops at its own
    padding sits under it no matter how far the page scrolls.
  */
  const barInset = MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom;

  // The request that is allowed to publish. A retry, a sign-out or an unmount
  // while a slow read is in flight must not let a stale answer land.
  const liveRef = useRef(0);

  /*
    WHO IS NAMED FOLLOWS THE CHOICE AS IT IS NOW (hardening addendum, #489
    `5841405625`). A privacy change settled in Settings re-reads the current
    community's roster, so a member who turns their name off is not still
    listed by name when they come back to this tab. `rosterGen` makes that
    re-read win over any older roster read still in flight.
  */
  const rosterGen = useRef(0);
  const [rosterNonce, setRosterNonce] = useState(0);
  useEffect(() => onPrivacySettled(() => setRosterNonce((n) => n + 1)), []);

  useEffect(() => {
    if (!ready || !user) return;
    const token = ++liveRef.current;
    const uid = user.uid;
    // A retry, or an account with nothing already read, starts from loading;
    // a warm first frame for THIS account stays up while the fresh reads run.
    const warm = retrying.current ? null : warmState(uid);
    retrying.current = false;
    setState(warm ?? { kind: 'loading' });

    (async () => {
      const fns = getFirebaseFunctions();
      let items: Membership[];
      try {
        const result = await readMyCommunities(uid);
        items = result.items as unknown as Membership[];
      } catch {
        if (liveRef.current === token) setState({ kind: 'error' });
        return;
      }

      if (items.length === 0) {
        if (liveRef.current === token) {
          setState({ kind: 'ready', items: [], currentId: null, momentum: [], roster: 'pending' });
        }
        return;
      }

      // Bounded and parallel. Serially this is an N+1 chain whose latency
      // grows with membership count; unbounded it is a burst of callables.
      const settled = await mapWithLimit(items, GOAL_READ_LIMIT, async (m) => {
        const r = await readGoals<Goal>(uid, m.groupId);
        return r.goals;
      });

      const enriched: Enriched[] = items.map((m, i) => {
        const s = settled[i];
        return { ...m, goals: s && s.ok ? s.value : 'failed' };
      });

      // `memberOf` is the authority, and the resolver — not this screen —
      // decides. Several memberships with nothing remembered is NULL.
      const currentId = resolveCurrentCommunity(
        uid,
        items.map((m) => m.groupId),
      );

      const current = currentId ? enriched.find((e) => e.groupId === currentId) : undefined;
      const open = current ? activeGoals(current.goals).slice(0, MOMENTUM_GOAL_LIMIT) : [];

      // Recent movement and the roster are independent reads: side by side.
      const readMomentum = async (): Promise<Addition[]> => {
        if (open.length === 0) return [];
        const recent = httpsCallable<{ goalId: string }, { additions: Addition[] }>(
          fns,
          'wsfGoalRecentAdditions',
        );
        const reads = await mapWithLimit(open, MOMENTUM_GOAL_LIMIT, async (g) => {
          const r = await recent({ goalId: g.goalId });
          return Array.isArray(r.data?.additions) ? r.data.additions : [];
        });
        return (
          reads
            .flatMap((r) => (r.ok ? r.value : []))
            .filter((a) => typeof a.amount === 'number' && typeof a.at === 'string')
            // Merged on the real instant, never on the order the reads returned:
            // two goals' tails interleave in time and stitching them end to end
            // would present a false sequence.
            .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
            .slice(0, MOMENTUM_ROWS)
        );
      };

      const rosterIssued = rosterGen.current;
      const readCurrentRoster = async (): Promise<Roster> => (current ? readRoster(current.groupId) : 'pending');

      const [momentum, fetched] = await Promise.all([
        readMomentum().catch(() => [] as Addition[]),
        readCurrentRoster(),
      ]);

      if (liveRef.current === token) {
        setState((prev) => {
          // A roster re-read after a privacy change is newer than this one.
          const roster =
            rosterGen.current !== rosterIssued &&
            prev.kind === 'ready' &&
            prev.roster !== 'pending' &&
            fetched !== 'pending' &&
            prev.roster.groupId === fetched.groupId
              ? prev.roster
              : fetched;
          return { kind: 'ready', items: enriched, currentId, momentum, roster };
        });
      }
    })();

    return () => {
      liveRef.current += 1;
    };
  }, [ready, user, attempt, selection]);

  // Back on this tab: if the member's current community moved while they
  // were elsewhere, the tab follows it.
  const currentIdNow = state.kind === 'ready' ? state.currentId : null;

  // The re-read a settled privacy change asks for: the roster only.
  useEffect(() => {
    if (rosterNonce === 0 || !currentIdNow) return;
    const gen = ++rosterGen.current;
    const groupId = currentIdNow;
    void readRoster(groupId).then((roster) => {
      if (rosterGen.current !== gen) return;
      setState((prev) => (prev.kind === 'ready' && prev.currentId === groupId ? { ...prev, roster } : prev));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterNonce]);

  const idsNow = state.kind === 'ready' ? state.items.map((i) => i.groupId).join(',') : '';
  useFocusEffect(
    useCallback(() => {
      if (!user || !idsNow) return;
      const chosen = resolveCurrentCommunity(user.uid, idsNow.split(','));
      if (chosen && chosen !== currentIdNow) setSelection((n) => n + 1);
    }, [user, idsNow, currentIdNow]),
  );

  /** A chip: the member's choice, in place, said out loud. */
  const select = useCallback(
    (groupId: string, name: string) => {
      if (!user || groupId === currentIdNow) return;
      rememberCurrentCommunity(user.uid, groupId);
      setAnnouncement(`Now showing ${name}.`);
      setSelection((n) => n + 1);
    },
    [user, currentIdNow],
  );

  /** Choosing or switching: remember it, then open that community's Home. */
  const open = useCallback(
    (groupId: string) => {
      rememberCurrentCommunity(user?.uid ?? null, groupId);
      router.replace(`/community/${groupId}`);
    },
    [user],
  );

  const body = (
    <View style={styles.column}>
        {/* THE WORDMARK IS THE SHELL'S NOW. The persistent member top bar in
            app/(tabs)/_layout.tsx carries it, and its tap is the one gesture
            that goes Home. A second copy here stacked two wordmarks down the
            page and gave the member two different Home gestures -- and this
            one navigated INTO the tab tree from inside it, which pushed a new
            community screen instead of returning to the mounted one. */}
      {state.kind === 'ready' && state.currentId && ready && user ? null : (
        <Text style={[display.md, styles.pageTitle]} testID="wsf-community-index-title">
          Community
        </Text>
      )}

      {!ready || !user ? (
        <Text style={styles.note} testID="wsf-community-index-signed-out">
          Sign in to see your communities.
        </Text>
      ) : state.kind === 'loading' ? (
        <LoadingBody />
      ) : state.kind === 'error' ? (
        <FailureBody
          onRetry={() => {
            retrying.current = true;
            setAttempt((n) => n + 1);
          }}
        />
      ) : state.items.length === 0 ? (
        <EmptyBody />
      ) : state.currentId ? (
        <CommunityParity state={state} onSelect={select} onOpen={open} onRefresh={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          <Chips state={state} onSelect={select} />
          <ReadyBody state={state} onOpen={open} />
        </>
      )}
    </View>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: barInset + 16 }]}
      testID="wsf-community-index"
    >
      {body}
      {/* The chip's announcement: polite, and not a visible line of copy. */}
      <Text
        style={styles.visuallyHidden}
        testID="wsf-community-index-announce"
        {...({ 'aria-live': 'polite' } as Record<string, unknown>)}
      >
        {announcement}
      </Text>
    </ScrollView>
  );
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/**
 * The skeleton is the real structure: the current-community panel, then rows.
 * A lone spinner over a blank page tells the member nothing about what is
 * arriving, and the page loses its own identity while it waits.
 */
function LoadingBody() {
  return (
    <View style={styles.stateWrap} testID="wsf-community-index-loading">
      <View style={styles.skeletonPanel}>
        <View style={styles.boneRow}>
          <View style={[styles.bone, { width: 74, height: 20 }]} />
          <View style={[styles.bone, { width: 96, height: 20 }]} />
        </View>
        <View style={[styles.bone, { width: '86%', height: 30 }]} />
        <View style={[styles.bone, { width: '40%', height: 14 }]} />
        <View style={styles.boneRule} />
        <View style={styles.boneGoal}>
          <View style={[styles.bone, { width: 60, height: 42 }]} />
          <View style={styles.boneGoalText}>
            <View style={[styles.bone, { width: '80%', height: 16 }]} />
            <View style={[styles.bone, { width: '60%', height: 13 }]} />
            <View style={[styles.bone, { width: '100%', height: 6 }]} />
          </View>
        </View>
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={[styles.bone, { width: '52%', height: 17 }]} />
          <View style={[styles.bone, { width: '34%', height: 12 }]} />
        </View>
      ))}
      <Text style={styles.note}>Loading your communities…</Text>
    </View>
  );
}

/* ── failure ─────────────────────────────────────────────────────────────── */

/**
 * A failure still knows what page it is, and offers more than a retry: a
 * member who cannot load this list can still reach the community they were in.
 */
function FailureBody({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.stateWrap} testID="wsf-community-index-error">
      <View style={styles.failPanel}>
        <Text style={styles.failTitle}>Your communities could not be loaded just now.</Text>
        <Text style={styles.failBody}>
          Nothing has changed — this is the reading, not the record.
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try loading your communities again"
          style={styles.failPrimary}
          testID="wsf-community-index-retry"
        >
          <Text style={styles.primaryText}>Try again</Text>
        </Pressable>
      </View>
      <View style={styles.actionRow}>
        <Pill label="Go to Home" testID="wsf-community-index-home" onPress={() => router.replace('/')} />
        <Pill
          label="Start a community"
          testID="wsf-community-index-start"
          onPress={() => router.replace('/start-community')}
        />
      </View>
    </View>
  );
}

/* ── no memberships ──────────────────────────────────────────────────────── */

function EmptyBody() {
  return (
    <View style={styles.stateWrap} testID="wsf-community-index-empty">
      <View style={styles.emptyPanel}>
        {/*
          NO SLOGAN, and no Join button. The heading is the thing the member is
          here to do; the copy is the only true account of how it happens, and
          the one control on this panel is the one that works.
        */}
        <Text style={[display.lg, styles.emptyTitle]}>Join a community</Text>
        <Text style={styles.emptyBody}>
          You join with an invite link or QR code from someone already in the community. Ask them
          to send you one.
        </Text>
        <View style={styles.emptyRule} />
        <Text style={styles.emptyOr}>Or start your own and invite people to it.</Text>
        <Pressable
          onPress={() => router.replace('/start-community')}
          accessibilityRole="link"
          accessibilityLabel="Start a community"
          style={styles.primary}
          testID="wsf-community-index-start"
        >
          <Text style={styles.primaryText}>Start a community</Text>
        </Pressable>
      </View>

      <View style={styles.facts}>
        {[
          [
            'Count what you choose',
            'Your community sets what it is counting, and how much. It can run more than one goal at a time.',
          ],
          ['Every amount counts once', 'You add what you did. The shared total is the record.'],
          ['No leaderboards', 'There is no ranking here, and nobody is compared.'],
        ].map(([title, text]) => (
          <View key={title} style={styles.fact}>
            <Text style={styles.factTitle}>{title}</Text>
            <Text style={styles.factBody}>{text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── your communities ───────────────────────────────────────────────────── */

/**
 * THE REFERENCE'S SWITCHER (Lovable `a15a610e`, screens/community.tsx): one
 * chip per community this account belongs to, the current one filled and
 * checked and pressed; pressing another selects it here, in place.
 *
 * Since COMMUNITY-SETTINGS-PARITY-1 the row always shows, as the reference
 * draws it: every joined community, then Join and Start -- so a member of one
 * community still sees where more come from.
 */
function Chips({
  state,
  onSelect,
}: {
  state: Extract<State, { kind: 'ready' }>;
  onSelect: (groupId: string, name: string) => void;
}) {
  return (
    <View style={styles.chipsBlock} testID="wsf-community-index-chips">
      <Text style={styles.eyebrow} {...({ role: 'heading', 'aria-level': 2 } as Record<string, unknown>)}>
        YOUR COMMUNITIES
      </Text>
      <View style={styles.chipsRow}>
        {state.items.map((item) => {
          const on = item.groupId === state.currentId;
          return (
            <Pressable
              key={item.groupId}
              onPress={() => onSelect(item.groupId, item.displayName)}
              accessibilityRole="button"
              accessibilityLabel={on ? `${item.displayName}, current` : `Show ${item.displayName}`}
              accessibilityState={{ selected: on }}
              {...({ 'aria-pressed': on } as Record<string, unknown>)}
              style={[styles.switchChip, on ? styles.switchChipOn : null]}
              testID={`wsf-community-index-chip-${item.groupId}`}
            >
              {on ? <Text style={[styles.switchChipText, styles.switchChipTextOn]}>✓ </Text> : null}
              <Text
                style={[styles.switchChipText, on ? styles.switchChipTextOn : null]}
                numberOfLines={1}
              >
                {item.displayName}
              </Text>
            </Pressable>
          );
        })}
        {/*
          JOIN AND START, as the reference's dashed chips. Join opens the one
          place this product takes a join code today (Home's list, with its
          "Join with a code" field), and is named for exactly that; Start
          opens community creation. Both are real destinations.
        */}
        <Pressable
          onPress={() => router.push('/?view=communities' as never)}
          accessibilityRole="link"
          accessibilityLabel="Join with a code"
          style={[styles.switchChip, styles.switchChipGhost]}
          testID="wsf-community-index-join"
        >
          <Text style={styles.switchChipIcon} aria-hidden>
            +
          </Text>
          <Text style={[styles.switchChipText, styles.switchChipTextGhost]}>Join</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/start-community' as never)}
          accessibilityRole="link"
          accessibilityLabel="Start a community"
          style={[styles.switchChip, styles.switchChipGhost]}
          testID="wsf-community-index-start"
        >
          <Text style={styles.switchChipIcon} aria-hidden>
            +
          </Text>
          <Text style={[styles.switchChipText, styles.switchChipTextGhost]}>Start</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── several memberships, none chosen ────────────────────────────────────── */

/**
 * SEVERAL MEMBERSHIPS AND NONE CHOSEN. `resolveCurrentCommunity()` returned
 * null, so the screen asks instead of picking. Every row is an equal choice
 * and says so.
 */
function ReadyBody({
  state,
  onOpen,
}: {
  state: Extract<State, { kind: 'ready' }>;
  onOpen: (groupId: string) => void;
}) {
  return (
    <View style={styles.stateWrap} testID="wsf-community-index-rows">
      <View style={styles.choosePanel} testID="wsf-community-index-choose">
        <Text style={styles.chooseTitle}>Choose which community Home opens</Text>
        <Text style={styles.chooseBody}>
          You are in {state.items.length} communities and have not opened one yet. Pick one — you
          can switch whenever you like.
        </Text>
      </View>
      <View style={styles.others}>
        {state.items.map((item) => (
          <OtherRow key={item.groupId} item={item} cue="Choose" onPress={() => onOpen(item.groupId)} />
        ))}
      </View>
    </View>
  );
}

/* ── the current community, in the reference's order ─────────────────────── */

/*
  COMMUNITY-SETTINGS-PARITY-1 CHECKPOINT 2. THE LITERAL HIERARCHY.

  Frozen Lovable `d4f60624`, src/demo/screens/community.tsx, in its order
  (Director #489 `5841270180`):
    1. the navy identity banner -- the name, then Members / Your role / Goals;
    2. every joined community as a chip, then Join and Start;
    3. THIS PERIOD -- one featured open goal with its Living WE, and the
       other open goals as a separately labelled "Also open" list;
    4. GOAL HISTORY -- "What we’ve done together";
    5. the roster -- "N people", by the names members chose to show.
  What this route had beyond the reference stays, after it: the rows that
  open another community's Home, then recent movement (Home owns the
  momentum feed; here it is a quiet last section).

  NOTHING IS INVENTED FOR THE REFERENCE'S SAMPLE SLOTS (#489 `5840935594`).
  Its place line is the stored group type, or nothing; its descriptor is the
  stored join policy in the words Community Home already uses. A goal list
  not read yet or not readable says so; it is never "No active goal" and
  never a count of 0.
*/
function CommunityParity({
  state,
  onSelect,
  onOpen,
  onRefresh,
}: {
  state: Extract<State, { kind: 'ready' }>;
  onSelect: (groupId: string, name: string) => void;
  onOpen: (groupId: string) => void;
  onRefresh: () => void;
}) {
  const current = state.items.find((i) => i.groupId === state.currentId)!;
  const others = state.items.filter((i) => i.groupId !== current.groupId);
  const roster = state.roster !== 'pending' && state.roster.groupId === current.groupId ? state.roster : 'pending';

  return (
    <View testID="wsf-community-index-rows">
      <Banner item={current} />
      <View style={styles.switcher}>
        <Chips state={state} onSelect={onSelect} />
      </View>
      <PeriodBlock item={current} onRefresh={onRefresh} />
      <HistoryBlock item={current} />
      <RosterBlock item={current} roster={roster} />

      {others.length > 0 ? (
        <View style={[styles.others, styles.afterCore]}>
          <Text style={styles.eyebrow}>OPEN ANOTHER COMMUNITY</Text>
          {others.map((item) => (
            <OtherRow key={item.groupId} item={item} cue="Switch" onPress={() => onOpen(item.groupId)} />
          ))}
        </View>
      ) : null}

      {state.momentum.length > 0 ? <Momentum rows={state.momentum} /> : null}
    </View>
  );
}

/** Goals this community has, when its list was read; null when it was not. */
function goalsOf(item: Enriched): Goal[] | null {
  return item.goals === 'pending' || item.goals === 'failed' ? null : item.goals;
}

/** The server returns at most this many closed goals with the history. */
const HISTORY_LIMIT = 50;

function Banner({ item }: { item: Enriched }) {
  const place = groupTypeCardLabel(item.groupType);
  const goals = goalsOf(item);
  const closed = goals ? goals.filter((g) => g.status === 'closed').length : 0;
  return (
    <View style={styles.banner} testID="wsf-community-index-current">
      {/* The reference's ring, drawn inside the banner's own bounds. */}
      <View style={styles.bannerRing} pointerEvents="none" />
      {place ? <Text style={styles.bannerEyebrow}>{place}</Text> : null}
      <Text
        style={styles.bannerName}
        numberOfLines={2}
        testID="wsf-community-index-title"
        {...({ role: 'heading', 'aria-level': 1 } as Record<string, unknown>)}
      >
        {item.displayName}
      </Text>
      {typeof item.joinPolicy === 'string' ? (
        <Text style={styles.bannerLine}>Joining: {joinPolicyLabel(item.joinPolicy)}</Text>
      ) : null}
      <View style={styles.bannerFacts}>
        <View style={styles.factCell}>
          <Text style={styles.factLabel}>Members</Text>
          <Text style={styles.factValue} testID="wsf-community-index-member-count">
            {formatCount(item.memberCount)}
          </Text>
        </View>
        <View style={styles.factCell}>
          <Text style={styles.factLabel}>Your role</Text>
          <Text style={styles.factValue}>{isChampionRole(item.role) ? 'Champion' : 'Member'}</Text>
        </View>
        <View style={styles.factCell}>
          <Text style={styles.factLabel}>Goals</Text>
          {/* A list not read is not a count: a dash, never 0. */}
          <Text
            style={styles.factValue}
            testID="wsf-community-index-goal-count"
            accessibilityLabel={goals ? undefined : 'Goals not known yet'}
          >
            {goals ? `${formatCount(goals.length)}${closed >= HISTORY_LIMIT ? '+' : ''}` : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

type PillKind = 'open' | 'reachedOpen' | 'closedReached' | 'closedUnfinished';

/**
 * The reference's status pill. Reached is only ever said from a confirmed
 * total; without one, an active goal is simply open.
 */
function pillKind(g: Goal): PillKind {
  const known = typeof g.sharedTotal === 'number' && g.target > 0;
  if (g.status === 'closed') {
    return known && isReached(g.sharedTotal!, g.target) ? 'closedReached' : 'closedUnfinished';
  }
  return known && isReached(g.sharedTotal!, g.target) ? 'reachedOpen' : 'open';
}

const PILL_TEXT: Record<PillKind, string> = {
  open: 'Open',
  reachedOpen: 'Reached · still open',
  closedReached: 'Closed · reached',
  closedUnfinished: 'Closed · unfinished',
};

function StatusPill({ goal }: { goal: Goal }) {
  const kind = pillKind(goal);
  return (
    <Text
      style={[
        styles.statusPill,
        kind === 'closedReached'
          ? styles.statusPillReached
          : kind === 'closedUnfinished'
            ? styles.statusPillQuiet
            : null,
      ]}
    >
      {PILL_TEXT[kind]}
    </Text>
  );
}

/** "Sep 1 – 30", in the goal's own zone; null when it cannot be said. */
function periodOf(g: Goal): string | null {
  return g.startsAt && g.endsAt ? formatPeriod(g.startsAt, g.endsAt, { timeZone: g.timezone ?? null }) : null;
}

/** "Sep 1 – 30 · 241 of 500 squats", or only what is known. */
function goalLine(g: Goal): string {
  const amount =
    typeof g.sharedTotal === 'number'
      ? totalOfTargetLabel(g.sharedTotal, g.target, g.unit)
      : `Target ${formatCount(g.target)} ${g.unit}`;
  const period = periodOf(g);
  return period ? `${period} · ${amount}` : amount;
}

function PeriodBlock({ item, onRefresh }: { item: Enriched; onRefresh: () => void }) {
  const open = activeGoals(item.goals);
  const lead = open[0];
  const also = open.slice(1);
  const known = lead && typeof lead.sharedTotal === 'number';
  const title =
    item.goals === 'pending'
      ? 'Reading this community’s goals…'
      : item.goals === 'failed'
        ? 'Goals could not be read just now'
        : lead
          ? lead.title
          : 'No active goal';

  return (
    <View style={styles.periodBlock} testID="wsf-community-index-period">
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingText}>
          <Text style={styles.eyebrow}>This period</Text>
          <Text
            style={styles.h2}
            testID={
              item.goals === 'pending'
                ? 'wsf-community-index-current-pending'
                : item.goals === 'failed'
                  ? 'wsf-community-index-current-unavailable'
                  : lead
                    ? 'wsf-community-index-period-title'
                    : 'wsf-community-index-current-nogoal'
            }
            {...({ role: 'heading', 'aria-level': 2 } as Record<string, unknown>)}
          >
            {title}
          </Text>
        </View>
        {lead ? <StatusPill goal={lead} /> : null}
      </View>

      {item.goals === 'failed' ? (
        /*
          THIS COMMUNITY'S READ FAILED, and only this one. Saying so where the
          progress would have been is the honest answer; a zero would be a lie.
        */
        <View style={styles.periodBody}>
          <Text style={styles.muted}>Nothing is shown as zero — this is the reading, not the record.</Text>
          <Pressable
            onPress={onRefresh}
            accessibilityRole="button"
            style={styles.inlineAction}
            testID="wsf-community-index-period-retry"
          >
            <Text style={styles.inlineActionText}>Try again</Text>
          </Pressable>
        </View>
      ) : item.goals === 'pending' ? null : !lead ? (
        <Text style={[styles.muted, styles.periodBody]}>
          No shared target is being counted.{' '}
          {isChampionRole(item.role)
            ? 'You can start the next goal from this community’s Home.'
            : 'Your Champion can start the next goal.'}
        </Text>
      ) : (
        <View style={styles.periodRow}>
          {/*
            The one Living WE on this screen -- only beside a real shared total.
            C-F9 (W7 Check 45; Director #489 `5841279872`): an unknown total
            drew the instrument as "0 of <target>". No confirmed total, or no
            positive target, means no instrument, no percentage and no
            remaining figure; the target is still stated as a target.
          */}
          {known && lead.target > 0 ? (
            <View style={styles.wePlate}>
              <LivingWeProgress
                completed={lead.sharedTotal!}
                target={lead.target}
                unit={lead.unit}
                width={88}
                surface="dark"
                testID="wsf-community-index-we"
              />
            </View>
          ) : null}
          <View style={styles.periodNumbers}>
            {known && lead.target > 0 ? (
              <>
                <View style={styles.goalNumber}>
                  <Text style={styles.goalNumberStrong}>
                    {totalOfTargetParts(lead.sharedTotal!, lead.target, lead.unit).count}
                  </Text>
                  <Text style={styles.goalNumberRest}>
                    {totalOfTargetParts(lead.sharedTotal!, lead.target, lead.unit).rest}
                  </Text>
                </View>
                <Track total={lead.sharedTotal!} target={lead.target} />
                <View style={styles.progressMeta}>
                  <Text style={styles.progressMetaStrong}>
                    {isReached(lead.sharedTotal!, lead.target)
                      ? 'Goal reached'
                      : `${percentLabel(lead.sharedTotal!, lead.target)} complete`}
                  </Text>
                  <Text style={styles.progressMetaRest}>
                    {statusLine(lead.sharedTotal!, lead.target, lead.status)}
                  </Text>
                </View>
              </>
            ) : known ? (
              <Text style={styles.unknownStrong}>
                {formatCount(lead.sharedTotal!)} {lead.unit}
              </Text>
            ) : (
              <View testID="wsf-community-index-period-unknown">
                <Text style={styles.unknownStrong}>Progress unknown</Text>
                <Text style={styles.muted}>
                  The current total could not be confirmed. Nothing is shown as zero.
                </Text>
                <Text style={styles.small}>
                  Target {formatCount(lead.target)} {lead.unit}
                </Text>
              </View>
            )}
            {periodOf(lead) ? <Text style={[styles.small, styles.periodLine]}>{periodOf(lead)}</Text> : null}
          </View>
        </View>
      )}

      {also.length > 0 ? (
        <View style={styles.alsoOpen} testID="wsf-community-index-also-open" accessibilityLabel="Also open">
          <Text style={styles.eyebrowQuiet}>Also open</Text>
          {also.map((g) => (
            <View key={g.goalId} style={styles.alsoRow}>
              <View style={styles.alsoText}>
                <Text style={styles.rowStrong} numberOfLines={1}>
                  {g.title}
                </Text>
                <Text style={styles.rowSpan}>{goalLine(g)}</Text>
              </View>
              <StatusPill goal={g} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function HistoryBlock({ item }: { item: Enriched }) {
  const goals = goalsOf(item);
  // Newest first, on the same rule as Community Home's history.
  const closed = goals
    ? goals
        .filter((g) => g.status === 'closed')
        .sort((a, b) =>
          (a.endsAt ?? '') === (b.endsAt ?? '')
            ? a.goalId.localeCompare(b.goalId)
            : (b.endsAt ?? '').localeCompare(a.endsAt ?? ''),
        )
    : null;
  return (
    <View style={styles.historyBlock} testID="wsf-community-index-history">
      <Text style={styles.eyebrow}>Goal history</Text>
      <Text style={styles.h2} {...({ role: 'heading', 'aria-level': 2 } as Record<string, unknown>)}>
        What we’ve done together
      </Text>
      {closed === null ? (
        <Text style={styles.muted}>
          {item.goals === 'failed' ? 'Past goals could not be read just now.' : 'Reading past goals…'}
        </Text>
      ) : closed.length === 0 ? (
        <Text style={styles.muted}>No past goals yet.</Text>
      ) : (
        <View style={styles.timeline}>
          {closed.map((g) => {
            const reached = pillKind(g) === 'closedReached';
            return (
              <View key={g.goalId} style={styles.timelineItem} testID={`wsf-community-index-history-${g.goalId}`}>
                <View style={[styles.dot, reached ? null : styles.dotQuiet]} />
                <View style={styles.alsoText}>
                  <Text style={styles.rowStrong}>{g.title}</Text>
                  <Text style={styles.rowSpan}>{goalLine(g)}</Text>
                </View>
                <StatusPill goal={g} />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** How many named members the Community tab draws before "See everyone". */
const ROSTER_PREVIEW = 8;

function RosterBlock({
  item,
  roster,
}: {
  item: Enriched;
  roster: Exclude<Roster, 'pending'> | 'pending';
}) {
  const count = item.memberCount;
  const ready = roster !== 'pending' && !('failed' in roster) ? roster : null;
  const shown = ready ? ready.people.slice(0, ROSTER_PREVIEW) : [];
  // Only a complete list can say how many chose not to be named.
  const anonymous = ready && ready.complete ? Math.max(0, count - ready.people.length) : 0;
  return (
    <View style={styles.rosterBlock} testID="wsf-community-index-roster">
      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingText}>
          <Text style={styles.eyebrow}>Members</Text>
          <Text style={styles.h2} {...({ role: 'heading', 'aria-level': 2 } as Record<string, unknown>)}>
            {count === 1 ? '1 person' : `${formatCount(count)} people`}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/community/${item.groupId}/members` as never)}
          accessibilityRole="link"
          accessibilityLabel={`See everyone in ${item.displayName}`}
          style={styles.inlineAction}
          testID="wsf-community-index-roster-all"
        >
          <Text style={styles.inlineActionText}>See everyone ›</Text>
        </Pressable>
      </View>

      {roster === 'pending' ? (
        <Text style={styles.muted}>Reading who is here…</Text>
      ) : 'failed' in roster ? (
        <Text style={styles.muted}>The member list could not be read just now.</Text>
      ) : (
        <View style={styles.rosterList}>
          {shown.map((p, i) => (
            <View key={`${p.displayName}-${i}`} style={styles.rosterRow}>
              <InitialsAvatar displayName={p.displayName} role={p.role} size={36} />
              <Text style={styles.rosterName} numberOfLines={1}>
                {p.displayName}
              </Text>
              {isChampionRole(p.role) ? <Text style={styles.rosterRole}>Champion</Text> : <View />}
            </View>
          ))}
          {ready && ready.people.length > shown.length ? (
            <View style={styles.rosterRow}>
              <View style={[styles.anonAvatar, styles.moreAvatar]}>
                <Text style={styles.moreAvatarText}>+{formatCount(ready.people.length - shown.length)}</Text>
              </View>
              <Text style={styles.rosterName}>more named in See everyone</Text>
              <View />
            </View>
          ) : null}
          {anonymous > 0 ? (
            <View style={styles.rosterRow} testID="wsf-community-index-roster-anonymous">
              {/* The reference's anonymous disc: a person, not an empty circle. */}
              <View style={styles.anonAvatar} aria-hidden>
                <View style={styles.anonHead} />
                <View style={styles.anonBody} />
              </View>
              <Text style={styles.rosterName}>
                {anonymous === 1 ? '1 member shown without a name' : `${formatCount(anonymous)} members shown without names`}
              </Text>
              <View />
            </View>
          ) : null}
        </View>
      )}
      <Text style={styles.small}>Names follow each member’s privacy choice for this community.</Text>
    </View>
  );
}

/** Amount, unit, coarse time. Never who. */
function Momentum({ rows }: { rows: Addition[] }) {
  return (
    <View style={styles.momentum} testID="wsf-community-index-momentum">
      <Text style={styles.eyebrow}>Recent movement</Text>
      <View style={styles.momentumRows}>
        {rows.map((r, i) => {
          const since = formatSinceShort(r.at);
          return (
            <View key={`${r.at}-${i}`} style={styles.chip}>
              <Text style={styles.chipAmount}>+{formatCount(r.amount)}</Text>
              <Text style={styles.chipUnit}>{r.unit}</Text>
              {since ? <Text style={styles.chipAgo}>{since}</Text> : null}
            </View>
          );
        })}
      </View>
      <Text style={styles.momentumNote}>What was added, and when. Never who.</Text>
    </View>
  );
}

function OtherRow({
  item,
  cue,
  onPress,
}: {
  item: Enriched;
  cue: string;
  onPress: () => void;
}) {
  const open = activeGoals(item.goals);
  const lead = open[0];
  const failed = item.goals === 'failed';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${cue} to ${item.displayName} and open its Home`}
      style={styles.otherRow}
      testID={`wsf-community-index-row-${item.groupId}`}
    >
      <View style={styles.otherHead}>
        <View style={styles.otherText}>
          <Text style={styles.otherName} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={styles.otherMeta}>
            {memberCountLabel(item.memberCount)} ·{' '}
            {failed
              ? 'Progress unavailable'
              : item.goals === 'pending'
                ? 'Reading progress…'
                : lead
                  ? lead.title
                  : 'No goal running'}
          </Text>
          {lead && typeof lead.sharedTotal === 'number' ? (
            <Text style={styles.otherTotal}>
              {totalOfTargetLabel(lead.sharedTotal, lead.target, lead.unit)} ·{' '}
              {percentLabel(lead.sharedTotal, lead.target)}
            </Text>
          ) : null}
        </View>
        {/* The cue says what tapping does. Semantics alone are invisible. */}
        <View style={styles.cue}>
          <Text style={styles.cueText}>{cue}</Text>
        </View>
      </View>
      {lead && typeof lead.sharedTotal === 'number' ? (
        <Track total={lead.sharedTotal} target={lead.target} />
      ) : null}
    </Pressable>
  );
}

function Track({ total, target, dark }: { total: number; target: number; dark?: boolean }) {
  return (
    <View style={[styles.track, dark ? styles.trackDark : null]}>
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
  page: { paddingHorizontal: 18, paddingTop: 10 },
  column: { gap: 14 },
  pageTitle: { color: NAVY, marginTop: -2 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  stateWrap: { gap: 14 },

  eyebrow: { color: '#2F7D4F', fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase' },

  /* ── the reference's Community (Lovable `d4f60624`, styles.css) ── */
  banner: {
    position: 'relative',
    overflow: 'hidden',
    marginHorizontal: -18,
    marginTop: -10,
    paddingHorizontal: 18,
    paddingTop: 26,
    paddingBottom: 20,
    backgroundColor: NAVY,
  },
  /* .community-banner::after, as a quarter ring kept inside the banner so
     nothing is laid out past the screen's right edge. */
  bannerRing: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 170,
    height: 170,
    borderBottomLeftRadius: 170,
    borderLeftWidth: 40,
    borderBottomWidth: 40,
    borderColor: 'rgba(145,203,125,0.14)',
  },
  bannerEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  bannerName: { color: '#FFFFFF', fontSize: 31, lineHeight: 33, fontWeight: '800', marginTop: 4, marginBottom: 2 },
  bannerLine: { color: '#C9D6E3', fontSize: 14, lineHeight: 19 },
  bannerFacts: { flexDirection: 'row', gap: 8, marginTop: 18 },
  factCell: { flex: 1, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  factLabel: { color: '#AFC0D2', fontSize: 10, lineHeight: 13, letterSpacing: 1, textTransform: 'uppercase' },
  factValue: { color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 2 },

  switcher: { marginTop: 18 },

  sectionHeading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  sectionHeadingText: { flex: 1, minWidth: 0 },
  h2: { color: NAVY, fontSize: 21, lineHeight: 26, fontWeight: '800', marginTop: 2 },
  muted: { color: TEXT_MUTED, fontSize: 14, lineHeight: 20 },
  small: { color: TEXT_MUTED, fontSize: 12, lineHeight: 17 },

  periodBlock: { paddingTop: 26 },
  periodBody: { marginTop: 12, gap: 4 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 },
  wePlate: {
    width: 108,
    height: 92,
    borderRadius: 16,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodNumbers: { flex: 1, minWidth: 0 },
  goalNumber: { flexDirection: 'row', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' },
  goalNumberStrong: { color: NAVY, fontSize: 28, lineHeight: 30, fontWeight: '800' },
  goalNumberRest: { color: TEXT_MUTED, fontSize: 13, fontWeight: '700' },
  progressMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 14, rowGap: 2, marginTop: 5 },
  progressMetaStrong: { color: '#2B6E37', fontSize: 11, fontWeight: '800' },
  progressMetaRest: { color: TEXT_MUTED, fontSize: 11 },
  periodLine: { marginTop: 6 },
  unknownStrong: { color: NAVY, fontSize: 18, lineHeight: 24, fontWeight: '800' },

  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DCEFD6',
    color: '#24562B',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  statusPillReached: { backgroundColor: NAVY, color: PROGRESS_GREEN },
  statusPillQuiet: { backgroundColor: '#EFEDE6', color: TEXT_MUTED },

  alsoOpen: { marginTop: 12 },
  eyebrowQuiet: {
    color: TEXT_MUTED,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  alsoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  alsoText: { flex: 1, minWidth: 0 },
  rowStrong: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  rowSpan: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16, marginTop: 2 },

  historyBlock: { paddingTop: 48 },
  timeline: { marginTop: 12, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: HAIRLINE },
  timelineItem: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 14,
    paddingLeft: 8,
  },
  dot: {
    position: 'absolute',
    left: -22,
    top: 15,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: PROGRESS_GREEN,
    borderWidth: 2,
    borderColor: CREAM,
  },
  dotQuiet: { backgroundColor: '#D7DFE7' },

  rosterBlock: { paddingTop: 48 },
  rosterList: { marginTop: 12, marginBottom: 10 },
  rosterRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  rosterName: { flex: 1, minWidth: 0, color: NAVY, fontSize: 14, fontWeight: '700' },
  rosterRole: {
    color: '#2F7D4F',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  anonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFEDE6',
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  anonHead: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#B9B4A9', marginBottom: 2 },
  anonBody: { width: 22, height: 9, borderTopLeftRadius: 11, borderTopRightRadius: 11, backgroundColor: '#B9B4A9' },
  moreAvatar: { backgroundColor: PROGRESS_GREEN, alignItems: 'center', justifyContent: 'center' },
  moreAvatarText: { color: NAVY, fontSize: 11, fontWeight: '800' },

  inlineAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  inlineActionText: { color: '#2F7D4F', fontSize: 12, fontWeight: '800' },

  afterCore: { marginTop: 32 },

  choosePanel: { gap: 4 },
  chooseTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '900' },
  chooseBody: { color: TEXT_MUTED, fontSize: 13.5, lineHeight: 19 },

  others: { gap: 8 },
  otherRow: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 9,
  },
  otherHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  otherText: { flex: 1, gap: 2 },
  otherName: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  otherMeta: { color: TEXT_MUTED, fontSize: 12, lineHeight: 16 },
  otherTotal: { color: INK_QUIET, fontSize: 12, lineHeight: 16 },
  cue: {
    borderWidth: 1,
    borderColor: '#C9C5BC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cueText: { color: INK_QUIET, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },

  momentum: { gap: 7, marginTop: 32 },
  momentumRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipAmount: { color: '#2B6E37', fontSize: 13, fontWeight: '900' },
  chipUnit: { color: NAVY, fontSize: 11, fontWeight: '700' },
  chipAgo: { color: TEXT_MUTED, fontSize: 11 },
  momentumNote: { color: TEXT_MUTED, fontSize: 11, lineHeight: 15 },

  emptyPanel: { backgroundColor: NAVY, borderRadius: 22, padding: 20, gap: 10, ...elevation.card },
  emptyTitle: { color: ON_NAVY },
  emptyBody: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },
  emptyRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 6 },
  emptyOr: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },

  facts: { gap: 11 },
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
    gap: 7,
  },
  bone: { backgroundColor: '#E3E0D8', borderRadius: 6 },
  boneRow: { flexDirection: 'row', gap: 8 },
  boneRule: { height: 1, backgroundColor: '#E3E0D8', marginVertical: 2 },
  boneGoal: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  boneGoalText: { flex: 1, gap: 6 },

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
  chipsBlock: { gap: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  /* The reference's .switch-chip: 44 px tall, 22 px round, 1.5 px rule. */
  switchChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#D7DFE7',
    backgroundColor: '#FFFFFF',
    maxWidth: '100%',
  },
  switchChipOn: { borderColor: NAVY, backgroundColor: NAVY },
  switchChipText: { color: NAVY, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  switchChipTextOn: { color: '#FFFFFF' },
  /* .switch-chip.ghost: a dashed rule and the action green's text. */
  switchChipGhost: { borderStyle: 'dashed', borderColor: '#C9D3DD' },
  switchChipTextGhost: { color: '#2F7D4F' },
  switchChipIcon: { color: '#2F7D4F', fontSize: 15, lineHeight: 17, fontWeight: '800', marginRight: 6 },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
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
});
