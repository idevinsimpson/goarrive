import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { AuthFlagOffPanel } from '../../../src/AuthFlagOffPanel';
import { FormShell, SecondaryLink } from '../../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../../src/featureFlags';
import { getFirebaseFirestore, getFirebaseFunctions } from '../../../src/firebase';
import {
  challengeParticipationLabel,
  groupTypeLabel,
  joinPolicyLabel,
  memberCountLabel,
  roleLabel,
  statusLabel,
} from '../../../src/labels';
import { wsfTheme } from '../../../src/theme';

type GroupDoc = {
  displayName: string;
  groupType: string;
  joinPolicy: string;
  lifecycleStatus: string;
  joinCode?: string;
  isSample?: boolean;
};

type ActiveChallenge = {
  id: string;
  title: string;
  participantCount: number;
  completedCount: number;
  goalTarget: number | null;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notSignedIn' }
  | { kind: 'notMember' }
  | {
      kind: 'ready';
      group: GroupDoc;
      role: string;
      memberCount: number | null;
      isSample: boolean;
      activeChallenge: ActiveChallenge | null;
    }
  | { kind: 'error'; message: string };

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

type MyCommunitiesResponse = { items: MyCommunityItem[] };

type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  startsAt: string;
  endsAt: string;
  aggregateDisplayAuthorized: boolean;
};

type ListGoalsResponse = { goals: ListedGoal[] };

/**
 * Three distinct states, deliberately not two.
 *
 * Catching the error and leaving an empty array made a failed load
 * indistinguishable from a community that genuinely has no goal yet — and the
 * page then told the member "No goal running yet", which is a claim about the
 * community rather than about the request. "We could not load this" and
 * "there is nothing here" are different facts and get different words.
 */
type GoalsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; goals: ListedGoal[] }
  | { kind: 'failed'; message: string };

type ListChallengeResponse = {
  challenge:
    | { id: string; title: string; status: string; goalTarget: number | null }
    | null;
  totals: {
    participantCount: number;
    completedCount: number;
    goalTarget: number | null;
  };
};

