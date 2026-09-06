import { Link, useLocalSearchParams } from 'expo-router';
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

  const inviteUrl = (() => {
    if (state.kind !== 'ready') return null;
    if (!state.group.joinCode) return null;
    if (state.group.joinPolicy !== 'public') return null;
    if (typeof window === 'undefined') return null;
    return `${window.location.origin}/join/${state.group.joinCode}`;
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
          {group.joinPolicy === 'public' && inviteUrl ? (
            <View>
              <Text
                style={styles.inviteUrl}
                selectable
                testID="wsf-community-invite-url"
              >
                {inviteUrl}
              </Text>
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
  noChallengeTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: wsfTheme.spacing.xs,
  },
});
