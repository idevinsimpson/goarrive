/**
 * FOLLOW ALONG — the movement screen.
 *
 * A timed follow-along for one goal's activity, on a phone in someone's hand
 * or on a station screen in a hall. It is WSF's own.
 *
 * WHAT IT SHOWS, AND WHAT IT SAYS ABOUT IT. There is no movement video catalog
 * in this repository — that is an asset gap, stated here rather than papered
 * over. When a goal supplies a poster or an authorized demonstration, this
 * screen shows it. When none exists, it draws its own two-pose figure and
 * labels it, on screen, as an ILLUSTRATED FALLBACK. No copy on this screen
 * implies a video was delivered, is loading, or failed.
 *
 * THE SHAPE OF A SESSION. Ready (explicit, untimed) → a 3-second countdown →
 * one 60-second round → finished. Both stopping early and running to the end
 * arrive at the same place: "Enter my reps", which hands off to the EXISTING
 * contribute screen — its own review, its own submission, its own
 * reconciliation and its own receipt. Nothing about that flow is reimplemented
 * here, and this screen has no control that could record anything.
 *
 * NO CREDIT COMES FROM THIS SCREEN. Not from elapsed time, not from a finished
 * round, not from the figure. The only number that counts is the one the
 * person types on the contribute screen, and this screen never sends one.
 *
 * THE CLOCK IS ELAPSED TIMESTAMPS, not a decremented counter, so a pause banks
 * what ran and a resume takes a new start — and a tab the browser threw into
 * the background does not quietly consume a round nobody could follow: a
 * visibility change or a media interruption PAUSES it (src/followAlong.ts).
 *
 * ONE ROUND, ONE ATTEMPT. A round mints one id; the handoff carries it; the
 * contribute screen derives this account's attemptId from it, so the same
 * person finishing on a second device replays one attempt instead of opening a
 * second one (src/moveSession.ts).
 */
import { useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { type GoalPulse } from '../../src/displayPulse';
import { getFirebaseFunctions } from '../../src/firebase';
import {
  buildFollowAlongPlan,
  clockElapsed,
  clockRunning,
  INTERRUPTED_NOTICE,
  LENGTH_LABELS,
  mediaPresentation,
  pauseClock,
  pausesForInterruption,
  resetClock,
  secondsLeft,
  startClock,
  stepAt,
  type FollowAlongClock,
  type FollowAlongLength,
} from '../../src/followAlong';
import {
  mintMoveRoundId,
  moveBackHref,
  moveHandoffHref,
  moveHandoffUrl,
  readActivityLabel,
  readMoveRoundId,
} from '../../src/moveSession';
import { wsfTheme } from '../../src/theme';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { readEventParam } from '../../src/ui/eventLinks';
import { kit, NAVY, SAMPLE_TINT } from '../../src/ui/kit';
import { figureKindFor, moveFigureLabel, moveFigureSvgDataUriRaw } from '../../src/ui/moveFigure';
import { encodeQr, qrSvgDataUriRaw } from '../../src/ui/qr';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/** How often the screen re-reads the clock. Fine enough to look alive. */
const TICK_MS = 250;
/** How fast the two poses alternate while the round is running. */
const POSE_MS = 1_200;
/** The same breakpoint, and the same hydration gate, the kiosk and station use. */
const STATION_MIN_WIDTH = 900;
/** The query as the static export sees it: empty, because a shell has none. */
const EMPTY_QUERY: Record<string, string | string[] | undefined> = {};
/** The station panel's QR. Big enough to scan across a table. */
const QR_SIZE = 200;

type Screen =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; unit: string; goalTitle: string; communityName: string };

type Phase = 'ready' | 'countdown' | 'round' | 'finished';

