import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { samePulse, type GoalPulse } from '../../src/displayPulse';
import { getFirebaseAuth, getFirebaseFunctions, wsfUsingEmulators } from '../../src/firebase';
import {
  KIOSK_REFUSAL_BODY,
  KIOSK_REFUSAL_HEADLINE,
  clearKioskReturnGoal,
  kioskContributeRoute,
  setKioskReturnGoal,
} from '../../src/kioskSession';
import { wsfTheme } from '../../src/theme';
import { PROGRESS_GREEN } from '../../src/ui/brandAssets';
import { formatActiveWindowLabel, formatClock, formatPeriod } from '../../src/ui/dates';
import { LivingWeProgress } from '../../src/ui/LivingWeProgress';
import { formatCount, percentLabel, statusLine } from '../../src/ui/progressFormat';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * KIOSK — one goal, one shared device, many separate visitors.
 *
 * This is the start screen. It is the PUBLIC hero and nothing else: the same
 * data path as app/display/[goalId].tsx (the `wsfGoalPulse` callable, which
 * answers only for a goal its Champion has authorized for display), the same
 * generic refusal when that authorization is absent, plus one action.
 *
 * WHY THE REFUSAL IS THE SAME. A kiosk standing on an unauthorized goal is
 * not a public surface, so it may not show the goal, and it may not explain
 * why — telling "no such goal" from "not authorized" apart would make this
 * screen an oracle for which goal ids exist. Identical copy, identical
 * silence (src/kioskSession.ts carries the two strings).
 *
 * WHAT THIS SCREEN DOES NOT DO. It does not identify anybody, it does not
 * pair with a phone, it does not verify that the person who taps is the
 * person who moved, and no copy on it suggests otherwise. It sends the
 * visitor through the ordinary sign-in and the ordinary contribution flow;
 * the only thing it adds is a way to end the session on the way out.
 *
 * Belonging never depends on this screen: the goal, the community and every
 * other way to contribute are unchanged whether a kiosk exists or not.
 */

type KioskState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; pulse: GoalPulse; confirmedAt: Date; stale: boolean };

/** Same 2 s cadence, and the same reason, as the public display: it matches
 * the server-side cache TTL for `wsfGoalPulse`. */
const POLL_INTERVAL_MS = 2_000;

