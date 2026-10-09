import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../auth';
import { AuthFlagOffPanel } from '../AuthFlagOffPanel';
import { SecondaryLink, StatusText } from '../AuthFormPrimitives';
import { describeCallableError } from '../callableErrors';
import { clearEventReturn } from '../eventReturn';
import { wsfAuthEnabled } from '../featureFlags';
import {
  clearMarkerReturn,
  goalStateLine,
  markerStep,
  markerWays,
  setMarkerReturn,
  type MarkerResolver,
  type ResolvedMarker,
} from '../markerEntry';
import { clearPendingJoinCode } from '../pendingJoinCode';
import { ButtonLink } from './ButtonLink';
import { kit } from './kit';
import { WsfWordmark } from './WsfWordmark';

/**
 * EVERGREEN-MARKER-ENTRY-1 (phase A) — what a printed `/go/<slug>` opens.
 *
 * ONE CONTINUOUS ENTRY, in this order, on one screen:
 *
 *   1. RESOLVE. The server names the community, the featured goal and the
 *      goal's truthful state. An unknown, inactive or refused marker is one
 *      plain "This code isn't active" — the same for every reason.
 *   2. SAY WHAT IS NEEDED, BEFORE ANY MOVEMENT. Signed out: sign in and join
 *      first, then straight back here. Nobody moves first and meets an
 *      account gate afterwards.
 *   3. JOIN, EXPLICITLY. A signed-in non-member gets "Join {community}" — one
 *      tap, the server's own join rules (`wsfJoinViaMarker`).
 *   4. CHOOSE. A member on an open goal: "Move on my phone" (the existing
 *      contribution screen), and "Use a kiosk" ONLY when the marker allows it.
 *
 * NOTHING ON THIS SCREEN QUEUES, TIMES OR CREDITS ANYBODY. Opening it writes
 * nothing; the one write is the explicit Join tap. In queue mode the kiosk
 * way is the existing event screen, whose confirmed name is the only queue
 * write anywhere.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'resolved'; marker: ResolvedMarker };

const INVALID_TITLE = 'This code isn’t active';

export function MarkerEntryScreen({
  slug,
  resolver,
}: {
  /** Already validated; null when the address was not a marker slug. */
  slug: string | null;
  resolver: MarkerResolver;
}) {
  const { ready, user } = useWsfAuth();
  const uid = user?.uid ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [kioskHelp, setKioskHelp] = useState(false);

  useEffect(() => {
    if (!wsfAuthEnabled || !ready) return;
    if (!slug) {
      setPhase({ kind: 'invalid' });
      return;
    }
    let cancelled = false;
    setPhase({ kind: 'loading' });
    resolver
      .resolve(slug)
      .then((marker) => {
        if (!cancelled) setPhase({ kind: 'resolved', marker });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = (e as { code?: unknown })?.code;
        if (code === 'functions/not-found' || code === 'functions/invalid-argument') {
          setPhase({ kind: 'invalid' });
        } else {
          setPhase({ kind: 'error', message: describeCallableError(e, 'We couldn’t open this code. Try again.') });
        }
      });
    return () => {
      cancelled = true;
    };
    // `uid`, not `user`: a token refresh is not a new viewer.
  }, [ready, uid, slug, resolver, attempt]);

  /**
   * THE RETURN IS SPENT ONCE THE VISITOR IS BACK HERE SIGNED IN — and only
   * while this screen is in front. The stack keeps it mounted under the auth
   * screens, and a background copy settling must not consume the return before
   * the terminal auth hop reads it (the rule `event/[goalId]` learned).
   */
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  const signedInResolved = phase.kind === 'resolved' && phase.marker.viewer !== 'signedOut';
  useEffect(() => {
    if (focused && signedInResolved) clearMarkerReturn();
  }, [focused, signedInResolved]);

  /** Arm the return on the way INTO an identity step, and only then. */
  const armReturn = useCallback(() => {
    if (!slug) return;
    // A fresh scan is the destination now; an older invitation or event left
    // in this tab must not outrank it on the terminal hop.
    clearPendingJoinCode();
    clearEventReturn();
    setMarkerReturn(slug);
  }, [slug]);

  const onJoin = useCallback(async () => {
    if (!slug || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      await resolver.join(slug);
      // Re-resolve: the server, not this screen, says they are a member now
      // and what the goal's state is at this moment.
      setAttempt((n) => n + 1);
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      if (code === 'functions/not-found') setPhase({ kind: 'invalid' });
      else setJoinError(describeCallableError(e, 'We couldn’t join you just now. Try again.'));
    } finally {
      setJoining(false);
    }
  }, [joining, resolver, slug]);

  const ways = useMemo(
    () => (phase.kind === 'resolved' ? markerWays(phase.marker) : null),
    [phase]
  );

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Scan to join" testID="wsf-marker-disabled" />;
  }

  const page = (testID: string, children: React.ReactNode) => (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.column} testID={testID}>
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-marker-wordmark" />
        </View>
        {children}
      </View>
    </ScrollView>
  );

  if (phase.kind === 'loading') {
    return page(
      'wsf-marker-loading',
      <View style={kit.card}>
        <StatusText>Loading…</StatusText>
      </View>
    );
  }

  if (phase.kind === 'invalid') {
    return page(
      'wsf-marker-invalid',
      <View style={kit.card}>
        <Text style={kit.cardTitle} accessibilityRole="header" {...({ 'aria-level': 1 } as Record<string, unknown>)}>
          {INVALID_TITLE}
        </Text>
        <Text style={kit.body}>
          It isn’t pointing at a challenge right now. Ask someone at the event, or open the app to
          find your communities.
        </Text>
        <SecondaryLink href="/" label="Back to home" testID="wsf-marker-home" />
      </View>
    );
  }

  if (phase.kind === 'error') {
    return page(
      'wsf-marker-error',
      <View style={kit.card}>
        <Text style={kit.errorText}>{phase.message}</Text>
        <Pressable
          onPress={() => setAttempt((n) => n + 1)}
          style={kit.secondaryButton}
          testID="wsf-marker-retry"
          accessibilityRole="button"
        >
          <Text style={kit.secondaryButtonText}>Try again</Text>
        </Pressable>
        <SecondaryLink href="/" label="Back to home" />
      </View>
    );
  }

  const m = phase.marker;
  const step = markerStep(m);

  const hero = (
    <View style={kit.hero} testID="wsf-marker-hero">
      <Text style={kit.eyebrowOnNavy} testID="wsf-marker-community">
        {m.communityName}
      </Text>
      <Text
        style={kit.heroTitle}
        testID="wsf-marker-goal"
        accessibilityRole="header"
        {...({ 'aria-level': 1 } as Record<string, unknown>)}
      >
        {m.goalTitle}
      </Text>
      <Text style={kit.heroMeta} testID="wsf-marker-state">
        {goalStateLine(m.goalState)}
      </Text>
    </View>
  );

  if (step === 'signIn') {
    return page(
      'wsf-marker-signed-out',
      <>
        {hero}
        <View style={kit.card} testID="wsf-marker-explain">
          <Text style={kit.cardTitle}>Before you move</Text>
          <Text style={kit.body}>
            {`Sign in and join ${m.communityName} first, so what you add is yours and counts. You’ll come straight back here.`}
          </Text>
        </View>
        <View style={styles.actions}>
          <ButtonLink
            href="/signup"
            style={kit.primaryButton}
            textStyle={kit.primaryButtonText}
            testID="wsf-marker-signup"
            label="Create an account"
            onPress={armReturn}
          />
          <ButtonLink
            href="/signin"
            style={kit.secondaryButton}
            textStyle={kit.secondaryButtonText}
            testID="wsf-marker-signin"
            label="Already have an account? Sign in"
            onPress={armReturn}
          />
          <Text style={kit.caption}>
            A new account needs you to confirm your email first. Open the link we send, then come back
            to this page.
          </Text>
          <SecondaryLink href="/" label="Not now — back to home" onPress={clearMarkerReturn} />
        </View>
      </>
    );
  }

  if (step === 'join') {
    const needsVerify = user !== null && !user.emailVerified;
    return page(
      'wsf-marker-join',
      <>
        {hero}
        <View style={kit.card} testID="wsf-marker-join-card">
          <Text style={kit.cardTitle}>{`Join ${m.communityName}`}</Text>
          <Text style={kit.body}>
            {m.goalState === 'open'
              ? 'Join first, then choose how you’ll take part. Nothing starts until you do.'
              : 'Join to follow this community. This challenge isn’t open, so there’s nothing to start yet.'}
          </Text>
          {needsVerify ? (
            <ButtonLink
              href="/verify-email"
              style={kit.primaryButton}
              textStyle={kit.primaryButtonText}
              testID="wsf-marker-verify"
              label="Confirm your email to join"
              onPress={armReturn}
            />
          ) : (
            <Pressable
              onPress={() => void onJoin()}
              disabled={joining}
              style={[kit.primaryButton, joining ? kit.primaryButtonDisabled : null]}
              testID="wsf-marker-join-button"
              accessibilityRole="button"
              accessibilityState={{ disabled: joining }}
            >
              <Text style={kit.primaryButtonText}>{joining ? 'Joining…' : `Join ${m.communityName}`}</Text>
            </Pressable>
          )}
          {joinError ? (
            <>
              <Text style={kit.errorText} testID="wsf-marker-join-error" aria-live="polite">
                {joinError}
              </Text>
              {/* The one other gate a signed-in visitor can meet: no profile
                  yet. The return is armed so finishing it lands back here. */}
              <SecondaryLink href="/profile-setup" label="Finish your profile" onPress={armReturn} />
            </>
          ) : null}
          {user?.email ? (
            <Text style={kit.caption} testID="wsf-marker-account">
              {`Signed in as ${user.email}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          <SecondaryLink href="/" label="Not now — back to home" />
        </View>
      </>
    );
  }

  if (step === 'notOpen') {
    return page(
      'wsf-marker-not-open',
      <>
        {hero}
        <View style={kit.card} testID="wsf-marker-not-open-card">
          <Text style={kit.body}>
            {m.goalState === 'upcoming'
              ? 'This challenge hasn’t started yet, so there’s nothing to add to it right now.'
              : 'There’s nothing to add to this challenge any more. What everyone added stays counted.'}
          </Text>
          {m.communityGroupId ? (
            <ButtonLink
              href={`/community/${encodeURIComponent(m.communityGroupId)}`}
              style={kit.primaryButton}
              textStyle={kit.primaryButtonText}
              testID="wsf-marker-open-community"
              label={`Open ${m.communityName}`}
            />
          ) : null}
        </View>
        <View style={styles.actions}>
          <SecondaryLink href="/" label="Back to home" />
        </View>
      </>
    );
  }

  // step === 'choose'
  return page(
    'wsf-marker-choose',
    <>
      {hero}
      <View style={[kit.card, styles.choice]} testID="wsf-marker-ways">
        <Text style={kit.cardTitle}>How will you take part?</Text>
        <ButtonLink
          href={ways!.phoneRoute}
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-marker-phone"
          label="Move on my phone"
        />
        {ways!.kiosk?.kind === 'queue' ? (
          <ButtonLink
            href={ways!.kiosk.route}
            style={kit.secondaryButton}
            textStyle={kit.secondaryButtonText}
            testID="wsf-marker-kiosk"
            label="Use a kiosk"
          />
        ) : null}
        {ways!.kiosk?.kind === 'guidance' ? (
          <Pressable
            onPress={() => setKioskHelp((v) => !v)}
            style={kit.secondaryButton}
            testID="wsf-marker-kiosk"
            accessibilityRole="button"
            accessibilityState={{ expanded: kioskHelp }}
          >
            <Text style={kit.secondaryButtonText}>Use a kiosk</Text>
          </Pressable>
        ) : null}
        {ways!.kiosk?.kind === 'guidance' && kioskHelp ? (
          <Text style={kit.body} testID="wsf-marker-kiosk-guidance">
            Look for a WE STAY FIT screen at the event and start from it. Scanning this code doesn’t
            save you a place or reserve a screen.
          </Text>
        ) : null}
        {ways!.kiosk?.kind === 'queue' ? (
          <Text style={kit.caption} testID="wsf-marker-kiosk-note">
            You’ll choose the name the screen shows before you’re added to the line.
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <SecondaryLink href="/" label="Back to home" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  choice: { gap: 10, width: '100%' },
});
