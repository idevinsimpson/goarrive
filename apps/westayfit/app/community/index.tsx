import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import { rememberCurrentCommunity, resolveCurrentCommunity } from '../../src/currentCommunity';
import { getFirebaseFunctions } from '../../src/firebase';
import { memberCountLabel, roleCardLabel } from '../../src/labels';
import { formatSinceShort } from '../../src/ui/dates';
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
} from '../../src/ui/kit';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../src/ui/MemberTabBar';
import { fillRatio, formatCount, percentLabel, totalOfTargetLabel } from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

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
 * PRESENCE WITHOUT IDENTITIES. The recent-movement strip is amounts, units and
 * coarse times. `wsfGoalRecentAdditions` rebuilds every row from `amount` and
 * `at` alone, so a uid or a name cannot ride out of it even from a hand-edited
 * document — and it is readable on the MEMBER route, for every community a
 * member is active in, not only display-authorized ones. There are no photos,
 * no names of who moved, no reactions and no count of who is here, because
 * none of that exists: `memberCount` is a roll, not a presence.
 *
 * ONE BAD READ MUST NOT EMPTY THE SCREEN. Goals are enriched per community,
 * bounded and in parallel, and each community's failure is its own. A member
 * whose third community will not load still sees the first two and still has
 * their way back into the one they were in.
 *
 * THERE IS NO JOIN CONTROL, and that is deliberate. `/join/[joinCode]` takes
 * the code from the route; nothing in the product accepts a typed one. A
 * "Join" button here would go nowhere, so joining is explained where it is
 * true — in words, in the empty state — and manual join-code entry is a
 * recorded product seam rather than a drawn button.
 */

/** At most this many community goal reads are in flight at once. */
const GOAL_READ_LIMIT = 4;
/** Recent movement is read for at most this many of the current community's goals. */
const MOMENTUM_GOAL_LIMIT = 3;
/** And at most this many entries are shown, newest first. */
const MOMENTUM_ROWS = 4;
/**
 * How many names the current community's panel previews.
 *
 * A PREVIEW, NOT A ROSTER — the panel is about the community, and the full
 * list is one tap away. Three keeps the section the same visual weight as the
 * two beneath it rather than turning the card into a directory.
 */
const MEMBER_PREVIEW_ROWS = 3;

type Membership = {
  groupId: string;
  displayName: string;
  memberCount: number;
  role: string;
  /*
    THE CALLER'S OWN answer in this community, never anybody else's — the
    callable's query is `userId == caller`, so no other person's choice is in
    scope here. It is carried so a member can be TOLD whether they are named
    without having to go looking for a setting; a privacy control somebody has
    to find is one they assume is off.
  */
  visibility?: 'private' | 'visible';
};

/** One listed member. Mirrors `wsfCommunityMembers` exactly — two fields. */
type MemberEntry = { displayName: string; role: 'foundingChampion' | 'member' };

type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  sharedTotal?: number;
};

type Addition = { amount: number; unit: string; at: string };

/** A membership plus whatever could be read about it. `failed` is its own. */
type Enriched = Membership & {
  goals: Goal[] | 'failed';
  /*
    The visible members of the CURRENT community only — the other rows do not
    preview names, so nothing is read for them. 'loading' is its own state so
    the panel shows its shape while the names arrive rather than flashing
    "No one is shown here yet." at a community that has plenty.
  */
  members: MemberEntry[] | 'loading';
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: Enriched[]; currentId: string | null; momentum: Addition[] };

function activeGoals(goals: Goal[] | 'failed'): Goal[] {
  return goals === 'failed' ? [] : goals.filter((g) => g.status === 'active');
}

