import { Link, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { describeCallableError } from '../../../src/callableErrors';
import { resolveCurrentCommunity } from '../../../src/currentCommunity';
import { wsfAuthEnabled } from '../../../src/featureFlags';
import { getFirebaseAuth, getFirebaseFunctions } from '../../../src/firebase';
import {
  challengeParticipationLabel,
  groupTypeCardLabel,
  memberCountLabel,
  roleCardLabel,
} from '../../../src/labels';
import { wsfTheme } from '../../../src/theme';
import { ButtonLink } from '../../../src/ui/ButtonLink';
import { CARD_BORDER, NAVY, kit } from '../../../src/ui/kit';
import { formatCount, totalOfTargetLabel } from '../../../src/ui/progressFormat';
import { readMyCommunities } from '../../../src/memberReads';

type MyCommunityItem = {
  groupId: string;
  displayName: string;
  groupType: string;
  joinPolicy: string;
  role: string;
  memberCount: number;
  isSample: boolean;
  activeChallenge: {
    id: string;
    title: string;
    participantCount: number;
    completedCount: number;
    goalTarget: number | null;
  } | null;
};

type MyCommunitiesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: MyCommunityItem[] };

// The subset of wsfListGoals' row this screen reads. `sharedTotal` is only
// present when the call asked for history (it does), and is still checked
// before it is printed: a fabricated 0 is worse than no number.
type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt: string;
  sharedTotal?: number;
};

type ListGoalsResponse = { goals: ListedGoal[] };

/**
 * What a community card knows about its current goal. Three states, kept
 * apart on purpose: a read that has not returned, one that returned (with or
 * without an open goal), and one that failed. "We could not check" and "there
 * is no goal" are different facts and get different lines.
 */
type CardGoalState =
  | { kind: 'loading' }
  | { kind: 'ok'; goal: ListedGoal | null }
  | { kind: 'failed' };

