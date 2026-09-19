import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../src/callableErrors';
import { SecondaryLink, StatusText } from '../../src/AuthFormPrimitives';
import type { GoalPulse } from '../../src/displayPulse';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * EVENT — where an attendee's OWN phone lands after scanning the screen in the
 * room.
 *
 * It is a signpost and deliberately nothing more. One decision, three answers:
 *
 *   - SIGNED OUT: create an account, or sign in. Both are the ordinary flows.
 *   - A MEMBER: one clear way on — "Add your part" — to the EXISTING
 *     contribution screen. Recording stays exactly where it already is; this
 *     page writes nothing, counts nothing and confirms nothing.
 *   - SIGNED IN, NOT A MEMBER: told to join the community first, and NEVER
 *     shown a join code. Handing a stranger a code because they stood near a
 *     screen would change who may be admitted, and admission policy is not
 *     this feature's to change. Only the Champion's own surfaces carry an
 *     invite link, exactly as before.
 *
 * MEMBERSHIP IS DECIDED BY THE SERVER, not by this page: `wsfMyContribution`
 * answers an active member (or someone with their own record on this goal) and
 * gives everyone else the same non-enumerating not-found an unknown goal gives.
 * That is the same gate the contribution screen itself already stands behind,
 * so this page cannot offer a way on that the next screen would refuse.
 */

type EventState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'member'; goalTitle: string | null; communityDisplayName: string | null }
  | { kind: 'notMember' }
  | { kind: 'error'; message: string };

export default function EventScreen() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = typeof params.goalId === 'string' ? params.goalId.trim() : '';
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<EventState>({ kind: 'loading' });

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'signedOut' });
      return;
    }
    if (!goalId) {
      setState({ kind: 'notMember' });
      return;
    }

    let cancelled = false;
    (async () => {
      setState({ kind: 'loading' });
      try {
        const functions = getFirebaseFunctions();
        const mineFn = httpsCallable<{ goalId: string }, { ownCredit: number; unit: string }>(
          functions,
          'wsfMyContribution'
        );
        // The membership decision. Its refusal is the whole answer for the
        // not-a-member branch, so it is awaited on its own.
        await mineFn({ goalId });
        if (cancelled) return;

        // Context, and only context. A member is entitled to it, and a failure
        // here changes nothing about what this page offers — it just says
        // less.
        let goalTitle: string | null = null;
        let communityDisplayName: string | null = null;
        try {
          const pulseFn = httpsCallable<{ goalId: string }, GoalPulse>(functions, 'wsfGoalPulse');
          const pulse = await pulseFn({ goalId });
          if (!cancelled) {
            goalTitle = pulse.data.goalTitle;
            communityDisplayName = pulse.data.communityDisplayName;
          }
        } catch {
          // Nothing to say and nothing to fix: the action below does not
          // depend on the goal's name.
        }
        if (cancelled) return;
        setState({ kind: 'member', goalTitle, communityDisplayName });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          // Not a member of this goal's community — or no such goal. The same
          // answer for both, which is exactly why it names neither.
          setState({ kind: 'notMember' });
          return;
        }
        setState({
          kind: 'error',
          message: describeCallableError(e, 'We couldn’t load this event. Try again.'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, goalId]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="At the event" testID="wsf-event-disabled" />;
  }

  const chrome = (
    <View style={kit.chrome}>
      <WsfWordmark variant="navy" height={22} testID="wsf-event-wordmark" />
    </View>
  );

  const page = (testID: string, children: React.ReactNode) => (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.column} testID={testID}>
        {chrome}
        {children}
      </View>
    </ScrollView>
  );

  if (state.kind === 'loading') {
    return page(
      'wsf-event-loading',
      <View style={kit.card}>
        <StatusText>Loading…</StatusText>
      </View>
    );
  }

  if (state.kind === 'signedOut') {
    return page(
      'wsf-event-signed-out',
      <>
        <View style={kit.hero}>
          <Text style={kit.eyebrowOnNavy}>At the event</Text>
          <Text style={kit.heroTitle} accessibilityRole="header" {...({ 'aria-level': 1 } as Record<string, unknown>)}>
            Add your part
          </Text>
          <Text style={kit.heroMeta}>
            You’ll need an account, so what you add is yours and stays yours.
          </Text>
        </View>
        <View style={styles.actions}>
          <ButtonLink
            href="/signup"
            style={kit.primaryButton}
            textStyle={kit.primaryButtonText}
            testID="wsf-event-signup"
            label="Create an account"
          />
          <ButtonLink
            href="/signin"
            style={kit.secondaryButton}
            textStyle={kit.secondaryButtonText}
            testID="wsf-event-signin"
            label="Already have an account? Sign in"
          />
          <SecondaryLink href="/" label="Not now — back to home" />
        </View>
      </>
    );
  }

  if (state.kind === 'error') {
    return page(
      'wsf-event-error',
      <View style={kit.card}>
        <Text style={kit.errorText}>{state.message}</Text>
        <SecondaryLink href="/" label="Back to home" />
      </View>
    );
  }

  if (state.kind === 'notMember') {
    return page(
      'wsf-event-not-member',
      <View style={kit.card}>
        <Text style={kit.cardTitle} accessibilityRole="header" {...({ 'aria-level': 1 } as Record<string, unknown>)}>
          Join the community first
        </Text>
        {/*
          NO JOIN CODE HERE, and no control that asks for one. Who may be
          admitted is the community's decision and is made on the Champion's
          own surfaces; standing next to a screen is not an admission. The
          sentence says what to do and stops.
        */}
        <Text style={kit.body}>
          You’re signed in, but you’re not in the community running this. Ask a Champion to send you
          their invite, then come back to this page.
        </Text>
        <SecondaryLink href="/" label="Back to home" />
      </View>
    );
  }

  return page(
    'wsf-event-member',
    <>
      <View style={kit.hero}>
        <Text style={kit.eyebrowOnNavy}>{state.communityDisplayName ?? 'At the event'}</Text>
        <Text style={kit.heroTitle} accessibilityRole="header" {...({ 'aria-level': 1 } as Record<string, unknown>)}>
          {state.goalTitle ?? 'Add your part'}
        </Text>
        <Text style={kit.heroMeta}>
          Enter the number you counted yourself. Nothing is counted for you.
        </Text>
      </View>
      <View style={styles.actions}>
        {/* The ONE way on, to the contribution screen that already exists. */}
        <ButtonLink
          href={`/contribute/${goalId}`}
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-event-add"
          label="Add your part"
        />
        <SecondaryLink href="/" label="Back to home" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
});
