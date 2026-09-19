import { useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { FormShell, SecondaryLink } from '../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFirestore } from '../../src/firebase';
import { wsfTheme } from '../../src/theme';

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

export default function CommunityPage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

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
});
