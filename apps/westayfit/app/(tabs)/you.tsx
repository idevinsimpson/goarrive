import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { mapWithLimit } from '../../src/concurrency';
import { resolveCurrentCommunity } from '../../src/currentCommunity';
import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from '../../src/firebase';
import { memberCountLabel, roleCardLabel } from '../../src/labels';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { WsfWordmark } from '../../src/ui/WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CARD_BORDER,
  CREAM,
  ERROR_RED,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  SURFACE,
  display,
  elevation,
} from '../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../src/ui/MemberTabBar';

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

type Community = {
  groupId: string;
  displayName: string;
  role: string;
  memberCount: number;
};

type Goal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt?: string;
  sharedTotal?: number;
};

/** A goal this member has a recorded part in, with both figures kept apart. */
type Row = {
  goalId: string;
  title: string;
  unit: string;
  target: number;
  /** Exactly what this member put in. Never summed with another unit. */
  yourPart: number;
  /** Where the community stands. A different number, and labelled as one. */
  sharedTotal: number;
  open: boolean;
  endsAt?: string;
};

type Profile = { displayName: string | null; memberSince: string | null };

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
      open: Row[];
      finished: Row[];
      /** True when a read failed and this list is not the whole truth. */
      partial: boolean;
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

function n(v: number): string {
  return v.toLocaleString('en-US');
}

