import { Link, router } from 'expo-router';
import { signOut } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFunctions } from '../src/firebase';
import {
  challengeParticipationLabel,
  groupTypeLabel,
  memberCountLabel,
  roleLabel,
} from '../src/labels';
import { wsfTheme } from '../src/theme';

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

// Same validator shape as pendingJoinCode.ts / wsfPreviewCommunity.
const JOIN_CODE_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export default function BrandShell() {
  const { ready, user } = useWsfAuth();
  const [myCommunities, setMyCommunities] = useState<MyCommunitiesState>({ kind: 'idle' });
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
        const fn = httpsCallable<Record<string, never>, { items: MyCommunityItem[] }>(
          getFirebaseFunctions(),
          'wsfMyCommunities'
        );
        const result = await fn({});
        if (cancelled) return;
        setMyCommunities({ kind: 'ready', items: result.data.items });
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof FirebaseError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not load your communities.';
        setMyCommunities({ kind: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

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
    <View style={styles.container} testID="wsf-home">
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>We Stay Fit</Text>
        <Text style={styles.heading}>Turn your community into a place that moves.</Text>
        <Text style={styles.subline}>Shared challenges. More movement. Stronger communities.</Text>

        {!wsfAuthEnabled ? (
          <Text style={styles.body} testID="wsf-home-flag-off">
            We Stay Fit is coming soon. This shell exists so the app can ship, deploy, and be
            verified. It intentionally has no content, no signup, and no reads or writes.
          </Text>
        ) : !ready ? (
          <View testID="wsf-home-loading" data-state="loading">
            <Text style={styles.body}>Loading…</Text>
          </View>
        ) : showSignedIn ? (
          <SignedInHome
            user={user!}
            state={myCommunities}
            joinCodeInput={joinCodeInput}
            setJoinCodeInput={setJoinCodeInput}
            joinFieldError={joinFieldError}
            onJoinCodeSubmit={onJoinCodeSubmit}
            onSignOut={onSignOut}
            signingOut={signingOut}
          />
        ) : (
          <SignedOutHome
            joinCodeInput={joinCodeInput}
            setJoinCodeInput={setJoinCodeInput}
            joinFieldError={joinFieldError}
            onJoinCodeSubmit={onJoinCodeSubmit}
          />
        )}

        <Link href="/health" style={styles.footerLink} testID="wsf-home-build-details">
          Build details
        </Link>
      </View>
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
    <View testID="wsf-home-signed-out" {...({ 'data-state': 'signed-out' } as Record<string, unknown>)}>
      <View style={styles.actions}>
        <Link href="/signup" style={styles.primaryAction} testID="wsf-home-signup">
          Create an account
        </Link>
        <Link href="/signin" style={styles.secondaryAction} testID="wsf-home-signin">
          Sign in
        </Link>
      </View>
      <JoinWithCodeField
        value={joinCodeInput}
        onChange={setJoinCodeInput}
        onSubmit={onJoinCodeSubmit}
        error={joinFieldError}
      />
    </View>
  );
}

function SignedInHome({
  user,
  state,
  joinCodeInput,
  setJoinCodeInput,
  joinFieldError,
  onJoinCodeSubmit,
  onSignOut,
  signingOut,
}: {
  user: { displayName?: string | null; email?: string | null };
  state: MyCommunitiesState;
  joinCodeInput: string;
  setJoinCodeInput: (v: string) => void;
  joinFieldError: string | null;
  onJoinCodeSubmit: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const identity = user.displayName || user.email || 'Signed in';
  return (
    <View testID="wsf-home-signed-in" {...({ 'data-state': 'signed-in' } as Record<string, unknown>)}>
      <Text style={styles.identity} testID="wsf-home-identity">
        {identity}
      </Text>
      <Text style={styles.sectionHeading}>Your communities</Text>
      <MyCommunitiesList state={state} />

      <View style={styles.actions}>
        <Link href="/start-community" style={styles.primaryAction} testID="wsf-home-start">
          Start a community
        </Link>
      </View>

      <JoinWithCodeField
        value={joinCodeInput}
        onChange={setJoinCodeInput}
        onSubmit={onJoinCodeSubmit}
        error={joinFieldError}
      />

      <Pressable
        onPress={onSignOut}
        disabled={signingOut}
        style={styles.signOutRow}
        testID="wsf-home-signout"
        accessibilityRole="button"
      >
        <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </View>
  );
}

function MyCommunitiesList({ state }: { state: MyCommunitiesState }) {
  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <View
        testID="wsf-home-my-loading"
        {...({ 'data-state': 'loading' } as Record<string, unknown>)}
      >
        <Text style={styles.body}>Loading your communities…</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View
        testID="wsf-home-my-error"
        {...({ 'data-state': 'error' } as Record<string, unknown>)}
      >
        <Text style={styles.error}>{state.message}</Text>
      </View>
    );
  }
  if (state.items.length === 0) {
    return (
      <View
        testID="wsf-home-my-empty"
        {...({ 'data-state': 'empty' } as Record<string, unknown>)}
      >
        <Text style={styles.body}>You're not in a community yet.</Text>
      </View>
    );
  }
  return (
    <View
      testID="wsf-home-my-list"
      {...({ 'data-state': 'ready' } as Record<string, unknown>)}
    >
      {state.items.map((item) => (
        <Link
          key={item.groupId}
          href={`/community/${item.groupId}` as never}
          style={styles.communityCard}
          testID={`wsf-home-community-${item.groupId}`}
        >
          <View>
            <Text style={styles.communityName}>
              {item.displayName}
              {item.isSample ? (
                <Text style={styles.sampleBadge}> · Sample</Text>
              ) : null}
            </Text>
            <Text style={styles.communityMeta}>
              {groupTypeLabel(item.groupType)} · {roleLabel(item.role)} ·{' '}
              {memberCountLabel(item.memberCount)}
            </Text>
            <Text style={styles.communityChallenge}>
              {item.activeChallenge
                ? `${item.activeChallenge.title} — ${challengeParticipationLabel(item.activeChallenge.participantCount, item.activeChallenge.completedCount)}`
                : 'No active challenge yet'}
            </Text>
          </View>
        </Link>
      ))}
    </View>
  );
}

