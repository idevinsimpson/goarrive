/**
 * FOLLOW ALONG — the movement screen.
 *
 * A timed follow-along for one goal's activity, on a phone in someone's hand
 * or on a station screen in a hall. It is WSF's own.
 *
 * WHERE THE PLAYER ITSELF LIVES. The round, the clock and the picture are
 * `useFollowAlongSession` + `<FollowAlongCard>`, because the same player also
 * runs inside a turn — at a station calling people up, and on the phone of the
 * person whose turn it is. This route is one of three hosts, and owns only
 * what is its own: the address it was opened at, the goal it read, the way
 * back, and the handoff to the contribute screen.
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { type GoalPulse } from '../../src/displayPulse';
import { getFirebaseFunctions } from '../../src/firebase';
import { useFollowAlongSession, type FollowAlongPhase } from '../../src/followAlongSession';
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
import { FollowAlongCard } from '../../src/ui/FollowAlongCard';
import { kit } from '../../src/ui/kit';
import { encodeQr, qrSvgDataUriRaw } from '../../src/ui/qr';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

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
  const [origin, setOrigin] = useState<string | null>(null);

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

  // The served origin, read once on the client. The static export has none at
  // build time, so the QR is drawn from the address the page actually has.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOrigin(window.location?.origin ?? null);
  }, []);

  const unit = screen.kind === 'ready' ? screen.unit : '';
  // A NEW round is a new attempt; a round already adopted from ?attempt= is
  // continued rather than replaced.
  const onRoundStart = useCallback(() => setRoundId((prev) => prev ?? mintMoveRoundId()), []);
  const onRoundReset = useCallback(() => setRoundId(null), []);
  const session = useFollowAlongSession({ unit, roundId, onRoundStart, onRoundReset });

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

  // THE HANDOFF, AND IT IS THE ONLY WAY OFF THIS SCREEN WITH A NUMBER. Both
  // the finished round and the not-yet-started state offer the same address;
  // neither of them sends anything.
  const enterMyReps = (style: 'primary' | 'secondary') => (
    <ButtonLink
      href={handoffHref}
      label="Enter my reps"
      style={style === 'primary' ? kit.primaryButton : kit.secondaryButton}
      textStyle={style === 'primary' ? kit.primaryButtonText : kit.secondaryButtonText}
      testID="wsf-move-contribute"
    />
  );

  // THE PANEL. On a station it stands beside the player and stays there for
  // the whole session — the person at the screen can always see where they
  // are and always has something to scan. On a phone the same panel simply
  // stacks underneath, because there is no second column to stand in.
  const panel = (
    <View style={station ? styles.panelStation : styles.panelStacked} testID="wsf-move-panel">
      <Text style={kit.eyebrow}>At this screen</Text>
      <Text style={kit.cardTitle} testID="wsf-move-panel-status">
        {session.statusLine}
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
    <Page station={station} phase={session.phase} backHref={backHref}>
      <Text style={kit.eyebrow} testID="wsf-move-heading">
        Follow along
      </Text>
      <Text style={kit.heading}>{screen.goalTitle || session.plan.unit}</Text>
      {activityHint || screen.communityName ? (
        <Text style={kit.intro} testID="wsf-move-activity">
          {[screen.communityName, activityHint ?? session.plan.unit].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      <View style={station ? styles.stationRow : styles.stack}>
        <FollowAlongCard
          session={session}
          wide={station}
          inRow={station}
          testIDPrefix="wsf-move"
          finishedAction={enterMyReps('primary')}
          idleSecondary={enterMyReps('secondary')}
        />
        {panel}
      </View>
    </Page>
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
  phase?: FollowAlongPhase;
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
  stack: { gap: 18 },
  // The station's two columns. The panel keeps its own width and never sits
  // under the player's controls; the player takes what is left.
  stationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  // THE RAIL IS A THIRD OF THE SCREEN, and the movement owns the other two.
  // A fixed 320 left the player's column stretched across whatever remained
  // on a venue screen, which is where the empty acreage came from.
  panelStation: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 260,
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
});
