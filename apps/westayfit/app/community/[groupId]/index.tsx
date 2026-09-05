import { Link, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { AuthFlagOffPanel } from '../../../src/AuthFlagOffPanel';
import { FormShell, SecondaryLink } from '../../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../../src/featureFlags';
import { getFirebaseFirestore, getFirebaseFunctions } from '../../../src/firebase';
import { wsfTheme } from '../../../src/theme';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notSignedIn' }
  | { kind: 'notMember' }
  | { kind: 'ready'; group: GroupDoc; role: string }
  | { kind: 'error'; message: string };

type GroupDoc = {
  displayName: string;
  groupType: 'familyFriends' | 'custom';
  joinPolicy: 'private' | 'inviteOnly';
  lifecycleStatus: string;
};

type ChallengeSummary = { id: string; title: string };

// wsfListChallenge's full response shape lives in the callable; the community
// page only cares whether an active challenge exists and, if so, its id and
// title for the link label. Any failure here is silent: the community page
// itself is fine to render without a challenge link, and re-surfacing a
// listChallenge error would fight the primary "you are in this community"
// message for attention.
type ListChallengeResponse = {
  challenge: ChallengeSummary | null;
};

export default function CommunityPage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [activeChallenge, setActiveChallenge] = useState<ChallengeSummary | null>(null);

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
        setState({
          kind: 'ready',
          group: groupSnap.data() as GroupDoc,
          role: membership.role,
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

  // Ask wsfListChallenge whether this community has an active challenge right
  // now. The link is a peek — the challenge screen re-fetches on its own — so
  // any error here is swallowed and the link simply does not render.
  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready || !user || !groupId) return;
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable<{ groupId: string }, ListChallengeResponse>(
          getFirebaseFunctions(),
          'wsfListChallenge'
        );
        const result = await fn({ groupId });
        if (cancelled) return;
        setActiveChallenge(result.data.challenge ?? null);
      } catch {
        if (cancelled) return;
        setActiveChallenge(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Your community" testID="wsf-community-disabled" />;
  }

  if (state.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Your community" testID="wsf-community-loading">
        <Text style={styles.body}>Loading…</Text>
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
        <Text style={styles.error}>{state.message}</Text>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  const { group, role } = state;
  return (
    <View style={styles.container} testID="wsf-community">
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>Community</Text>
        <Text style={styles.heading}>{group.displayName}</Text>
        <Row label="Type" value={group.groupType === 'familyFriends' ? 'Family and friends' : 'Custom'} />
        <Row label="Join policy" value={group.joinPolicy === 'private' ? 'Private' : 'Invite-only'} />
        <Row label="Status" value={group.lifecycleStatus} />
        <Row label="Your role" value={role} />
        {activeChallenge ? (
          <Link
            href={`/community/${groupId}/challenge` as never}
            style={styles.challengeLink}
            testID="wsf-community-challenge-link"
          >
            Go to challenge: {activeChallenge.title}
          </Link>
        ) : null}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
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
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.heading.fontSize,
    fontWeight: wsfTheme.typography.heading.fontWeight,
    lineHeight: wsfTheme.typography.heading.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
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
  },
  error: {
    color: '#B4232C',
    fontSize: wsfTheme.typography.body.fontSize,
    marginBottom: wsfTheme.spacing.md,
  },
  challengeLink: {
    marginTop: wsfTheme.spacing.xl,
    backgroundColor: wsfTheme.colors.primary,
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.xl,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
  },
});