function JoinWithCodeField({
  value,
  onChange,
  onSubmit,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <View style={styles.joinField} testID="wsf-home-join-field">
      <Text style={styles.joinLabel}>Join with a code</Text>
      <View style={styles.joinRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Paste a join code"
          placeholderTextColor={wsfTheme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.joinInput}
          testID="wsf-home-join-input"
          onSubmitEditing={onSubmit}
        />
        <Pressable
          onPress={onSubmit}
          disabled={!value.trim()}
          style={[styles.joinButton, !value.trim() ? styles.joinButtonDisabled : null]}
          testID="wsf-home-join-submit"
          accessibilityRole="button"
        >
          <Text style={styles.joinButtonText}>Go</Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.error} testID="wsf-home-join-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: wsfTheme.spacing.md,
  },
  subline: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    lineHeight: wsfTheme.typography.subheading.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  body: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  identity: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
    marginBottom: wsfTheme.spacing.sm,
  },
  sectionHeading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    lineHeight: wsfTheme.typography.subheading.lineHeight,
    marginBottom: wsfTheme.spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.lg,
    marginTop: wsfTheme.spacing.md,
  },
  primaryAction: {
    backgroundColor: wsfTheme.colors.primary,
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.xl,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.xl,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
  },
  communityCard: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.md,
    padding: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.sm,
    color: wsfTheme.colors.text,
    textDecorationLine: 'none' as const,
  },
  communityName: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    marginBottom: 2,
  },
  sampleBadge: {
    color: wsfTheme.colors.accent,
    fontWeight: '700',
    fontSize: wsfTheme.typography.caption.fontSize,
  },
  communityMeta: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    marginBottom: 2,
  },
  communityChallenge: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
  },
  joinField: {
    marginTop: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.lg,
  },
  joinLabel: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
    marginBottom: wsfTheme.spacing.xs,
  },
  joinRow: {
    flexDirection: 'row',
    gap: wsfTheme.spacing.sm,
  },
  joinInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.sm,
    fontSize: wsfTheme.typography.body.fontSize,
    color: wsfTheme.colors.text,
  },
  joinButton: {
    backgroundColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.sm,
    paddingHorizontal: wsfTheme.spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    color: wsfTheme.colors.surface,
    fontWeight: '700',
  },
  signOutRow: {
    paddingVertical: wsfTheme.spacing.md,
  },
  signOutText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerLink: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    marginTop: wsfTheme.spacing.xl,
    textDecorationLine: 'underline',
  },
  error: {
    color: '#B4232C',
    fontSize: wsfTheme.typography.body.fontSize,
    marginTop: wsfTheme.spacing.sm,
  },
});
