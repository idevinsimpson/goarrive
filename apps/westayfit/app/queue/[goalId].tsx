import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { SecondaryLink, StatusText } from '../../src/AuthFormPrimitives';
import { useWsfAuth } from '../../src/auth';
import { describeCallableError } from '../../src/callableErrors';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { announceYourTurn, describePlaceInLine, type QueueStatus } from '../../src/queueLine';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { CREAM, NAVY, kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * YOUR TURN — the person's own view of the line they are standing in.
 *
 * It answers three things and nothing else: where they are, what the screen in
 * the room will call them, and how to take their name back off it.
 *
 * WHAT IT NEVER SHOWS. Anybody else. Not the names in front of them, not how
 * many of those names are whose, not a uid — `wsfMyQueueEntry` returns the
 * caller's own place and a COUNT of the people ahead, and there is no callable
 * this screen could ask for more.
 *
 * WHAT IT NEVER PRINTS. The raw `position`. That number is an allocation
 * counter, not a place in the line — the people in front may have left — so
 * `describePlaceInLine` turns it into the thing that is actually true: how many
 * are ahead right now.
 *
 * BEING CALLED HAS TO WORK FOR SOMEBODY WHO CANNOT SEE THE SCREEN.
 * `wsf-queue-announce` is a live region that is ALWAYS mounted — a region
 * created at the same moment its text appears is frequently not announced at
 * all — and it becomes assertive only for a turn, so a routine change of place
 * does not interrupt a screen reader mid-sentence. The sentence it carries is
 * the same sentence the screen shows, from `announceYourTurn`, so the two
 * cannot drift.
 *
 * AND WITHOUT ANY ANIMATION. There is none on this screen: not a pulse, not a
 * flash, not a transition. Nothing about a turn depends on motion, which is
 * also what makes `prefers-reduced-motion` a non-question here rather than a
 * media query somebody has to remember.
 */

/** Three seconds. A person glances at this page; the station polls its own
 * state at two, and there is no reason for a pocket to be faster than a hall. */
const MY_ENTRY_POLL_MS = 3_000;

type MyEntry = {
  entryId: string;
  calledName: string;
  position: number;
  status: QueueStatus;
  ahead: number;
  calledByLabel: string | null;
};

type QueueScreenState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'inLine'; entry: MyEntry }
  | { kind: 'notInLine' }
  | { kind: 'error'; message: string };

