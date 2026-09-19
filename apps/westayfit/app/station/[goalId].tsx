import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { samePulse, type GoalPulse } from '../../src/displayPulse';
import {
  announceHallTurn,
  describeHallResult,
  describeWaitingCount,
  formatTurnCode,
  isUsableTurnCount,
  stationAction,
  stationActionLabel,
  turnCountValue,
  type HallAssignment,
  type HallResult,
  type HallState,
} from '../../src/turnContract';
import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import { useFollowAlongSession } from '../../src/followAlongSession';
import { KIOSK_REFUSAL_BODY, KIOSK_REFUSAL_HEADLINE } from '../../src/kioskSession';
import {
  clearStationCredential,
  credentialForGoal,
  formatPairingCode,
  isStationSlot,
  saveStationCredential,
  type StationSlot,
} from '../../src/stationSession';
import { wsfTheme } from '../../src/theme';
import { PROGRESS_GREEN } from '../../src/ui/brandAssets';
import { formatActiveWindowLabel, formatClock, formatPeriod } from '../../src/ui/dates';
import { buildEventJoinUrlFromScreenedCode, buildEventUrl } from '../../src/ui/eventLinks';
import { FollowAlongCard } from '../../src/ui/FollowAlongCard';
import { kit } from '../../src/ui/kit';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { formatCount, percentLabel, statusLine } from '../../src/ui/progressFormat';
import { encodeQr, qrSvgDataUriRaw } from '../../src/ui/qr';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * STATION — the second screen at an event.
 *
 * THREE MODES, and no fourth:
 *
 *   1. NO CREDENTIAL. The screen prints a six-character pairing code large
 *      enough to read across a hall and waits. A Champion of this goal types
 *      that code into their own Manage sheet and chooses Station 1 or Station
 *      2. The screen polls, claims ONCE, and keeps the credential.
 *   2. A VALID CREDENTIAL. The goal's hero — the same nine published fields
 *      the kiosk and the public display show, from the same server function —
 *      plus two attendee QR codes.
 *   3. A REJECTED CREDENTIAL. Revoked by the Champion, or no longer a station
 *      at all. The screen empties its own storage and falls back to mode 1.
 *
 * AND, SINCE THE TURN CONTRACT, IT RUNS TURNS. "Call next" assigns the oldest
 * place in the line and prints ONE name — the one THAT PERSON CHOSE — beside a
 * short code, and nothing about anybody else: `wsfTurnState` publishes one
 * assigned person, a ten-second result and a COUNT, and this screen has no way
 * to ask for more. The call is announced through an ARIA live region as well
 * as printed, and nothing about a turn depends on an animation: there is none
 * on this screen.
 *
 * WHAT IT CAN NOW DO, AND WHY THAT IS NOT A NEW AUTHORITY. It starts and
 * records the turn it called — the SAME canonical attempt the person's own
 * phone would record, minted by the server and bound to this station, this
 * account and the activity they chose. It still cannot name anybody: the
 * account comes from the entry, written when that person joined the line under
 * their own account, and this screen never supplies a uid. It cannot see more
 * than the public display sees: `wsfStationState` reads the goal through the
 * SAME function `wsfGoalPulse` uses, with no uid, so a goal whose Champion has
 * not authorized public display refuses here and this screen renders the
 * kiosk's refusal, word for word, from src/kioskSession.ts. A station is no
 * more of an oracle than a kiosk.
 *
 * WHAT THE QR CODES ARE. Two ordinary links to pages on an attendee's OWN
 * phone: the existing join link with this event named on it, and this event's
 * page for someone who is already a member. Neither carries a secret, a token
 * or any administrative authority; scanning one enrols no screen and grants no
 * management power, and the pages they open still ask whoever scanned them to
 * sign in as themselves.
 *
 * Layout copies the kiosk deliberately: a flex:1 View rather than a
 * ScrollView, because a screen at an event is a fixed surface nobody scrolls,
 * and a hydration-gated wide breakpoint, because the static export renders the
 * phone layout and the first client render has to match it.
 *
 * WITH ONE CORRECTION, found by looking at a screenshot rather than by
 * reasoning. "A fixed surface nobody scrolls" is true of the venue screen and
 * false of a phone. At 390x640 the fixed surface had the wordmark, the station
 * label, the total, the Call next button and the caption drawn ON TOP OF ONE
 * ANOTHER — flex children shrinking below their content and overflowing, with
 * nowhere to go. So the WIDE canvas stays exactly as it was, and the narrow
 * one scrolls: `flexGrow: 1` keeps it centred when there is room and lets it
 * extend when there is not. A Champion checking a station on their phone is a
 * real person, and overlapping text is not a layout.
 */

/** Same 2 s cadence, and the same reason, as the kiosk and the public display:
 * it matches the server-side cache TTL for the goal pulse. */
const STATE_POLL_MS = 2_000;
/** A Champion has to walk to a screen and type six characters; three seconds
 * is a quick enough answer and a tenth of the state poll's traffic. */
const PAIRING_POLL_MS = 3_000;

/**
 * WHAT THIS SCREEN IS ALLOWED TO KNOW, and it is the whole of it.
 *
 * `wsfTurnState` publishes ONE assigned person — a first name or alias and a
 * short code — a ten-second result carrying a code and a number, and a COUNT.
 * There is no array in this type at any depth, so "the hall shows a column of
 * names" is not something a different argument could produce; it would be a
 * change to a type, and the tests read the type's shape.
 */
type TurnState = HallState;

type PairingPhase =
  | { kind: 'requesting' }
  | { kind: 'waiting'; pairingId: string; code: string }
  | { kind: 'claiming'; code: string }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string };

type EnrolledPhase =
  | { kind: 'loading' }
  | { kind: 'unreachable' }
  | { kind: 'notAvailable' }
  | {
      kind: 'ready';
      label: string;
      slot: StationSlot;
      joinCode: string | null;
      pulse: GoalPulse;
      confirmedAt: Date;
      stale: boolean;
    };

type TurnStateResponse = TurnState;

type StationStateResponse = {
  stationId: string;
  slot: number;
  label: string;
  goalId: string;
  queueId: string;
  joinCode: string | null;
  pulse: GoalPulse;
};

