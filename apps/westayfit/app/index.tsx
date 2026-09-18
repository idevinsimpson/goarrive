import { Link, router } from 'expo-router';
import { signOut } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { ButtonLink } from '../src/ui/ButtonLink';
import { NAVY, kit } from '../src/ui/kit';
import { WsfWordmark } from '../src/ui/WsfWordmark';

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
    <ScrollView
      style={kit.scroll}
      contentContainerStyle={kit.page}
      keyboardShouldPersistTaps="handled"
      testID="wsf-home"
    >
      <View style={kit.column}>
        {/* Product chrome: the full wordmark, compact. It replaces the old text eyebrow. */}
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-home-wordmark" />
        </View>

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
          <>
            <HomeHero />
            <View testID="wsf-home-loading" data-state="loading">
              <Text style={kit.statusText}>Loading…</Text>
            </View>
          </>
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

        <View style={kit.footer}>
          <ButtonLink
            href="/health"
            style={FOOTER_LINK}
            textStyle={kit.tertiaryButtonText}
            testID="wsf-home-build-details"
            label="Build details"
          />
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * The navy hero every state of the home opens with: the tagline and the
 * subline, and (signed out) the two ways in, stacked inside it.
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
    <View
      style={styles.stack}
      testID="wsf-home-signed-in"
      {...({ 'data-state': 'signed-in' } as Record<string, unknown>)}
    >
      <HomeHero />
      <Text style={[kit.statusText, styles.identity]} testID="wsf-home-identity">
        {identity}
      </Text>

      <View style={styles.section}>
        <Text style={kit.eyebrow}>Your communities</Text>
        <MyCommunitiesList state={state} />
      </View>

      <ButtonLink
        href="/start-community"
        style={kit.primaryButton}
        textStyle={kit.primaryButtonText}
        testID="wsf-home-start"
        label="Start a community"
      />

      <JoinWithCodeField
        value={joinCodeInput}
        onChange={setJoinCodeInput}
        onSubmit={onJoinCodeSubmit}
        error={joinFieldError}
      />

      <Pressable
        onPress={onSignOut}
        disabled={signingOut}
        style={[kit.tertiaryButton, signingOut ? kit.primaryButtonDisabled : null]}
        testID="wsf-home-signout"
        accessibilityRole="button"
      >
        <Text style={kit.tertiaryButtonText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
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
      {state.items.map((item) => (
        <Link
          key={item.groupId}
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
            <Text style={kit.cardMeta}>
              {groupTypeLabel(item.groupType)} · {roleLabel(item.role)} ·{' '}
              {memberCountLabel(item.memberCount)}
            </Text>
            <Text style={kit.body}>
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
    <View style={kit.card} testID="wsf-home-join-field">
      <Text style={kit.cardTitle}>Join with a code</Text>
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
  identity: { fontWeight: '600' },
  section: { gap: 12 },
  // Consecutive cards in a list: the same rhythm as the challenge page.
  list: { gap: 12 },
  // The two ways in sit inside the hero, under the subline.
  heroActions: { gap: 10, marginTop: 8 },
  cardBody: { gap: 4 },
  // The field and Go share a row; the field gives way first so the row can
  // never push past a 195 px viewport.
  joinRow: { flexDirection: 'row', gap: 10 },
  joinInput: { flex: 1, minWidth: 0 },
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
// The tertiary control sits left by default; the footer centres it.
const FOOTER_LINK = StyleSheet.flatten([kit.tertiaryButton, { alignSelf: 'center' as const }]);