export default function QueueScreen() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = typeof params.goalId === 'string' ? params.goalId.trim() : '';
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<QueueScreenState>({ kind: 'loading' });
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  /** Set once the person taps Leave, so a poll already in flight cannot put
   * them back in a line they have just walked out of. */
  const leftRef = useRef(false);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'signedOut' });
      return;
    }
    if (!goalId) {
      setState({ kind: 'notInLine' });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (leftRef.current) return;
      try {
        const fn = httpsCallable<{ goalId: string }, { entry: MyEntry | null }>(
          getFirebaseFunctions(),
          'wsfMyQueueEntry'
        );
        const result = await fn({ goalId });
        if (cancelled || leftRef.current) return;
        const entry = result.data.entry;
        setState(entry ? { kind: 'inLine', entry } : { kind: 'notInLine' });
      } catch (e) {
        if (cancelled || leftRef.current) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          setState({ kind: 'notInLine' });
          return;
        }
        setState((prev) =>
          // A single failed poll says nothing about the line. A page that is
          // already showing somebody their place keeps showing it.
          prev.kind === 'inLine'
            ? prev
            : {
                kind: 'error',
                message: describeCallableError(e, 'We couldn’t check the line. Try again.'),
              }
        );
      }
    };

    void tick();
    timer = setInterval(() => void tick(), MY_ENTRY_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [ready, user, goalId]);

  const onLeave = useCallback(async () => {
    if (state.kind !== 'inLine' || leaving) return;
    const entryId = state.entry.entryId;
    setLeaving(true);
    setLeaveError(null);
    try {
      const fn = httpsCallable<{ entryId: string }, { entryId: string; status: string }>(
        getFirebaseFunctions(),
        'wsfLeaveQueue'
      );
      await fn({ entryId });
      // Taking a name off a screen is unilateral and immediate, so the page
      // says so immediately rather than waiting for the next poll to agree.
      leftRef.current = true;
      setState({ kind: 'notInLine' });
    } catch (e) {
      setLeaveError(describeCallableError(e, 'We couldn’t take you out of the line. Try again.'));
    } finally {
      setLeaving(false);
    }
  }, [state, leaving]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Your turn" testID="wsf-queue-disabled" />;
  }

  const chrome = (
    <View style={kit.chrome}>
      <WsfWordmark variant="navy" height={22} testID="wsf-queue-wordmark" />
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
      'wsf-queue-loading',
      <View style={kit.card}>
        <StatusText>Loading…</StatusText>
      </View>
    );
  }

  if (state.kind === 'signedOut') {
    return page(
      'wsf-queue-signed-out',
      <View style={kit.card}>
        <Text style={kit.cardTitle} {...HEADING}>
          Sign in to see your place
        </Text>
        <Text style={kit.body}>
          The line is yours, so it is behind your own account. Sign in and it will be here.
        </Text>
        <ButtonLink
          href="/signin"
          style={kit.secondaryButton}
          textStyle={kit.secondaryButtonText}
          testID="wsf-queue-signin"
          label="Sign in"
        />
      </View>
    );
  }

  if (state.kind === 'error') {
    return page(
      'wsf-queue-error',
      <View style={kit.card}>
        <Text style={kit.errorText}>{state.message}</Text>
        <SecondaryLink href="/" label="Back to home" />
      </View>
    );
  }

  if (state.kind === 'notInLine') {
    return page(
      'wsf-queue-not-in-line',
      <>
        {/*
          The live region stays mounted in every state. A region created at the
          moment its text appears is frequently never announced at all.
        */}
        <View
          style={styles.announce}
          testID="wsf-queue-announce"
          aria-live="polite"
          {...({ 'aria-atomic': 'true' } as Record<string, unknown>)}
        >
          <Text style={kit.statusText} testID="wsf-queue-place">
            You’re not in the line.
          </Text>
        </View>
        <View style={kit.card}>
          <Text style={kit.cardTitle} {...HEADING}>
            You’re not in the line
          </Text>
          <Text style={kit.body}>
            Nothing of yours is on the screen in the room. You can get back in line from the event
            page whenever you like.
          </Text>
          {goalId ? (
            <ButtonLink
              href={`/event/${goalId}`}
              style={kit.primaryButton}
              textStyle={kit.primaryButtonText}
              testID="wsf-queue-back-to-event"
              label="Back to the event"
            />
          ) : null}
          <SecondaryLink href="/" label="Back to home" />
        </View>
      </>
    );
  }

  const { entry } = state;
  const called = entry.status === 'called';
  const place = describePlaceInLine({
    status: entry.status,
    ahead: entry.ahead,
    stationLabel: entry.calledByLabel,
  });

  return page(
    'wsf-queue-screen',
    <>
      {/*
        THE ANNOUNCEMENT. One region, always mounted, carrying the same
        sentence the screen shows. It is assertive only for a turn — a change
        of place is news, but it is not worth interrupting somebody mid-word.
      */}
      <View
        style={styles.announce}
        testID="wsf-queue-announce"
        aria-live={called ? 'assertive' : 'polite'}
        {...({ 'aria-atomic': 'true' } as Record<string, unknown>)}
      >
        <Text
          style={called ? styles.calledPlace : kit.statusText}
          testID="wsf-queue-place"
        >
          {place}
        </Text>
      </View>

      {called ? (
        <View style={kit.hero} testID="wsf-queue-called">
          <Text style={kit.eyebrowOnNavy}>Your turn</Text>
          <Text style={styles.calledName} testID="wsf-queue-called-name" {...HEADING}>
            {entry.calledName}
          </Text>
          <Text style={kit.heroMeta}>{announceYourTurn(entry.calledByLabel)}</Text>
        </View>
      ) : (
        <View style={kit.hero} testID="wsf-queue-waiting">
          <Text style={kit.eyebrowOnNavy}>In line</Text>
          <Text style={kit.heroTitle} {...HEADING}>
            You’re in the line
          </Text>
          <Text style={kit.heroMeta}>
            Keep this page open, or come back to it. The screen in the room will call you.
          </Text>
        </View>
      )}

      <View style={kit.card}>
        <Text style={kit.cardMeta}>The screen will call you</Text>
        {/*
          What they chose, shown back to them, so nobody is surprised by what a
          room is about to read out.
        */}
        <Text style={styles.chosenName} testID="wsf-queue-called-as">
          {entry.calledName}
        </Text>
        <Text style={kit.caption}>
          Only this name goes on the screen. It is kept with your place in the line and nowhere
          else, and it goes when your place does.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => void onLeave()}
          disabled={leaving}
          style={[kit.secondaryButton, leaving ? kit.primaryButtonDisabled : null]}
          testID="wsf-queue-leave"
          accessibilityRole="button"
          accessibilityState={{ disabled: leaving }}
        >
          <Text style={kit.secondaryButtonText}>
            {leaving ? 'Taking your name off…' : 'Take my name off the screen'}
          </Text>
        </Pressable>
        {leaveError ? (
          <Text style={kit.errorText} testID="wsf-queue-leave-error" aria-live="polite">
            {leaveError}
          </Text>
        ) : null}
        <SecondaryLink href={goalId ? `/event/${goalId}` : '/'} label="Back to the event" />
      </View>
    </>
  );
}

const HEADING = {
  accessibilityRole: 'header' as const,
  ...({ 'aria-level': 1 } as Record<string, unknown>),
};

const styles = StyleSheet.create({
  announce: { width: '100%' },
  // Large enough to read at arm's length while somebody is walking.
  calledPlace: { color: NAVY, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  calledName: {
    color: CREAM,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  chosenName: { color: NAVY, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  actions: { gap: 10 },
});