export default function CommunityIndexScreen() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
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

  useEffect(() => {
    if (!ready || !user) return;
    const token = ++liveRef.current;
    const uid = user.uid;
    setState({ kind: 'loading' });

    (async () => {
      const fns = getFirebaseFunctions();
      let items: Membership[];
      try {
        const result = await httpsCallable<Record<string, never>, { items: Membership[] }>(
          fns,
          'wsfMyCommunities',
        )({});
        items = Array.isArray(result.data?.items) ? result.data.items : [];
      } catch {
        if (liveRef.current === token) setState({ kind: 'error' });
        return;
      }

      if (items.length === 0) {
        if (liveRef.current === token) {
          setState({ kind: 'ready', items: [], currentId: null, momentum: [] });
        }
        return;
      }

      // Bounded and parallel. Serially this is an N+1 chain whose latency
      // grows with membership count; unbounded it is a burst of callables.
      const listGoals = httpsCallable<
        { groupId: string; includeHistory: boolean },
        { goals: Goal[] }
      >(fns, 'wsfListGoals');
      const settled = await mapWithLimit(items, GOAL_READ_LIMIT, async (m) => {
        const r = await listGoals({ groupId: m.groupId, includeHistory: true });
        return Array.isArray(r.data?.goals) ? r.data.goals : [];
      });

      const enriched: Enriched[] = items.map((m, i) => {
        const s = settled[i];
        return { ...m, goals: s && s.ok ? s.value : 'failed', members: 'loading' as const };
      });

      // `memberOf` is the authority, and the resolver — not this screen —
      // decides. Several memberships with nothing remembered is NULL.
      const currentId = resolveCurrentCommunity(
        uid,
        items.map((m) => m.groupId),
      );

      let momentum: Addition[] = [];
      const current = currentId ? enriched.find((e) => e.groupId === currentId) : undefined;
      const open = current ? activeGoals(current.goals).slice(0, MOMENTUM_GOAL_LIMIT) : [];
      if (open.length > 0) {
        const recent = httpsCallable<{ goalId: string }, { additions: Addition[] }>(
          fns,
          'wsfGoalRecentAdditions',
        );
        const reads = await mapWithLimit(open, MOMENTUM_GOAL_LIMIT, async (g) => {
          const r = await recent({ goalId: g.goalId });
          return Array.isArray(r.data?.additions) ? r.data.additions : [];
        });
        momentum = reads
          .flatMap((r) => (r.ok ? r.value : []))
          .filter((a) => typeof a.amount === 'number' && typeof a.at === 'string')
          // Merged on the real instant, never on the order the reads returned:
          // two goals' tails interleave in time and stitching them end to end
          // would present a false sequence.
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, MOMENTUM_ROWS);
      }

      /*
        THE CURRENT COMMUNITY'S NAMES, and only that one. A member sees the
        people they stand beside in the community they are actually in; reading
        names for every membership would be several more calls for a panel that
        is not on screen.

        A failure here is not a failure of the screen: the panel falls back to
        its empty line, which is already the honest sentence for "no names to
        show". Nothing about the community's identity or its goal depends on
        this read landing.
      */
      let members: MemberEntry[] = [];
      if (currentId) {
        try {
          const listed = await httpsCallable<{ groupId: string }, { members: MemberEntry[] }>(
            fns,
            'wsfCommunityMembers',
          )({ groupId: currentId });
          members = Array.isArray(listed.data?.members) ? listed.data.members : [];
        } catch {
          members = [];
        }
      }

      if (liveRef.current === token) {
        setState({
          kind: 'ready',
          items: enriched.map((e) => (e.groupId === currentId ? { ...e, members } : e)),
          currentId,
          momentum,
        });
      }
    })();

    return () => {
      liveRef.current += 1;
    };
  }, [ready, user, attempt]);

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
      <Pressable
        onPress={() => router.replace('/')}
        accessibilityRole="link"
        accessibilityLabel="We Stay Fit, go Home"
        style={styles.wordmarkTap}
        testID="wsf-community-index-wordmark-home"
      >
        <WsfWordmark variant="navy" height={22} testID="wsf-community-index-wordmark" />
      </Pressable>
      <Text style={[display.md, styles.pageTitle]} testID="wsf-community-index-title">
        Community
      </Text>

      {!ready || !user ? (
        <Text style={styles.note} testID="wsf-community-index-signed-out">
          Sign in to see your communities.
        </Text>
      ) : state.kind === 'loading' ? (
        <LoadingBody />
      ) : state.kind === 'error' ? (
        <FailureBody onRetry={() => setAttempt((n) => n + 1)} />
      ) : state.items.length === 0 ? (
        <EmptyBody />
      ) : (
        <ReadyBody state={state} onOpen={open} />
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

/* ── ready ───────────────────────────────────────────────────────────────── */

function ReadyBody({
  state,
  onOpen,
}: {
  state: Extract<State, { kind: 'ready' }>;
  onOpen: (groupId: string) => void;
}) {
  const current = state.currentId
    ? state.items.find((i) => i.groupId === state.currentId)
    : undefined;
  const others = state.items.filter((i) => i.groupId !== current?.groupId);

  return (
    <View style={styles.stateWrap} testID="wsf-community-index-rows">
      {current ? (
        <CurrentPanel item={current} momentum={state.momentum} />
      ) : (
        /*
          SEVERAL MEMBERSHIPS AND NONE CHOSEN. `resolveCurrentCommunity()`
          returned null, so the screen asks instead of picking. Every row is an
          equal choice and says so.
        */
        <View style={styles.choosePanel} testID="wsf-community-index-choose">
          <Text style={styles.chooseTitle}>Choose which community Home opens</Text>
          <Text style={styles.chooseBody}>
            You are in {state.items.length} communities and have not opened one yet. Pick one — you
            can switch whenever you like.
          </Text>
        </View>
      )}

      {others.length > 0 ? (
        <View style={styles.others}>
          {current ? <Text style={styles.eyebrow}>ALSO YOURS</Text> : null}
          {others.map((item) => (
            <OtherRow
              key={item.groupId}
              item={item}
              cue={current ? 'Switch' : 'Choose'}
              onPress={() => onOpen(item.groupId)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pill
          label="Start a community"
          testID="wsf-community-index-start"
          onPress={() => router.replace('/start-community')}
        />
      </View>
    </View>
  );
}

function CurrentPanel({ item, momentum }: { item: Enriched; momentum: Addition[] }) {
  const open = activeGoals(item.goals);
  const lead = open[0];
  const role = roleCardLabel(item.role);

  return (
    <View style={styles.currentPanel} testID="wsf-community-index-current">
      <View style={styles.currentTop}>
        <Text style={styles.currentPill}>CURRENT</Text>
        {role ? <Text style={styles.rolePill}>{role}</Text> : null}
      </View>
      <Text style={[display.lg, styles.currentName]} numberOfLines={2}>
        {item.displayName}
      </Text>
      <Text style={styles.currentMeta} testID="wsf-community-index-member-count">
        {memberCountLabel(item.memberCount)}
      </Text>

      <View style={styles.currentRule} />

      {/*
        MEMBERS IS A COMMUNITY FEATURE, so it is a section of this panel in the
        panel's own rhythm — a green eyebrow, then content — exactly like WHAT
        WE'RE DOING and RECENT MOVEMENT below it.

        An earlier version put a privacy STATUS here instead: a pill reading
        "Who is here · Your name is not shown", wedged between the community's
        name and its first section. It made a line about ME the second thing
        read inside a panel that is entirely about US. The member's own setting
        lives on the Members page as one quiet row and is not narrated here.

        NO COUNT OF THIS PREVIEW. `memberCount` is printed above over every
        active member; a second number here would make "how many are hiding" a
        subtraction the product performs for the reader.
      */}
      <Pressable
        onPress={() => router.push(`/community/${item.groupId}/members`)}
        accessibilityRole="link"
        accessibilityLabel={`Members of ${item.displayName}`}
        style={styles.membersHead}
        testID="wsf-community-index-members"
      >
        <Text style={styles.eyebrowDark}>MEMBERS</Text>
        <Text style={styles.membersChevron}>›</Text>
      </Pressable>
      {item.members === 'loading' ? (
        <View style={styles.membersBoneRow}>
          {[0, 1].map((i) => (
            <View key={i} style={styles.membersBone} />
          ))}
        </View>
      ) : item.members.length > 0 ? (
        <View style={styles.membersPreview}>
          {item.members.slice(0, MEMBER_PREVIEW_ROWS).map((m, i) => (
            <Text key={i} style={styles.memberLine} numberOfLines={1}>
              {m.displayName}
              {m.role === 'foundingChampion' ? (
                <Text style={styles.memberRole}> · Champion</Text>
              ) : null}
            </Text>
          ))}
        </View>
      ) : (
        /*
          NOT "nobody is here". The count above says how many members there
          are; this preview is empty because none of them has chosen to be
          shown, which is a different fact and the only one this may state.
        */
        <Text style={styles.membersNone}>No one is shown here yet.</Text>
      )}

      <View style={styles.currentRule} />

      <Text style={styles.eyebrowDark}>WHAT WE&apos;RE DOING</Text>
      {item.goals === 'failed' ? (
        /*
          THIS COMMUNITY'S READ FAILED, and only this one. Saying so where the
          progress would have been is the honest answer; blanking the screen or
          showing a zero would both be worse, and a zero would be a lie.
        */
        <Text style={styles.currentUnavailable} testID="wsf-community-index-current-unavailable">
          Progress could not be loaded just now.
        </Text>
      ) : !lead ? (
        <Text style={styles.currentUnavailable} testID="wsf-community-index-current-nogoal">
          No goal running yet.
        </Text>
      ) : (
        <View style={styles.currentGoalRow}>
          {/* The one Living WE on this screen, beside a real shared total. */}
          <LivingWeProgress
            completed={lead.sharedTotal ?? 0}
            target={lead.target}
            unit={lead.unit}
            width={74}
            surface="dark"
            testID="wsf-community-index-we"
          />
          <View style={styles.currentGoalText}>
            <Text style={styles.currentGoalTitle} numberOfLines={1}>
              {lead.title}
            </Text>
            <Text style={styles.currentGoalTotal}>
              {typeof lead.sharedTotal === 'number'
                ? totalOfTargetLabel(lead.sharedTotal, lead.target, lead.unit)
                : `Target ${formatCount(lead.target)} ${lead.unit}`}
            </Text>
            {typeof lead.sharedTotal === 'number' ? (
              <>
                <Track total={lead.sharedTotal} target={lead.target} dark />
                <Text style={styles.currentGoalPct}>
                  {percentLabel(lead.sharedTotal, lead.target)}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      )}

      {open.length > 1 ? (
        <View style={styles.currentSecond}>
          <Text style={styles.currentSecondTitle} numberOfLines={1}>
            {open[1]!.title}
          </Text>
          {typeof open[1]!.sharedTotal === 'number' ? (
            <Text style={styles.currentSecondPct}>
              {percentLabel(open[1]!.sharedTotal!, open[1]!.target)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {momentum.length > 0 ? <Momentum rows={momentum} /> : null}
    </View>
  );
}

/** Amount, unit, coarse time. Never who. */
function Momentum({ rows }: { rows: Addition[] }) {
  return (
    <View style={styles.momentum} testID="wsf-community-index-momentum">
      <Text style={styles.eyebrowDark}>RECENT MOVEMENT</Text>
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
            {failed ? 'Progress unavailable' : lead ? lead.title : 'No goal running'}
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
  wordmarkTap: { minHeight: 44, justifyContent: 'center' },
  pageTitle: { color: NAVY, marginTop: -2 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  stateWrap: { gap: 14 },

  eyebrow: { color: '#2F7D4F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  eyebrowDark: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  currentPanel: { backgroundColor: NAVY, borderRadius: 22, padding: 18, gap: 8, ...elevation.card },
  currentTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currentPill: {
    color: '#04260F',
    backgroundColor: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  rolePill: {
    color: ON_NAVY_MUTED,
    borderColor: ON_NAVY_RULE,
    borderWidth: 1,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  currentName: { color: ON_NAVY },
  currentMeta: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  currentRule: { height: 1, backgroundColor: ON_NAVY_RULE, marginVertical: 4 },
  /*
    The section head sits in the panel's existing rhythm: the same green
    eyebrow as WHAT WE'RE DOING, with a chevron to say it opens somewhere. No
    pill, no border, no weight of its own — the goal below is what this panel
    is for.
  */
  membersHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  membersChevron: { color: ON_NAVY_MUTED, fontSize: 20, lineHeight: 22 },
  membersPreview: { gap: 3, marginTop: 4 },
  memberLine: { color: ON_NAVY, fontSize: 15, lineHeight: 21 },
  memberRole: { color: ON_NAVY_MUTED, fontSize: 13 },
  membersNone: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20, marginTop: 4 },
  membersBoneRow: { gap: 6, marginTop: 6 },
  membersBone: { height: 14, width: '52%', borderRadius: 4, backgroundColor: 'rgba(247,245,240,0.14)' },
  currentUnavailable: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20 },
  currentGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  currentGoalText: { flex: 1, gap: 3 },
  currentGoalTitle: { color: ON_NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  currentGoalTotal: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  currentGoalPct: { color: PROGRESS_GREEN, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  currentSecond: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: ON_NAVY_RULE,
    paddingTop: 8,
    gap: 10,
  },
  currentSecondTitle: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18, flex: 1 },
  currentSecondPct: { color: PROGRESS_GREEN, fontSize: 12, fontWeight: '800' },

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

  momentum: { gap: 7, paddingTop: 4 },
  momentumRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipAmount: { color: PROGRESS_GREEN, fontSize: 13, fontWeight: '900' },
  chipUnit: { color: ON_NAVY, fontSize: 11, fontWeight: '700' },
  chipAgo: { color: ON_NAVY_MUTED, fontSize: 11 },
  momentumNote: { color: ON_NAVY_MUTED, fontSize: 11, lineHeight: 15 },

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
