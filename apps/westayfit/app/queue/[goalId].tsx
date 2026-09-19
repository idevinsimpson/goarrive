import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { SecondaryLink, StatusText } from '../../src/AuthFormPrimitives';
import { useWsfAuth } from '../../src/auth';
import { describeCallableError } from '../../src/callableErrors';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { useFollowAlongSession } from '../../src/followAlongSession';
import { wsfTheme } from '../../src/theme';
import {
  RESULT_VISIBLE_SECONDS,
  TURN_NO_SHOW_MESSAGE,
  describeTurnPlace,
  formatTurnCode,
  isUsableTurnCount,
  turnCountValue,
  type TurnStatus,
} from '../../src/turnContract';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { FollowAlongCard } from '../../src/ui/FollowAlongCard';
import { CREAM, NAVY, kit } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * YOUR TURN — the person's own view of the turn they are standing in.
 *
 * It answers four things and nothing else: where they are, what the screen in
 * the room will call them, THEIR CODE, and what to do next.
 *
 * WHAT IT NEVER SHOWS. Anybody else. Not the names in front of them, not how
 * many of those names are whose, not a uid — `wsfMyTurn` returns the caller's
 * own place and a COUNT of the people ahead, and there is no callable this
 * screen could ask for more.
 *
 * WHAT IT NEVER PRINTS. The raw position. That number is an allocation
 * counter, not a place in the line — the people in front may have left — so
 * `describeTurnPlace` turns it into the thing that is actually true.
 *
 * THE FOUR LIVE STATES, and the one control each of them gets:
 *
 *   waiting  — how many are ahead. Leave, if they want.
 *   assigned — THE STATION, THE CODE, AND “I’M READY”, with the 45 seconds
 *              counting down. This is the state the old queue did not have:
 *              being called used to be a thing that happened TO somebody, with
 *              ten minutes of nothing to do about it.
 *   ready    — walk over. Nothing to tap; the station starts them.
 *   active   — their turn is running, and it can be finished HERE as easily as
 *              at the station: the same attempt, recorded once.
 *
 * AND THEN IT CLEARS ITSELF. Ten seconds of result — the same ten the hall
 * gets — and then every trace of the turn goes from this page too, leaving one
 * quiet line: their own receipt, which stays recoverable however the response
 * that carried it was lost.
 *
 * BEING CALLED HAS TO WORK FOR SOMEBODY WHO CANNOT SEE THE SCREEN.
 * `wsf-queue-announce` is a live region that is ALWAYS mounted — a region
 * created at the same moment its text appears is frequently not announced at
 * all — and it becomes assertive only for a turn, so a routine change of place
 * does not interrupt a screen reader mid-sentence.
 *
 * AND WITHOUT ANY ANIMATION. There is none on this screen: not a pulse, not a
 * flash, not a transition. Nothing about a turn depends on motion, which is
 * also what makes `prefers-reduced-motion` a non-question here rather than a
 * media query somebody has to remember.
 */

/** Three seconds while waiting; one while a 45-second lease is running, because
 * a countdown that lies by three seconds is a countdown nobody trusts. */
const TURN_POLL_MS = 3_000;
const TURN_POLL_FAST_MS = 1_000;

type MyTurn = {
  entryId: string;
  code: string;
  calledName: string;
  status: TurnStatus;
  goalId: string;
  activityUnit: string;
  ahead: number;
  stationLabel: string | null;
  readySecondsLeft: number | null;
  attemptOpen: boolean;
};

type Receipt = { amount: number; unit: string; goalId: string };

type MyTurnResponse = { turn: MyTurn | null; receipt: Receipt | null };

type TurnScreenState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'inLine'; turn: MyTurn; receipt: Receipt | null }
  | { kind: 'notInLine'; receipt: Receipt | null; noShow: boolean }
  | { kind: 'error'; message: string };