export default function KioskGoal() {
  const params = useLocalSearchParams<{ goalId: string }>();
  const goalId = params.goalId;
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useWsfAuth();

  // Same hydration rule as the display: the static export renders the phone
  // layout, so the first client render must match it or React re-renders the
  // whole tree (#418).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const wide = hydrated && windowWidth >= 900;

  const [state, setState] = useState<KioskState>({ kind: 'loading' });
  const [pollSession, setPollSession] = useState(0);

  // THE START SCREEN IS A SIGNED-OUT SCREEN.
  //
  // Arriving here with an account still attached means a session ended
  // without its Finish — a hard reload mid-flow, a back button, a tab
  // restored by the browser. The previous visitor is not around to be asked,
  // and the next one must not inherit them, so the account goes. This is the
  // reset half of Finish, applied wherever the kiosk comes to rest.
  //
  // Only the kiosk's own storage key is removed. An unresolved attempt
  // belongs to the account that made it and stays reconcilable.
  useEffect(() => {
    clearKioskReturnGoal();
    if (!user) return;
    void signOut(getFirebaseAuth()).catch(() => {
      // Nothing useful to do here and nothing to claim: the start screen
      // shows no identity either way, and the next Contribute press lands on
      // the sign-in gate.
    });
  }, [user]);

  useEffect(() => {
    setState({ kind: 'loading' });
  }, [goalId]);

  useEffect(() => {
    if (!goalId) {
      setState({ kind: 'notFound' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // The display's two admission rules, unchanged: a response may only paint
    // if it is newer than what is on screen, AND a refusal closes the session
    // so an older-issued success held in flight can never repaint a total
    // this device is no longer entitled to show.
    let issued = 0;
    let applied = 0;
    let sessionClosed = false;

    const apply = (seq: number, next: SetStateAction<KioskState>) => {
      if (cancelled) return;
      if (sessionClosed) return;
      if (seq <= applied) return;
      applied = seq;
      setState(next);
    };

    const tick = async () => {
      const seq = ++issued;
      try {
        const fn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const result = await fn({ goalId });
        const at = new Date();
        apply(seq, (prev) =>
          prev.kind === 'ready' &&
          !prev.stale &&
          samePulse(prev.pulse, result.data) &&
          formatClock(prev.confirmedAt) === formatClock(at)
            ? prev
            : { kind: 'ready', pulse: result.data, confirmedAt: at, stale: false }
        );
      } catch (e) {
        if (cancelled) return;
        if (
          e instanceof FirebaseError &&
          (e.code === 'functions/not-found' || e.code === 'functions/invalid-argument')
        ) {
          if (sessionClosed) return;
          sessionClosed = true;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          setState({ kind: 'notFound' });
          return;
        }
        if (sessionClosed) return;
        if (seq <= applied) return;
        applied = seq;
        setState((prev) => (prev.kind === 'ready' ? { ...prev, stale: true } : { kind: 'unreachable' }));
      }
    };

    void tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [goalId, pollSession]);

  // The handoff. The visitor goes through the ORDINARY sign-in; the kiosk
  // destination rides sessionStorage across the sign-in (and, for someone
  // whose account still needs verifying or a profile, across those gates
  // too) exactly the way a scanned join code already does.
  const onContribute = useCallback(() => {
    if (!goalId) return;
    setKioskReturnGoal(goalId);
    router.push(kioskContributeRoute(goalId) as never);
  }, [goalId]);

  const testNote = wsfUsingEmulators ? (
    <Text style={styles.testNote} testID="wsf-kiosk-test-banner">
      Local synthetic test
    </Text>
  ) : null;

  if (state.kind !== 'ready') {
    const copy =
      state.kind === 'loading'
        ? { headline: 'Loading display…', body: null, testID: 'wsf-kiosk-loading', action: false }
        : state.kind === 'unreachable'
          ? {
              headline: 'Connection interrupted',
              body: 'Nothing has been confirmed yet. Check again when you’re connected.',
              testID: 'wsf-kiosk-unreachable',
              action: true,
            }
          : {
              // Byte-identical to the public display's refusal.
              headline: KIOSK_REFUSAL_HEADLINE,
              body: KIOSK_REFUSAL_BODY,
              testID: 'wsf-kiosk-not-available',
              action: true,
            };
    return (
      <View
        key={`generic-${wide ? 'wide' : 'phone'}`}
        style={[styles.canvas, styles.canvasNavy]}
        testID={copy.testID}
        {...({ dataSet: { layout: wide ? 'wide' : 'phone' } } as Record<string, unknown>)}
      >
        <View style={styles.genericBlock}>
          <WsfWordmark variant="white" height={wide ? 44 : 22} testID="wsf-kiosk-wordmark" />
          <Text
            style={[styles.genericHeadline, wide ? styles.genericHeadlineWide : null]}
            accessibilityRole="header"
            {...({ 'aria-level': 1 } as Record<string, unknown>)}
          >
            {copy.headline}
          </Text>
          {copy.body ? (
            <Text style={[styles.genericBody, wide ? styles.genericBodyWide : null]}>{copy.body}</Text>
          ) : null}
          {copy.action ? (
            <Pressable
              onPress={() => {
                setState({ kind: 'loading' });
                setPollSession((n) => n + 1);
              }}
              style={styles.secondaryButton}
              testID="wsf-kiosk-recheck"
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Check again</Text>
            </Pressable>
          ) : null}
        </View>
        {testNote}
      </View>
    );
  }

  const { pulse, confirmedAt, stale } = state;
  const { sharedTotal, target, unit, status } = pulse;
  const closed = status === 'closed';
  const zone = { timeZone: pulse.timezone };
  const period = formatPeriod(pulse.startsAt, pulse.endsAt, zone);
  const periodText = closed ? period : formatActiveWindowLabel(pulse.endsAt, zone);
  const weWidth = wide
    ? Math.min(560, Math.round(windowWidth * 0.38))
    : Math.max(96, Math.min(300, windowWidth - 2 * 20 - 2 * 22));

  return (
    <View
      key="ready"
      style={[styles.canvas, styles.canvasNavy]}
      testID="wsf-kiosk-screen"
      {...({ dataSet: { layout: wide ? 'wide' : 'phone', stale: stale ? 'true' : 'false' } } as Record<string, unknown>)}
    >
      <View style={styles.header}>
        <WsfWordmark variant="white" height={wide ? 40 : 22} testID="wsf-kiosk-wordmark" />
        <Text style={styles.freshnessText} testID="wsf-kiosk-confirmed-at">
          {`${stale ? 'Last confirmed' : 'Confirmed'} ${formatClock(confirmedAt)}`}
        </Text>
      </View>

      <View style={styles.hero} testID="wsf-kiosk-hero">
        <Text style={[styles.community, wide ? styles.communityWide : null]} testID="wsf-kiosk-community">
          {pulse.communityDisplayName}
        </Text>
        <Text
          style={[styles.goalTitle, wide ? styles.goalTitleWide : null]}
          testID="wsf-kiosk-goal-title"
          accessibilityRole="header"
          {...({ 'aria-level': 1 } as Record<string, unknown>)}
        >
          {pulse.goalTitle}
        </Text>
        {periodText ? (
          <Text style={styles.period} testID="wsf-kiosk-period">
            {periodText}
          </Text>
        ) : null}
        <View style={styles.weWrap}>
          <LivingWeProgress
            completed={sharedTotal}
            target={target}
            unit={unit}
            width={weWidth}
            surface="dark"
            testID="wsf-kiosk-we"
          />
        </View>
        <Text style={[styles.total, wide ? styles.totalWide : null]} testID="wsf-kiosk-total-line">
          <Text testID="wsf-kiosk-shared-total">{formatCount(sharedTotal)}</Text>
          {` of ${formatCount(target)} ${unit}`}
        </Text>
        <Text style={styles.percent} testID="wsf-kiosk-percent">
          {`${percentLabel(sharedTotal, target)} complete`}
        </Text>
        <Text style={styles.status} testID="wsf-kiosk-status">
          {statusLine(sharedTotal, target, status)}
        </Text>
      </View>

      {/*
        THE ONE ACTION, and the only sentences that describe it.
        "Add yours" — not "check in", not "verify". What follows is the
        member's own sign-in and the member's own self-counted entry; this
        device witnesses nothing and the copy claims nothing.
      */}
      <View style={styles.actions}>
        <Pressable
          onPress={onContribute}
          accessibilityRole="button"
          style={styles.primaryButton}
          testID="wsf-kiosk-start"
        >
          <Text style={styles.primaryButtonText}>Contribute here</Text>
        </Pressable>
        <Text style={styles.caption} testID="wsf-kiosk-caption">
          You’ll sign in with your own account, enter the number you counted yourself, and finish.
        </Text>
        <Text style={styles.caption} testID="wsf-kiosk-shared-note">
          This is a shared device. Nothing about you stays on it after you finish.
        </Text>
      </View>
      {testNote}
    </View>
  );
}

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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  hero: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  community: { color: PROGRESS_GREEN, fontSize: 15, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center' },
  communityWide: { fontSize: 26, letterSpacing: 2 },
  goalTitle: { color: CREAM, fontSize: 30, fontWeight: '800', lineHeight: 36, letterSpacing: -0.4, textAlign: 'center' },
  goalTitleWide: { fontSize: 56, lineHeight: 64, letterSpacing: -1 },
  period: { color: HERO_MUTED, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  weWrap: { alignItems: 'center', paddingVertical: 8 },
  total: { color: CREAM, fontSize: 30, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  totalWide: { fontSize: 56, lineHeight: 64 },
  percent: { color: PROGRESS_GREEN, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  status: { color: HERO_MUTED, fontSize: 17, lineHeight: 22, textAlign: 'center' },

  actions: { gap: 10 },
  primaryButton: {
    backgroundColor: PROGRESS_GREEN,
    // D-4. 44 px: the owner's minimum touch target. This one is the whole
    // point of the screen, so it is comfortably past it.
    minHeight: 56,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: 14,
  },
  primaryButtonText: { color: NAVY, fontSize: 20, fontWeight: '800', textAlign: 'center' },
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

  genericBlock: { alignItems: 'center', gap: 16, maxWidth: 720, alignSelf: 'center', flex: 1, justifyContent: 'center' },
  genericHeadline: { color: CREAM, fontSize: 30, fontWeight: '800', textAlign: 'center', lineHeight: 36 },
  genericHeadlineWide: { fontSize: 56, lineHeight: 64 },
  genericBody: { color: HERO_MUTED, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  genericBodyWide: { fontSize: 26, lineHeight: 34 },

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
