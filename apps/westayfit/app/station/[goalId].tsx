import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { samePulse, type GoalPulse } from '../../src/displayPulse';
import { getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
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
 * WHAT THIS SCREEN CANNOT DO, BY CONSTRUCTION. It cannot record a
 * contribution: it does not know who is standing in front of it, so it records
 * nothing about them and calls nothing that writes a total. It cannot see more
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
 */

/** Same 2 s cadence, and the same reason, as the kiosk and the public display:
 * it matches the server-side cache TTL for the goal pulse. */
const STATE_POLL_MS = 2_000;
/** A Champion has to walk to a screen and type six characters; three seconds
 * is a quick enough answer and a tenth of the state poll's traffic. */
const PAIRING_POLL_MS = 3_000;

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
    <View
      key={key}
      style={[styles.canvas, styles.canvasNavy]}
      testID={testID}
      {...({ dataSet: { layout: wide ? 'wide' : 'phone' } } as Record<string, unknown>)}
    >
      {children}
      {testNote}
    </View>
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

  const origin = typeof window === 'undefined' ? null : (window.location?.origin ?? null);
  // The newcomer link exists only when the server handed this screen a code,
  // and it only does that for a community whose policy admits by link at all.
  const joinUrl = buildEventJoinUrlFromScreenedCode({ origin, joinCode, goalId });
  const eventUrl = buildEventUrl({ origin, goalId });
  const joinQr = qrUri(joinUrl);
  const eventQr = qrUri(eventUrl);

  return (
    <View
      key="ready"
      style={[styles.canvas, styles.canvasNavy]}
      testID="wsf-station-screen"
      {...({
        dataSet: { layout: wide ? 'wide' : 'phone', stale: stale ? 'true' : 'false' },
      } as Record<string, unknown>)}
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

        {/*
          THE TWO ATTENDEE CODES. Both are links to a page on the attendee's own
          phone and nothing else. Neither carries a secret, a token or any
          authority: scanning one cannot enrol a screen, cannot make anyone a
          Champion, and cannot record anything.
        */}
        <View style={styles.qrRow} testID="wsf-station-qr">
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
          {eventQr && eventUrl ? (
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

      <Text style={styles.caption} testID="wsf-station-qr-note">
        These codes open a page on your own phone. You sign in as yourself and enter the number you
        counted yourself. This screen records nothing and knows nobody.
      </Text>
      {testNote}
    </View>
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
  canvasNavy: {
    backgroundColor: NAVY,
    paddingHorizontal: 24,
    paddingVertical: 28,
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
