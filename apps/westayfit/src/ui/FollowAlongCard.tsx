/**
 * THE FOLLOW-ALONG PLAYER, as a thing that can stand in more than one screen.
 *
 * The picture, the clock, the round-length choice and the transport controls —
 * everything the movement player shows — with the behaviour supplied by
 * `useFollowAlongSession`. `/move/[goalId]` runs it as a whole page; a station
 * runs it above the panel where a turn is recorded; a phone runs it while its
 * owner's turn is live. One player, three hosts, and no second copy of it to
 * drift.
 *
 * IT STILL CANNOT RECORD ANYTHING. There is no control here that sends a
 * number, and the session behind it has none either. What a finished round
 * offers is whatever the HOST puts in `finishedAction`: on `/move` that is a
 * link to the contribute screen, and on a turn it is that surface's own record
 * panel. The player's job ends at "that's the round".
 *
 * TESTIDS ARE PREFIXED because the same player now appears on screens that
 * have their own specs. `/move` keeps `wsf-move-*` exactly as it was, so the
 * route's existing proofs are untouched; the turn hosts get their own handles
 * and a spec can say which player it is looking at.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { INTERRUPTED_NOTICE, LENGTH_LABELS, type FollowAlongLength } from '../followAlong';
import { type FollowAlongSession } from '../followAlongSession';
import { wsfTheme } from '../theme';
import { kit, NAVY, SAMPLE_TINT } from './kit';
import { moveFigureLabel, moveFigureSvgDataUriRaw } from './moveFigure';

export function FollowAlongCard({
  session,
  testIDPrefix,
  finishedAction,
  idleSecondary,
  wide = false,
  inRow = false,
  tone = 'light',
  compact = false,
}: {
  session: FollowAlongSession;
  /** `wsf-move` on the route; each turn host uses its own. */
  testIDPrefix: string;
  /** A venue screen across a room rather than a phone in a hand. The movement
   * and the clock are what carries at that distance, so both grow again.
   * PURELY A MATTER OF SIZE — it says nothing about the layout around it. */
  wide?: boolean;
  /**
   * The host lays this card out in a ROW beside something else, and wants the
   * movement to take two thirds of it.
   *
   * Separate from `wide` on purpose, and the separation is the whole point: a
   * station is wide AND stacks the player in a column, so tying the row flex
   * to `wide` collapsed it to zero height there. Size and layout are two
   * questions and the hosts answer them independently.
   */
  inRow?: boolean;
  /**
   * WHICH GROUND THIS IS STANDING ON.
   *
   * `light` is the cream page the phone and `/move` are: white cards, navy
   * text. `venue` is the navy hall screen a station is, where a white card is
   * not a card — it is a bright rectangle punched into the middle of the room's
   * display, which is exactly what the first render of this looked like.
   *
   * It is the same player either way. The session, the phases, the controls and
   * the rule that none of it can record anything are identical; only the ink
   * and the ground change, because the surface changed.
   */
  tone?: 'light' | 'venue';
  /**
   * A PHONE RUNNING A TURN, where the screen is already carrying a hero with
   * the person's name, code and station above this card.
   *
   * At full size the figure and the clock stacked pushed Start past the bottom
   * of a 390x844 viewport, so the primary action on the screen was something
   * you had to go looking for under a very tall drawing. Compact puts the
   * figure and the clock side by side and takes the drawing down, which is
   * what brings the controls back above the fold.
   */
  compact?: boolean;
  /** What the host offers once the round is over. The only way to record. */
  finishedAction: React.ReactNode;
  /** An optional control the host offers before a round has begun. */
  idleSecondary?: React.ReactNode;
}) {
  const {
    plan,
    length,
    chooseLength,
    lengthIsFixed,
    phase,
    running,
    started,
    interrupted,
    reducedMotion,
    shown,
    remainingSeconds,
    statusLine,
    kind,
    pose,
    media,
    onStart,
    onPause,
    onResume,
    onStop,
    onStartOver,
  } = session;
  const id = (suffix: string) => `${testIDPrefix}-${suffix}`;
  const venue = tone === 'venue';
  // Side by side whenever height is the scarce dimension — a hall canvas that
  // cannot scroll, or a phone that must show Start without one.
  const stageIsRow = venue || compact;
  // One place decides the ink, so no element can be left on the wrong ground.
  const t = {
    card: venue ? styles.venueCard : kit.card,
    title: venue ? styles.venueTitle : kit.cardTitle,
    body: venue ? styles.venueBody : kit.body,
    meta: venue ? styles.venueMeta : kit.cardMeta,
    status: venue ? styles.venueStatus : kit.statusText,
    caption: venue ? styles.venueCaption : kit.caption,
    timer: venue
      ? styles.venueTimer
      : compact
        ? styles.timerCompact
        : wide
          ? styles.timerWide
          : styles.timer,
  };
  // A VENUE FIGURE IS SIZED BY THE ROOM'S SCREEN, NOT BY ITS WIDTH. The hall
  // canvas does not scroll, so everything a running turn needs — the person's
  // name, the movement, the clock, the controls and the count box — has to fit
  // inside it. `figureWide` is for /move at a desk, where the page scrolls.
  const figureStyle = venue
    ? styles.figureVenue
    : compact
      ? styles.figureCompact
      : wide
        ? styles.figureWide
        : styles.figure;

  return (
    <View style={inRow ? styles.playerColumnRow : styles.playerColumn}>
      <View style={t.card}>
        <Text style={t.title} testID={id('step-title')}>
          {shown.title}
        </Text>
        <Text style={t.body} testID={id('step-rule')}>
          {shown.detail}
        </Text>

        {/*
          THE HONEST DEFAULT STATE. A poster when the goal supplies one; this
          app's own drawing when it does not — labelled as exactly that.
        */}
        {/*
          THE STAGE: the figure and the clock, which are the two things a
          person actually follows. On a venue screen they stand SIDE BY
          SIDE — the hall canvas is a fixed height that does not scroll,
          and a large figure stacked on a large clock is taller than the
          room’s screen, which is how the first attempt printed over
          itself. On a phone they stack, because there is no width to
          stand in.
        */}
        <View style={stageIsRow ? styles.venueStage : styles.stageStack} testID={id('stage')}>
          <View style={styles.figureRow} testID={id('figure')}>
            {media.posterUri ? (
              <Image
                source={{ uri: media.posterUri }}
                style={figureStyle}
                resizeMode="contain"
                accessibilityLabel={`${media.label}: ${plan.unit}.`}
                testID={id('poster')}
              />
            ) : (
              <>
                <Image
                  // NAVY INK ON A NAVY WALL IS NO INK. The figure is drawn in
                  // the brand's green on a venue screen — the same pairing the
                  // rest of that screen already uses — and in navy on cream.
                  source={{ uri: moveFigureSvgDataUriRaw({ kind, pose, accent: venue }) }}
                  style={figureStyle}
                  resizeMode="contain"
                  accessibilityLabel={moveFigureLabel(kind, pose)}
                  testID={id('figure-image')}
                />
                {/*
                  With reduced motion asked for, nothing alternates: both
                  positions are shown side by side instead, so the shape reads.
                */}
                {reducedMotion ? (
                  <Image
                    source={{ uri: moveFigureSvgDataUriRaw({ kind, pose: 'end', accent: !venue }) }}
                    style={figureStyle}
                    resizeMode="contain"
                    accessibilityLabel={moveFigureLabel(kind, 'end')}
                    testID={id('reduced-motion')}
                  />
                ) : null}
              </>
            )}
          </View>
          <Text style={t.timer} testID={id('timer')}>
            {phase === 'ready'
              ? `${plan.roundSeconds}s`
              : phase === 'finished'
                ? 'Done'
                : phase === 'countdown'
                  ? `${remainingSeconds}`
                  : `${remainingSeconds}s`}
          </Text>
        </View>
        <View style={styles.mediaNote} testID={id('media')}>
          {/*
            A plain tinted label rather than kit.badge: the badge clips what it
            cannot fit, and this line must stay readable at 195 px wide.
          */}
          <View style={styles.mediaBadge}>
            <Text style={styles.mediaBadgeText} testID={id('media-label')}>
              {media.label}
            </Text>
          </View>
          <Text style={t.caption} testID={id('media-note')}>
            {media.note}
          </Text>
        </View>

        {/*
          The count in reads as a bare 3 · 2 · 1, the way the reference player
          in .claude/workout-player-spec.md counts a member in; the round reads
          as seconds remaining.

          ON A VENUE SCREEN IT STANDS BESIDE THE FIGURE, not under it. The hall
          canvas is a fixed height with no scroll, and a big figure stacked on
          a big clock is taller than the room's screen — which is how the first
          attempt ended up printing over itself.
        */}
        {/*
          The shape of the round, spelled out. NOT on a venue screen: there it
          said "3s count in · 60s round" directly above "Starting in 3" and
          "One 60-second round.", three lines for one fact, on the screen with
          the least room to spare.
        */}
        {venue ? null : (
          <Text style={t.meta} testID={id('round')}>
            {`${plan.countdownSeconds}s count in · ${plan.roundSeconds}s round`}
          </Text>
        )}
        {/*
          The same sentence three times is not emphasis. On a venue screen the
          title already says "Starting", the clock already says "3", and the
          line below already says it is one 60-second round — so this one goes
          there, and the room gets the clock instead of a caption about it. It
          stays everywhere else, where it is the only status on the page.
        */}
        {venue ? null : (
          <Text style={t.status} testID={id('status')}>
            {statusLine}
          </Text>
        )}
        {interrupted ? (
          <Text style={t.caption} testID={id('interrupted')}>
            {INTERRUPTED_NOTICE}
          </Text>
        ) : null}
      </View>

      {phase === 'finished' ? (
        <View style={t.card} testID={id('finished')}>
          <Text style={t.title}>That’s the round</Text>
          <Text style={t.body}>
            {`Enter the number of ${plan.unit} you counted yourself. This screen counted nothing.`}
          </Text>
          {finishedAction}
          <Pressable onPress={onStartOver} style={[kit.secondaryButton, styles.control]} testID={id('again')}>
            <Text style={kit.secondaryButtonText}>Start another round</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/*
            A QUEUED TURN IS ONE 60-SECOND ROUND, so where the length is pinned
            this card is NOT RENDERED — not rendered disabled, and not rendered
            with the two-minute chip quietly ignoring taps. A control that
            cannot do anything is worse than no control, and at a station it is
            a control the room can see somebody press.
          */}
          {lengthIsFixed ? (
            <Text style={t.caption} testID={id('length-fixed')}>
              {`One ${plan.roundSeconds}-second round.`}
            </Text>
          ) : (
            <View style={kit.card}>
              <Text style={kit.cardTitle}>Round length</Text>
              <View style={styles.row}>
                {(['short', 'full'] as FollowAlongLength[]).map((option) => (
                  <Choice
                    key={option}
                    label={LENGTH_LABELS[option]}
                    selected={length === option}
                    onPress={() => chooseLength(option)}
                    testID={id(`length-${option}`)}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.row}>
            {running ? (
              <Pressable onPress={onPause} style={[kit.primaryButton, styles.control]} testID={id('pause')}>
                <Text style={kit.primaryButtonText}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={started ? onResume : onStart}
                style={[kit.primaryButton, styles.control]}
                testID={id('start')}
              >
                <Text style={kit.primaryButtonText}>{started ? 'Resume' : 'Start'}</Text>
              </Pressable>
            )}
            {started ? (
              <Pressable onPress={onStop} style={[kit.secondaryButton, styles.control]} testID={id('stop')}>
                <Text style={kit.secondaryButtonText}>Stop and enter my reps</Text>
              </Pressable>
            ) : (
              (idleSecondary ?? null)
            )}
          </View>
        </>
      )}

      {/*
        The whole point, stated on screen and never implied: this screen does
        not count and does not record. The member adds their own number where
        they always have.
      */}
      {/*
        Stated once per screen, not twice. The movement guide's own line
        already says "Demonstration only — count your own reps." right under
        the figure, which is where a person mid-round is looking.
      */}
      {venue ? null : (
        <Text style={t.caption} testID={id('self-count')}>
          {plan.selfCountNote}
        </Text>
      )}
    </View>
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

const styles = StyleSheet.create({
  playerColumn: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 18 },
  /**
   * TWO THIRDS OF THE ROW, and ONLY in a row.
   *
   * `flexBasis: 0` with `flexGrow: 2` is what makes the movement take two
   * thirds beside a one-third rail. Where this card is stacked in a COLUMN —
   * the phone, and the station, which is wide and stacks anyway — flex-basis
   * is a HEIGHT, so these three properties collapsed the player to nothing,
   * dropped it below the panel on the phone and made it zero-height (and so
   * `hidden`) at a station. Two specs caught it. It is a row style, so it is
   * applied only when the host says it is in a row.
   */
  playerColumnRow: { flexGrow: 2, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  figureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' },
  // THE MOVEMENT IS THE SCREEN. It was 100x120 — a thumbnail sitting in a
  // large empty card, which is what made the player read as a technical
  // fallback rather than something to follow.
  figure: { width: 200, height: 240 },
  figureWide: { width: 320, height: 384 },
  // THE VENUE FIGURE, sized to the room now that the movement owns the width
  // the attract columns used to take.
  figureVenue: { width: 210, height: 252 },
  figureCompact: { width: 128, height: 154 },
  control: { minHeight: 56 },
  // THE VENUE GROUND. No white rectangle: the hall screen IS the card, so the
  // container only spaces its children and the ink is cream on navy.
  venueCard: { gap: 4, alignItems: 'center', minWidth: 0, alignSelf: 'stretch' },
  stageStack: { gap: 12, alignItems: 'flex-start' },
  venueStage: {
    flexDirection: 'row',
    minWidth: 0,
    flexWrap: 'wrap',
    gap: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  venueTitle: { color: '#F7F5F0', fontSize: 22, lineHeight: 28, fontWeight: '800', textAlign: 'center' },
  venueBody: { color: 'rgba(247,245,240,0.88)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  venueMeta: { color: 'rgba(247,245,240,0.7)', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  venueStatus: { color: 'rgba(247,245,240,0.78)', fontSize: 17, lineHeight: 23, textAlign: 'center' },
  venueCaption: { color: 'rgba(247,245,240,0.66)', fontSize: 14, lineHeight: 19, textAlign: 'center' },
  timerCompact: {
    color: wsfTheme.colors.text,
    fontSize: 64,
    lineHeight: 70,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  venueTimer: {
    color: '#F7F5F0',
    fontSize: 96,
    lineHeight: 102,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
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
    fontSize: 88,
    lineHeight: 94,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  timerWide: {
    color: wsfTheme.colors.text,
    fontSize: 140,
    lineHeight: 148,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pillSelected: { backgroundColor: wsfTheme.colors.text, borderColor: wsfTheme.colors.text },
  pillTextSelected: { color: '#F7F5F0', fontSize: 15, fontWeight: '700' },
});