// Same validator shape as pendingJoinCode.ts / wsfPreviewCommunity.
const JOIN_CODE_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export default function BrandShell() {
  const { ready, user } = useWsfAuth();
  const [myCommunities, setMyCommunities] = useState<MyCommunitiesState>({ kind: 'idle' });
  const [goalsByGroup, setGoalsByGroup] = useState<Record<string, CardGoalState>>({});
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinFieldError, setJoinFieldError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    // Only fetch for a signed-in user with auth enabled. Feature-flag-off, no
    // auth SDK is initialised — the fetch would throw at getFirebaseFunctions.
    if (!wsfAuthEnabled || !ready || !user) return;
    let cancelled = false;
    setMyCommunities({ kind: 'loading' });
    (async () => {
      try {
        // Fresh, and shared with the identical read the community this list
        // redirects to makes at the same moment (src/memberReads.ts).
        const result = { data: (await readMyCommunities(user.uid)) as unknown as { items: MyCommunityItem[] } };
        if (cancelled) return;
        setMyCommunities({ kind: 'ready', items: result.data.items });
      } catch (e) {
        if (cancelled) return;
        setMyCommunities({
          kind: 'error',
          message: describeCallableError(e, 'Could not load your communities.'),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  /*
    A GENUINE RETURN TO THIS SCREEN RE-READS WHAT IT SHOWS, QUIETLY.

    Home stays mounted under whatever the member opens from it, and a labelled
    "Back to home" returns to it as it stands (contribute/[goalId].tsx). So a
    member who asked for their list, moved, and came back is looking at the
    SAME list — which read once, on mount, and would otherwise still show the
    figures from before they moved (measured: a card at 1,847 against a
    committed 1,867, #458).

    Bumped on every focus except the first: the mount read covers that one,
    and reselecting the tab already in view is not a focus change, so it stays
    a no-op. Each return is one wsfMyCommunities read and one wsfListGoals
    read per community — the same reads the mount makes — and nothing polls.
  */
  const [returnToken, setReturnToken] = useState(0);
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) setReturnToken((n) => n + 1);
      focusedBefore.current = true;
    }, [])
  );
  /*
    Deliberately NOT the mount effect above: that one sets `loading` so a
    different account can never see the previous one's list, and on a return
    that would blank a screen the member is already looking at. Here nothing
    is cleared. A successful read replaces the list (and, through the effect
    below, re-reads every card's figures); a failed one leaves what is on
    screen standing and re-reads the figures alone. A read still in flight is
    left to finish. The cleanup runs when the account changes, so a result
    read for one account is never applied to another.
  */
  const [figuresRefreshToken, setFiguresRefreshToken] = useState(0);
  const handledReturn = useRef(0);
  useEffect(() => {
    if (!wsfAuthEnabled || !ready || !user) return;
    if (returnToken === 0 || returnToken === handledReturn.current) return;
    handledReturn.current = returnToken;
    if (myCommunities.kind === 'idle' || myCommunities.kind === 'loading') return;
    let cancelled = false;
    (async () => {
      try {
        const result = { data: (await readMyCommunities(user.uid)) as unknown as { items: MyCommunityItem[] } };
        if (cancelled) return;
        setMyCommunities({ kind: 'ready', items: result.data.items });
      } catch (e) {
        if (cancelled) return;
        console.warn('[wsf] home list refresh failed', e);
        setFiguresRefreshToken((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, returnToken, myCommunities.kind]);

  // The open goal of each community, so a card can say what is happening and
  // what the next action is. One wsfListGoals read per community (the same
  // member-authorized read Community Home makes, with history so the row
  // carries its confirmed total), in parallel; each card settles on its own
  // so one slow or failed read never blanks the others. A failed read falls
  // back to the challenge line the list already carries.
  //
  // A card that already has a figure keeps it until its new read returns: a
  // re-read on a return replaces numbers, it never shows loading over them.
  // The mount effect passes through `loading` first, which clears every card,
  // so a figure never carries over from a different account.
  useEffect(() => {
    if (myCommunities.kind !== 'ready') {
      setGoalsByGroup({});
      return;
    }
    let cancelled = false;
    const ids = myCommunities.items.map((item) => item.groupId);
    setGoalsByGroup((prev) =>
      Object.fromEntries(ids.map((id) => [id, prev[id] ?? ({ kind: 'loading' } as CardGoalState)]))
    );
    for (const groupId of ids) {
      (async () => {
        let next: CardGoalState;
        try {
          const fn = httpsCallable<{ groupId: string; includeHistory: boolean }, ListGoalsResponse>(
            getFirebaseFunctions(),
            'wsfListGoals'
          );
          const result = await fn({ groupId, includeHistory: true });
          next = { kind: 'ok', goal: featuredOpenGoal(result.data.goals ?? []) };
        } catch (e) {
          console.warn('[wsf] home goal read failed', e);
          next = { kind: 'failed' };
        }
        if (cancelled) return;
        setGoalsByGroup((prev) => ({ ...prev, [groupId]: next }));
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [myCommunities, figuresRefreshToken]);

  const onJoinCodeSubmit = useCallback(() => {
    const trimmed = joinCodeInput.trim();
    if (!JOIN_CODE_SHAPE.test(trimmed)) {
      setJoinFieldError('That does not look like a valid code.');
      return;
    }
    setJoinFieldError(null);
    router.push(`/join/${trimmed}` as never);
  }, [joinCodeInput]);

  const onSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut(getFirebaseAuth());
      setMyCommunities({ kind: 'idle' });
    } finally {
      setSigningOut(false);
    }
  }, []);

  // Signed-in branch: covers auth-enabled + settled + user present.
  const showSignedIn = wsfAuthEnabled && ready && !!user;

  return (
    <ScrollView
      style={kit.scroll}
      contentContainerStyle={kit.page}
      keyboardShouldPersistTaps="handled"
      testID="wsf-home"
    >
      <View style={kit.column}>
        {/* THE WORDMARK IS THE SHELL'S NOW. The persistent member top bar in
            app/(tabs)/_layout.tsx carries it, and its tap is the one gesture
            that goes Home. A second copy here stacked two wordmarks down the
            page and gave the member two different Home gestures -- and this
            one navigated INTO the tab tree from inside it, which pushed a new
            community screen instead of returning to the mounted one. */}

        {!wsfAuthEnabled ? (
          <>
            <HomeHero />
            <View style={kit.cardQuiet}>
              <Text style={kit.body} testID="wsf-home-flag-off">
                We Stay Fit is coming soon. This shell exists so the app can ship, deploy, and be
                verified. It intentionally has no content, no signup, and no reads or writes.
              </Text>
            </View>
          </>
        ) : !ready ? (
          // No hero while auth settles: a returning member must not watch a
          // marketing hero appear and vanish before their communities show.
          <View testID="wsf-home-loading" data-state="loading">
            <Text style={kit.statusText}>Loading…</Text>
          </View>
        ) : showSignedIn ? (
          <SignedInHome
            state={myCommunities}
            goalsByGroup={goalsByGroup}
            joinCodeInput={joinCodeInput}
            setJoinCodeInput={setJoinCodeInput}
            joinFieldError={joinFieldError}
            onJoinCodeSubmit={onJoinCodeSubmit}
          />
        ) : (
          <SignedOutHome
            joinCodeInput={joinCodeInput}
            setJoinCodeInput={setJoinCodeInput}
            joinFieldError={joinFieldError}
            onJoinCodeSubmit={onJoinCodeSubmit}
          />
        )}

        {/* Utility footer: who is signed in, the way out, and the build — each
            once, at the very bottom, out of the centre of the page. */}
        <View style={styles.utility}>
          {showSignedIn ? (
            <Text style={kit.caption} testID="wsf-home-identity">
              {identityLine(user!)}
            </Text>
          ) : null}
          <View style={styles.utilityRow}>
            {showSignedIn ? (
              <Pressable
                onPress={onSignOut}
                disabled={signingOut}
                style={[UTILITY_CONTROL, signingOut ? kit.primaryButtonDisabled : null]}
                testID="wsf-home-signout"
                accessibilityRole="button"
              >
                <Text style={kit.tertiaryButtonText}>
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </Text>
              </Pressable>
            ) : null}
            <ButtonLink
              href="/health"
              style={UTILITY_CONTROL}
              textStyle={kit.tertiaryButtonText}
              testID="wsf-home-build-details"
              label="Build details"
            />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * The open goal a card features: the one that ends soonest, as Community
 * Home features it. Several open goals stay several on Community Home; the
 * card names one so its line stays one line.
 */
function featuredOpenGoal(goals: ListedGoal[]): ListedGoal | null {
  const open = goals
    .filter((g) => g.status === 'active')
    .slice()
    .sort((a, b) => (a.endsAt === b.endsAt ? a.goalId.localeCompare(b.goalId) : a.endsAt.localeCompare(b.endsAt)));
  return open[0] ?? null;
}

/**
 * Which account is signed in, said clearly enough to tell two of them apart.
 *
 * This used to print the display name alone whenever one existed. Two accounts
 * with the same display name then produced byte-identical screens, so someone
 * who signed out and signed in again could not tell which account they were
 * looking at — and reasonably read an empty new account as the old one
 * misbehaving. The address is what distinguishes them, so it is always shown
 * when we have it.
 */
function identityLine(user: { displayName?: string | null; email?: string | null }): string {
  const name = user.displayName?.trim();
  const email = user.email?.trim();
  if (name && email) return `Signed in as ${name} · ${email}`;
  const who = name || email;
  return who ? `Signed in as ${who}` : 'Signed in';
}

/**
 * The navy hero a visitor opens with: the tagline and the subline, and the
 * two ways in, stacked inside it. A signed-in member never sees it again.
 */
function HomeHero({ children }: { children?: ReactNode }) {
  return (
    <View style={kit.hero}>
      <Text style={kit.heroTitle}>Turn your community into a place that moves.</Text>
      <Text style={kit.heroBody}>Shared challenges. More movement. Stronger communities.</Text>
      {children}
    </View>
  );
}

function SignedOutHome({
  joinCodeInput,
  setJoinCodeInput,
  joinFieldError,
  onJoinCodeSubmit,
}: {
  joinCodeInput: string;
  setJoinCodeInput: (v: string) => void;
  joinFieldError: string | null;
  onJoinCodeSubmit: () => void;
}) {
  return (
    <View
      style={styles.stack}
      testID="wsf-home-signed-out"
      {...({ 'data-state': 'signed-out' } as Record<string, unknown>)}
    >
      <HomeHero>
        <View style={styles.heroActions}>
          <ButtonLink
            href="/signup"
            style={kit.primaryButton}
            textStyle={kit.primaryButtonText}
            testID="wsf-home-signup"
            label="Create an account"
          />
          <ButtonLink
            href="/signin"
            style={kit.secondaryButtonOnNavy}
            textStyle={kit.secondaryButtonOnNavyText}
            testID="wsf-home-signin"
            label="Sign in"
          />
        </View>
      </HomeHero>
      <JoinWithCodeField
        title="Join with a code"
        value={joinCodeInput}
        onChange={setJoinCodeInput}
        onSubmit={onJoinCodeSubmit}
        error={joinFieldError}
      />
    </View>
  );
}

/**
 * ONE NAVIGATION ASKS HOME NOT TO OPEN A COMMUNITY.
 *
 * Home opening the member's community is right almost always, and stays the
 * default. It is wrong in one place: after a create whose result never came
 * back. `wsfCreateCommunity` has no attempt key, so a member who already has a
 * community and then loses the response is sent to the REMEMBERED one and
 * cannot tell whether the new one exists — the two outcomes render the same
 * screen. `/?view=communities` is how that one navigation asks for the list it
 * needs instead.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not a preference: nothing is written,
 * nothing is remembered, and bare `/` behaves exactly as it did. It is not a
 * new surface either — the list it reveals is the one `SignedInHome` already
 * renders, from the same authenticated read. And it never selects a community
 * on the member's behalf: it removes a selection, it does not make one.
 *
 * Anything other than the exact value keeps today's behaviour, including an
 * absent param, an unrecognised one, and the array expo-router hands back for
 * a repeated `?view=`. An opt-in that could be triggered by accident would be
 * a change to the default wearing a query string.
 */
const VIEW_COMMUNITIES = 'communities';

function wantsCommunityList(view: string | string[] | undefined): boolean {
  return view === VIEW_COMMUNITIES;
}

/**
 * Signed in, the page is the member's communities and nothing above them.
 * With at least one community the card is the primary action and the two
 * ways to add another sit below it as secondaries; with none, starting one
 * is the primary and the join card stays.
 */
function SignedInHome({
  state,
  goalsByGroup,
  joinCodeInput,
  setJoinCodeInput,
  joinFieldError,
  onJoinCodeSubmit,
}: {
  state: MyCommunitiesState;
  goalsByGroup: Record<string, CardGoalState>;
  joinCodeInput: string;
  setJoinCodeInput: (v: string) => void;
  joinFieldError: string | null;
  onJoinCodeSubmit: () => void;
}) {
  const { user } = useWsfAuth();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const listRequested = wantsCommunityList(view);
  const noCommunityYet = state.kind === 'ready' && state.items.length === 0;
  // HOME OPENS THE COMMUNITY. Replace rather than push: Home is not a place
  // the member should have to press back through to leave the community they
  // are in. The redirect waits for the real list, so it can never act on a
  // guess, and it runs in an effect rather than during render.
  //
  // Unless this navigation asked for the list. `resolveCurrentCommunity` is
  // still called and still reads what it reads — only the redirect is skipped,
  // so nothing the member has opened before is forgotten by passing through
  // here.
  //
  // DECIDED ONCE, ON WHAT IS FIRST READ FOR THIS ACCOUNT. A later re-read (a
  // genuine return to this screen, above) replaces figures on the screen the
  // member is looking at; it never moves them. A member who left a create
  // mid-flight and came Home stays on Home when it lands (M5), and a member
  // who pressed Back from a community to see the list gets the list, not the
  // community again. A different account decides afresh.
  const uid = user?.uid ?? null;
  const decided = useRef<{ uid: string | null; openable: string | null } | null>(null);
  if (state.kind === 'ready' && (decided.current === null || decided.current.uid !== uid)) {
    decided.current = {
      uid,
      openable: resolveCurrentCommunity(uid, state.items.map((item) => item.groupId)),
    };
  }
  const resolved = decided.current?.uid === uid ? decided.current.openable : null;
  const openable = listRequested ? null : resolved;
  useEffect(() => {
    if (openable) router.replace(`/community/${openable}`);
  }, [openable]);
  // THE REQUEST HAS TO SURVIVE IN THE ADDRESS, because a reload re-derives
  // this screen from the address alone. Arriving here from a focused flow
  // (the unconfirmed-create screen's "Check your communities") pushes a new
  // tab navigator whose target exists only as a navigate payload, and Expo
  // Router writes the address from that payload with the query dropped: the
  // member sees the list at `/`, and a reload opens the remembered community
  // instead. Setting the param on this route commits the navigators' state,
  // so the address is recomputed from the screen actually shown. The value is
  // the one already asked for; nothing is added and nothing is remembered.
  const navigation = useNavigation();
  useEffect(() => {
    if (listRequested) navigation.setParams({ view: VIEW_COMMUNITIES } as never);
  }, [listRequested, navigation]);
  if (openable) {
    return (
      <View
        style={styles.stack}
        testID="wsf-home-opening-community"
        {...({ 'data-state': 'opening' } as Record<string, unknown>)}
      >
        <Text style={kit.statusText}>Opening your community…</Text>
      </View>
    );
  }
  const joinField = (
    <JoinWithCodeField
      title={noCommunityYet ? 'Join with a code' : 'Join another community'}
      value={joinCodeInput}
      onChange={setJoinCodeInput}
      onSubmit={onJoinCodeSubmit}
      error={joinFieldError}
    />
  );
  return (
    <View
      style={styles.stack}
      testID="wsf-home-signed-in"
      {...({ 'data-state': 'signed-in' } as Record<string, unknown>)}
    >
      {/*
        HOME IS A COMMUNITY, NOT A DIRECTORY.

        When the member is in exactly one community — or in several and last
        opened one of them — Home opens THAT community rather than a list of
        cards to pick from. The list is still here, but only for the case it
        was ever the right answer for: somebody in several communities who
        has not chosen one yet.
      */}
      <View style={styles.section}>
        <Text style={kit.eyebrow}>Choose a community</Text>
        <MyCommunitiesList state={state} goalsByGroup={goalsByGroup} />
      </View>

      {noCommunityYet ? (
        <>
          <ButtonLink
            href="/start-community"
            style={kit.primaryButton}
            textStyle={kit.primaryButtonText}
            testID="wsf-home-start"
            label="Start a community"
          />
          {joinField}
        </>
      ) : (
        <>
          {joinField}
          <ButtonLink
            href="/start-community"
            style={kit.secondaryButton}
            textStyle={kit.secondaryButtonText}
            testID="wsf-home-start"
            label="Start a community"
          />
        </>
      )}
    </View>
  );
}

function MyCommunitiesList({
  state,
  goalsByGroup,
}: {
  state: MyCommunitiesState;
  goalsByGroup: Record<string, CardGoalState>;
}) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <View
        testID="wsf-home-my-loading"
        {...({ 'data-state': 'loading' } as Record<string, unknown>)}
      >
        <Text style={kit.statusText}>Loading your communities…</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View
        testID="wsf-home-my-error"
        {...({ 'data-state': 'error' } as Record<string, unknown>)}
      >
        <Text style={kit.errorText}>{state.message}</Text>
      </View>
    );
  }
  if (state.items.length === 0) {
    return (
      <View
        style={kit.cardQuiet}
        testID="wsf-home-my-empty"
        {...({ 'data-state': 'empty' } as Record<string, unknown>)}
      >
        <Text style={kit.body}>You're not in a community yet.</Text>
      </View>
    );
  }
  return (
    <View
      style={styles.list}
      testID="wsf-home-my-list"
      {...({ 'data-state': 'ready' } as Record<string, unknown>)}
    >
      {orderByUserValue(state.items, goalsByGroup).map((item) => (
        <CommunityCard
          key={item.groupId}
          item={item}
          goalState={goalsByGroup[item.groupId] ?? { kind: 'loading' }}
        />
      ))}
    </View>
  );
}

/**
 * The order the member reads the list in, not the order the server returned
 * it in: a community with an open goal has something to do in it today, so it
 * comes first, soonest-ending first among those. Everything else keeps the
 * server's order exactly, which is the tiebreak — the sort is stable, so two
 * communities that rank the same never swap.
 *
 * It re-sorts once, when the per-community goal reads land; before that every
 * card is still `loading` and the order is the server's.
 */
function orderByUserValue(
  items: MyCommunityItem[],
  goalsByGroup: Record<string, CardGoalState>
): MyCommunityItem[] {
  const openGoalOf = (item: MyCommunityItem) => {
    const s = goalsByGroup[item.groupId];
    return s && s.kind === 'ok' && s.goal ? s.goal : null;
  };
  return items
    .map((item, index) => ({ item, index, goal: openGoalOf(item) }))
    .sort((a, b) => {
      if (!!a.goal !== !!b.goal) return a.goal ? -1 : 1;
      if (a.goal && b.goal && a.goal.endsAt !== b.goal.endsAt) {
        return a.goal.endsAt < b.goal.endsAt ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * One community, one card, one link. The card answers "what is happening
 * here" in a line and names the next action inside it; the whole card is the
 * way in, so there is nothing else to tap.
 */
function CommunityCard({ item, goalState }: { item: MyCommunityItem; goalState: CardGoalState }) {
  const meta = [
    groupTypeCardLabel(item.groupType),
    roleCardLabel(item.role),
    memberCountLabel(item.memberCount),
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
  const { status, action } = cardStatusAndAction(item, goalState);
  return (
    <Link
      href={`/community/${item.groupId}` as never}
      style={COMMUNITY_CARD}
      testID={`wsf-home-community-${item.groupId}`}
    >
      <View style={styles.cardBody}>
        <Text style={kit.cardTitle}>
          {item.displayName}
          {item.isSample ? (
            <>
              {' · '}
              <Text style={kit.badge}>Sample</Text>
            </>
          ) : null}
        </Text>
        {meta ? <Text style={kit.cardMeta}>{meta}</Text> : null}
        <Text style={kit.body}>{status}</Text>
        <Text style={styles.cardAction}>{action}</Text>
      </View>
    </Link>
  );
}

/**
 * The honest one-line status and the one contextual action of a card.
 *   open goal            → "<title> · <total> of <target> <unit>", Contribute
 *   no open goal         → "No goal running yet", Start a goal (Champion) / Open
 *   read failed          → the challenge line the list carries, Open
 *   read not yet settled → a quiet checking line, Open
 * A goal that reached its target stays open and stays "Contribute": the
 * people still contributing to it are the point.
 */
function cardStatusAndAction(
  item: MyCommunityItem,
  goalState: CardGoalState
): { status: string; action: string } {
  if (goalState.kind === 'ok' && goalState.goal) {
    const goal = goalState.goal;
    const progress =
      typeof goal.sharedTotal === 'number'
        ? totalOfTargetLabel(goal.sharedTotal, goal.target, goal.unit)
        : `goal of ${formatCount(goal.target)} ${goal.unit}`;
    return { status: `${goal.title} · ${progress}`, action: 'Contribute' };
  }
  if (goalState.kind === 'ok') {
    // Community Home's Champion is the founding Champion; the same person is
    // offered the same next step here.
    const isChampion = item.role === 'foundingChampion';
    return { status: 'No goal running yet', action: isChampion ? 'Start a goal' : 'Open' };
  }
  if (goalState.kind === 'failed') {
    return {
      status: item.activeChallenge
        ? `${item.activeChallenge.title} — ${challengeParticipationLabel(item.activeChallenge.participantCount, item.activeChallenge.completedCount)}`
        : 'No active challenge yet',
      action: 'Open',
    };
  }
  return { status: 'Checking for an open goal…', action: 'Open' };
}

function JoinWithCodeField({
  title,
  value,
  onChange,
  onSubmit,
  error,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <View style={kit.card} testID="wsf-home-join-field">
      <Text style={kit.cardTitle}>{title}</Text>
      <View style={styles.joinRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Paste a join code"
          placeholderTextColor={wsfTheme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[kit.input, styles.joinInput]}
          testID="wsf-home-join-input"
          onSubmitEditing={onSubmit}
        />
        <Pressable
          onPress={onSubmit}
          disabled={!value.trim()}
          style={[kit.secondaryButton, !value.trim() ? kit.primaryButtonDisabled : null]}
          testID="wsf-home-join-submit"
          accessibilityRole="button"
        >
          <Text style={kit.secondaryButtonText}>Go</Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={kit.errorText} testID="wsf-home-join-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// Layout that only this screen needs; every colour, radius and type size
// comes from the kit.
const styles = StyleSheet.create({
  // A state's contents stack with the same rhythm as the page column.
  stack: { gap: 18 },
  section: { gap: 12 },
  // Consecutive cards in a list: the same rhythm as the challenge page.
  list: { gap: 12 },
  // The two ways in sit inside the hero, under the subline.
  heroActions: { gap: 10, marginTop: 8 },
  cardBody: { gap: 4 },
  // The card's one action, named at the foot of the card. The whole card is
  // the link, so this is a label on it, not a second control.
  // Not underlined: an underlined navy line is this product's tertiary LINK
  // control, and this is not a link — the whole card is the link, and it goes
  // to Community Home whatever this line says. It names the next step waiting
  // there; it must not look like a second destination.
  cardAction: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  // The field and Go share a row; the field gives way first so the row can
  // never push past a 195 px viewport.
  joinRow: { flexDirection: 'row', gap: 10 },
  joinInput: { flex: 1, minWidth: 0 },
  // The utility footer: a hairline, then the quiet controls, centred and
  // wrapping so nothing pushes past a narrow viewport.
  utility: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 16,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  utilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
});

// A community card is a Link (a text anchor on web) wearing the card look.
// `display: 'flex'` makes the anchor the card's own box, so its border wraps
// the whole card and the anchor measures the card's full height. Flattened
// once, at module scope, so the Link gets one plain object.
const COMMUNITY_CARD = StyleSheet.flatten([
  kit.card,
  {
    display: 'flex' as const,
    // The anchor is a text element, so its flex direction would default to
    // row and the card body could not shrink below its longest line.
    // Column makes the body a stretched item that wraps within the card.
    flexDirection: 'column' as const,
    color: NAVY,
    textDecorationLine: 'none' as const,
  },
]);
// The tertiary control sits left by default; the footer centres it. Flat
// (never an array) because ButtonLink passes it straight to the anchor.
const UTILITY_CONTROL = StyleSheet.flatten([kit.tertiaryButton, { alignSelf: 'center' as const }]);