export default function QueueScreen() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const router = useRouter();
  const goalId = typeof params.goalId === 'string' ? params.goalId.trim() : '';
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<TurnScreenState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [count, setCount] = useState('');
  /** The just-recorded result, shown for ten seconds and then cleared with
   * everything else this turn put on the page. */
  const [justRecorded, setJustRecorded] = useState<{ amount: number; unit: string } | null>(null);
  /**
   * Set once the person leaves or finishes, so a poll already in flight cannot
   * put them back into a turn they have walked out of.
   */
  const stoppedRef = useRef(false);
  /** True while the person held a live place, so "it is gone" can be told
   * apart from "they were never in it" when a lease lapses under them. */
  const wasLiveRef = useRef(false);
  /**
   * The status of the last live turn this page saw.
   *
   * ONLY AN ASSIGNED TURN CAN LAPSE. The 45-second lease exists on `assigned`
   * and nowhere else — it is the offer to come over, and the server's own
   * recovery only reclaims entries in that state. A turn that was READY or
   * ACTIVE and is now gone was finished, or cancelled by the station; it did
   * not time out.
   */
  const lastLiveStatusRef = useRef<TurnStatus | null>(null);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'signedOut' });
      return;
    }
    if (!goalId) {
      setState({ kind: 'notInLine', receipt: null, noShow: false });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stoppedRef.current) return;
      let nextDelay = TURN_POLL_MS;
      try {
        const fn = httpsCallable<{ goalId: string }, MyTurnResponse>(
          getFirebaseFunctions(),
          'wsfMyTurn'
        );
        const result = await fn({ goalId });
        if (cancelled || stoppedRef.current) return;
        const turn = result.data.turn;
        const receipt = result.data.receipt ?? null;
        if (turn) {
          wasLiveRef.current = true;
          lastLiveStatusRef.current = turn.status;
          if (turn.status === 'assigned') nextDelay = TURN_POLL_FAST_MS;
          setState({ kind: 'inLine', turn, receipt });
        } else {
          // Their place is gone. If they had one a moment ago, did not end it
          // themselves, and it was still only ASSIGNED, the lease lapsed — say
          // so rather than showing the blank "you're not in the line" page and
          // leaving them to guess.
          //
          // AND IF IT HAD GOT FURTHER THAN THAT, IT DID NOT LAPSE. This used
          // to read `wasLiveRef.current` alone, which cannot tell a turn that
          // TIMED OUT from one that was COMPLETED — both end with the turn
          // gone. So somebody who had just finished their turn at a station
          // was told "Your turn timed out. Get back in line and it will call
          // you again", directly above the receipt for the turn they had in
          // fact just done.
          const noShow = wasLiveRef.current && lastLiveStatusRef.current === 'assigned';
          wasLiveRef.current = false;
          lastLiveStatusRef.current = null;
          setState({ kind: 'notInLine', receipt, noShow });
        }
      } catch (e) {
        if (cancelled || stoppedRef.current) return;
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          setState({ kind: 'notInLine', receipt: null, noShow: false });
        } else {
          setState((prev) =>
            // A single failed poll says nothing about the line. A page that is
            // already showing somebody their turn keeps showing it.
            prev.kind === 'inLine'
              ? prev
              : {
                  kind: 'error',
                  message: describeCallableError(e, 'We couldn’t check the line. Try again.'),
                }
          );
        }
      } finally {
        if (!cancelled && !stoppedRef.current) {
          timer = setTimeout(() => void tick(), nextDelay);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready, user, goalId]);

  /** The ten seconds, and then the page forgets the turn entirely. */
  useEffect(() => {
    if (!justRecorded) return;
    const timer = setTimeout(() => setJustRecorded(null), RESULT_VISIBLE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [justRecorded]);

  const onReady = useCallback(async () => {
    if (state.kind !== 'inLine' || busy) return;
    const entryId = state.turn.entryId;
    setBusy(true);
    setActionError(null);
    try {
      const fn = httpsCallable<{ entryId: string }, { status: TurnStatus }>(
        getFirebaseFunctions(),
        'wsfTurnReady'
      );
      const result = await fn({ entryId });
      setState((prev) =>
        prev.kind === 'inLine'
          ? { ...prev, turn: { ...prev.turn, status: result.data.status, readySecondsLeft: null } }
          : prev
      );
    } catch (e) {
      setActionError(describeCallableError(e, 'We couldn’t tell the screen you’re ready.'));
    } finally {
      setBusy(false);
    }
  }, [state, busy]);

  const onRecord = useCallback(async () => {
    if (state.kind !== 'inLine' || busy) return;
    const entryId = state.turn.entryId;
    const value = turnCountValue(count);
    if (value === null) {
      setActionError('Enter how many you did — a whole number.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const fn = httpsCallable<
        { entryId: string; count: number },
        { receipt: { addedCount: number; unit?: string; alreadyRecorded: boolean } }
      >(getFirebaseFunctions(), 'wsfCompleteMyTurn');
      const result = await fn({ entryId, count: value });
      const receipt = result.data.receipt;
      // THE SAME ATTEMPT, RECORDED ONCE. A retry after a lost response lands
      // here with alreadyRecorded, the same number, and nothing added.
      setJustRecorded({ amount: receipt.addedCount, unit: receipt.unit ?? '' });
      setCount('');
      setState({
        kind: 'notInLine',
        receipt: { amount: receipt.addedCount, unit: receipt.unit ?? '', goalId },
        noShow: false,
      });
      wasLiveRef.current = false;
    } catch (e) {
      // NOT stopped, and nothing cleared: if this failed after the server
      // recorded it, the next poll finds the turn finished and the receipt
      // waiting. A retry of the same tap records nothing twice.
      setActionError(describeCallableError(e, 'We couldn’t record that. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [state, busy, count, goalId]);

  /**
   * SWITCH TO MY PHONE — leaving the line and going to do it themselves, as
   * one action rather than two.
   *
   * It frees the event place with `switchingToPhone: true`, which is the same
   * unconditional release an ordinary leave performs: the flag changes only
   * what the row records about WHY, which is the one thing a Champion looking
   * at a wedged event cannot work out afterwards.
   *
   * NOT OFFERED ONCE A STATION HAS STARTED THE ATTEMPT. By then a canonical
   * attempt is open against this turn, and the honest thing to do with it is
   * finish it — on this phone or at the screen, which are the same write under
   * the same key. Walking away from a started turn is the station's "Let them
   * go", not a button on the phone that looks like a shortcut.
   *
   * The place is freed BEFORE the journey opens, so nobody is standing in a
   * line they have already left.
   */
  const onSwitchToPhone = useCallback(async () => {
    if (state.kind !== 'inLine' || busy) return;
    const { entryId, goalId: activityGoalId } = state.turn;
    setBusy(true);
    setActionError(null);
    try {
      const fn = httpsCallable<{ entryId: string; switchingToPhone: boolean }, { status: string }>(
        getFirebaseFunctions(),
        'wsfLeaveTurnLine'
      );
      await fn({ entryId, switchingToPhone: true });
      stoppedRef.current = true;
      wasLiveRef.current = false;
      setState({ kind: 'notInLine', receipt: state.receipt, noShow: false });
      router.replace(`/contribute/${activityGoalId}`);
    } catch (e) {
      setActionError(describeCallableError(e, 'We couldn’t move you to your phone. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [state, busy, router]);

  const onLeave = useCallback(async () => {
    if (state.kind !== 'inLine' || busy) return;
    const entryId = state.turn.entryId;
    setBusy(true);
    setActionError(null);
    try {
      const fn = httpsCallable<{ entryId: string }, { status: string }>(
        getFirebaseFunctions(),
        'wsfLeaveTurnLine'
      );
      await fn({ entryId });
      // Taking a name off a screen is unilateral and immediate, so the page
      // says so immediately rather than waiting for the next poll to agree.
      stoppedRef.current = true;
      wasLiveRef.current = false;
      setState({ kind: 'notInLine', receipt: state.receipt, noShow: false });
    } catch (e) {
      setActionError(describeCallableError(e, 'We couldn’t take you out of the line. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [state, busy]);

  // THE FOLLOW-ALONG, BOUND TO THIS TURN. The hook runs unconditionally and
  // above every early return, because it is a hook; it is simply inert until
  // there is a live turn to run, since a null round id is the player's own
  // "not started".
  //
  // The round id is the ENTRY's id rather than something this screen mints:
  // the turn already has a canonical attempt, bound server-side by
  // wsfStartTurn, and inventing a second id here would be inventing a second
  // round. So nothing is minted and nothing is dropped — hence the two inert
  // callbacks.
  const turnUnit = state.kind === 'inLine' ? state.turn.activityUnit : '';
  const turnRoundId =
    state.kind === 'inLine' && state.turn.status === 'active' ? state.turn.entryId : null;
  const keepRound = useCallback(() => undefined, []);
  const session = useFollowAlongSession({
    unit: turnUnit,
    roundId: turnRoundId,
    onRoundStart: keepRound,
    onRoundReset: keepRound,
    // ONE 60-SECOND ROUND PER TURN. The throughput contract for a line, not a
    // preference — so the two-minute chip is not offered here at all.
    fixedLength: 'short',
  });

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
        {/*
          THE TEN SECONDS, AND THEN NOTHING. What was just recorded, large
          enough to read while walking away — and gone by itself, so no trace
          of a turn is left on a phone somebody hands to a friend.
        */}
        {justRecorded ? (
          <View style={kit.hero} testID="wsf-queue-result">
            <Text style={kit.eyebrowOnNavy}>Recorded</Text>
            <Text style={styles.resultAmount} testID="wsf-queue-result-amount">
              {justRecorded.unit
                ? `${justRecorded.amount} ${justRecorded.unit}`
                : `${justRecorded.amount}`}
            </Text>
            <Text style={kit.heroMeta}>That’s counted. Thank you.</Text>
          </View>
        ) : null}
        <View style={kit.card}>
          <Text style={kit.cardTitle} {...HEADING}>
            {state.noShow ? 'Your turn timed out' : 'You’re not in the line'}
          </Text>
          <Text style={kit.body} testID="wsf-queue-not-in-line-reason">
            {state.noShow
              ? TURN_NO_SHOW_MESSAGE
              : 'Nothing of yours is on the screen in the room. You can get back in line from the event page whenever you like.'}
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
        {/*
          THE RECOVERABLE RECEIPT. It is the last thing on the page and the
          quietest, because it is not what anybody came here for — it is what
          they need when the tap that recorded it never came back.
        */}
        {state.receipt && !justRecorded ? (
          <View style={kit.cardQuiet} testID="wsf-queue-receipt">
            <Text style={kit.cardMeta}>Your last turn here</Text>
            <Text style={kit.body} testID="wsf-queue-receipt-amount">
              {state.receipt.unit
                ? `${state.receipt.amount} ${state.receipt.unit} recorded.`
                : `${state.receipt.amount} recorded.`}
            </Text>
            <Text style={kit.caption}>
              Counted once, whatever happened to the page that recorded it.
            </Text>
          </View>
        ) : null}
      </>
    );
  }

  const { turn } = state;
  const called = turn.status === 'assigned' || turn.status === 'ready';
  const place = describeTurnPlace({
    status: turn.status,
    ahead: turn.ahead,
    stationLabel: turn.stationLabel,
    readySecondsLeft: turn.readySecondsLeft,
  });

  return page(
    'wsf-queue-screen',
    <>
      {/*
        THE ANNOUNCEMENT. One region, always mounted, carrying the same
        sentence the screen shows. It is assertive only for a turn — a change
        of place is news, but it is not worth interrupting somebody mid-word.
      */}
      {/*
        IT IS STILL ALWAYS MOUNTED, and it is now SCREEN-READER ONLY.
        A live region has to exist before its text changes or the change is
        never announced, so this cannot move inside a branch — but the same
        sentence was also the only place the person's POSITION appeared, in
        small type above the hero, while the hero itself said the much less
        useful "You're in the line". The position is the message, so it has
        been promoted into the hero below and this keeps only the announcement.
      */}
      <View
        style={styles.announceHidden}
        testID="wsf-queue-announce"
        aria-live={called ? 'assertive' : 'polite'}
        {...({ 'aria-atomic': 'true' } as Record<string, unknown>)}
      >
        <Text style={kit.statusText} testID="wsf-queue-place">
          {place}
        </Text>
      </View>

      {turn.status === 'waiting' ? (
        <View style={kit.hero} testID="wsf-queue-waiting">
          <Text style={kit.eyebrowOnNavy}>In line</Text>
          {/* WHERE THEY ARE, as the largest thing on the screen. */}
          <Text style={kit.heroTitle} testID="wsf-queue-waiting-place" {...HEADING}>
            {place}
          </Text>
          {/*
            INITIALS ALREADY END IN A FULL STOP. "A.L." inside a sentence that
            adds its own produced "The screen will call you A.L..", on the
            first line of the first screen anybody in the line reads.
          */}
          <Text style={kit.heroMeta} testID="wsf-queue-will-call">
            {`The screen will call you ${turn.calledName}${
              turn.calledName.endsWith('.') ? '' : '.'
            }`}
          </Text>
          <Text style={kit.heroMeta}>
            Keep this page open, or come back to it. You’ll have 45 seconds to say you’re coming.
          </Text>
        </View>
      ) : (
        <View style={kit.hero} testID="wsf-queue-called">
          <Text style={kit.eyebrowOnNavy}>
            {turn.status === 'active' ? 'Your turn is running' : 'Your turn'}
          </Text>
          <Text style={styles.calledName} testID="wsf-queue-called-name" {...HEADING}>
            {turn.calledName}
          </Text>
          {/*
            THE CODE. The same three characters the screen in the room is
            showing beside that name, so two people called Sam each know which
            one is theirs.
          */}
          <Text style={styles.code} testID="wsf-queue-code">
            {formatTurnCode(turn.code)}
          </Text>
          <Text style={kit.heroMeta} testID="wsf-queue-station">
            {turn.stationLabel ? `Go to ${turn.stationLabel}.` : 'Go to the screen in the room.'}
          </Text>
          {/*
            THE 45 SECONDS, ON THE SCREEN. It was only ever in the live region,
            which means the one person under time pressure was the one who
            could not see how much of it was left.
          */}
          {turn.status === 'assigned' && turn.readySecondsLeft !== null ? (
            <Text style={styles.lease} testID="wsf-queue-lease">
              {`${turn.readySecondsLeft}s to say you’re coming`}
            </Text>
          ) : null}
        </View>
      )}

      {/*
        “I’M READY” — the tap the old queue had no way to take. It is the only
        thing on the page while a lease is running, because it is the only
        thing that matters.
      */}
      {turn.status === 'assigned' ? (
        <View style={kit.card} testID="wsf-queue-ready-panel">
          <Text style={kit.cardTitle} {...SUBHEADING}>
            Are you coming?
          </Text>
          <Text style={kit.body}>
            Tap this and the screen holds your place while you walk over. If nobody taps within 45
            seconds the screen moves on, so nobody waits on an empty spot.
          </Text>
          <Pressable
            onPress={() => void onReady()}
            disabled={busy}
            style={[kit.primaryButton, busy ? kit.primaryButtonDisabled : null]}
            testID="wsf-queue-ready"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={kit.primaryButtonText}>{busy ? 'Telling them…' : 'I’m ready'}</Text>
          </Pressable>
        </View>
      ) : null}

      {/*
        THE SAME PLAYER THE STATION RUNS. Not a copy of it and not a phone
        variant of it: `<FollowAlongCard>` on the session from
        `useFollowAlongSession`, which is the one the /move route runs too.
        What differs is the host, and what a host supplies is what happens when
        the round ends — here, the record panel directly below, which stays the
        only control that sends a number anywhere.
      */}
      {turn.status === 'active' ? (
        <View testID="wsf-queue-player">
          <FollowAlongCard
            session={session}
            compact
            testIDPrefix="wsf-queue-move"
            finishedAction={
              <Text style={kit.body} testID="wsf-queue-move-handoff">
                Enter what you counted below.
              </Text>
            }
          />
        </View>
      ) : null}

      {/*
        FINISHING, FROM HERE. The same attempt the station started: recording
        it on this phone and recording it at the station are the same write,
        under the same key, and whichever happens first is the one that counts.
      */}
      {turn.status === 'active' ? (
        <View style={kit.card} testID="wsf-queue-record-panel">
          <Text style={kit.cardTitle} {...SUBHEADING}>
            How many did you do?
          </Text>
          <Text style={kit.body}>
            You can finish here or at the screen — it is the same turn either way, and it is
            counted once.
          </Text>
          <Text style={kit.fieldLabel}>How many</Text>
          <TextInput
            value={count}
            onChangeText={(next) => {
              setCount(next);
              setActionError(null);
            }}
            style={kit.input}
            testID="wsf-queue-count"
            placeholder="30"
            placeholderTextColor={wsfTheme.colors.textMuted}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={6}
            accessibilityLabel="How many"
          />
          <Pressable
            onPress={() => void onRecord()}
            disabled={busy || !isUsableTurnCount(count)}
            style={[
              kit.primaryButton,
              busy || !isUsableTurnCount(count) ? kit.primaryButtonDisabled : null,
            ]}
            testID="wsf-queue-record"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !isUsableTurnCount(count) }}
          >
            <Text style={kit.primaryButtonText}>{busy ? 'Recording…' : 'Record it'}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={kit.card}>
        {/*
          What they chose, shown back to them, so nobody is surprised by what a
          room is about to read out. It used to be headed "The screen will call
          you" — which is now word for word the line in the hero above it, so
          the heading goes and the name and the privacy note stay.
        */}
        <Text style={kit.cardMeta}>Your name on the screen</Text>
        <Text style={styles.chosenName} testID="wsf-queue-called-as">
          {turn.calledName}
        </Text>
        <Text style={kit.caption}>
          Only this name and your code go on the screen. They are kept with your place in the line
          and nowhere else, and they go when your place does.
        </Text>
      </View>

      <View style={styles.actions}>
        {/*
          THE OTHER WAY THROUGH, offered for as long as it is honest to offer
          it: waiting, called, and ready. Once a station has STARTED the
          attempt it is gone — see onSwitchToPhone.
        */}
        {turn.status !== 'active' ? (
          <Pressable
            onPress={() => void onSwitchToPhone()}
            disabled={busy}
            style={[kit.secondaryButton, busy ? kit.primaryButtonDisabled : null]}
            testID="wsf-queue-switch-to-phone"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={kit.secondaryButtonText}>
              {busy ? 'Moving you over…' : 'Use my phone instead'}
            </Text>
          </Pressable>
        ) : null}
        {/* Still here, and now plainly the last resort rather than the only
            thing on offer. */}
        <Pressable
          onPress={() => void onLeave()}
          disabled={busy}
          style={styles.tertiary}
          testID="wsf-queue-leave"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.tertiaryText}>
            {busy ? 'Taking your name off…' : 'Take my name off the screen'}
          </Text>
        </Pressable>
        {actionError ? (
          <Text style={kit.errorText} testID="wsf-queue-leave-error" aria-live="polite">
            {actionError}
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

const SUBHEADING = {
  accessibilityRole: 'header' as const,
  ...({ 'aria-level': 2 } as Record<string, unknown>),
};

const styles = StyleSheet.create({
  announce: { width: '100%' },
  // Large enough to read at arm's length while somebody is walking.
  calledPlace: { color: NAVY, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  tertiary: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  tertiaryText: { color: wsfTheme.colors.textMuted, fontSize: 15, textDecorationLine: 'underline' },
  lease: {
    color: '#F7F5F0',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  /**
   * Present to every assistive technology and to no eye: a live region has to
   * stay mounted to announce, and this one's sentence is shown properly in the
   * hero. Not `display: none` and not `opacity: 0` on a zero box, either of
   * which removes it from the accessibility tree along with the pixels.
   */
  announceHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    top: 0,
    left: 0,
  },
  calledName: {
    color: CREAM,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  code: { color: CREAM, fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: 4 },
  resultAmount: { color: CREAM, fontSize: 40, lineHeight: 46, fontWeight: '800' },
  chosenName: { color: NAVY, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  actions: { gap: 10 },
});
