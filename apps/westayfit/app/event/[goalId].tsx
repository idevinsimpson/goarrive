import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../src/callableErrors';
import { SecondaryLink, StatusText } from '../../src/AuthFormPrimitives';
import {
  clearDeviceMode,
  decideDeviceEntry,
  readDeviceMode,
  saveDeviceMode,
  type DeviceMode,
} from '../../src/deviceMode';
import type { GoalPulse } from '../../src/displayPulse';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { CALL_NAME_MAX, callNameSuggestions, isUsableCallName } from '../../src/queueName';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { DeviceChoice, SharedScreenNotice } from '../../src/ui/DeviceChoice';
import { kit } from '../../src/ui/kit';
import { wsfTheme } from '../../src/theme';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * EVENT — where an attendee's OWN phone lands after scanning the screen in the
 * room.
 *
 * It is a signpost and deliberately nothing more.
 *
 * BEFORE ANY OF IT, ONE QUESTION: whose screen is this? The same QR is
 * scanned by someone holding their own phone and by someone standing at a
 * device the venue shares between strangers, and nothing in the request tells
 * them apart — so the person is asked, in plain words, before anything signs
 * in, creates an account or calls the server. "My own phone" runs everything
 * below exactly as it ran before. "A shared screen here" hands the device to
 * `/kiosk/<goalId>`, the route that ALREADY implements a shared session — its
 * sign-out on rest, its Finish, its countdown and its reset, none of which is
 * reimplemented or altered here. The answer is one of two words in this
 * browser's localStorage (src/deviceMode.ts) and is never sent anywhere.
 *
 * ADMISSION IS UNTOUCHED BY THE QUESTION. Neither answer admits anybody,
 * shows a join code, or changes what the server will do for whoever signs in.
 *
 * Then the signpost proper. One decision, three answers:
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
 * AND ONE MORE WAY ON, FOR A MEMBER: "Get in line". It opens the name choice —
 * and the name choice is the whole point of it, not a formality on the way to a
 * queue. A queue puts a person's name on a screen in a room full of strangers,
 * so what that screen will say is decided HERE, by them, before they are in it:
 * their profile's first name is offered pre-filled, initials are one tap away,
 * the box is theirs to overwrite, and nothing is sent until they say so. What
 * they choose is stored on their place in the line and nowhere else — it never
 * joins the member profile — and it leaves when their place does.
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

  /**
   * The name choice, which is closed until somebody asks for it. `null` means
   * the control has not been opened; a string is what is currently in the box.
   */
  const [callName, setCallName] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const suggestions = callNameSuggestions(user?.displayName ?? null);

  /**
   * `undefined` until this browser's storage has actually been read.
   *
   * The static export renders this route with no storage at all, so the answer
   * cannot be read during render without the first client render disagreeing
   * with the served HTML (#418, the same hydration rule the kiosk and station
   * screens keep). Until it has been read the screen shows its ordinary
   * loading state, which is what it showed at this moment anyway.
   */
  const [deviceMode, setDeviceMode] = useState<DeviceMode | null | undefined>(undefined);
  useEffect(() => {
    setDeviceMode(readDeviceMode());
  }, []);

  const entry = deviceMode === undefined ? null : decideDeviceEntry({ mode: deviceMode, goalId });
  // The ordinary path runs only once the device has said it is somebody's own.
  const ownPhone = entry?.kind === 'personal';

  const onChoosePersonal = useCallback(() => {
    // A browser that refuses storage still gets the path it just chose; it is
    // simply asked again next time.
    saveDeviceMode('personal');
    setDeviceMode('personal');
  }, []);

  const onChooseShared = useCallback(() => {
    // One derivation of the hand-off address, and the same one the standing
    // answer uses: whether a shared session can be entered at all is the
    // decision function's to make, not this handler's.
    const decided = decideDeviceEntry({ mode: 'shared', goalId });
    if (decided.kind !== 'shared') return;
    saveDeviceMode('shared');
    // Straight into the EXISTING shared session. `replace`, not push: a shared
    // device must not have a personal signpost sitting under its back button.
    // `deviceMode` is deliberately not set here — this screen is leaving, and
    // the standing-answer notice below is for a device that arrives already
    // knowing, not for the tap that just answered.
    router.replace(decided.route as never);
  }, [goalId]);

  const onUseOwnPhoneInstead = useCallback(() => {
    clearDeviceMode();
    setDeviceMode(null);
  }, []);

  const onOpenNameChoice = useCallback(() => {
    setQueueError(null);
    // Pre-filled with the FIRST name and never a surname. An account whose
    // display name is an address yields '' here, and the box simply starts
    // empty rather than handing somebody something the next check refuses.
    setCallName(suggestions.first);
  }, [suggestions.first]);

  const onCloseNameChoice = useCallback(() => {
    setCallName(null);
    setQueueError(null);
  }, []);

  const onJoinQueue = useCallback(async () => {
    if (joining) return;
    const chosen = (callName ?? '').trim();
    if (!isUsableCallName(chosen)) {
      setQueueError(
        'Choose a name for the screen — up to 24 characters, and not an email address.'
      );
      return;
    }
    setJoining(true);
    setQueueError(null);
    try {
      const fn = httpsCallable<{ goalId: string; calledName: string }, { entryId: string }>(
        getFirebaseFunctions(),
        'wsfJoinQueue'
      );
      await fn({ goalId, calledName: chosen });
      // Their own view of the line. `push`, not `replace`: the event page is a
      // reasonable place to come back to.
      router.push(`/queue/${goalId}` as never);
    } catch (e) {
      setQueueError(describeCallableError(e, 'We couldn’t put you in the line. Try again.'));
    } finally {
      setJoining(false);
    }
  }, [callName, goalId, joining]);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ownPhone) return;
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
  }, [ready, user, goalId, ownPhone]);

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

  // ── the device question, before anything else ────────────────────────────
  //
  // Ahead of the membership call, ahead of sign-in, ahead of any account being
  // created. Nothing below this point runs until the device has said it is
  // somebody's own.
  if (entry === null) {
    // Storage has not been read yet — one paint, and the same loading state
    // this screen showed at this moment before.
    return page(
      'wsf-event-loading',
      <View style={kit.card}>
        <StatusText>Loading…</StatusText>
      </View>
    );
  }

  if (entry.kind === 'ask') {
    return page(
      'wsf-event-device-choice',
      <DeviceChoice
        onChoosePersonal={onChoosePersonal}
        onChooseShared={onChooseShared}
        testID="wsf-device-choice"
      />
    );
  }

  if (entry.kind === 'shared') {
    // This device has already said it is shared. It is not offered a personal
    // sign-in at all; it is offered the shared session it belongs to, and the
    // one way back for a phone that answered this by mistake.
    return page(
      'wsf-event-device-shared',
      <SharedScreenNotice
        onContinue={() => router.replace(entry.route as never)}
        onUseOwnPhone={onUseOwnPhoneInstead}
        testID="wsf-device-shared"
      />
    );
  }

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
        {callName === null ? (
          <Pressable
            onPress={onOpenNameChoice}
            style={kit.secondaryButton}
            testID="wsf-event-queue-start"
            accessibilityRole="button"
          >
            <Text style={kit.secondaryButtonText}>Get in line</Text>
          </Pressable>
        ) : null}
        <SecondaryLink href="/" label="Back to home" />
      </View>

      {/*
        THE NAME CHOICE. Not a formality on the way to a queue: it IS the
        feature's one real decision, made by the person it is about, before
        anything of theirs reaches a screen in a room. Nothing is sent until
        they tap.
      */}
      {callName !== null ? (
        <View style={kit.card} testID="wsf-event-queue-panel">
          <Text
            style={kit.cardTitle}
            accessibilityRole="header"
            {...({ 'aria-level': 2 } as Record<string, unknown>)}
          >
            What should the screen call you?
          </Text>
          <Text style={kit.body}>
            This goes on the screen in the room, where everybody can read it. Pick whatever you are
            happy for strangers to see.
          </Text>
          <Text style={kit.fieldLabel}>Name on the screen</Text>
          <TextInput
            value={callName}
            onChangeText={(next) => {
              setCallName(next);
              setQueueError(null);
            }}
            style={kit.input}
            testID="wsf-event-queue-name"
            placeholder="Your first name"
            placeholderTextColor={wsfTheme.colors.textMuted}
            maxLength={CALL_NAME_MAX}
            autoCapitalize="words"
            autoCorrect={false}
            accessibilityLabel="Name on the screen"
          />
          <View style={styles.namePills}>
            {suggestions.first ? (
              <Pressable
                onPress={() => {
                  setCallName(suggestions.first);
                  setQueueError(null);
                }}
                style={[kit.pill, callName === suggestions.first ? kit.pillSelected : null]}
                testID="wsf-event-queue-name-first"
                accessibilityRole="button"
              >
                <Text
                  style={[
                    kit.pillText,
                    callName === suggestions.first ? kit.pillTextSelected : null,
                  ]}
                >
                  {suggestions.first}
                </Text>
              </Pressable>
            ) : null}
            {/*
              INITIALS ARE ONE TAP AND NOT BURIED. A screen that offers an
              empty choice is worse than one that offers none, so this appears
              only when there is something to abbreviate.
            */}
            {suggestions.initials ? (
              <Pressable
                onPress={() => {
                  setCallName(suggestions.initials);
                  setQueueError(null);
                }}
                style={[kit.pill, callName === suggestions.initials ? kit.pillSelected : null]}
                testID="wsf-event-queue-name-initials"
                accessibilityRole="button"
              >
                <Text
                  style={[
                    kit.pillText,
                    callName === suggestions.initials ? kit.pillTextSelected : null,
                  ]}
                >
                  {`Initials only (${suggestions.initials})`}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={kit.caption}>
            It is kept with your place in the line and nowhere else. It never joins your profile,
            and it goes when your place does.
          </Text>
          {queueError ? (
            <Text style={kit.errorText} testID="wsf-event-queue-error" aria-live="polite">
              {queueError}
            </Text>
          ) : null}
          <Pressable
            onPress={() => void onJoinQueue()}
            disabled={joining}
            style={[kit.primaryButton, joining ? kit.primaryButtonDisabled : null]}
            testID="wsf-event-queue-join"
            accessibilityRole="button"
            accessibilityState={{ disabled: joining }}
          >
            <Text style={kit.primaryButtonText}>
              {joining ? 'Getting in line…' : 'Get in line'}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCloseNameChoice}
            style={kit.tertiaryButton}
            testID="wsf-event-queue-cancel"
            accessibilityRole="button"
          >
            <Text style={kit.tertiaryButtonText}>Not now</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  // Wraps rather than squeezes: a chosen name and an initials label are both
  // variable-length strings, and neither may push the other off a 195 px page.
  namePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