export default function MoveScreen() {
  const params = useLocalSearchParams<{
    goalId?: string;
    groupId?: string;
    event?: string;
    activity?: string;
    from?: string;
    attempt?: string;
  }>();
  const { width: windowWidth } = useWindowDimensions();
  // #418, AND WHY EVERY PARAM ON THIS SCREEN NOW WAITS FOR IT. The static
  // export renders this route as `/move/[goalId]` with NO query string, so
  // anything computed from the query differs from the served HTML on the
  // FIRST client render. React does not repair an ATTRIBUTE mismatch while
  // hydrating, and it never writes that attribute afterwards either, because
  // every later client render computes the same value — so the exported
  // `href="/"` on "Back" stayed on the page for good while the router held
  // the right address all along. Reading the query only once hydrated makes
  // the value CHANGE after mount, which is the one thing that makes React
  // write the attribute. Same rule, same reason, as the kiosk's and the
  // station's layout breakpoint.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const station = hydrated && windowWidth >= STATION_MIN_WIDTH;
  const query = hydrated ? params : EMPTY_QUERY;

  const goalId =
    typeof params.goalId === 'string' && params.goalId !== '' && params.goalId !== '[goalId]'
      ? params.goalId
      : '';
  // THE SELECTION AND THE WAY BACK, PRESERVED. Whatever chose this activity —
  // an event screen, a community page, a combined setup — said so in the URL,
  // and this screen carries all of it: what was selected, which event it
  // belongs to, and where "Back" returns to.
  const groupIdHint = typeof query.groupId === 'string' && query.groupId ? query.groupId : null;
  const eventGoalId = readEventParam(query.event);
  const activityHint = readActivityLabel(query.activity);
  const backHref = moveBackHref({
    from: query.from,
    eventGoalId,
    groupId: groupIdHint,
  });

  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [length, setLength] = useState<FollowAlongLength>('short');
  // The round's own id, minted when a round starts and null before that. It
  // is what makes one round one attempt, wherever it is finished.
  const [roundId, setRoundId] = useState<string | null>(() => readMoveRoundId(params.attempt));
  // A round continued from another device arrives as ?attempt=<id>, and that
  // parameter reaches this screen the same way the rest of the query does —
  // sometimes only from the address bar. Adopt it once, and never over a
  // round already under way, so continuing is one round and starting is not.
  useEffect(() => {
    const carried = readMoveRoundId(params.attempt);
    if (carried) setRoundId((current) => current ?? carried);
  }, [params.attempt]);
  const [clock, setClock] = useState<FollowAlongClock>(resetClock);
  const [stopped, setStopped] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The activity this goal counts, read from the same public pulse the kiosk
  // and the display use. A goal this caller may not read simply has no
  // follow-along; the screen says so rather than guessing an activity.
  useEffect(() => {
    let cancelled = false;
    if (!goalId) {
      setScreen({ kind: 'unavailable' });
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const fn = httpsCallable<{ goalId: string }, GoalPulse>(
          getFirebaseFunctions(),
          'wsfGoalPulse'
        );
        const { data } = await fn({ goalId });
        if (cancelled) return;
        setScreen({
          kind: 'ready',
          unit: data.unit ?? '',
          goalTitle: data.goalTitle ?? '',
          communityName: data.communityDisplayName ?? '',
        });
      } catch {
        if (!cancelled) setScreen({ kind: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goalId]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        if (!cancelled) setReducedMotion(Boolean(on));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The served origin, read once on the client. The static export has none at
  // build time, so the QR is drawn from the address the page actually has.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOrigin(window.location?.origin ?? null);
  }, []);

  const running = clockRunning(clock);

  // One interval, only while something is running.
  useEffect(() => {
    if (!running) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return undefined;
    }
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [running]);

  const unit = screen.kind === 'ready' ? screen.unit : '';
  const plan = useMemo(() => buildFollowAlongPlan({ unit, length }), [unit, length]);

  const elapsedMs = clockElapsed(clock, now);
  const at = stepAt(plan, elapsedMs);
  const started = roundId !== null && (running || clock.heldMs > 0 || stopped);
  const finished = started && (stopped || at.finished);
  const phase: Phase = !started ? 'ready' : finished ? 'finished' : at.step.kind === 'countdown' ? 'countdown' : 'round';

  // A round that ran to its end stops the clock rather than accruing forever.
  useEffect(() => {
    if (finished && clockRunning(clock)) setClock((c) => pauseClock(c, Date.now()));
  }, [finished, clock]);

  const onStart = useCallback(() => {
    // A NEW round is a new attempt. Starting again after a stop mints a fresh
    // id rather than replaying the previous round's, because it is a different
    // round — and the person's entry for it is a different contribution.
    setRoundId((prev) => prev ?? mintMoveRoundId());
    setStopped(false);
    setInterrupted(false);
    setNow(Date.now());
    setClock(startClock(resetClock(), Date.now()));
  }, []);

  const onResume = useCallback(() => {
    setInterrupted(false);
    setNow(Date.now());
    setClock((c) => startClock(c, Date.now()));
  }, []);

  const onPause = useCallback(() => {
    setClock((c) => pauseClock(c, Date.now()));
  }, []);

  // STOP EARLY AND RUN TO THE END ARRIVE AT THE SAME PLACE. Stopping is not a
  // discard: what the person counted is theirs, and the next thing they see is
  // where to enter it.
  const onStop = useCallback(() => {
    setClock((c) => pauseClock(c, Date.now()));
    setStopped(true);
  }, []);

  // Back to the beginning. Nothing was recorded and nothing is kept.
  const onStartOver = useCallback(() => {
    setRoundId(null);
    setStopped(false);
    setInterrupted(false);
    setClock(resetClock());
  }, []);

  // AN INTERRUPTION PAUSES THE ROUND. A tab the person left, a screen that
  // went away, media that stopped on its own: the round is not usable, so it
  // is not consumed. The clock banks what ran and waits.
  //
  // The listener is attached ONCE and reads the clock through a ref: a handler
  // re-bound on every tick would miss the event that arrives between renders,
  // and asking the ref lets the effect decide whether anything was running
  // without a state updater having to cause a second state change.
  const clockRef = useRef(clock);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const interrupt = (reason: string) => {
      if (!pausesForInterruption(reason)) return;
      if (!clockRunning(clockRef.current)) return;
      setInterrupted(true);
      setClock((c) => pauseClock(c, Date.now()));
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') interrupt('hidden');
    };
    const onHide = () => interrupt('pagehide');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  const kind = figureKindFor(unit);
  const media = mediaPresentation(plan.media);
  const alternating = running && at.step.kind === 'round' && !reducedMotion;
  const pose = alternating && Math.floor(elapsedMs / POSE_MS) % 2 === 1 ? 'end' : 'start';

  // What the player's card says right now: the Ready state before a round, the
  // closing step once one is over however it ended, and the live step between.
  const shown = phase === 'ready' ? plan.ready : phase === 'finished' ? plan.steps[plan.steps.length - 1] : at.step;

  const handoffHref = moveHandoffHref({ goalId, roundId, groupId: groupIdHint });
  const handoffUrl = moveHandoffUrl({ origin, goalId, roundId, groupId: groupIdHint });
  const qrUri = useMemo(() => {
    if (!handoffUrl) return null;
    try {
      return qrSvgDataUriRaw(encodeQr(handoffUrl), {
        dark: wsfTheme.colors.primary,
        light: '#FFFFFF',
      });
    } catch {
      return null;
    }
  }, [handoffUrl]);

  const statusLine =
    phase === 'ready'
      ? `Not started · a ${LENGTH_LABELS[length]} round`
      : phase === 'countdown'
        ? `Starting in ${secondsLeft(at.remainingMs)}`
        : phase === 'round'
          ? running
            ? `${secondsLeft(at.remainingMs)} left in this round`
            : `Paused · ${secondsLeft(at.remainingMs)} left in this round`
          : 'Round finished · enter your own count';

  if (screen.kind === 'loading') {
    return (
      <Page station={station} backHref={backHref}>
        <Text style={kit.statusText} testID="wsf-move-loading">
          Loading…
        </Text>
      </Page>
    );
  }

  if (screen.kind === 'unavailable') {
    return (
      <Page station={station} backHref={backHref}>
        <Text style={kit.heading} testID="wsf-move-not-available">
          This follow-along isn’t available
        </Text>
        <Text style={kit.body}>
          The goal it belongs to could not be found, or it isn’t open to this screen.
        </Text>
      </Page>
    );
  }

  const player = (
    <View style={styles.playerColumn}>
      <View style={kit.card}>
        <Text style={kit.cardTitle} testID="wsf-move-step-title">
          {shown.title}
        </Text>
        <Text style={kit.body} testID="wsf-move-step-rule">
          {shown.detail}
        </Text>

        {/*
          THE HONEST DEFAULT STATE. A poster when the goal supplies one; this
          app's own drawing when it does not — labelled as exactly that.
        */}
        <View style={styles.figureRow} testID="wsf-move-figure">
          {media.posterUri ? (
            <Image
              source={{ uri: media.posterUri }}
              style={styles.figure}
              resizeMode="contain"
              accessibilityLabel={`${media.label}: ${plan.unit}.`}
              testID="wsf-move-poster"
            />
          ) : (
            <>
              <Image
                source={{ uri: moveFigureSvgDataUriRaw({ kind, pose }) }}
                style={styles.figure}
                resizeMode="contain"
                accessibilityLabel={moveFigureLabel(kind, pose)}
                testID="wsf-move-figure-image"
              />
              {/*
                With reduced motion asked for, nothing alternates: both
                positions are shown side by side instead, so the shape reads.
              */}
              {reducedMotion ? (
                <Image
                  source={{ uri: moveFigureSvgDataUriRaw({ kind, pose: 'end', accent: true }) }}
                  style={styles.figure}
                  resizeMode="contain"
                  accessibilityLabel={moveFigureLabel(kind, 'end')}
                  testID="wsf-move-reduced-motion"
                />
              ) : null}
            </>
          )}
        </View>
        <View style={styles.mediaNote} testID="wsf-move-media">
          {/*
            A plain tinted label rather than kit.badge: the badge clips what it
            cannot fit, and this line must stay readable at 195 px wide.
          */}
          <View style={styles.mediaBadge}>
            <Text style={styles.mediaBadgeText} testID="wsf-move-media-label">
              {media.label}
            </Text>
          </View>
          <Text style={kit.caption} testID="wsf-move-media-note">
            {media.note}
          </Text>
        </View>

        {/*
          The count in reads as a bare 3 · 2 · 1, the way the reference player
          in .claude/workout-player-spec.md counts a member in; the round reads
          as seconds remaining.
        */}
        <Text style={styles.timer} testID="wsf-move-timer">
          {phase === 'ready'
            ? `${plan.roundSeconds}s`
            : phase === 'finished'
              ? 'Done'
              : phase === 'countdown'
                ? `${secondsLeft(at.remainingMs)}`
                : `${secondsLeft(at.remainingMs)}s`}
        </Text>
        <Text style={kit.cardMeta} testID="wsf-move-round">
          {`${plan.countdownSeconds}s count in · ${plan.roundSeconds}s round`}
        </Text>
        <Text style={kit.statusText} testID="wsf-move-status">
          {statusLine}
        </Text>
        {interrupted ? (
          <Text style={kit.caption} testID="wsf-move-interrupted">
            {INTERRUPTED_NOTICE}
          </Text>
        ) : null}
      </View>

      {phase === 'finished' ? (
        <View style={kit.card} testID="wsf-move-finished">
          <Text style={kit.cardTitle}>That’s the round</Text>
          <Text style={kit.body}>
            {`Enter the number of ${plan.unit} you counted yourself. This screen counted nothing.`}
          </Text>
          <ButtonLink
            href={handoffHref}
            label="Enter my reps"
            style={kit.primaryButton}
            textStyle={kit.primaryButtonText}
            testID="wsf-move-contribute"
          />
          <Pressable onPress={onStartOver} style={kit.secondaryButton} testID="wsf-move-again">
            <Text style={kit.secondaryButtonText}>Start another round</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={kit.card}>
            <Text style={kit.cardTitle}>Round length</Text>
            <View style={styles.row}>
              <Choice
                label={LENGTH_LABELS.short}
                selected={length === 'short'}
                onPress={() => {
                  onStartOver();
                  setLength('short');
                }}
                testID="wsf-move-length-short"
              />
              <Choice
                label={LENGTH_LABELS.full}
                selected={length === 'full'}
                onPress={() => {
                  onStartOver();
                  setLength('full');
                }}
                testID="wsf-move-length-full"
              />
            </View>
          </View>

          <View style={styles.row}>
            {running ? (
              <Pressable onPress={onPause} style={kit.primaryButton} testID="wsf-move-pause">
                <Text style={kit.primaryButtonText}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={started ? onResume : onStart}
                style={kit.primaryButton}
                testID="wsf-move-start"
              >
                <Text style={kit.primaryButtonText}>{started ? 'Resume' : 'Start'}</Text>
              </Pressable>
            )}
            {started ? (
              <Pressable onPress={onStop} style={kit.secondaryButton} testID="wsf-move-stop">
                <Text style={kit.secondaryButtonText}>Stop and enter my reps</Text>
              </Pressable>
            ) : (
              <ButtonLink
                href={handoffHref}
                label="Enter my reps"
                style={kit.secondaryButton}
                textStyle={kit.secondaryButtonText}
                testID="wsf-move-contribute"
              />
            )}
          </View>
        </>
      )}

      {/*
        The whole point, stated on screen and never implied: this screen does
        not count and does not record. The member adds their own number where
        they always have.
      */}
      <Text style={kit.caption} testID="wsf-move-self-count">
        {plan.selfCountNote}
      </Text>
    </View>
  );

  // THE PANEL. On a station it stands beside the player and stays there for
  // the whole session — the person at the screen can always see where they
  // are and always has something to scan. On a phone the same panel simply
  // stacks underneath, because there is no second column to stand in.
  const panel = (
    <View style={station ? styles.panelStation : styles.panelStacked} testID="wsf-move-panel">
      <Text style={kit.eyebrow}>At this screen</Text>
      <Text style={kit.cardTitle} testID="wsf-move-panel-status">
        {statusLine}
      </Text>
      {qrUri ? (
        <>
          <Image
            source={{ uri: qrUri }}
            style={styles.qr}
            resizeMode="contain"
            accessibilityLabel="QR code: open this round’s entry page on your own phone."
            testID="wsf-move-panel-qr"
          />
          <Text style={kit.caption} testID="wsf-move-panel-note">
            Scan to enter your own count on your own phone. It opens the entry page for this goal
            and asks you to sign in as yourself.
          </Text>
        </>
      ) : (
        <Text style={kit.caption} testID="wsf-move-panel-note">
          Enter your own count on this screen when the round is finished.
        </Text>
      )}
    </View>
  );

  return (
    <Page station={station} phase={phase} backHref={backHref}>
      <Text style={kit.eyebrow} testID="wsf-move-heading">
        Follow along
      </Text>
      <Text style={kit.heading}>{screen.goalTitle || plan.unit}</Text>
      {activityHint || screen.communityName ? (
        <Text style={kit.intro} testID="wsf-move-activity">
          {[screen.communityName, activityHint ?? plan.unit].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      <View style={station ? styles.stationRow : styles.stack}>
        {player}
        {panel}
      </View>
    </Page>
  );
}

function Choice(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[kit.pill, props.selected ? styles.pillSelected : null]}
      testID={props.testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      {...({ 'aria-checked': props.selected } as Record<string, unknown>)}
    >
      <Text style={props.selected ? styles.pillTextSelected : kit.pillText}>{props.label}</Text>
    </Pressable>
  );
}

function Page({
  children,
  station,
  phase,
  backHref,
}: {
  children: React.ReactNode;
  station: boolean;
  phase?: Phase;
  backHref: string;
}) {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
      <View
        style={station ? styles.columnStation : kit.column}
        testID="wsf-move-screen"
        {...({
          dataSet: {
            layout: station ? 'station' : 'phone',
            ...(phase ? { phase } : {}),
          },
        } as Record<string, unknown>)}
      >
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-move-wordmark" />
          <ButtonLink
            href={backHref}
            label="Back"
            style={kit.chromeLink}
            textStyle={kit.chromeLinkText}
            testID="wsf-move-back"
          />
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  columnStation: { maxWidth: 1160, width: '100%', gap: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  stack: { gap: 18 },
  // The station's two columns. The panel keeps its own width and never sits
  // under the player's controls; the player takes what is left.
  stationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  playerColumn: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 18 },
  panelStation: {
    width: 320,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E7E1',
    padding: 16,
    gap: 10,
    alignItems: 'flex-start',
  },
  panelStacked: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E3E7E1',
    padding: 16,
    gap: 10,
    alignItems: 'flex-start',
  },
  qr: { width: QR_SIZE, height: QR_SIZE, alignSelf: 'center' },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  figure: { width: 100, height: 120 },
  mediaNote: { gap: 6, alignItems: 'flex-start' },
  mediaBadge: {
    backgroundColor: SAMPLE_TINT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexShrink: 1,
  },
  mediaBadgeText: {
    color: NAVY,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  timer: {
    color: wsfTheme.colors.text,
    fontSize: 46,
    lineHeight: 50,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pillSelected: { backgroundColor: wsfTheme.colors.text, borderColor: wsfTheme.colors.text },
  pillTextSelected: { color: '#F7F5F0', fontSize: 15, fontWeight: '700' },
});
