import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
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
  // PACKAGE E: which goal's display authorization is being changed right now.
  const [displayAuthPending, setDisplayAuthPending] = useState<string | null>(null);
  const [displayAuthError, setDisplayAuthError] = useState<string | null>(null);

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
   * display. Deliberately a separate, explicit act — not part of creating a
   * goal — and available only to a Champion, whose authority is scoped to this
   * community.
   */
  const onSetDisplayAuth = useCallback(
    async (goalId: string, authorized: boolean) => {
      setDisplayAuthPending(goalId);
      setDisplayAuthError(null);
      try {
        const fn = httpsCallable<
          { goalId: string; authorized: boolean },
          { aggregateDisplayAuthorized: boolean }
        >(getFirebaseFunctions(), 'wsfSetGoalDisplayAuthorization');
        await fn({ goalId, authorized });
        setGoalsReloadToken((n) => n + 1);
      } catch {
        setDisplayAuthError(
          authorized
            ? 'Could not turn on the public display for this goal. Nothing changed.'
            : 'Could not turn off the public display for this goal. It is still on.'
        );
      } finally {
        setDisplayAuthPending(null);
      }
    },
    []
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
            goalsState.goals.map((goal) => (
              // Separately created goals stay separate — one card each, with
              // its own unit and window. Nothing here sums or merges them.
              <View key={goal.goalId}>
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
                {/*
                  PACKAGE E. Champion-only, and secondary to the goal itself:
                  the goal is the thing, this is a permission about it. The
                  copy states the consequence plainly rather than naming a
                  setting, because "public display" is what actually happens.
                */}
                {isChampion ? (
                  <View testID={`wsf-goal-display-auth-${goal.goalId}`}>
                    <Text style={styles.body}>
                      {goal.aggregateDisplayAuthorized
                        ? 'This goal\u2019s total can appear on a public display. Individual contributions and member names never do.'
                        : 'This goal\u2019s total is not on any public display.'}
                    </Text>
                    <Pressable
                      onPress={() =>
                        onSetDisplayAuth(goal.goalId, !goal.aggregateDisplayAuthorized)
                      }
                      disabled={displayAuthPending === goal.goalId}
                      style={styles.copyButton}
                      testID={`wsf-goal-display-auth-toggle-${goal.goalId}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.copyButtonText}>
                        {displayAuthPending === goal.goalId
                          ? 'Saving\u2026'
                          : goal.aggregateDisplayAuthorized
                            ? 'Stop showing on a public display'
                            : 'Allow on a public display'}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))
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

        {displayAuthError ? (
          <Text style={styles.error} testID="wsf-goal-display-auth-error">
            {displayAuthError}
          </Text>
        ) : null}

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
