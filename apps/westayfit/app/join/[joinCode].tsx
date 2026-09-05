import { Link, router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import {
  ErrorText,
  FormShell,
  SecondaryLink,
  StatusText,
  SubmitButton,
} from '../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import {
  clearPendingJoinCode,
  setPendingJoinCode,
} from '../../src/pendingJoinCode';
import { wsfTheme } from '../../src/theme';

type Preview = {
  displayName: string;
  groupType: 'familyFriends' | 'custom';
  memberCount: number;
};

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'rateLimited' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: Preview };

type JoinState =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'error'; message: string };

export default function JoinPage() {
  const params = useLocalSearchParams<{ joinCode: string }>();
  const joinCode = typeof params.joinCode === 'string' ? params.joinCode.trim() : '';
  const { ready, user } = useWsfAuth();

  const [previewState, setPreviewState] = useState<PreviewState>({ kind: 'loading' });
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });

  // Stash the code the moment this page mounts. Signup / verify / profile-setup
  // read it and route back here on success. Cleared once we successfully route
  // into /community/<id>, and when the tab closes.
  useEffect(() => {
    if (joinCode) setPendingJoinCode(joinCode);
  }, [joinCode]);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!joinCode) {
      setPreviewState({ kind: 'invalid' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const fn = httpsCallable<{ joinCode: string }, Preview>(
          getFirebaseFunctions(),
          'wsfPreviewCommunity'
        );
        const result = await fn({ joinCode });
        if (cancelled) return;
        setPreviewState({ kind: 'ready', preview: result.data });
      } catch (e) {
        if (cancelled) return;
        // The server returns the SAME 'not-found' shape for "unknown code" and
        // "private/non-public group" (see E2 §3.3 oracle test). Both surface
        // here as the same "this link is not valid" state — do not add UI copy
        // that would let a visitor distinguish them.
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          setPreviewState({ kind: 'invalid' });
          return;
        }
        if (e instanceof FirebaseError && e.code === 'functions/resource-exhausted') {
          setPreviewState({ kind: 'rateLimited' });
          return;
        }
        setPreviewState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load community.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [joinCode]);

  const onJoin = useCallback(async () => {
    if (!user) return;
    setJoinState({ kind: 'joining' });
    try {
      const fn = httpsCallable<{ joinCode: string }, { groupId: string; alreadyMember: boolean }>(
        getFirebaseFunctions(),
        'wsfJoinCommunity'
      );
      const result = await fn({ joinCode });
      clearPendingJoinCode();
      router.replace(`/community/${result.data.groupId}`);
    } catch (e) {
      setJoinState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Join failed.',
      });
    }
  }, [joinCode, user]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Join a community" testID="wsf-join-disabled" />;
  }

  if (!joinCode || previewState.kind === 'invalid') {
    return (
      <FormShell heading="This link is not valid" testID="wsf-join-invalid">
        <Text style={styles.body}>
          The link you followed is not valid or is no longer active. Ask the person who shared it
          to send you a new one.
        </Text>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (previewState.kind === 'rateLimited') {
    return (
      <FormShell heading="Too many requests" testID="wsf-join-rate-limited">
        <Text style={styles.body}>
          The join preview is rate-limited right now. Wait a moment and try again.
        </Text>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (previewState.kind === 'error') {
    return (
      <FormShell heading="Something went wrong" testID="wsf-join-error">
        <ErrorText>{previewState.message}</ErrorText>
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (previewState.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Loading community" testID="wsf-join-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  const { preview } = previewState;
  const typeLabel = preview.groupType === 'familyFriends' ? 'Family and friends' : 'Community';
  const memberLabel = preview.memberCount === 1 ? '1 member' : `${preview.memberCount} members`;

  // Signed out — preview is safe (only shown for public+active groups) so we
  // show it and route to signup/signin. The pending join code sits in
  // sessionStorage; the auth chain reads it and routes back here on success.
  if (!user) {
    return (
      <View style={styles.container} testID="wsf-join-signed-out">
        <View style={styles.inner}>
          <Text style={styles.eyebrow}>Join a community</Text>
          <Text style={styles.heading}>{preview.displayName}</Text>
          <Text style={styles.meta}>
            {typeLabel} · {memberLabel}
          </Text>
          <View style={styles.actions}>
            <Link
              href="/signup"
              style={styles.primaryAction}
              testID="wsf-join-signup"
            >
              Sign up to join
            </Link>
            <Link
              href="/signin"
              style={styles.secondaryAction}
              testID="wsf-join-signin"
            >
              Already have an account? Sign in
            </Link>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="wsf-join-signed-in">
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>Join a community</Text>
        <Text style={styles.heading}>{preview.displayName}</Text>
        <Text style={styles.meta}>
          {typeLabel} · {memberLabel}
        </Text>
        {joinState.kind === 'error' ? (
          <ErrorText testID="wsf-join-submit-error">{joinState.message}</ErrorText>
        ) : null}
        <SubmitButton
          label="Join this community"
          onPress={onJoin}
          submitting={joinState.kind === 'joining'}
          testID="wsf-join-submit"
        />
        <SecondaryLink href="/" label="Not now" />
      </View>
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
    marginBottom: wsfTheme.spacing.sm,
  },
  meta: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    marginBottom: wsfTheme.spacing.xl,
  },
  body: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  actions: {
    flexDirection: 'column',
    gap: wsfTheme.spacing.sm,
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
});