export default function CommunityPage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [goalsState, setGoalsState] = useState<GoalsState>({ kind: 'loading' });
  const [goalsReloadToken, setGoalsReloadToken] = useState(0);
  const router = useRouter();
  const [resetting, setResetting] = useState(false);
  const [resetJoinCode, setResetJoinCode] = useState<string | null>(null);
  const [resetOutcome, setResetOutcome] = useState<'idle' | 'done' | 'failed'>('idle');
  // PACKAGE E. Three distinct states, because a failed request does not
  // establish what the server did: it may have saved the change before the
  // connection dropped. `unconfirmed` is that case, and it is not an error
  // message dressed up — it is the honest answer until a read settles it.
  const [displayAuth, setDisplayAuth] = useState<
    | { kind: 'idle' }
    | { kind: 'saving'; goalId: string; intended: boolean }
    | { kind: 'unconfirmed'; goalId: string; intended: boolean }
    | { kind: 'failed'; goalId: string; intended: boolean }
  >({ kind: 'idle' });

  // A response that lands after the screen has moved on must not write into
  // whatever is on screen now. These hold the account and community the screen
  // is currently showing, so a late response can ask whether it still applies
  // before it changes anything.
  const groupIdRef = useRef(groupId);
  const uidRef = useRef<string | null>(user?.uid ?? null);
  useEffect(() => {
    groupIdRef.current = groupId;
    uidRef.current = user?.uid ?? null;
  }, [groupId, user?.uid]);

  const [leaveState, setLeaveState] = useState<
    { kind: 'idle' } | { kind: 'confirming' } | { kind: 'leaving' } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'notSignedIn' });
      return;
    }
    if (!groupId) {
      setState({ kind: 'error', message: 'Missing group id.' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const db = getFirebaseFirestore();
        const functions = getFirebaseFunctions();

        const membershipRef = doc(db, 'wsfMemberships', `${groupId}_${user.uid}`);
        const membershipSnap = await getDoc(membershipRef);
        if (cancelled) return;
        if (!membershipSnap.exists()) {
          setState({ kind: 'notMember' });
          return;
        }
        const membership = membershipSnap.data() as { role: string; membershipStatus: string };
        // D2/D3 DEFECT FOUND AND FIXED IN THIS PACKAGE. This gate used to be
        // existence-only: it read membershipStatus and never looked at it.
        // Removal and voluntary departure both LEAVE the membership document
        // in place and change its status, so a removed person still satisfied
        // `exists()` and this screen rendered for them — community name, the
        // goal list, the invite link, and the Champion controls if their role
        // said foundingChampion. The callables refuse them (proved in
        // functions-westayfit/tests/callable/wsf-admission-controls.test.ts),
        // but this screen is itself a member-only path and was not closing.
        // Anything that is not an active membership is not a membership here.
        if (membership.membershipStatus !== 'active') {
          setState({ kind: 'notMember' });
          return;
        }

        const groupSnap = await getDoc(doc(db, 'wsfCommunityGroups', groupId));
        if (cancelled) return;
        if (!groupSnap.exists()) {
          setState({ kind: 'error', message: 'Community not found.' });
          return;
        }
        const group = groupSnap.data() as GroupDoc;

        // Aggregate totals (memberCount, sample flag, active challenge summary)
        // come from wsfMyCommunities so this page reads exactly one aggregate
        // source. If the caller is a member the item will be present; a race
        // against a fresh join could momentarily miss it, and we fall back to
        // rendering without the count line rather than blocking the page.
        let memberCount: number | null = null;
        let isSample = group.isSample === true;
        let activeChallenge: ActiveChallenge | null = null;
        try {
          const myFn = httpsCallable<Record<string, never>, MyCommunitiesResponse>(
            functions,
            'wsfMyCommunities'
          );
          const myResult = await myFn({});
          if (cancelled) return;
          const item = myResult.data.items.find((i) => i.groupId === groupId);
          if (item) {
            memberCount = item.memberCount;
            isSample = item.isSample;
            activeChallenge = item.activeChallenge;
          }
        } catch {
          // Non-blocking. The page still renders with what we have.
        }

        // If the challenge summary was not populated by wsfMyCommunities (race
        // or callable error), fall back to a direct wsfListChallenge call —
        // that is the source of truth for this group's current challenge and
        // is what the challenge screen itself uses.
        if (!activeChallenge) {
          try {
            const listFn = httpsCallable<{ groupId: string }, ListChallengeResponse>(
              functions,
              'wsfListChallenge'
            );
            const listResult = await listFn({ groupId });
            if (cancelled) return;
            if (listResult.data.challenge) {
              activeChallenge = {
                id: listResult.data.challenge.id,
                title: listResult.data.challenge.title,
                participantCount: listResult.data.totals.participantCount,
                completedCount: listResult.data.totals.completedCount,
                goalTarget: listResult.data.totals.goalTarget,
              };
            }
          } catch {
            // Silent fallback — no challenge card.
          }
        }

        setState({
          kind: 'ready',
          group,
          role: membership.role,
          memberCount,
          isSample,
          activeChallenge,
        });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: e instanceof Error ? e.message : 'Load failed.' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId]);

  // The seam this package exists to add. Every other wsfGoals access is by
  // explicit goalId, so before wsfListGoals a member who did not create the
  // goal had no way to reach it.
  //
  // Its own effect, so a retry is a real action and a failure does not take
  // the rest of the community page down with it. Reset to `loading` on every
  // context change: results from a previous account or community must never
  // be on screen while a different one loads.
  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready || !user || !groupId) return;

    let cancelled = false;
    setGoalsState({ kind: 'loading' });

    (async () => {
      try {
        const fn = httpsCallable<{ groupId: string }, ListGoalsResponse>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const result = await fn({ groupId });
        if (cancelled) return;
        setGoalsState({ kind: 'loaded', goals: result.data.goals ?? [] });
      } catch (e) {
        if (cancelled) return;
        setGoalsState({
          kind: 'failed',
          message: e instanceof Error ? e.message : 'Could not load goals.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId, goalsReloadToken]);

  const inviteUrl = (() => {
    if (state.kind !== 'ready') return null;
    const code = resetJoinCode ?? state.group.joinCode;
    if (!code) return null;
    // D4: public AND inviteOnly are link-joinable. private is not — a general
    // community link never admits anyone there.
    if (state.group.joinPolicy !== 'public' && state.group.joinPolicy !== 'inviteOnly') return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/join/${code}`;
  })();

  const onCopyInvite = useCallback(async () => {
    if (!inviteUrl || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2_000);
    } catch {
      setCopyStatus('failed');
    }
  }, [inviteUrl]);

  /**
   * D1: retire the current link. New admissions through the old one stop; no
   * member is removed and no contribution is touched. The old code then
   * resolves exactly as an unknown code does — for everyone, members included.
   */
  const onResetInvite = useCallback(async () => {
    if (resetting || !groupId) return;
    setResetting(true);
    setResetOutcome('idle');
    try {
      const fn = httpsCallable<{ groupId: string }, { joinCode: string }>(
        getFirebaseFunctions(),
        'wsfResetJoinCode'
      );
      const result = await fn({ groupId });
      setResetJoinCode(result.data.joinCode);
      setCopyStatus('idle');
      setResetOutcome('done');
    } catch {
      // A failure here is NOT cosmetic and must never be swallowed. The reason
      // a Champion resets a link is usually that the old one got somewhere it
      // should not have. Leaving the button to settle back to "Reset link"
      // would let them walk away believing a live link is dead. The old link
      // is still working, and the screen has to say so.
      setResetOutcome('failed');
    } finally {
      setResetting(false);
    }
  }, [groupId, resetting]);

  /**
   * D2: leave a community of your own accord. This is the ONLY one of the
   * membership actions that can be finished inside this package's scope,
   * because it is the only one that acts on the caller themselves —
   * wsfLeaveCommunity takes no target and reads the uid off the token.
   * Removing, reinstating or designating someone else all need that person's
   * account id, and nothing this screen loads yields another member's id.
   *
   * The sole-Champion refusal is deliberately surfaced verbatim rather than
   * hidden by disabling the control: the server's message names what has to
   * happen first, and a greyed-out button would not.
   */
  const onLeave = useCallback(async () => {
    if (!groupId) return;
    setLeaveState({ kind: 'leaving' });
    try {
      const fn = httpsCallable<{ groupId: string }, unknown>(
        getFirebaseFunctions(),
        'wsfLeaveCommunity'
      );
      await fn({ groupId });
      router.replace('/');
    } catch (e) {
      const message =
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message)
          : 'Could not leave this community. Try again.';
      setLeaveState({ kind: 'failed', message });
    }
  }, [groupId, router]);

  /**
   * PACKAGE E. Authorize or revoke this goal's aggregate for the public
   * display. A separate, explicit act — not part of creating a goal — and
   * available only to a Champion, whose authority is scoped to this community.
   *
   * The interesting part is failure. The first version caught any error and
   * told the Champion "Nothing changed" or "It is still on". Neither is a fact
   * a lost response establishes: the server may well have saved it. So a
   * failure is not reported as an outcome. It triggers a READ-BACK of the
   * authoritative value, and only if that also fails does the screen say, in
   * those words, that it could not confirm the setting.
   *
   * `intended` is the explicit value that was asked for, carried through the
   * retry. Retrying by inverting whatever the card currently shows could undo
   * a request that actually succeeded.
   */
  const readStoredDisplayAuth = useCallback(
    async (targetGoalId: string): Promise<boolean | null> => {
      // The authoritative read. wsfListGoals reports the stored permission for
      // every goal this Champion can see, closed ones included. `null` means
      // the read itself did not settle anything — it is not `false`, and it
      // must not be rendered as one.
      try {
        const fn = httpsCallable<{ groupId: string }, ListGoalsResponse>(
          getFirebaseFunctions(),
          'wsfListGoals'
        );
        const result = await fn({ groupId });
        const found = (result.data.goals ?? []).find((g) => g.goalId === targetGoalId);
        if (!found) return null;
        return found.aggregateDisplayAuthorized === true;
      } catch {
        return null;
      }
    },
    [groupId]
  );

  const onSetDisplayAuth = useCallback(
    async (targetGoalId: string, intended: boolean) => {
      // Scoped to this account, this community and this goal. `requestGroupId`
      // and `requestUid` are captured now and compared when the response
      // lands, so a slow response cannot write into a different community's
      // screen or a different signed-in account's.
      const requestGroupId = groupId;
      const requestUid = user?.uid ?? null;
      const stillTheSameContext = () =>
        groupIdRef.current === requestGroupId && uidRef.current === requestUid;

      setDisplayAuth({ kind: 'saving', goalId: targetGoalId, intended });
      try {
        const fn = httpsCallable<
          { goalId: string; authorized: boolean },
          { aggregateDisplayAuthorized: boolean }
        >(getFirebaseFunctions(), 'wsfSetGoalDisplayAuthorization');
        await fn({ goalId: targetGoalId, authorized: intended });
        if (!stillTheSameContext()) return;
        setDisplayAuth({ kind: 'idle' });
        setGoalsReloadToken((n) => n + 1);
      } catch {
        if (!stillTheSameContext()) return;
        // The request did not come back. That is not the same as the change
        // not happening — the server may have saved it before the connection
        // dropped — so read the stored value rather than assert an outcome.
        const stored = await readStoredDisplayAuth(targetGoalId);
        if (!stillTheSameContext()) return;
        if (stored === null) {
          // Both the write and the read-back failed. Nothing is known, and the
          // screen says exactly that.
          setDisplayAuth({ kind: 'unconfirmed', goalId: targetGoalId, intended });
          return;
        }
        // The read-back settled it. Show the stored permission either way, and
        // when it disagrees with what was asked for, say the change did not
        // take effect instead of leaving a silent no-op.
        setGoalsReloadToken((n) => n + 1);
        setDisplayAuth(
          stored === intended
            ? { kind: 'idle' }
            : { kind: 'failed', goalId: targetGoalId, intended }
        );
      }
    },
    [groupId, user?.uid, readStoredDisplayAuth]
  );

  const onShareInvite = useCallback(async () => {
    if (!inviteUrl) return;
    if (typeof navigator === 'undefined' || !('share' in navigator)) return;
    try {
      await (navigator as Navigator & {
        share: (data: ShareData) => Promise<void>;
      }).share({
        title: 'Join our We Stay Fit community',
        url: inviteUrl,
      });
    } catch {
      // User dismissed the share sheet or the browser blocked it — no-op.
    }
  }, [inviteUrl]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Your community" testID="wsf-community-disabled" />;
  }

  if (state.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Your community" testID="wsf-community-loading">
        <View {...({ 'data-state': 'loading' } as Record<string, unknown>)}>
          <Text style={styles.body}>Loading…</Text>
        </View>
      </FormShell>
    );
  }

  if (state.kind === 'notSignedIn') {
    return (
      <FormShell
        heading="Your community"
        intro="Sign in to view this community."
        testID="wsf-community-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  if (state.kind === 'notMember') {
    return (
      <FormShell
        heading="Not a member"
        intro="You are not a member of this community."
        testID="wsf-community-not-member"
      >
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <FormShell heading="Something went wrong" testID="wsf-community-error">
        <View {...({ 'data-state': 'error' } as Record<string, unknown>)}>
          <Text style={styles.error}>{state.message}</Text>
        </View>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  const { group, role, memberCount, isSample, activeChallenge } = state;
  const isChampion = role === 'foundingChampion';
  const hasShareApi = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <View
      style={styles.container}
      testID="wsf-community"
      {...({ 'data-state': 'ready' } as Record<string, unknown>)}
    >
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>Community</Text>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>{group.displayName}</Text>
          {isSample ? (
            <Text style={styles.sampleBadge} testID="wsf-community-sample-badge">
              Sample
            </Text>
          ) : null}
        </View>

        <Row label="Type" value={groupTypeLabel(group.groupType)} testID="wsf-community-type" />
        <Row
          label="Join policy"
          value={joinPolicyLabel(group.joinPolicy)}
          testID="wsf-community-policy"
        />
        <Row
          label="Status"
          value={statusLabel(group.lifecycleStatus)}
          testID="wsf-community-status"
        />
        <Row label="Your role" value={roleLabel(role)} testID="wsf-community-role" />
        {memberCount != null ? (
          <Row
            label="Members"
            value={memberCountLabel(memberCount)}
            testID="wsf-community-member-count"
          />
        ) : null}

        <View style={styles.section} testID="wsf-community-invite">
          <Text style={styles.sectionHeading}>Invite</Text>
          {inviteUrl ? (
            <View>
              <Text
                style={styles.inviteUrl}
                selectable
                testID="wsf-community-invite-url"
              >
                {inviteUrl}
              </Text>
              <Text style={styles.body} testID="wsf-community-invite-caveat">
                {group.joinPolicy === 'inviteOnly'
                  ? 'Anyone with this link can join, including someone it is forwarded to. It keeps working until you reset it.'
                  : 'This community can be found and joined by anyone.'}
              </Text>
              {resetOutcome === 'done' ? (
                <Text style={styles.body} testID="wsf-community-invite-reset-done">
                  The old link no longer works. Share the new one above.
                </Text>
              ) : null}
              {resetOutcome === 'failed' ? (
                <Text style={styles.error} testID="wsf-community-invite-reset-error">
                  The link could not be reset. The link above is still the live
                  one and still lets people join. Try again.
                </Text>
              ) : null}
              <View style={styles.inviteActions}>
                <Pressable
                  onPress={onCopyInvite}
                  style={styles.copyButton}
                  testID="wsf-community-invite-copy"
                  accessibilityRole="button"
                >
                  <Text style={styles.copyButtonText}>
                    {copyStatus === 'copied'
                      ? 'Copied'
                      : copyStatus === 'failed'
                        ? 'Copy failed — long-press the link'
                        : 'Copy link'}
                  </Text>
                </Pressable>
                {isChampion ? (
                  <Pressable
                    onPress={onResetInvite}
                    disabled={resetting}
                    style={styles.shareButton}
                    testID="wsf-community-invite-reset"
                    accessibilityRole="button"
                  >
                    <Text style={styles.shareButtonText}>
                      {resetting ? 'Resetting…' : 'Reset link'}
                    </Text>
                  </Pressable>
                ) : null}
                {hasShareApi ? (
                  <Pressable
                    onPress={onShareInvite}
                    style={styles.shareButton}
                    testID="wsf-community-invite-share"
                    accessibilityRole="button"
                  >
                    <Text style={styles.shareButtonText}>Share</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={styles.body} testID="wsf-community-invite-pending">
              Invite links arrive with the next update.
            </Text>
          )}
        </View>

        <View style={styles.section} testID="wsf-community-goals">
          <Text style={styles.sectionHeading}>Goals</Text>
          {goalsState.kind === 'loading' ? (
            <View
              style={styles.noChallengeCard}
              testID="wsf-community-goals-loading"
              {...({ 'data-state': 'loading' } as Record<string, unknown>)}
            >
              <Text style={styles.body}>Loading goals…</Text>
            </View>
          ) : goalsState.kind === 'failed' ? (
            <View
              style={styles.noChallengeCard}
              testID="wsf-community-goals-error"
              {...({ 'data-state': 'error' } as Record<string, unknown>)}
            >
              <Text style={styles.noChallengeTitle}>Goals are unavailable right now</Text>
              <Text style={styles.body}>
                This is a problem loading them, not a community without goals.
              </Text>
              <Pressable
                onPress={() => setGoalsReloadToken((n) => n + 1)}
                style={styles.copyButton}
                testID="wsf-community-goals-retry"
                accessibilityRole="button"
              >
                <Text style={styles.copyButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : goalsState.goals.length ? (
            goalsState.goals.map((goal) => {
              const goalIsOpen = goal.status === 'active';
              const saving =
                displayAuth.kind === 'saving' && displayAuth.goalId === goal.goalId;
              // Unsettled covers the two cases where the last request left
              // something to say: the outcome is unknown, or it is known and
              // the change did not take. Both carry the value that was asked
              // for, so the retry sends that explicit value — never the
              // inverse of whatever the card happens to be showing, which
              // would undo a request that had in fact succeeded.
              const unsettled =
                (displayAuth.kind === 'unconfirmed' || displayAuth.kind === 'failed') &&
                displayAuth.goalId === goal.goalId
                  ? displayAuth
                  : null;
              // A closed goal keeps no contribution controls, but a display
              // permission granted while it ran is still in force: closing a
              // goal does not revoke it. So the Champion keeps the revoke
              // control on a closed goal that is still authorized, and that is
              // the only control a closed goal carries.
              const showDisplayControl =
                isChampion && (goalIsOpen || goal.aggregateDisplayAuthorized);
              return (
                // Separately created goals stay separate — one card each, with
                // its own unit and window. Nothing here sums or merges them.
                <View key={goal.goalId}>
                  {goalIsOpen ? (
                    <Link
                      href={`/contribute/${goal.goalId}` as never}
                      style={styles.goalCard}
                      testID={`wsf-community-goal-link-${goal.goalId}`}
                    >
                      <View>
                        <Text style={styles.goalTitle}>{goal.title}</Text>
                        <Text style={styles.goalMeta}>
                          {`Goal: ${goal.target} ${goal.unit}`}
                        </Text>
                        <Text style={styles.goalCta}>Add your contribution</Text>
                      </View>
                    </Link>
                  ) : (
                    <View
                      style={styles.goalCard}
                      testID={`wsf-community-goal-closed-${goal.goalId}`}
                      {...({ 'data-state': 'closed' } as Record<string, unknown>)}
                    >
                      <Text style={styles.goalTitle}>{goal.title}</Text>
                      <Text style={styles.goalMeta}>
                        {`Goal: ${goal.target} ${goal.unit}`}
                      </Text>
                      <Text style={styles.goalMeta}>
                        This goal has closed. It is no longer taking
                        contributions.
                      </Text>
                    </View>
                  )}
                  {/*
                    PACKAGE E. Champion-only, and secondary to the goal itself:
                    the goal is the thing, this is a permission about it. The
                    copy describes the permission this application controls. It
                    does not claim anything about screens, saved images or
                    snapshots already shared, which this application cannot
                    reach and cannot speak for.
                  */}
                  {showDisplayControl ? (
                    <View testID={`wsf-goal-display-auth-${goal.goalId}`}>
                      <Text
                        style={styles.body}
                        testID={`wsf-goal-display-auth-state-${goal.goalId}`}
                      >
                        {goal.aggregateDisplayAuthorized
                          ? 'Public display is authorized for this goal. A public display can show the running total only \u2014 never individual contributions or member names.'
                          : 'Public display is not authorized for this goal.'}
                      </Text>
                      <Pressable
                        onPress={() =>
                          onSetDisplayAuth(
                            goal.goalId,
                            unsettled ? unsettled.intended : !goal.aggregateDisplayAuthorized
                          )
                        }
                        disabled={saving}
                        style={styles.copyButton}
                        testID={`wsf-goal-display-auth-toggle-${goal.goalId}`}
                        accessibilityRole="button"
                      >
                        <Text style={styles.copyButtonText}>
                          {saving
                            ? 'Saving\u2026'
                            : unsettled
                              ? unsettled.intended
                                ? 'Try again: authorize public display'
                                : 'Try again: remove public display'
                              : goal.aggregateDisplayAuthorized
                                ? 'Remove public display'
                                : 'Authorize public display'}
                        </Text>
                      </Pressable>
                      {unsettled ? (
                        <Text
                          style={styles.error}
                          testID={`wsf-goal-display-auth-unsettled-${goal.goalId}`}
                        >
                          {unsettled.kind === 'unconfirmed'
                            ? 'We could not confirm this goal\u2019s current display permission. What is shown above may be out of date until this succeeds.'
                            : unsettled.intended
                              ? 'That change did not take effect. Public display is still not authorized for this goal.'
                              : 'That change did not take effect. Public display is still authorized for this goal.'}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          ) : (
            <View
              style={styles.noChallengeCard}
              testID="wsf-community-no-goal"
              {...({ 'data-state': 'empty' } as Record<string, unknown>)}
            >
              <Text style={styles.noChallengeTitle}>No goal running yet</Text>
              <Text style={styles.body}>
                {isChampion
                  ? 'Start one and your community can begin contributing.'
                  : 'Your Champion can start one for this community.'}
              </Text>
            </View>
          )}
          {isChampion && goalsState.kind !== 'failed' ? (
            <Link
              href={`/goals/new?groupId=${encodeURIComponent(groupId)}` as never}
              style={styles.goalStartLink}
              testID="wsf-community-start-goal"
            >
              <Text style={styles.goalStartText}>Start a goal</Text>
            </Link>
          ) : null}
        </View>

        <View style={styles.section} testID="wsf-community-challenge-card">
          <Text style={styles.sectionHeading}>Challenge</Text>
          {activeChallenge ? (
            <Link
              href={`/community/${groupId}/challenge` as never}
              style={styles.challengeCard}
              testID="wsf-community-challenge-link"
            >
              <View>
                <Text style={styles.challengeTitle}>{activeChallenge.title}</Text>
                <Text style={styles.challengeMeta}>
                  {challengeParticipationLabel(
                    activeChallenge.participantCount,
                    activeChallenge.completedCount
                  )}
                </Text>
              </View>
            </Link>
          ) : (
            <View
              style={styles.noChallengeCard}
              testID="wsf-community-no-challenge"
              {...({ 'data-state': 'empty' } as Record<string, unknown>)}
            >
              <Text style={styles.noChallengeTitle}>No challenge running yet</Text>
              <Text style={styles.body}>
                Starting a challenge from the app is coming next.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section} testID="wsf-community-membership">
          <Text style={styles.sectionHeading}>Your membership</Text>
          {leaveState.kind === 'idle' ? (
            <Pressable
              onPress={() => setLeaveState({ kind: 'confirming' })}
              style={styles.copyButton}
              testID="wsf-community-leave"
              accessibilityRole="button"
            >
              <Text style={styles.copyButtonText}>Leave this community</Text>
            </Pressable>
          ) : null}
          {leaveState.kind === 'confirming' ? (
            <View testID="wsf-community-leave-confirm">
              <Text style={styles.body}>
                You will stop seeing this community's goals and can no longer
                contribute to them. What you have already contributed stays
                counted toward the community's totals. You can rejoin with a
                current invite link.
              </Text>
              <View style={styles.inviteActions}>
                <Pressable
                  onPress={onLeave}
                  style={styles.copyButton}
                  testID="wsf-community-leave-confirm-yes"
                  accessibilityRole="button"
                >
                  <Text style={styles.copyButtonText}>Yes, leave</Text>
                </Pressable>
                <Pressable
                  onPress={() => setLeaveState({ kind: 'idle' })}
                  style={styles.shareButton}
                  testID="wsf-community-leave-cancel"
                  accessibilityRole="button"
                >
                  <Text style={styles.shareButtonText}>Stay</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {leaveState.kind === 'leaving' ? (
            <Text style={styles.body} testID="wsf-community-leave-pending">
              Leaving…
            </Text>
          ) : null}
          {leaveState.kind === 'failed' ? (
            <View>
              <Text style={styles.error} testID="wsf-community-leave-error">
                {leaveState.message}
              </Text>
              <Pressable
                onPress={() => setLeaveState({ kind: 'idle' })}
                style={styles.shareButton}
                testID="wsf-community-leave-dismiss"
                accessibilityRole="button"
              >
                <Text style={styles.shareButtonText}>OK</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <SecondaryLink href="/" label="Back to home" />
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
    padding: wsfTheme.spacing.xl,
  },
  inner: {
    maxWidth: 640,
    width: '100%',
  },
  eyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.md,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.lg,
    flexWrap: 'wrap',
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.heading.fontSize,
    fontWeight: wsfTheme.typography.heading.fontWeight,
    lineHeight: wsfTheme.typography.heading.lineHeight,
  },
  sampleBadge: {
    color: wsfTheme.colors.accent,
    fontWeight: '700',
    fontSize: wsfTheme.typography.caption.fontSize,
    borderWidth: 1,
    borderColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: wsfTheme.spacing.sm,
    paddingVertical: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: wsfTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: wsfTheme.colors.border,
  },
  rowLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  rowValue: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
  },
  body: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
  },
  error: {
    color: '#B4232C',
    fontSize: wsfTheme.typography.body.fontSize,
    marginBottom: wsfTheme.spacing.md,
  },
  section: {
    marginTop: wsfTheme.spacing.xl,
  },
  sectionHeading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: wsfTheme.spacing.sm,
  },
  inviteUrl: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontFamily: 'System',
    marginBottom: wsfTheme.spacing.sm,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: wsfTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  copyButton: {
    backgroundColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: wsfTheme.spacing.lg,
    paddingVertical: wsfTheme.spacing.sm,
  },
  copyButtonText: {
    color: wsfTheme.colors.surface,
    fontWeight: '700',
  },
  shareButton: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: wsfTheme.spacing.lg,
    paddingVertical: wsfTheme.spacing.sm,
  },
  shareButtonText: {
    color: wsfTheme.colors.text,
    fontWeight: '600',
  },
  challengeCard: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.md,
    padding: wsfTheme.spacing.md,
    color: wsfTheme.colors.text,
    textDecorationLine: 'none' as const,
  },
  challengeTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: 2,
  },
  challengeMeta: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
  },
  noChallengeCard: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.md,
    padding: wsfTheme.spacing.md,
    backgroundColor: wsfTheme.colors.surface,
  },
  goalCard: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.md,
    padding: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.sm,
    color: wsfTheme.colors.text,
    textDecorationLine: 'none' as const,
  },
  goalTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: 2,
  },
  goalMeta: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
  },
  goalCta: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    marginTop: wsfTheme.spacing.xs,
  },
  goalStartLink: {
    marginTop: wsfTheme.spacing.sm,
    textDecorationLine: 'none' as const,
  },
  goalStartText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  noChallengeTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: wsfTheme.spacing.xs,
  },
});