export default function You() {
  const { ready, user } = useWsfAuth();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const [reloads, setReloads] = useState(0);
  /** Guards a landed read against a newer one, and against an unmounted tree. */
  const live = useRef(0);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      setScreen({ kind: 'signedOut' });
      return;
    }
    const token = ++live.current;
    setScreen({ kind: 'loading' });

    void (async () => {
      // THE PROFILE FIRST, AND ON ITS OWN. It is the member's own document and
      // the only thing on this page that does not need a callable — so an
      // identity is on screen even when every goal read fails.
      let profile: Profile = { displayName: null, memberSince: null };
      try {
        const snap = await getDoc(doc(getFirebaseFirestore(), 'wsfMemberProfiles', user.uid));
        const data = snap.data() as { displayName?: unknown; createdAt?: unknown } | undefined;
        profile = {
          displayName: typeof data?.displayName === 'string' ? data.displayName : null,
          memberSince: monthAndYear(data?.createdAt),
        };
      } catch {
        // An unreadable profile is not a failure of the page: the account is
        // still signed in and still has a way out.
      }
      if (live.current !== token) return;

      const fns = getFirebaseFunctions();
      let communities: Community[] = [];
      try {
        const listMine = httpsCallable<Record<string, never>, { items: Community[] }>(
          fns,
          'wsfMyCommunities',
        );
        const r = await listMine({});
        communities = Array.isArray(r.data?.items) ? r.data.items : [];
      } catch {
        if (live.current !== token) return;
        setScreen({ kind: 'failed', profile });
        return;
      }
      if (live.current !== token) return;

      if (communities.length === 0) {
        setScreen({ kind: 'noCommunity', profile });
        return;
      }

      // NEVER SILENTLY THE FIRST. `resolveCurrentCommunity` returns null when
      // there are several and none is remembered; this page then has no single
      // community to speak for and says so rather than choosing one.
      const currentId = resolveCurrentCommunity(
        user.uid,
        communities.map((c) => c.groupId),
      );
      const community = communities.find((c) => c.groupId === currentId) ?? null;
      if (!community) {
        setScreen({ kind: 'pickCommunity', profile, count: communities.length });
        return;
      }

      let partial = false;

      // Bounded and parallel, with each failure isolated — the pattern Progress
      // was accepted on. One goal that will not load must not empty the page.
      const listGoals = httpsCallable<
        { groupId: string; includeHistory: boolean },
        { goals: Goal[] }
      >(fns, 'wsfListGoals');
      let goals: Goal[] = [];
      try {
        const r = await listGoals({ groupId: community.groupId, includeHistory: true });
        goals = Array.isArray(r.data?.goals) ? r.data.goals : [];
      } catch {
        if (live.current !== token) return;
        setScreen({ kind: 'failed', profile });
        return;
      }
      if (live.current !== token) return;

      const myContribution = httpsCallable<{ goalId: string }, { ownCredit: number; unit: string }>(
        fns,
        'wsfMyContribution',
      );
      const owned = await mapWithLimit(goals, READ_LIMIT, async (goal) => {
        const own = await myContribution({ goalId: goal.goalId });
        return { goal, own: own.data };
      });
      if (live.current !== token) return;

      const open: Row[] = [];
      const finished: Row[] = [];
      for (const settled of owned) {
        if (!settled.ok) {
          partial = true;
          continue;
        }
        const { goal, own } = settled.value;
        const yourPart = typeof own?.ownCredit === 'number' ? own.ownCredit : 0;
        // ONLY GOALS THIS MEMBER ACTUALLY PUT SOMETHING INTO. A goal they never
        // touched is the community's business, not a row on their own page.
        if (yourPart <= 0) continue;
        const row: Row = {
          goalId: goal.goalId,
          title: goal.title,
          unit: own?.unit || goal.unit,
          target: goal.target,
          yourPart,
          sharedTotal: typeof goal.sharedTotal === 'number' ? goal.sharedTotal : 0,
          open: goal.status === 'active',
          endsAt: goal.endsAt,
        };
        (row.open ? open : finished).push(row);
      }

      // Soonest to end leads: it is the one with something still to do in it.
      open.sort((a, b) => (a.endsAt ?? '').localeCompare(b.endsAt ?? ''));
      finished.sort((a, b) => (b.endsAt ?? '').localeCompare(a.endsAt ?? ''));

      setScreen({ kind: 'member', profile, community, open, finished, partial });
    })();
  }, [ready, user, reloads]);

  const onSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut(getFirebaseAuth())
      .then(() => router.replace('/'))
      .finally(() => setSigningOut(false));
  }, []);

  /*
    `wsf-you-identity` IS THE RESOLVED STATE for somebody signed in, and the
    shell test polls for it by name to know this screen is no longer loading.
    The rebuild moved the field's contents around and dropped the handle, so
    that poll had nothing to find and the test sat through its whole timeout —
    reported as "you at 360 never left its loading state", which read like a
    narrow-width bug and was neither narrow nor a loading bug.
  */
  const identity = (profile: Profile, email: string | null) => (
    <View style={s.field} testID="wsf-you-identity">
      <View style={s.fieldTop}>
        {/* THE WORDMARK GOES HOME, on this destination as on every other.
            The rebuild left it as a bare image, so the one gesture that
            gets a member out of a tab did nothing here. */}
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          testID="wsf-you-wordmark-home"
        >
          <WsfWordmark variant="white" height={17} testID="wsf-you-wordmark" />
        </Pressable>
        <Text style={s.pageTag} testID="wsf-you-title">You</Text>
      </View>
      <Text style={[display.lg, s.name]} testID="wsf-you-name" accessibilityRole="header">
        {profile.displayName ?? 'You'}
      </Text>
      {profile.memberSince ? (
        <Text style={s.since} testID="wsf-you-since">{`Member since ${profile.memberSince}`}</Text>
      ) : null}
      {/*
        SETTINGS — AN ORDINARY ROW INSIDE THE PAGE, NOT A HEADER GEAR.
        The social lane's proposal drew a gear in the top-right chrome; that was
        refused because W9 owns the persistent header and hamburger, and a
        second utility affordance in that corner would either fight W9's or
        become dead. A working row here is real on arrival and can be exposed
        from the hamburger later with nothing left to wire up.
      */}
      <Pressable
        onPress={() => router.push('/settings')}
        style={s.settingsRow}
        testID="wsf-you-settings"
        accessibilityRole="link"
        accessibilityLabel="Settings"
      >
        <Text style={s.settingsText}>Settings</Text>
        <Text style={s.settingsChevron}>›</Text>
      </Pressable>
      {/* The account row lives in the field so it is above the fold at every
          class, and so Sign out is never below a list that failed to load. */}
      <View style={s.account}>
        <View style={s.accountText}>
          <Text style={s.accountLabel}>SIGNED IN AS</Text>
          <Text style={s.accountEmail} numberOfLines={1} testID="wsf-you-email">
            {email ?? 'this device'}
          </Text>
        </View>
        <Pressable
          onPress={onSignOut}
          disabled={signingOut}
          style={s.signOut}
          testID="wsf-you-signout"
          accessibilityRole="button"
        >
          <Text style={s.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={s.screen} testID="wsf-you">
      <ScrollView contentContainerStyle={s.body}>
        {screen.kind === 'loading' ? (
          <>
            <View style={s.fieldShort}>
              <View style={s.fieldTop}>
                <Pressable
                  onPress={() => router.replace('/')}
                  accessibilityRole="link"
                  accessibilityLabel="We Stay Fit, go Home"
                  testID="wsf-you-wordmark-home"
                >
                  <WsfWordmark variant="white" height={17} testID="wsf-you-wordmark" />
                </Pressable>
                <Text style={s.pageTag} testID="wsf-you-title">You</Text>
              </View>
              <View style={[s.skelOnNavy, { width: '62%', height: 30 }]} />
              <View style={[s.skelOnNavy, { width: '40%', height: 13 }]} />
            </View>
            <View style={s.sheet} testID="wsf-you-loading">
              <View style={s.skelRow}>
                <View style={[s.skel, { width: 150, height: 150, borderRadius: 16 }]} />
                <View style={s.skelCol}>
                  <View style={[s.skel, { width: '80%', height: 16 }]} />
                  <View style={[s.skel, { width: '50%', height: 12 }]} />
                  <View style={[s.skel, { width: '65%', height: 22 }]} />
                </View>
              </View>
              <View style={[s.skel, { width: '100%', height: 62, borderRadius: 14 }]} />
            </View>
          </>
        ) : null}

        {screen.kind === 'signedOut' ? (
          <>
            <View style={s.fieldShort}>
              <View style={s.fieldTop}>
                <Pressable
                  onPress={() => router.replace('/')}
                  accessibilityRole="link"
                  accessibilityLabel="We Stay Fit, go Home"
                  testID="wsf-you-wordmark-home"
                >
                  <WsfWordmark variant="white" height={17} testID="wsf-you-wordmark" />
                </Pressable>
                <Text style={s.pageTag} testID="wsf-you-title">You</Text>
              </View>
              <Text style={[display.lg, s.name]} accessibilityRole="header">
                You
              </Text>
              <Text style={s.since}>Sign in to see your part and your communities.</Text>
            </View>
            <View style={s.sheet} testID="wsf-you-signed-out">
              <Pressable
                onPress={() => router.push('/signin')}
                style={s.primary}
                testID="wsf-you-signin"
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Sign in</Text>
              </Pressable>
              <Text style={s.quietBody}>
                What you record is yours. It is counted into your community’s shared total and is
                never shown beside anybody else’s.
              </Text>
            </View>
          </>
        ) : null}

        {screen.kind === 'noCommunity' ? (
          <>
            {identity(screen.profile, user?.email ?? null)}
            <View style={s.sheet} testID="wsf-you-no-community">
              <Text style={s.emptyTitle}>You’re not in a community yet.</Text>
              <Text style={s.quietBody}>
                Your part is counted inside a community’s goals. Join one with a code, or start
                your own.
              </Text>
              <Pressable
                onPress={() => router.push('/community')}
                style={s.primary}
                testID="wsf-you-find-community"
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Find a community</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {screen.kind === 'pickCommunity' ? (
          <>
            {identity(screen.profile, user?.email ?? null)}
            <View style={s.sheet} testID="wsf-you-pick-community">
              <Text style={s.emptyTitle}>Which community?</Text>
              <Text style={s.quietBody}>
                {`You are in ${screen.count} communities. Open one and it becomes the one this ` +
                  'page speaks for.'}
              </Text>
              <Pressable
                onPress={() => router.push('/community')}
                style={s.primary}
                testID="wsf-you-choose-community"
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Choose a community</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {screen.kind === 'failed' ? (
          <>
            {identity(screen.profile, user?.email ?? null)}
            <View style={s.sheet} testID="wsf-you-failed">
              {/* The read failed; the account did not. Identity and Sign out are
                  above this and unaffected. */}
              <View style={s.errorBox}>
                <Text style={s.errorTitle}>We couldn’t load your goals.</Text>
                <Text style={s.errorBody}>
                  Nothing of yours has changed. Check your connection and try again.
                </Text>
              </View>
              <Pressable
                onPress={() => setReloads((v) => v + 1)}
                style={s.primary}
                testID="wsf-you-retry"
                accessibilityRole="button"
              >
                <Text style={s.primaryText}>Try again</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {screen.kind === 'member' ? (
          <>
            {identity(screen.profile, user?.email ?? null)}
            <View style={s.sheet} testID="wsf-you-member">
              <View style={s.belong} testID="wsf-you-community">
                <Text style={s.belongName}>{screen.community.displayName}</Text>
                <Text style={s.belongMeta}>
                  {[
                    roleCardLabel(screen.community.role),
                    memberCountLabel(screen.community.memberCount),
                  ]
                    .filter((p): p is string => Boolean(p))
                    .join(' · ')}
                </Text>
              </View>

              {screen.partial ? (
                <Text style={s.partial} testID="wsf-you-partial">
                  Some goals could not be loaded, so this list may be short.
                </Text>
              ) : null}

              {screen.open.length > 0 ? (
                <View style={s.lead} testID="wsf-you-lead">
                  <LivingWeProgress
                    completed={screen.open[0]!.sharedTotal}
                    target={screen.open[0]!.target}
                    unit={screen.open[0]!.unit}
                    width={150}
                    surface="light"
                  />
                  <View style={s.leadText}>
                    <Text style={s.leadTitle}>{screen.open[0]!.title}</Text>
                    <Text style={s.leadMineLabel}>YOUR PART</Text>
                    <Text style={s.leadMine} testID="wsf-you-lead-own">
                      {`${n(screen.open[0]!.yourPart)} ${screen.open[0]!.unit}`}
                    </Text>
                    {/* The community's number, said to be the community's. */}
                    <Text style={s.leadShared} testID="wsf-you-lead-shared">
                      {`The community is at ${n(screen.open[0]!.sharedTotal)} of ${n(
                        screen.open[0]!.target,
                      )}.`}
                    </Text>
                  </View>
                </View>
              ) : null}

              {screen.open.length > 1 ? (
                <>
                  <Text style={s.sectionLabel}>ALSO OPEN</Text>
                  {screen.open.slice(1).map((r) => (
                    <GoalRow key={r.goalId} row={r} />
                  ))}
                </>
              ) : null}

              {screen.finished.length > 0 ? (
                <>
                  <Text style={s.sectionLabel}>FINISHED</Text>
                  {screen.finished.map((r) => (
                    <GoalRow key={r.goalId} row={r} finished />
                  ))}
                </>
              ) : null}

              {screen.open.length === 0 && screen.finished.length === 0 ? (
                <Text style={s.quietBody} testID="wsf-you-nothing-yet">
                  You haven’t recorded anything yet. Whatever you add to a goal shows up here, with
                  your own figure kept separate from the community’s.
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** One goal, one row: what it is, your exact part, where the community stands. */
function GoalRow({ row, finished }: { row: Row; finished?: boolean }) {
  return (
    <View style={s.row} testID={`wsf-you-row-${row.goalId}`}>
      <View style={s.rowHead}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {row.title}
        </Text>
        {finished && row.sharedTotal >= row.target ? (
          <Text style={s.rowReached}>Reached</Text>
        ) : null}
      </View>
      <View style={s.rowFacts}>
        <View style={s.rowFact}>
          <Text style={s.rowFactLabel}>YOUR PART</Text>
          <Text style={s.rowMine}>{`${n(row.yourPart)} ${row.unit}`}</Text>
        </View>
        {!finished ? (
          <View style={s.rowFact}>
            <Text style={s.rowFactLabel}>THE COMMUNITY</Text>
            <Text style={s.rowShared}>{`${n(row.sharedTotal)} of ${n(row.target)}`}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1 },

  field: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 22,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    gap: 6,
    ...elevation.hero,
  },
  fieldShort: {
    backgroundColor: NAVY,
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 22,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    gap: 6,
    ...elevation.hero,
  },
  fieldTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 30,
    marginBottom: 6,
  },
  pageTag: {
    color: ON_NAVY_MUTED,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  name: { color: ON_NAVY },
  since: { color: ON_NAVY_MUTED, fontSize: 13, fontWeight: '600' },

  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  settingsText: { color: ON_NAVY, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  settingsChevron: { color: ON_NAVY_MUTED, fontSize: 20, fontWeight: '700' },
  account: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(247,245,240,0.16)',
    paddingTop: 12,
  },
  accountText: { flexShrink: 1, minWidth: 0, gap: 1 },
  accountLabel: { color: ON_NAVY_MUTED, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.4 },
  accountEmail: { color: ON_NAVY, fontSize: 13.5, fontWeight: '700' },
  signOut: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.4)',
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: ON_NAVY, fontSize: 13.5, fontWeight: '800' },

  /* The sheet clears the shell's bar by its exported measurements plus the
     raised MOVE control's overhang, so the last row is readable at rest. */
  sheet: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG,
    gap: 10,
  },

  belong: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderLeftWidth: 4,
    borderLeftColor: ACTION_GREEN,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 2,
    ...elevation.card,
  },
  belongName: { color: NAVY, fontSize: 16.5, lineHeight: 21, fontWeight: '900' },
  belongMeta: { color: INK_QUIET, fontSize: 12, lineHeight: 17 },

  partial: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17, fontWeight: '700' },

  lead: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  leadText: { flexShrink: 1, minWidth: 0, gap: 1 },
  leadTitle: { color: NAVY, fontSize: 15.5, lineHeight: 20, fontWeight: '900' },
  leadMineLabel: {
    color: INK_QUIET,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 6,
  },
  leadMine: { color: ACTION_GREEN_DEEP, fontSize: 24, lineHeight: 29, fontWeight: '900' },
  leadShared: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17, marginTop: 4 },

  sectionLabel: {
    color: INK_QUIET,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 8,
  },

  row: { borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 9, paddingBottom: 3, gap: 5 },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: { color: NAVY, fontSize: 14.5, fontWeight: '800', flexShrink: 1, minWidth: 0 },
  rowReached: { color: ACTION_GREEN_DEEP, fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  rowFacts: { flexDirection: 'row', gap: 22 },
  rowFact: { gap: 1 },
  rowFactLabel: { color: INK_QUIET, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  rowMine: { color: NAVY, fontSize: 15, fontWeight: '900' },
  rowShared: { color: INK_QUIET, fontSize: 15, fontWeight: '700' },

  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    ...elevation.action,
  },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },

  emptyTitle: { color: NAVY, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  quietBody: { color: INK_QUIET, fontSize: 13.5, lineHeight: 19 },

  errorBox: {
    backgroundColor: '#FBEFEF',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: ERROR_RED,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 3,
  },
  errorTitle: { color: ERROR_RED, fontSize: 14.5, lineHeight: 19, fontWeight: '900' },
  errorBody: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },

  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },
  skelOnNavy: { backgroundColor: 'rgba(247,245,240,0.14)', borderRadius: 6 },
  skelRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  skelCol: { flexShrink: 1, minWidth: 0, gap: 8, flexGrow: 1 },
});
