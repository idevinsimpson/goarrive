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
import { groupTypeCardLabel, memberCountLabel, roleCardLabel } from '../../src/labels';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { ACTION_GREEN, NAVY, PROGRESS_GREEN, SURFACE, elevation } from '../../src/ui/kit';
import { fillRatio, percentLabel } from '../../src/ui/progressFormat';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG, MOVE_HREF } from '../../src/ui/MemberTabBar';

/**
 * PAGE 5 — YOU. Composition: YOU-PARITY-1 (Director #365 `5840666502`), a
 * literal port of the accepted Lovable reference `642f830b`
 * (`src/demo/screens/you.tsx`); evidence in
 * `docs/design-target/review/you-parity-1/`. Order: identity (avatar, name,
 * member since, Settings) → current community band (role, size) → your part in
 * Living WE (shared position beside your exact confirmed part) → other goals
 * you helped → the account, last and quiet. Earlier target:
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
  /** Returned by wsfMyCommunities; read only to name the kind of community. */
  groupType?: string;
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
  /**
   * A read failed. `community` is present when the failure came AFTER the
   * member's community was resolved, so the page can keep saying which
   * community this is (YOU-PARITY-1) rather than dropping back to identity only.
   */
  | { kind: 'failed'; profile: Profile; community?: Community }
  | {
      kind: 'member';
      profile: Profile;
      community: Community;
      open: Row[];
      finished: Row[];
      /** True when a read failed and this list is not the whole truth. */
      partial: boolean;
      /**
       * Whether this community has a goal a first contribution could go to
       * right now: active, with a target to measure against. Only then does
       * the no-own state offer "Start moving" (accepted You reference,
       * `canInviteFirstContribution`); otherwise it says nothing is open.
       */
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
        setScreen({ kind: 'failed', profile, community });
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

      const eligible = goals.some(
        (g) => g.status === 'active' && typeof g.target === 'number' && g.target > 0,
      );
      setScreen({ kind: 'member', profile, community, open, finished, partial, eligible });
    })();
  }, [ready, user, reloads]);


  const onSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut(getFirebaseAuth())
      .then(() => router.replace('/'))
      .finally(() => setSigningOut(false));
  }, []);

  const openSettings = useCallback(() => router.push('/settings'), []);
  const openCommunity = useCallback(() => router.push('/community'), []);
  const startMoving = useCallback(() => router.push(MOVE_HREF), []);

  const email = user?.email ?? null;

  return (
    <View style={s.screen} testID="wsf-you">
      <ScrollView contentContainerStyle={s.body}>
        {screen.kind === 'loading' ? (
          <>
            <Head profile={null} onSettings={null} resolved={false} />
            <View style={s.bandSkeleton} testID="wsf-you-loading">
              <View style={[s.skelOnNavy, { width: '46%', height: 11 }]} />
              <View style={[s.skelOnNavy, { width: '70%', height: 24 }]} />
              <View style={[s.skelOnNavy, { width: '100%', height: 34, marginTop: 10 }]} />
            </View>
            <View style={s.leadSkeleton}>
              <View style={[s.skel, { width: '52%', height: 11 }]} />
              <View style={[s.skel, { width: '78%', height: 22 }]} />
              <View style={[s.skel, { width: '100%', height: 118, borderRadius: 8, marginTop: 12 }]} />
            </View>
          </>
        ) : null}

        {screen.kind === 'signedOut' ? (
          <>
            <Head profile={null} onSettings={null} resolved={false} />
            <View style={s.stateCard} testID="wsf-you-signed-out">
              <Text style={s.eyebrow}>YOUR PART</Text>
              <Text style={s.stateTitle}>Sign in to see your part and your communities</Text>
              <Text style={s.stateBody}>
                What you record is yours. It is counted into your community’s shared total and is
                never shown beside anybody else’s.
              </Text>
              <PrimaryAction label="Sign in" onPress={() => router.push('/signin')} testID="wsf-you-signin" />
            </View>
          </>
        ) : null}

        {screen.kind === 'noCommunity' ? (
          <>
            <Head profile={screen.profile} onSettings={openSettings} />
            <View style={s.stateCard} testID="wsf-you-no-community">
              <Text style={s.eyebrow}>YOUR COMMUNITY</Text>
              <Text style={s.stateTitle}>Find your people</Text>
              <Text style={s.stateBody}>
                You’re not in a community yet. Your part is counted inside a community’s goals —
                join one with a code, or start your own.
              </Text>
              <PrimaryAction
                label="Find a community"
                arrow
                onPress={openCommunity}
                testID="wsf-you-find-community"
              />
            </View>
            <Account email={email} signingOut={signingOut} onSignOut={onSignOut} />
          </>
        ) : null}

        {screen.kind === 'pickCommunity' ? (
          <>
            <Head profile={screen.profile} onSettings={openSettings} />
            <View style={s.stateCard} testID="wsf-you-pick-community">
              <Text style={s.eyebrow}>YOUR COMMUNITY</Text>
              <Text style={s.stateTitle}>Which community?</Text>
              <Text style={s.stateBody}>
                {`You are in ${screen.count} communities. Open one and it becomes the one this ` +
                  'page speaks for.'}
              </Text>
              <PrimaryAction
                label="Choose a community"
                arrow
                onPress={openCommunity}
                testID="wsf-you-choose-community"
              />
            </View>
            <Account email={email} signingOut={signingOut} onSignOut={onSignOut} />
          </>
        ) : null}

        {screen.kind === 'failed' ? (
          <>
            <Head profile={screen.profile} onSettings={openSettings} />
            {screen.community ? <Belonging community={screen.community} /> : null}
            {/* The read failed; the account did not. Identity, the community
                when it was already known, and Sign out are all still here, and
                no amount is guessed or shown as zero. */}
            <View style={s.stateCard} testID="wsf-you-failed" accessibilityRole={'alert' as never}>
              <Text style={s.eyebrow}>YOUR PART</Text>
              <Text style={s.stateTitle}>Contribution details unavailable</Text>
              <Text style={s.stateBody}>
                {screen.community
                  ? 'Your identity and community are still here. We won’t guess an amount or show it as zero.'
                  : 'Your identity is still here. We won’t guess an amount or show it as zero.'}
              </Text>
              <View style={s.flowActions}>
                <SecondaryAction label="Open community" onPress={openCommunity} testID="wsf-you-failed-community" />
                <PrimaryAction
                  label="Retry"
                  onPress={() => setReloads((v) => v + 1)}
                  testID="wsf-you-retry"
                  inRow
                />
              </View>
            </View>
            <Account email={email} signingOut={signingOut} onSignOut={onSignOut} />
          </>
        ) : null}

        {screen.kind === 'member' ? (
          <>
            <Head profile={screen.profile} onSettings={openSettings} />
            <View testID="wsf-you-member">
              <Belonging community={screen.community} />

              {screen.partial ? (
                <Text style={s.partial} testID="wsf-you-partial">
                  Some goals could not be loaded, so this list may be short.
                </Text>
              ) : null}

              {screen.open.length > 0 ? (
                <Lead row={screen.open[0]!} />
              ) : screen.eligible ? (
                <View style={s.stateCard} testID="wsf-you-nothing-yet">
                  <Text style={s.eyebrow}>YOUR PART</Text>
                  <Text style={s.stateTitle}>Your first confirmed contribution can start here</Text>
                  <Text style={s.stateBody}>
                    No confirmed contribution is shown for you yet. Pending or unknown attempts never
                    count here.
                  </Text>
                  <PrimaryAction label="Start moving" arrow onPress={startMoving} testID="wsf-you-start-moving" />
                </View>
              ) : (
                <View
                  style={s.stateCard}
                  testID="wsf-you-nothing-yet"
                  {...({ dataSet: { state: 'no-eligible-goal' } } as Record<string, unknown>)}
                >
                  <Text style={s.eyebrow}>YOUR PART</Text>
                  <Text style={s.stateTitle}>No goal is open for contributions</Text>
                  <Text style={s.stateBody}>
                    {screen.finished.length > 0
                      ? 'This community has no goal accepting contributions right now. What you added before is below.'
                      : 'No confirmed contribution is shown for you, and this community has no goal accepting contributions right now. Nothing here can be counted yet.'}
                  </Text>
                  <SecondaryAction
                    label="Open community"
                    arrow
                    onPress={openCommunity}
                    testID="wsf-you-open-community"
                    block
                  />
                </View>
              )}

              <OtherGoals
                rows={[...screen.open.slice(1), ...screen.finished]}
                communityName={screen.community.displayName}
              />
            </View>
            <Account email={email} signingOut={signingOut} onSignOut={onSignOut} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Up to two initials from the member's own display name; none when it is unknown. */
function initialsOf(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => Array.from(p)[0] ?? '').join('');
  return letters ? letters.toUpperCase() : null;
}

/**
 * THE HEAD: who you are, first. Avatar, name, member-since, and Settings as a
 * working affordance on the right — the accepted reference's `you-head`. The
 * side panel itself is W9's; this only opens Settings.
 */
function Head({
  profile,
  onSettings,
  resolved = true,
}: {
  profile: Profile | null;
  onSettings: (() => void) | null;
  /**
   * False while loading and when signed out. `wsf-you-identity` is the shell
   * tests' "this screen has resolved for a signed-in member" handle and
   * `wsf-you-name` is somebody's name, so neither may be on a loading or
   * signed-out page.
   */
  resolved?: boolean;
}) {
  const name = profile?.displayName ?? null;
  const initials = initialsOf(name);
  return (
    <View style={s.head} testID={resolved ? 'wsf-you-identity' : undefined}>
      <View style={s.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {initials ? <Text style={s.avatarText}>{initials}</Text> : <PersonGlyph />}
      </View>
      <View style={s.headText}>
        <Text style={s.eyebrow} testID="wsf-you-title">YOUR PROFILE</Text>
        <Text style={s.h1} testID={resolved ? 'wsf-you-name' : undefined} accessibilityRole="header">
          {name ?? 'You'}
        </Text>
        {profile?.memberSince ? (
          <Text style={s.muted} testID="wsf-you-since">{`Member since ${profile.memberSince}`}</Text>
        ) : null}
      </View>
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          style={s.settings}
          testID="wsf-you-settings"
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <GearGlyph />
          <Text style={s.settingsText}>Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Your current community, full-bleed navy: name, kind, then role and size. */
function Belonging({ community }: { community: Community }) {
  const kind = groupTypeCardLabel(community.groupType ?? null);
  return (
    <View style={s.band} testID="wsf-you-community">
      <View>
        <Text style={s.eyebrowLight}>YOUR CURRENT COMMUNITY</Text>
        <Text style={s.bandName}>{community.displayName}</Text>
        {kind ? <Text style={s.bandSub}>{kind}</Text> : null}
      </View>
      <View style={s.bandFacts}>
        <View style={[s.bandFact, { flex: 0.7 }]}>
          <Text style={s.bandDt}>ROLE</Text>
          <Text style={s.bandDd}>{roleCardLabel(community.role) ?? 'Member'}</Text>
        </View>
        <View style={[s.bandFact, { flex: 1.3 }]}>
          <Text style={s.bandDt}>COMMUNITY</Text>
          <Text style={s.bandDd}>{memberCountLabel(community.memberCount)}</Text>
        </View>
      </View>
    </View>
  );
}

type Status = { label: string; tone: 'open' | 'closedReached' | 'closedUnfinished' };

/** The accepted reference's four lifecycle states, derived only from status and the two figures. */
function statusOf(row: Row): Status {
  const reached = row.target > 0 && row.sharedTotal >= row.target;
  if (row.open) return { label: reached ? 'REACHED · STILL OPEN' : 'OPEN', tone: 'open' };
  return reached
    ? { label: 'CLOSED · REACHED', tone: 'closedReached' }
    : { label: 'CLOSED · UNFINISHED', tone: 'closedUnfinished' };
}

function Pill({ status, testID }: { status: Status; testID?: string }) {
  return (
    <View
      style={[
        s.pill,
        status.tone === 'closedReached' && s.pillClosedReached,
        status.tone === 'closedUnfinished' && s.pillClosedUnfinished,
      ]}
      testID={testID}
    >
      <Text
        style={[
          s.pillText,
          status.tone === 'closedReached' && s.pillTextClosedReached,
          status.tone === 'closedUnfinished' && s.pillTextClosedUnfinished,
        ]}
      >
        {status.label}
      </Text>
    </View>
  );
}

/**
 * YOUR PART IN LIVING WE: the shared position and your exact confirmed part,
 * side by side and never joined. No ratio between them, no rank, no streak.
 */
function Lead({ row }: { row: Row }) {
  const usable = row.target > 0;
  const ratio = usable ? fillRatio(row.sharedTotal, row.target) : 0;
  const remaining = Math.max(0, row.target - row.sharedTotal);
  const reached = usable && row.sharedTotal >= row.target;
  return (
    <View style={s.lead} testID="wsf-you-lead">
      <View style={s.leadHeading}>
        <View style={s.leadHeadingText}>
          <Text style={s.eyebrow}>YOUR PART IN LIVING WE</Text>
          <Text style={s.h2}>{row.title}</Text>
        </View>
        <Pill status={statusOf(row)} testID="wsf-you-lead-status" />
      </View>
      <View style={s.leadBody}>
        <View style={s.shared}>
          {usable ? (
            <LivingWeProgress
              completed={row.sharedTotal}
              target={row.target}
              unit={row.unit}
              width={76}
              surface="dark"
            />
          ) : null}
          <View style={s.sharedText}>
            <Text style={s.sharedSmall}>SHARED POSITION</Text>
            <Text style={s.sharedNumberLine} testID="wsf-you-lead-shared">
              <Text style={s.sharedNumber}>{n(row.sharedTotal)}</Text>
              <Text style={s.sharedOf}>{usable ? ` / ${n(row.target)} confirmed` : ` ${row.unit} confirmed`}</Text>
            </Text>
            {usable ? (
              <>
                <View style={s.track}>
                  <View style={[s.trackFill, { width: `${ratio * 100}%` }]} />
                </View>
                <View style={s.meta}>
                  <Text style={s.metaStrong}>
                    {reached ? 'Goal reached' : `${percentLabel(row.sharedTotal, row.target)} complete`}
                  </Text>
                  <Text style={s.metaSoft}>{reached ? 'Still open' : `${n(remaining)} ${row.unit} to go`}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>
        <View style={s.own}>
          <Text style={s.ownSmall}>YOUR EXACT CONFIRMED PART</Text>
          {/* One text node, so the figure and its unit are read together and
              can never be separated: the number, a line break, the unit. */}
          <Text style={s.ownNumber} testID="wsf-you-lead-own">
            {n(row.yourPart)}
            <Text style={s.ownUnit}>{`\n${row.unit}`}</Text>
          </Text>
        </View>
      </View>
      <Text style={s.truth}>Shared and yours are separate facts. No rank, streak, score or inferred impact.</Text>
    </View>
  );
}

/** Other goals you helped: each with your part and the shared figure, kept apart. */
function OtherGoals({ rows, communityName }: { rows: Row[]; communityName: string }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.others} testID="wsf-you-others">
      <Text style={s.eyebrow}>ALSO YOURS</Text>
      <Text style={s.h2Others}>Other goals you helped</Text>
      {rows.map((r) => (
        <View key={r.goalId} style={s.row} testID={`wsf-you-row-${r.goalId}`}>
          <View style={s.rowHead}>
            <View style={s.rowHeadText}>
              <Text style={s.rowTitle} numberOfLines={2}>
                {r.title}
              </Text>
              <Text style={s.rowSub}>{[communityName, whenLabel(r)].filter(Boolean).join(' · ')}</Text>
            </View>
            <Pill status={statusOf(r)} />
          </View>
          <View style={s.rowFacts}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowDt}>YOURS</Text>
              <Text style={s.rowDd}>{`${n(r.yourPart)} ${r.unit}`}</Text>
            </View>
            <View style={{ flex: 1.45 }}>
              <Text style={s.rowDt}>SHARED</Text>
              <Text style={s.rowDd}>
                {r.target > 0 ? `${n(r.sharedTotal)} / ${n(r.target)} ${r.unit}` : `${n(r.sharedTotal)} ${r.unit}`}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function whenLabel(r: Row): string | null {
  if (!r.endsAt) return null;
  const d = new Date(r.endsAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return r.open ? `Ends ${day}` : `Ended ${day}`;
}

/**
 * THE ACCOUNT, LAST AND QUIET. Signing out needs no read, so this renders in
 * every signed-in state — it is reachable, just not the member story's lead.
 */
function Account({
  email,
  signingOut,
  onSignOut,
}: {
  email: string | null;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <View style={s.account} testID="wsf-you-account">
      <View style={s.accountText}>
        <Text style={s.accountLabel}>Signed in as</Text>
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
  );
}

function PrimaryAction({
  label,
  onPress,
  testID,
  arrow,
  inRow,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  arrow?: boolean;
  inRow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.primary, inRow && s.inRow]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.primaryText}>{label}</Text>
      {arrow ? <Text style={s.primaryArrow} accessibilityElementsHidden>→</Text> : null}
    </Pressable>
  );
}

function SecondaryAction({
  label,
  onPress,
  testID,
  arrow,
  block,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  arrow?: boolean;
  block?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.secondary, block ? s.secondaryBlock : s.inRow]}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.secondaryText}>{label}</Text>
      {arrow ? <Text style={s.secondaryArrow} accessibilityElementsHidden>→</Text> : null}
    </Pressable>
  );
}

/** The Settings gear, drawn from Views: four crossed bars, a hub, a hole. */
function GearGlyph() {
  return (
    <View style={s.gear} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 45, 90, 135].map((deg) => (
        <View key={deg} style={[s.gearTooth, { transform: [{ rotate: `${deg}deg` }] }]} />
      ))}
      <View style={s.gearHub} />
      <View style={s.gearHole} />
    </View>
  );
}

/** A plain figure for a member with no display name. */
function PersonGlyph() {
  return (
    <View style={s.person} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.personHead} />
      <View style={s.personBody} />
    </View>
  );
}

/*
  TOKENS FROM THE ACCEPTED REFERENCE (Lovable `642f830b`, src/styles.css),
  converted from oklch to hex so this route reads the same without editing the
  shared kit. Navy, action green and confirmed green are the kit's own.
*/
const BG = '#FBFAF4';
const MUTED_BG = '#EFEFE6';
const MUTED_FG = '#4B5C71';
const BORDER = '#D7DFE7';
const EYEBROW_GREEN = '#00741E';
const UNIT_GREEN = '#005E19';
const PILL_TEXT = '#014210';
const PILL_BG = '#E0F0DB';
const CONFIRMED = PROGRESS_GREEN;
const BAND_SUB = '#BFD5E2';
const BAND_DT = '#A6C3D4';
const SHARED_SMALL = '#ACC9DB';
const SHARED_SOFT = '#B5CEE3';

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  body: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG,
  },

  eyebrow: { color: EYEBROW_GREEN, fontSize: 11, fontWeight: '800', letterSpacing: 1.32 },
  eyebrowLight: { color: CONFIRMED, fontSize: 11, fontWeight: '800', letterSpacing: 1.32 },
  muted: { color: MUTED_FG, fontSize: 12 },
  h1: { color: NAVY, fontSize: 27, lineHeight: 31, fontWeight: '400', marginVertical: 2 },
  h2: { color: NAVY, fontSize: 21, lineHeight: 23, fontWeight: '400', marginTop: 3 },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: SURFACE, fontSize: 11, fontWeight: '800' },
  headText: { flex: 1, minWidth: 0 },
  settings: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  settingsText: { color: NAVY, fontSize: 10, fontWeight: '800' },
  gear: { width: 21, height: 21, alignItems: 'center', justifyContent: 'center' },
  gearTooth: { position: 'absolute', width: 4, height: 19, borderRadius: 1, backgroundColor: NAVY },
  gearHub: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: NAVY },
  gearHole: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: BG },
  person: { width: 22, height: 22, alignItems: 'center', justifyContent: 'flex-end' },
  personHead: { width: 9, height: 9, borderRadius: 5, backgroundColor: SURFACE, marginBottom: 2 },
  personBody: { width: 16, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: SURFACE },

  band: {
    marginTop: 14,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 14,
    backgroundColor: NAVY,
  },
  bandName: { color: SURFACE, fontSize: 25, lineHeight: 27, fontWeight: '400', marginTop: 3, marginBottom: 2 },
  bandSub: { color: BAND_SUB, fontSize: 12 },
  bandFacts: { flexDirection: 'row', gap: 14 },
  bandFact: { paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  bandDt: { color: BAND_DT, fontSize: 10, fontWeight: '800' },
  bandDd: { color: SURFACE, fontSize: 14, fontWeight: '800', marginTop: 2 },

  partial: { color: MUTED_FG, fontSize: 12.5, lineHeight: 17, fontWeight: '700', marginTop: 12 },

  lead: { paddingTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  leadHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  leadHeadingText: { flex: 1, minWidth: 0 },
  leadBody: { marginTop: 13, flexDirection: 'row', gap: 10 },
  shared: {
    flex: 1.35,
    minWidth: 0,
    padding: 12,
    borderRadius: 8,
    backgroundColor: NAVY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sharedText: { flex: 1, minWidth: 0 },
  sharedSmall: { color: SHARED_SMALL, fontSize: 9, fontWeight: '800' },
  sharedNumberLine: { marginTop: 2 },
  sharedNumber: { color: SURFACE, fontSize: 24, lineHeight: 26, fontWeight: '700' },
  sharedOf: { color: SHARED_SOFT, fontSize: 13, fontWeight: '700' },
  track: {
    height: 8,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  trackFill: { height: '100%', borderRadius: 10, backgroundColor: CONFIRMED },
  meta: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  metaStrong: { color: CONFIRMED, fontSize: 9, fontWeight: '700' },
  metaSoft: { color: SHARED_SOFT, fontSize: 9 },
  own: {
    flex: 0.65,
    minWidth: 104,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 4,
    borderLeftColor: CONFIRMED,
    backgroundColor: SURFACE,
  },
  ownSmall: { color: MUTED_FG, fontSize: 9, lineHeight: 11, fontWeight: '800' },
  ownNumber: { color: NAVY, fontSize: 34, lineHeight: 34, fontWeight: '700', marginTop: 6 },
  ownUnit: { color: UNIT_GREEN, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  truth: { color: MUTED_FG, fontSize: 10, marginTop: 9 },

  pill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: PILL_BG,
    alignSelf: 'flex-start',
  },
  pillText: { color: PILL_TEXT, fontSize: 10, fontWeight: '800' },
  pillClosedReached: { backgroundColor: NAVY },
  pillTextClosedReached: { color: CONFIRMED },
  pillClosedUnfinished: { backgroundColor: MUTED_BG },
  pillTextClosedUnfinished: { color: MUTED_FG },

  others: { paddingTop: 17 },
  h2Others: { color: NAVY, fontSize: 19, lineHeight: 22, fontWeight: '400', marginTop: 2, marginBottom: 6 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowHeadText: { flex: 1, minWidth: 0 },
  rowTitle: { color: NAVY, fontSize: 14, fontWeight: '700' },
  rowSub: { color: MUTED_FG, fontSize: 11, marginTop: 2 },
  rowFacts: { flexDirection: 'row', gap: 10, marginTop: 8 },
  rowDt: { color: MUTED_FG, fontSize: 9, fontWeight: '800' },
  rowDd: { color: NAVY, fontSize: 12, fontWeight: '800', marginTop: 2 },

  stateCard: { marginTop: 16, padding: 20, borderRadius: 8, backgroundColor: MUTED_BG },
  stateTitle: { color: NAVY, fontSize: 22, lineHeight: 25, fontWeight: '400', marginTop: 4, marginBottom: 7 },
  stateBody: { color: MUTED_FG, fontSize: 13, lineHeight: 19 },
  flowActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  inRow: { flex: 1, marginTop: 0 },

  primary: {
    minHeight: 54,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: ACTION_GREEN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    ...elevation.action,
  },
  primaryText: { color: NAVY, fontSize: 16, fontWeight: '800' },
  primaryArrow: { color: NAVY, fontSize: 18, fontWeight: '800' },
  secondary: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: NAVY,
    backgroundColor: SURFACE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  secondaryBlock: { alignSelf: 'flex-start', marginTop: 10 },
  secondaryText: { color: NAVY, fontSize: 14, fontWeight: '800' },
  secondaryArrow: { color: NAVY, fontSize: 15, fontWeight: '800' },

  account: {
    marginTop: 24,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountText: { flex: 1, minWidth: 0 },
  accountLabel: { color: MUTED_FG, fontSize: 12 },
  accountEmail: { color: NAVY, fontSize: 14, fontWeight: '800', marginTop: 2 },
  signOut: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: NAVY, fontSize: 13.5, fontWeight: '800' },

  bandSkeleton: {
    marginTop: 14,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 18,
    gap: 8,
    backgroundColor: NAVY,
  },
  leadSkeleton: { paddingTop: 18, gap: 8 },
  skel: { backgroundColor: '#E9E5DC', borderRadius: 6 },
  skelOnNavy: { backgroundColor: 'rgba(247,245,240,0.14)', borderRadius: 6 },
});
