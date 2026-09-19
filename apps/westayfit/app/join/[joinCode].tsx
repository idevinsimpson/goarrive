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
import { groupTypeCardLabel, groupTypeLabel } from '../../src/labels';
import {
  clearPendingJoinCode,
  setPendingJoinCode,
} from '../../src/pendingJoinCode';
import {
  clearPendingEventGoal,
  readPendingEventGoal,
  routeAfterJoin,
  setPendingEventGoal,
} from '../../src/stationSession';
import { readEventParam } from '../../src/ui/eventLinks';
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
  const params = useLocalSearchParams<{ joinCode: string; event?: string }>();
  const joinCode = typeof params.joinCode === 'string' ? params.joinCode.trim() : '';
  /**
   * `?event=<goalId>` — set only by the QR on the screen at an event. It names
   * a goal and nothing else: no token, no authority, and nothing that changes
   * who may be admitted. A join that arrives with it finishes at that event's
   * page instead of the community page, which is the difference between
   * someone standing in a hall being shown where to add their part and being
   * dropped somewhere they have to navigate out of.
   */
  const eventGoalId = readEventParam(params.event);
  const { ready, user } = useWsfAuth();

  const [previewState, setPreviewState] = useState<PreviewState>({ kind: 'loading' });
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });

  // Stash the code the moment this page mounts. Signup / verify / profile-setup
  // read it and route back here on success. Cleared once we successfully route
  // into /community/<id>, and when the tab closes.
  useEffect(() => {
    if (joinCode) setPendingJoinCode(joinCode);
  }, [joinCode]);

  // The event rides sessionStorage for the same reason the join code does:
  // signup -> verify -> profile-setup replace this screen, and the round trip
  // returns to `/join/<code>` without the query string it left with.
  useEffect(() => {
    if (eventGoalId) setPendingEventGoal(eventGoalId);
  }, [eventGoalId]);

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
      // Where a finished join lands: the event this visitor scanned into, or —
      // for every join that did not come from an event — exactly where it
      // landed before.
      const destination = routeAfterJoin(result.data.groupId, readPendingEventGoal());
      clearPendingEventGoal();
      router.replace(destination as never);
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

  // The hero meta line is built only from what the preview returns: the type
  // as a card fact (nothing for a plain community, never a placeholder) and
  // the joining condition the callable and rules enforce for that stored
  // policy today. Both sentences are the admission-semantics report's
  // supported wording, read from the joiner's side: a link admits to
  // 'public' and 'inviteOnly' alike, nothing lists or searches communities,
  // and a reset retires the old link for everyone who has not joined yet.
  // An unrecognised policy states no condition rather than guessing one.
  const joiningConditions =
    preview.joinPolicy === 'public'
      ? 'Anyone with the invite link can join. The community is not listed or searchable anywhere, so people need the link.'
      : preview.joinPolicy === 'inviteOnly'
        ? 'Anyone with the invite link can join, including anyone it is forwarded to, until a new invite link is created.'
        : '';
  const typeFact = groupTypeCardLabel(preview.groupType);
  const metaParts = [typeFact, joiningConditions].filter((part): part is string => Boolean(part));
  const metaLine = metaParts.length > 0 ? metaParts.join(' · ') : groupTypeLabel(preview.groupType);

  // The invitation itself: the community's name on the navy hero, with the
  // eyebrow and the joining conditions around it, then what joining means.
  // Same on both sides of sign-in; only the actions under it differ.
  const invitation = (
    <>
      <View style={kit.hero}>
        <Text style={kit.eyebrowOnNavy}>Join a community</Text>
        <Text style={kit.heroTitle}>{preview.displayName}</Text>
        <Text style={kit.heroMeta} testID="wsf-join-meta">
          {metaLine}
        </Text>
      </View>
      <View style={kit.card} testID="wsf-join-meaning">
        <Text style={kit.cardTitle}>What joining means</Text>
        <Text style={kit.body}>See the community’s goals and its shared progress.</Text>
        <Text style={kit.body}>Add your own contributions to the shared total.</Text>
        <Text style={kit.body}>Leave whenever you like.</Text>
      </View>
    </>
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
            {/* No account surprise after the tap: say it before the button. */}
            <Text style={kit.body}>You’ll need a free account first.</Text>
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
            {/*
              A visitor who does not want an account still needs a way off
              this screen. Same control, same words as the signed-in branch
              below, so the decision reads the same on both sides of sign-in.
            */}
            <SecondaryLink href="/" label="Not now — back to home" />
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
            label={`Join ${preview.displayName}`}
            onPress={onJoin}
            submitting={joinState.kind === 'joining'}
            testID="wsf-join-submit"
          />
          <SecondaryLink href="/" label="Not now — back to home" />
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
