import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../src/callableErrors';
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
import { ButtonLink } from '../../src/ui/ButtonLink';
import { kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

type Preview = {
  displayName: string;
  groupType: 'familyFriends' | 'custom';
  joinPolicy: string;
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
          message: describeCallableError(e, 'We couldn’t load this community. Try again.'),
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
        message: describeCallableError(e, 'We couldn’t join this community. Try again.'),
      });
    }
  }, [joinCode, user]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Join a community" testID="wsf-join-disabled" />;
  }

  if (!joinCode || previewState.kind === 'invalid') {
    return (
      <FormShell heading="This link is not valid" testID="wsf-join-invalid">
        <Text style={kit.body}>
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
        <Text style={kit.body}>
          This link is being opened a lot right now. Wait a moment and try again.
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
  // D6: the preview shows the minimum needed to explain what someone is
  // joining — name, supported type, and the joining conditions. The member
  // count that used to appear here is deliberately gone: a count is
  // information about the community's members, and an invitation preview is
  // not the place to disclose it.
  //
  // Each supported policy states its own condition, and an unrecognised value
  // states none. The two-branch form would have described any unexpected
  // policy as link-only, which understates who can get in — the wrong
  // direction to be wrong in on the screen where someone decides to join.
  const joiningConditions =
    preview.joinPolicy === 'public'
      ? 'Anyone can find and join this community.'
      : preview.joinPolicy === 'inviteOnly'
        ? 'Anyone with this link can join. It keeps working until a Champion resets it.'
        : '';
  const metaLine = joiningConditions ? `${typeLabel} · ${joiningConditions}` : typeLabel;

  // The invitation itself: the community's name on the navy hero, with the
  // eyebrow and the joining conditions around it. Same hero on both sides of
  // sign-in; only the actions under it differ.
  const invitation = (
    <View style={kit.hero}>
      <Text style={kit.eyebrowOnNavy}>Join a community</Text>
      <Text style={kit.heroTitle}>{preview.displayName}</Text>
      <Text style={kit.heroMeta} testID="wsf-join-meta">
        {metaLine}
      </Text>
    </View>
  );

  // Signed out — preview is safe (D4: only shown for link-joinable active
  // groups, i.e. public or inviteOnly; private never previews) so we
  // show it and route to signup/signin. The pending join code sits in
  // sessionStorage; the auth chain reads it and routes back here on success.
  if (!user) {
    return (
      <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
        <View style={kit.column} testID="wsf-join-signed-out">
          <View style={kit.chrome}>
            <WsfWordmark variant="navy" height={22} testID="wsf-join-wordmark" />
          </View>
          {invitation}
          <View style={styles.actions}>
            {/*
              `replace`, not push. If these Links pushed, the join screen would
              stay at the bottom of the stack while signup -> verify-email ->
              profile-setup ran on top. profile-setup then router.replace's
              back to /join/<code> via nextRouteAfterAuth, which mounts a
              SECOND join instance — the strict-mode Playwright locator caught
              exactly this ("resolved to 2 elements"). `replace` swaps the join
              screen out for the auth flow instead; sessionStorage carries the
              pending code across, and the return trip lands on a single join
              instance. Back-button behaviour also stays sane — no one lands
              on a stale signed-out join page after signing up.

              ButtonLink, not a bare Link: on web a Link is a text anchor, so
              the button shape and the 44 px minimum have to live on a
              Pressable. The testID stays on the anchor the spec clicks.
            */}
            <ButtonLink
              href="/signup"
              replace
              style={kit.primaryButton}
              textStyle={kit.primaryButtonText}
              testID="wsf-join-signup"
              label="Sign up to join"
            />
            <ButtonLink
              href="/signin"
              replace
              style={kit.secondaryButton}
              textStyle={kit.secondaryButtonText}
              testID="wsf-join-signin"
              label="Already have an account? Sign in"
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.column} testID="wsf-join-signed-in">
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-join-wordmark" />
        </View>
        {invitation}
        <View style={styles.actions}>
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
    </ScrollView>
  );
}

// Layout only this screen needs: the actions sit a little closer to each
// other than the page's sections do.
const styles = StyleSheet.create({
  actions: { gap: 10 },
});