const QR_SIZE_PHONE = 168;
const QR_SIZE_WIDE = 232;

/** The symbol, or null when the encoder refuses the string. Never a partial
 * symbol: a truncated QR scans cleanly and sends the scanner somewhere wrong. */
function qrUri(url: string | null): string | null {
  if (!url) return null;
  try {
    return qrSvgDataUriRaw(encodeQr(url), { dark: wsfTheme.colors.primary, light: '#FFFFFF' });
  } catch {
    return null;
  }
}

export default function StationScreen() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = typeof params.goalId === 'string' ? params.goalId : '';
  const { width: windowWidth } = useWindowDimensions();

  // The kiosk's hydration rule, and the same reason (#418): the static export
  // renders the phone layout, so the first client render must match it.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const wide = hydrated && windowWidth >= 900;

  /**
   * Bumped whenever the credential this screen holds changes — claimed, or
   * cleared because the server refused it. Both effects below key off it, so a
   * refusal actually restarts the screen instead of leaving a dead secret in a
   * loop.
   */
  const [credentialToken, setCredentialToken] = useState(0);
  const credential = useMemo(
    () => (hydrated && goalId ? credentialForGoal(goalId) : null),
    // credentialToken is the point of this memo: storage is not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, goalId, credentialToken]
  );

  /**
   * The line, as this screen last saw it. `null` until the first answer, which
   * is not the same as an empty line: a screen must not print "nobody is
   * waiting" before it has asked.
   */
  const [queue, setQueue] = useState<TurnState | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  /**
   * What the person at the screen says they did. It exists only while a turn
   * is `active`, and it is cleared the instant a turn ends — a number left in
   * a box at a public screen is the next person's number by accident.
   */
  const [turnCount, setTurnCount] = useState('');

  /**
   * THE FOLLOW-ALONG THIS SCREEN RUNS, and it is the same one the phone runs:
   * `useFollowAlongSession` + `<FollowAlongCard>`, the pair `/move` is built
   * from. A station is a host for that player, not a second implementation of
   * it.
   *
   * WHICH MOVEMENT, and why it cannot be read off this screen's address. A
   * combined event has ONE line across every station, and the people in it
   * chose different child activities — so the movement to demonstrate belongs
   * to the turn, not to the station. It arrives on the assignment as
   * `activityUnit`, which names an activity and never a person.
   *
   * The round id is the assigned turn's code, which is stable for as long as
   * that turn is. This screen mints nothing: the canonical attempt was minted
   * server-side by wsfStartTurn, and this player has no way to send a number
   * regardless — the record panel below is the only thing that can.
   */
  const assignedUnit = queue?.assigned?.activityUnit ?? '';
  const playerRoundId = queue?.assigned?.state === 'active' ? (queue.assigned.code ?? null) : null;
  const keepRound = useCallback(() => undefined, []);
  const session = useFollowAlongSession({
    unit: assignedUnit,
    roundId: playerRoundId,
    onRoundStart: keepRound,
    onRoundReset: keepRound,
    // ONE 60-SECOND ROUND PER TURN. The throughput contract for a line, not a
    // preference — so the two-minute chip is not offered here at all.
    fixedLength: 'short',
  });

  const [pairing, setPairing] = useState<PairingPhase>({ kind: 'requesting' });
  const [enrolled, setEnrolled] = useState<EnrolledPhase>({ kind: 'loading' });
  const [pairingSession, setPairingSession] = useState(0);

  // ── MODE 1: ask to be let in ───────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !goalId) return;
    if (credential) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // A claim happens at most once per approved pairing, whatever the poll
    // does: two claims would race for a credential only one of them can have.
    let claiming = false;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const claim = async (pairingId: string, code: string) => {
      if (claiming) return;
      claiming = true;
      stop();
      if (!cancelled) setPairing({ kind: 'claiming', code });
      try {
        const fn = httpsCallable<
          { pairingId: string },
          { stationId: string; secret: string; slot: number; label: string; goalId: string }
        >(getFirebaseFunctions(), 'wsfStationClaimPairing');
        const result = await fn({ pairingId });
        if (cancelled) return;
        const slot = result.data.slot;
        if (!isStationSlot(slot) || result.data.goalId !== goalId) {
          setPairing({
            kind: 'failed',
            message: 'This screen could not finish setting up. Ask for a new code.',
          });
          return;
        }
        const saved = saveStationCredential({
          stationId: result.data.stationId,
          secret: result.data.secret,
          goalId,
          slot,
        });
        if (!saved) {
          // A device that cannot remember being enrolled is not enrolled, and
          // saying so is better than a screen that re-pairs on every reload.
          setPairing({
            kind: 'failed',
            message:
              'This browser will not let this screen remember anything, so it cannot be set up here.',
          });
          return;
        }
        setEnrolled({ kind: 'loading' });
        setCredentialToken((n) => n + 1);
      } catch {
        if (cancelled) return;
        setPairing({
          kind: 'failed',
          message: 'This screen could not finish setting up. Ask for a new code.',
        });
      }
    };

    (async () => {
      setPairing({ kind: 'requesting' });
      let pairingId = '';
      let code = '';
      try {
        const fn = httpsCallable<
          { goalId: string },
          { pairingId: string; code: string; expiresAt: string }
        >(getFirebaseFunctions(), 'wsfStationRequestPairing');
        const result = await fn({ goalId });
        if (cancelled) return;
        pairingId = result.data.pairingId;
        code = result.data.code;
        setPairing({ kind: 'waiting', pairingId, code });
      } catch {
        if (cancelled) return;
        setPairing({
          kind: 'failed',
          message: 'This screen could not reach the server. Check the connection and try again.',
        });
        return;
      }

      const tick = async () => {
        try {
          const fn = httpsCallable<{ pairingId: string }, { status: string }>(
            getFirebaseFunctions(),
            'wsfStationPairingStatus'
          );
          const result = await fn({ pairingId });
          if (cancelled) return;
          const status = result.data.status;
          if (status === 'approved') {
            void claim(pairingId, code);
            return;
          }
          if (status === 'expired' || status === 'refused') {
            stop();
            setPairing({ kind: 'expired' });
          }
          // 'pending' and 'claimed' both keep waiting: 'claimed' can only be
          // this screen's own claim in flight.
        } catch {
          // A single failed poll says nothing. The code on screen is still
          // live until it expires, so the next tick simply asks again.
        }
      };

      timer = setInterval(() => void tick(), PAIRING_POLL_MS);
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [hydrated, goalId, credential, pairingSession]);

  // ── MODE 2: the event screen ───────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !goalId) return;
    if (!credential) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // The display's two admission rules, unchanged from the kiosk: only a
    // newer answer may paint, and a refusal closes the session so an older
    // success held in flight can never repaint what this screen is no longer
    // entitled to show.
    let issued = 0;
    let applied = 0;
    let sessionClosed = false;

    const closeWith = (next: EnrolledPhase) => {
      sessionClosed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      setEnrolled(next);
    };

    const tick = async () => {
      const seq = ++issued;
      try {
        const fn = httpsCallable<{ stationId: string; secret: string }, StationStateResponse>(
          getFirebaseFunctions(),
          'wsfStationState'
        );
        const result = await fn({ stationId: credential.stationId, secret: credential.secret });
        if (cancelled || sessionClosed) return;
        if (seq <= applied) return;
        applied = seq;
        const data = result.data;
        const slot = isStationSlot(data.slot) ? data.slot : credential.slot;
        const at = new Date();
        setEnrolled((prev) =>
          prev.kind === 'ready' &&
          !prev.stale &&
          prev.label === data.label &&
          prev.joinCode === data.joinCode &&
          samePulse(prev.pulse, data.pulse) &&
          formatClock(prev.confirmedAt) === formatClock(at)
            ? prev
            : {
                kind: 'ready',
                label: data.label,
                slot,
                joinCode: data.joinCode ?? null,
                pulse: data.pulse,
                confirmedAt: at,
                stale: false,
              }
        );
      } catch (e) {
        if (cancelled || sessionClosed) return;
        if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
          // THE REJECTED CREDENTIAL. Revoked from across the hall, or never a
          // station. The device empties itself and goes back to asking.
          clearStationCredential();
          closeWith({ kind: 'loading' });
          setPairing({ kind: 'requesting' });
          setCredentialToken((n) => n + 1);
          return;
        }
        if (
          e instanceof FirebaseError &&
          (e.code === 'functions/not-found' || e.code === 'functions/invalid-argument')
        ) {
          // The goal is not authorized for display (or is not there at all).
          // Same answer, same silence, as the kiosk and the public display.
          closeWith({ kind: 'notAvailable' });
          return;
        }
        if (seq <= applied) return;
        applied = seq;
        setEnrolled((prev) =>
          prev.kind === 'ready' ? { ...prev, stale: true } : { kind: 'unreachable' }
        );
      }
    };

    void tick();
    timer = setInterval(() => void tick(), STATE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [hydrated, goalId, credential]);

  // ── THE LINE ──────────────────────────────────────────────────────────────
  //
  // Its own poll, deliberately: the goal's pulse and the queue answer different
  // questions at different rates, and a failure to read one must not blank the
  // other. A credential refusal is handled by the state effect above, which is
  // the one place this screen decides it is no longer enrolled.
  useEffect(() => {
    if (!hydrated || !goalId) return;
    if (!credential) {
      setQueue(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let issued = 0;
    let applied = 0;

    const tick = async () => {
      const seq = ++issued;
      try {
        const fn = httpsCallable<{ stationId: string; secret: string }, TurnStateResponse>(
          getFirebaseFunctions(),
          'wsfTurnState'
        );
        const result = await fn({ stationId: credential.stationId, secret: credential.secret });
        if (cancelled) return;
        if (seq <= applied) return;
        applied = seq;
        setQueue(result.data);
      } catch {
        // A single failed poll says nothing about the line, and a screen in a
        // hall that blanks the person it is calling is the worst thing this
        // route can do. It keeps showing what it last confirmed.
      }
    };

    void tick();
    timer = setInterval(() => void tick(), STATE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [hydrated, goalId, credential]);

  /**
   * ONE HELPER FOR EVERY TURN ACTION, because they are the same shape: prove
   * the credential, send nothing but the credential (and a count, where there
   * is one), and paint whatever the server says the hall now is. The server's
   * answer is always the whole hall state, so this screen never patches its
   * own idea of the line from a response and then drifts from it.
   */
  const runTurnAction = useCallback(
    async (
      name: 'wsfCallNext' | 'wsfStartTurn' | 'wsfCompleteTurn' | 'wsfCancelTurn',
      count?: number
    ) => {
      if (!credential || queueBusy) return;
      setQueueBusy(true);
      setQueueError(null);
      try {
        const fn = httpsCallable<
          { stationId: string; secret: string; count?: number },
          TurnStateResponse & { blockedMessage?: string | null }
        >(getFirebaseFunctions(), name);
        const result = await fn({
          stationId: credential.stationId,
          secret: credential.secret,
          ...(typeof count === 'number' ? { count } : {}),
        });
        setQueue({
          stationId: result.data.stationId,
          stationLabel: result.data.stationLabel,
          assigned: result.data.assigned,
          result: result.data.result,
          waitingCount: result.data.waitingCount,
        });
        // CALL NEXT NEVER CLOSES AN UNFINISHED TURN. When the server refuses
        // because this screen still holds one, it says so in its own words and
        // the screen prints them — no second copy of the sentence here.
        if (result.data.blockedMessage) setQueueError(result.data.blockedMessage);
        if (name === 'wsfCompleteTurn' || name === 'wsfCancelTurn') setTurnCount('');
      } catch (e) {
        // No code, no identifier and no vendor string on a screen in a room —
        // but a refusal the product itself wrote ("this goal takes one
        // contribution from each member") is the product's own sentence and
        // names nobody, so it is shown rather than swallowed.
        const message = (e as { message?: unknown })?.message;
        setQueueError(
          typeof message === 'string' && message && !/^[A-Z_]+$/.test(message)
            ? message
            : 'That didn’t go through. Try again.'
        );
      } finally {
        setQueueBusy(false);
      }
    },
    [credential, queueBusy]
  );

  const onCallNext = useCallback(() => void runTurnAction('wsfCallNext'), [runTurnAction]);
  const onStartTurn = useCallback(() => void runTurnAction('wsfStartTurn'), [runTurnAction]);
  const onCancelTurn = useCallback(() => void runTurnAction('wsfCancelTurn'), [runTurnAction]);
  const onCompleteTurn = useCallback(() => {
    const value = turnCountValue(turnCount);
    if (value === null) {
      setQueueError('Enter how many they did — a whole number.');
      return;
    }
    void runTurnAction('wsfCompleteTurn', value);
  }, [runTurnAction, turnCount]);

  const onNewCode = useCallback(() => {
    setPairing({ kind: 'requesting' });
    setPairingSession((n) => n + 1);
  }, []);

  const testNote = wsfUsingEmulators ? (
    <Text style={styles.testNote} testID="wsf-station-test-banner">
      Sample data
    </Text>
  ) : null;

  const frame = (testID: string, children: ReactNode, key: string) => (
    <StationSurface
      key={key}
      wide={wide}
      testID={testID}
      dataSet={{ layout: wide ? 'wide' : 'phone' }}
    >
      {children}
      {testNote}
    </StationSurface>
  );

  if (!hydrated || !goalId) {
    return frame(
      'wsf-station-loading',
      <View style={styles.genericBlock}>
        <WsfWordmark variant="white" height={wide ? 44 : 22} testID="wsf-station-wordmark" />
        <Text style={[styles.genericHeadline, wide ? styles.genericHeadlineWide : null]} {...HEADING}>
          Loading screen…
        </Text>
      </View>,
      'loading'
    );
  }

  // ── MODE 1 ────────────────────────────────────────────────────────────────
  if (!credential) {
    const code =
      pairing.kind === 'waiting' || pairing.kind === 'claiming' ? pairing.code : null;
    return frame(
      'wsf-station-pairing',
      <View style={styles.genericBlock}>
        <WsfWordmark variant="white" height={wide ? 44 : 22} testID="wsf-station-wordmark" />
        <Text style={[styles.genericHeadline, wide ? styles.genericHeadlineWide : null]} {...HEADING}>
          Set up this screen
        </Text>
        {code ? (
          <Text
            style={[styles.pairingCode, wide ? styles.pairingCodeWide : null]}
            testID="wsf-station-pairing-code"
            selectable={false}
          >
            {formatPairingCode(code)}
          </Text>
        ) : null}
        {pairing.kind === 'requesting' ? (
          <Text style={styles.genericBody} testID="wsf-station-pairing-requesting">
            Asking for a code…
          </Text>
        ) : null}
        {pairing.kind === 'claiming' ? (
          <Text style={styles.genericBody} testID="wsf-station-pairing-claiming">
            Approved. Setting this screen up…
          </Text>
        ) : null}
        {pairing.kind === 'waiting' ? (
          <Text
            style={[styles.genericBody, wide ? styles.genericBodyWide : null]}
            testID="wsf-station-pairing-instructions"
          >
            In your community’s Manage panel, open “Screens at this event”, enter this code, and
            choose Station 1 or Station 2.
          </Text>
        ) : null}
        {pairing.kind === 'expired' ? (
          <Text style={styles.genericBody} testID="wsf-station-pairing-expired">
            That code has expired. Get a new one and enter it within ten minutes.
          </Text>
        ) : null}
        {pairing.kind === 'failed' ? (
          <Text style={styles.genericBody} testID="wsf-station-pairing-error">
            {pairing.message}
          </Text>
        ) : null}
        {pairing.kind === 'expired' || pairing.kind === 'failed' ? (
          <Pressable
            onPress={onNewCode}
            style={styles.secondaryButton}
            testID="wsf-station-pairing-retry"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Get a new code</Text>
          </Pressable>
        ) : null}
        {/*
          Said before anybody types it anywhere: the code is a request to be
          approved, not a sign-in and not a way in. It gives this screen
          exactly one thing — permission to show this goal's shared progress.
        */}
        <Text style={styles.caption} testID="wsf-station-pairing-note">
          This code only asks a Champion to approve this screen. It is not a sign-in, it gives
          nobody access to an account, and nothing is recorded here.
        </Text>
      </View>,
      'pairing'
    );
  }

  // ── MODE 2 ────────────────────────────────────────────────────────────────
  if (enrolled.kind !== 'ready') {
    const copy =
      enrolled.kind === 'loading'
        ? { headline: 'Loading display…', body: null, testID: 'wsf-station-loading', action: false }
        : enrolled.kind === 'unreachable'
          ? {
              headline: 'Connection interrupted',
              body: 'Nothing has been confirmed yet. Check again when you’re connected.',
              testID: 'wsf-station-unreachable',
              action: true,
            }
          : {
              // Byte-identical to the kiosk's and the public display's refusal.
              headline: KIOSK_REFUSAL_HEADLINE,
              body: KIOSK_REFUSAL_BODY,
              testID: 'wsf-station-not-available',
              action: true,
            };
    return frame(
      copy.testID,
      <View style={styles.genericBlock}>
        <WsfWordmark variant="white" height={wide ? 44 : 22} testID="wsf-station-wordmark" />
        <Text style={[styles.genericHeadline, wide ? styles.genericHeadlineWide : null]} {...HEADING}>
          {copy.headline}
        </Text>
        {copy.body ? (
          <Text style={[styles.genericBody, wide ? styles.genericBodyWide : null]}>{copy.body}</Text>
        ) : null}
        {copy.action ? (
          <Pressable
            onPress={() => setEnrolled({ kind: 'loading' })}
            style={styles.secondaryButton}
            testID="wsf-station-recheck"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Check again</Text>
          </Pressable>
        ) : null}
      </View>,
      `generic-${wide ? 'wide' : 'phone'}`
    );
  }

  const { pulse, confirmedAt, stale, label, joinCode } = enrolled;
  const { sharedTotal, target, unit, status } = pulse;
  const zone = { timeZone: pulse.timezone };
  const period =
    status === 'closed'
      ? formatPeriod(pulse.startsAt, pulse.endsAt, zone)
      : formatActiveWindowLabel(pulse.endsAt, zone);
  const weWidth = wide
    ? Math.min(420, Math.round(windowWidth * 0.26))
    : Math.max(96, Math.min(260, windowWidth - 2 * 24 - 2 * 22));
  const qrSize = wide ? QR_SIZE_WIDE : QR_SIZE_PHONE;

  // THE ONE PERSON, AND THE ONE CONTROL. Both are derived from the state the
  // server sent rather than from which buttons this screen remembered to
  // disable, so a control that cannot work is not on the screen at all.
  const assigned: HallAssignment | null = queue?.assigned ?? null;
  const turnResult: HallResult | null = queue?.result ?? null;
  const action = stationAction(queue);
  /** A turn is actually running, on a venue screen. See the body below. */
  const turnRunningWide = wide && action === 'complete';
  const callSentence = announceHallTurn(queue, label);
  const resultSentence = describeHallResult(turnResult);

  const origin = typeof window === 'undefined' ? null : (window.location?.origin ?? null);
  // The newcomer link exists only when the server handed this screen a code,
  // and it only does that for a community whose policy admits by link at all.
  //
  // THE NEWCOMER LINK NAMES THE ACTIVITY THIS SCREEN IS RUNNING. A newcomer's
  // phone is about to leave for four routes and a mail round trip — signup,
  // verification, profile, join — and come back with nothing in its URL. The
  // unit rides along so that when it comes back it can still say what the
  // room was doing. `unit` is what `wsfGoalPulse` already publishes to an
  // unauthenticated screen, so the code carries nothing this screen is not
  // already printing in letters a hall can read; it is still a link, still
  // grants nothing, and still enrols nobody.
  //
  // THE MEMBER LINK STAYS BARE, deliberately: a member is already signed in,
  // makes no round trip, and is asked which activity they are here to do on
  // the page itself. There is nothing for it to carry.
  //
  // THE ACTIVITY IS A PREFERENCE, NOT A REQUIREMENT. `encodeQr` refuses a
  // payload past version 10 rather than truncating it — a truncated symbol
  // scans cleanly and takes the scanner somewhere wrong — and a Champion is
  // free to type a 40-character unit that, percent-encoded onto a long origin,
  // does not fit. So the longer address is TRIED first and the address that
  // existed before this parameter is the fallback, and the symbol and the
  // `qrUrl` the room is shown are always the same string. A newcomer who
  // scans the fallback still reaches the join; they are simply asked which
  // activity on the event page, which is where they are asked anyway.
  const joinWithActivity = buildEventJoinUrlFromScreenedCode({
    origin,
    joinCode,
    goalId,
    activity: unit,
  });
  const joinBare = buildEventJoinUrlFromScreenedCode({ origin, joinCode, goalId });
  const joinPreferredQr = qrUri(joinWithActivity);
  const joinUrl = joinPreferredQr ? joinWithActivity : joinBare;
  const joinQr = joinPreferredQr ?? qrUri(joinBare);
  const eventUrl = buildEventUrl({ origin, goalId });
  const eventQr = qrUri(eventUrl);

  return (
    <StationSurface
      key="ready"
      wide={wide}
      testID="wsf-station-screen"
      dataSet={{ layout: wide ? 'wide' : 'phone', stale: stale ? 'true' : 'false' }}
    >
      <View style={styles.header}>
        <WsfWordmark variant="white" height={wide ? 40 : 22} testID="wsf-station-wordmark" />
        <View style={styles.headerRight}>
          <Text style={styles.stationLabel} testID="wsf-station-label">
            {label}
          </Text>
          <Text style={styles.freshnessText} testID="wsf-station-confirmed-at">
            {`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`}
          </Text>
        </View>
      </View>

      <View style={wide ? styles.bodyWide : styles.bodyPhone}>
        {/*
          WHILE A TURN IS RUNNING, THE MOVEMENT IS THE SCREEN.

          The attract layout is three columns — the goal's progress, the line,
          and the two attendee codes — and that is right for a screen nobody is
          standing at. It is wrong the moment somebody is: the venue canvas is
          a FIXED height that does not scroll, so a follow-along added beside
          the other two overflowed it, and the spill landed as text printed
          over other text and controls dropped onto the page's white ground.

          Nobody needs the join codes or the running total while they are
          mid-squat. Both come back the instant the turn ends.
        */}
        {turnRunningWide ? null : (
          <View style={styles.hero} testID="wsf-station-hero">
            <Text
              style={[styles.community, wide ? styles.communityWide : null]}
              testID="wsf-station-community"
            >
              {pulse.communityDisplayName}
            </Text>
            <Text
              style={[styles.goalTitle, wide ? styles.goalTitleWide : null]}
              testID="wsf-station-goal-title"
              {...HEADING}
            >
              {pulse.goalTitle}
            </Text>
            {period ? (
              <Text style={styles.period} testID="wsf-station-period">
                {period}
              </Text>
            ) : null}
            <View style={styles.weWrap}>
              <LivingWeProgress
                completed={sharedTotal}
                target={target}
                unit={unit}
                width={weWidth}
                surface="dark"
                testID="wsf-station-we"
              />
            </View>
            <Text style={[styles.total, wide ? styles.totalWide : null]} testID="wsf-station-total-line">
              <Text testID="wsf-station-shared-total">{formatCount(sharedTotal)}</Text>
              {` of ${formatCount(target)} ${unit}`}
            </Text>
            <Text style={styles.percent} testID="wsf-station-percent">
              {`${percentLabel(sharedTotal, target)} complete`}
            </Text>
            <Text style={styles.status} testID="wsf-station-status">
              {statusLine(sharedTotal, target, status)}
            </Text>
          </View>
        )}

        {/*
          THE CALLING HALF — AND IT SHOWS ONE PERSON.

          `wsfTurnState` publishes ONE assigned person — the first name or alias
          they chose, and a short duplicate-safe code — plus a ten-second result
          and a COUNT of who is waiting. There is no waiting list in the
          response, in the type, or anywhere this screen could reach: a hall
          full of strangers reading a column of everybody's names was the defect
          this replaced, and it is not a thing a different argument can produce.

          THE CODE IS WHY TWO PEOPLE CALLED SAM BOTH KNOW. It is minted from the
          line's own position counter and a random per-line salt — never from an
          account — and the same three characters are on that person's phone.

          ONE CONTROL AT A TIME. `stationAction` decides which, from the state
          the server sent: call the next person, wait for them to tap ready,
          start their turn, or record it. A control that cannot work is not on
          the screen, and "Call next" is never a way to close somebody's turn
          without a result — the server refuses that, in its own words, and
          those words are what appears below.

          BEING CALLED WORKS WITHOUT SEEING THE SCREEN. The block below is an
          assertive live region that is always mounted — a region created at the
          moment its text appears is frequently never announced — and it carries
          the full sentence once. The huge name beside it is `aria-hidden` so a
          screen reader says the call once rather than twice.

          AND WITHOUT HEARING THE ROOM: the call is printed, not shouted. There
          is no animation anywhere on this screen, so nothing about a turn
          depends on motion and `prefers-reduced-motion` has nothing to turn
          off.
        */}
        <View
          style={[
            styles.queue,
            wide ? styles.queueWide : styles.queuePhone,
            // WHILE SOMEBODY IS ACTUALLY MOVING, THE MOVEMENT TAKES THE ROOM.
            // This column is one of three equal ones on the attract screen,
            // which is right until a turn starts — then the follow-along is
            // what the person in front of the screen is there for, and a third
            // of the width is what squeezed it.
            wide && action === 'complete' ? styles.queueRunning : null,
          ]}
          testID="wsf-station-queue"
        >
          <Text style={styles.queueEyebrow}>Now serving</Text>
          <View
            style={styles.queueServing}
            testID="wsf-station-queue-announce"
            aria-live="assertive"
            {...({ 'aria-atomic': 'true' } as Record<string, unknown>)}
          >
            {assigned ? (
              <>
                <Text
                  // WHILE THEY ARE MOVING, THE MOVEMENT IS THE BIGGEST THING.
                  // The called name is the biggest thing on an attract screen
                  // because being called is what matters then. Once the turn is
                  // running they already know it is theirs, and a name at that
                  // size pushed the clock and the count box off a canvas that
                  // cannot scroll.
                  style={[
                    styles.servingName,
                    wide ? styles.servingNameWide : null,
                    turnRunningWide ? styles.servingNameRunning : null,
                  ]}
                  testID="wsf-station-queue-serving"
                  {...({ 'aria-hidden': 'true' } as Record<string, unknown>)}
                >
                  {assigned.calledName}
                </Text>
                <Text
                  style={styles.servingCode}
                  testID="wsf-station-queue-code"
                  {...({ 'aria-hidden': 'true' } as Record<string, unknown>)}
                >
                  {formatTurnCode(assigned.code)}
                </Text>
                <Text style={styles.servingSentence} testID="wsf-station-queue-sentence">
                  {callSentence}
                </Text>
              </>
            ) : resultSentence ? (
              /*
                THE TEN SECONDS. A code and a number — and NO NAME: the moment a
                turn is recorded every name on this screen is gone, and ten
                seconds later so is this.
              */
              <Text style={styles.servingSentence} testID="wsf-station-queue-result">
                {resultSentence}
              </Text>
            ) : (
              <Text style={styles.queueEmpty} testID="wsf-station-queue-serving-empty">
                {queue === null ? 'Reading the line…' : 'Nobody is being called.'}
              </Text>
            )}
          </View>

          {/* THE WAITING ARE A NUMBER. Not a list, and not a list truncated to
              four either — the room does not need to read anybody's name but
              the one person who is up. */}
          <Text style={styles.queueCount} testID="wsf-station-queue-count">
            {describeWaitingCount(queue?.waitingCount ?? 0)}
          </Text>

          {/* RECORDING THE TURN, at the screen. It is the SAME attempt the
              server minted when this station started them, so recording it
              here and recording it on their own phone are one write under one
              key — whichever lands first is the one that counts, and the other
              adds nothing. */}
          {/*
            THE MOVEMENT AND THE CONTROLS STAND SIDE BY SIDE on a venue
            screen, and stacked everywhere else.

            Stacked at 1280x720 this column was a narrow strip of content
            down the middle with the width unused on either side, and it was
            still too TALL — the count box and "Record this turn" sat below
            the bottom edge of a canvas that does not scroll. Turning it into
            two columns spends the width that was going spare and halves the
            height at the same time, which is the only way both fit.
          */}
          <View style={turnRunningWide ? styles.turnColumns : null}>
            {action === 'complete' ? (
              <View testID="wsf-station-player">
              {/*
                WHICH ACTIVITY THIS TURN IS FOR, said before the movement.
                At a multi-activity event "Ready when you are" above a stick
                figure does not tell the person in front of the screen — or the
                room — which of the three things on offer they are up for. The
                server assigned it; the screen names it.
              */}
              {queue?.assigned?.activityTitle ? (
                <Text style={styles.turnActivityTitle} testID="wsf-station-turn-activity">
                  {queue.assigned.activityTitle}
                </Text>
              ) : null}
              {assignedUnit ? (
                <Text style={styles.turnActivityUnit} testID="wsf-station-turn-activity-unit">
                  {`Counted in ${assignedUnit}`}
                </Text>
              ) : null}
                <FollowAlongCard
                  session={session}
                  wide={wide}
                  tone="venue"
                  testIDPrefix="wsf-station-move"
                  finishedAction={
                    <Text style={kit.body} testID="wsf-station-move-handoff">
                      Enter what they counted below.
                    </Text>
                  }
                />
              </View>
            ) : null}
            {/* The count box and the two decisions are ONE group, so they
                are one column. Left as siblings of the player they became
                a third column of their own, with the number to type in one
                place and the button that sends it in another. */}
            <View style={turnRunningWide ? styles.turnControls : null}>

              {action === 'complete' ? (
                <View style={styles.turnRecord} testID="wsf-station-turn-record">
                  <Text style={styles.queueEyebrow}>
                {assignedUnit ? `How many ${assignedUnit} did they do?` : 'How many did they do?'}
              </Text>
                  <TextInput
                    value={turnCount}
                    onChangeText={(next) => {
                      setTurnCount(next);
                      setQueueError(null);
                    }}
                    style={styles.turnInput}
                    testID="wsf-station-turn-count"
                    placeholder="30"
                    placeholderTextColor={wsfTheme.colors.textMuted}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={6}
                    accessibilityLabel={
                  assignedUnit ? `How many ${assignedUnit} did they do?` : 'How many did they do?'
                }
                  />
                </View>
              ) : null}

              <View style={styles.queueActions}>
                <Pressable
                  onPress={
                    action === 'complete'
                      ? onCompleteTurn
                      : action === 'start'
                        ? onStartTurn
                        : onCallNext
                  }
                  disabled={
                    queueBusy ||
                    action === 'awaitReady' ||
                    (action === 'complete' && !isUsableTurnCount(turnCount))
                  }
                  style={[
                    styles.secondaryButton,
                    queueBusy ||
                    action === 'awaitReady' ||
                    (action === 'complete' && !isUsableTurnCount(turnCount))
                      ? styles.buttonDisabled
                      : null,
                  ]}
                  testID={action === 'callNext' ? 'wsf-station-call-next' : 'wsf-station-turn-action'}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled:
                      queueBusy ||
                      action === 'awaitReady' ||
                      (action === 'complete' && !isUsableTurnCount(turnCount)),
                  }}
                >
                  <Text style={styles.secondaryButtonText}>{stationActionLabel(action)}</Text>
                </Pressable>
                {/* ENDING A TURN WITHOUT A RESULT IS A DECISION SOMEBODY TAKES,
                    and it is this control — never a side effect of calling the
                    next person. */}
                {assigned ? (
                  <Pressable
                    onPress={onCancelTurn}
                    disabled={queueBusy}
                    style={[styles.outlineButton, queueBusy ? styles.buttonDisabled : null]}
                    testID="wsf-station-turn-cancel"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: queueBusy }}
                  >
                    <Text style={styles.outlineButtonText}>Let them go</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
          {queueError ? (
            <Text style={styles.queueError} testID="wsf-station-queue-error" aria-live="polite">
              {queueError}
            </Text>
          ) : null}
        </View>

        {/*
          THE TWO ATTENDEE CODES. Both are links to a page on the attendee's own
          phone and nothing else. Neither carries a secret, a token or any
          authority: scanning one cannot enrol a screen, cannot make anyone a
          Champion, and cannot record anything.
        */}
        {/*
          ONE CODE STAYS UP WHILE SOMEBODY IS MOVING.

          Hiding the whole row during a turn was too blunt. Somebody who
          walks up mid-round and wants in has nothing to scan, and a reserved
          panel during movement is part of the agreed contract. So during a
          turn this becomes a narrow right rail carrying the JOIN code only —
          a public URL, the same one the attract screen prints, with no
          station credential anywhere near it. The second (“already a
          member”) code stands down, because a rail is not a place for two.
        */}
        <View
          style={[styles.qrRow, turnRunningWide ? styles.qrRail : null]}
          testID="wsf-station-qr"
        >
          {joinQr && joinUrl ? (
            <View style={styles.qrBlock} testID="wsf-station-qr-join" dataSet={{ qrUrl: joinUrl }}>
              <Text style={styles.qrHeading}>New here?</Text>
              <Image
                source={{ uri: joinQr }}
                style={[styles.qrImage, { width: qrSize, height: qrSize }]}
                resizeMode="contain"
                accessibilityLabel="QR code that opens the page to join this community"
                testID="wsf-station-qr-join-image"
              />
              <Text style={styles.qrCaption}>Scan to join, then add your part.</Text>
            </View>
          ) : (
            <View style={styles.qrBlock} testID="wsf-station-qr-join-unavailable">
              <Text style={styles.qrHeading}>New here?</Text>
              {/*
                No symbol rather than a symbol that leads nowhere. This
                community admits nobody by link, the server therefore handed
                this screen no code, and the screen says so instead of
                inventing a way in — admission policy is not this feature's to
                change.
              */}
              <Text style={styles.qrCaption}>
                This community isn’t joined from a link. Ask a Champion to add you.
              </Text>
            </View>
          )}
          {/* The rail holds one code. This is the one that stands down. */}
          {turnRunningWide ? null : eventQr && eventUrl ? (
            <View style={styles.qrBlock} testID="wsf-station-qr-member" dataSet={{ qrUrl: eventUrl }}>
              <Text style={styles.qrHeading}>Already a member?</Text>
              <Image
                source={{ uri: eventQr }}
                style={[styles.qrImage, { width: qrSize, height: qrSize }]}
                resizeMode="contain"
                accessibilityLabel="QR code that opens this event on your own phone"
                testID="wsf-station-qr-member-image"
              />
              <Text style={styles.qrCaption}>Scan to add your part on your own phone.</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* It explains the join codes, so it goes when they do. */}
      {turnRunningWide ? null : (
        <Text style={styles.caption} testID="wsf-station-qr-note">
          These codes open the event on your own phone. This screen shows only the person whose
          turn it is, and their repetitions are entered after the round.
        </Text>
      )}
      {testNote}
    </StationSurface>
  );
}

/**
 * The surface a station draws on.
 *
 * Wide is the venue screen and is unchanged: one flex:1 View, no scrolling,
 * because nobody walks up to a hall display and swipes it. Narrow is a phone,
 * where the same content does not fit and a fixed surface makes its children
 * overlap rather than overflow. `flexGrow: 1` on the content keeps it centred
 * while there is room and lets it extend once there is not.
 */
function StationSurface({
  wide,
  testID,
  dataSet,
  children,
}: {
  wide: boolean;
  testID: string;
  dataSet: Record<string, string>;
  children: ReactNode;
}) {
  if (wide) {
    return (
      <View
        style={[styles.canvas, styles.canvasNavy]}
        testID={testID}
        {...({ dataSet } as Record<string, unknown>)}
      >
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      style={[styles.canvas, styles.canvasScroll]}
      contentContainerStyle={styles.canvasScrollContent}
      testID={testID}
      {...({ dataSet } as Record<string, unknown>)}
    >
      {children}
    </ScrollView>
  );
}

const HEADING = {
  accessibilityRole: 'header' as const,
  ...({ 'aria-level': 1 } as Record<string, unknown>),
};

const NAVY = wsfTheme.colors.primary;
const CREAM = wsfTheme.colors.background;
const HERO_MUTED = 'rgba(247,245,240,0.78)';

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  // The narrow surface. The ground colour belongs to the scroll view so it
  // covers the whole viewport; the spacing belongs to the content, or a
  // ScrollView's own padding would clip what it is meant to let through.
  canvasScroll: { backgroundColor: NAVY },
  // Centred while it fits, extending once it does not. These four values are
  // canvasNavy's, on purpose: the narrow surface must look identical to the
  // fixed one right up to the moment it has to scroll.
  canvasScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 28,
    justifyContent: 'space-between',
    gap: 16,
  },
  canvasNavy: {
    backgroundColor: NAVY,
    paddingHorizontal: 24,
    // A BOTTOM SAFE AREA THE CONTROLS CANNOT CROSS. The venue canvas is a
    // fixed height and never scrolls, so anything that overflows it is simply
    // gone — and what was going was Pause, Stop and the buttons that end a
    // turn. This padding is the floor; the stage above gives way instead.
    paddingTop: 28,
    paddingBottom: 24,
    justifyContent: 'space-between',
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerRight: { alignItems: 'flex-end', gap: 2 },
  stationLabel: {
    color: PROGRESS_GREEN,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bodyPhone: { flex: 1, gap: 16, justifyContent: 'center' },
  bodyWide: { flex: 1, flexDirection: 'row', gap: 32, alignItems: 'center' },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  community: {
    color: PROGRESS_GREEN,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  communityWide: { fontSize: 24, letterSpacing: 2 },
  goalTitle: {
    color: CREAM,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  goalTitleWide: { fontSize: 48, lineHeight: 56, letterSpacing: -1 },
  period: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  weWrap: { alignItems: 'center', paddingVertical: 8 },
  total: { color: CREAM, fontSize: 28, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  totalWide: { fontSize: 48, lineHeight: 56 },
  percent: { color: PROGRESS_GREEN, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  status: { color: HERO_MUTED, fontSize: 17, lineHeight: 22, textAlign: 'center' },

  // The calling half. No fixed widths, everything wraps: a chosen name is a
  // variable-length string and must never push anything off the screen.
  queue: { gap: 8, alignItems: 'center', minWidth: 0 },
  // In the wide layout the line is a column of the body row; on a phone it is
  // a block in the body column. Neither may be given a width of its own.
  queueWide: { flex: 1 },
  queueRunning: { flex: 2.6 },
  // The reserved panel: it keeps its own width rather than being squeezed by
  // the movement beside it, and stacks its one code vertically.
  turnColumns: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
    alignSelf: 'stretch',
    minWidth: 0,
    paddingHorizontal: 24,
  },
  turnControls: { alignItems: 'center', gap: 14, minWidth: 0, flexShrink: 1 },
  qrRail: { flexDirection: 'column', flexGrow: 0, flexShrink: 0, width: 250, gap: 10 },
  servingNameRunning: { fontSize: 44, lineHeight: 50 },
  turnActivityTitle: {
    color: '#F7F5F0',
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    textAlign: 'center',
  },
  turnActivityUnit: {
    color: PROGRESS_GREEN,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  queuePhone: { alignSelf: 'stretch' },
  queueEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  queueServing: { alignItems: 'center', gap: 4, alignSelf: 'stretch', minWidth: 0 },
  servingName: {
    color: CREAM,
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  servingNameWide: { fontSize: 88, lineHeight: 100, letterSpacing: -1.5 },
  // The code, under the name and quieter than it: a person reads the name
  // first and checks the code second, which is the order they need.
  servingCode: {
    color: PROGRESS_GREEN,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  servingSentence: { color: HERO_MUTED, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  turnRecord: { alignSelf: 'stretch', alignItems: 'center', gap: 6, minWidth: 0 },
  turnInput: {
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.35)',
    borderRadius: 14,
    minHeight: 48,
    minWidth: 120,
    maxWidth: 195,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 22,
    fontWeight: '700',
    color: CREAM,
    textAlign: 'center',
  },
  queueEmpty: { color: HERO_MUTED, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  queueCount: { color: HERO_MUTED, fontSize: 14, lineHeight: 19, textAlign: 'center' },
  queueActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  queueError: { color: CREAM, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: 'rgba(247,245,240,0.35)',
    paddingHorizontal: 24,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 14,
    marginTop: 8,
  },
  outlineButtonText: { color: CREAM, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  buttonDisabled: { opacity: 0.6 },

  qrRow: { flexDirection: 'row', gap: 20, justifyContent: 'center', flexWrap: 'wrap' },
  qrBlock: { alignItems: 'center', gap: 6, maxWidth: 280 },
  qrHeading: { color: CREAM, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  qrImage: { backgroundColor: '#FFFFFF', borderRadius: 10 },
  qrCaption: { color: HERO_MUTED, fontSize: 14, lineHeight: 19, textAlign: 'center' },

  pairingCode: {
    color: CREAM,
    fontSize: 56,
    lineHeight: 64,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
  },
  pairingCodeWide: { fontSize: 112, lineHeight: 124, letterSpacing: 16 },

  secondaryButton: {
    backgroundColor: PROGRESS_GREEN,
    paddingHorizontal: 28,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 14,
    marginTop: 8,
  },
  secondaryButtonText: { color: NAVY, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  caption: { color: HERO_MUTED, fontSize: 14, lineHeight: 19, textAlign: 'center' },

  genericBlock: {
    alignItems: 'center',
    gap: 16,
    maxWidth: 820,
    alignSelf: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  genericHeadline: { color: CREAM, fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 36 },
  genericHeadlineWide: { fontSize: 52, lineHeight: 60 },
  genericBody: { color: HERO_MUTED, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  genericBodyWide: { fontSize: 24, lineHeight: 32 },

  freshnessText: { color: HERO_MUTED, fontSize: 13, letterSpacing: 0.3 },
  testNote: {
    color: HERO_MUTED,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 8,
  },
});
