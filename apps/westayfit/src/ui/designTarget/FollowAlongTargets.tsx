import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CARD_BORDER,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  PROGRESS_GREEN,
  SURFACE,
  display,
  elevation,
} from '../kit';

/**
 * ATLAS BATCH G — THE FOLLOW-ALONG, ON ITS OWN ROUTE.
 * TARGETS, NOT IMPLEMENTED PAGES.
 *
 *   /move/[goalId]   7 states × 2 layouts — 390x844 phone, 1280x800 station
 *
 * THE LAST UNCOVERED ROUTE. The player COMPONENT already appears inside Batch
 * D's running-turn frame and Batch E's station, because the queue and the
 * station host it. Its own route was never drawn, and it is not the same
 * screen: here there is no turn, no queue, nobody called. It is a timer
 * anybody can start, beside a way to enter what they counted.
 *
 * ── THE ONE THING THIS ROUTE MUST NOT IMPLY ───────────────────────────────
 *
 * THE PLAYER COUNTS NOTHING. It runs a clock and shows a movement; it does
 * not watch anybody, does not count repetitions, and sends nothing anywhere.
 * The only way off this screen with a number is "Enter my reps", which opens
 * the ordinary contribution page and asks the person to sign in as
 * themselves. Both the finished round AND the not-yet-started state offer
 * that same address, and neither of them sends anything — so the target gives
 * it the same words and the same destination in both, and never dresses the
 * finished state as though something had been recorded.
 *
 * THE QR IS A HANDOFF, NOT A LOGIN. "Scan to enter your own count on your own
 * phone. It opens the entry page for this goal and asks you to sign in as
 * yourself." A screen in a room must never be the thing that takes a
 * password, and the panel says what the scan does before anybody scans it.
 *
 * ── TWO LAYOUTS, ONE SESSION ──────────────────────────────────────────────
 *
 * `station` is decided by width (>= STATION_MIN_WIDTH), not by a flag anybody
 * sets, so the same URL is both. On a station the panel stands beside the
 * player for the whole session — the person at the screen can always see
 * where they are and always has something to scan. On a phone the same panel
 * stacks underneath, because there is no second column to stand in.
 *
 * The target draws the same seven states on both, rather than a rich station
 * and a reduced phone: the session is the same session, and a state that
 * exists at one width and not the other would be a state somebody loses by
 * turning their phone.
 */

export type MoveLayout = 'phone' | 'station';

type Phase = 'ready' | 'countdown' | 'round' | 'paused' | 'finished';

function scale(layout: MoveLayout) {
  /*
    SIZED TO THE CANVAS, NOT TO TASTE. The first pass gave the station a
    260px figure and a 132px clock; together with the controls that column
    was ~700px tall inside ~680px of usable height, so the player card rode
    up over the goal title and the Stop button fell off the bottom edge — on
    a screen that cannot scroll. These are the sizes that fit.
  */
  return layout === 'station'
    ? { clock: 92, cue: 26, title: 30, eyebrow: 14, body: 17, status: 22, qr: 170, pad: 26, figure: 150 }
    : { clock: 64, cue: 19, title: 23, eyebrow: 11, body: 13.5, status: 16, qr: 116, pad: 18, figure: 128 };
}

function Chrome({ layout }: { layout: MoveLayout }) {
  return (
    <View style={s.chrome}>
      <WsfWordmark variant="navy" height={layout === 'station' ? 30 : 22} />
      <Text style={s.back}>Back</Text>
    </View>
  );
}

/**
 * THE MOVEMENT, DRAWN AS THE PRODUCT DRAWS IT: a figure and a cue, not a
 * video and not a photograph of a person. Nobody in this product's evidence
 * is a real human being, and a stock body on a screen in a church hall is a
 * promise about who this is for that the product does not make.
 */
function Figure({ layout, dim }: { layout: MoveLayout; dim?: boolean }) {
  const t = scale(layout);
  return (
    <View style={[s.figure, { width: t.figure, height: t.figure }, dim ? s.figureDim : null]}>
      <View style={[s.figureHead, { width: t.figure * 0.2, height: t.figure * 0.2 }]} />
      <View style={[s.figureBody, { width: t.figure * 0.12, height: t.figure * 0.38 }]} />
      <View style={s.figureArms}>
        <View style={[s.limb, { width: t.figure * 0.3, height: t.figure * 0.075 }]} />
        <View style={[s.limb, { width: t.figure * 0.3, height: t.figure * 0.075 }]} />
      </View>
    </View>
  );
}

function Player({
  layout,
  phase,
  clock,
  cue,
}: {
  layout: MoveLayout;
  phase: Phase;
  clock: string;
  cue: string;
}) {
  const t = scale(layout);
  return (
    <View style={[s.player, { padding: t.pad }]}>
      <Figure layout={layout} dim={phase === 'ready' || phase === 'paused'} />
      <Text style={[s.clock, { fontSize: t.clock, lineHeight: Math.round(t.clock * 1.05) }]}>
        {clock}
      </Text>
      <Text style={[s.cue, { fontSize: t.cue, lineHeight: Math.round(t.cue * 1.25) }]}>{cue}</Text>
      {phase === 'round' || phase === 'paused' ? (
        <View style={s.track}>
          <View style={[s.bar, { width: phase === 'paused' ? '48%' : '63%' }]} />
        </View>
      ) : null}
    </View>
  );
}

function Controls({ layout, phase }: { layout: MoveLayout; phase: Phase }) {
  const t = scale(layout);
  const primary = (label: string) => (
    <View style={[s.primary, layout === 'station' ? s.primaryStation : null]}>
      <Text style={[s.primaryText, layout === 'station' ? s.primaryTextStation : null]}>
        {label}
      </Text>
    </View>
  );
  const secondary = (label: string) => (
    <View style={[s.secondary, layout === 'station' ? s.secondaryStation : null]}>
      <Text style={[s.secondaryText, layout === 'station' ? s.secondaryTextStation : null]}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={[s.controls, { gap: layout === 'station' ? 14 : 10 }]}>
      {phase === 'ready' ? (
        <>
          {/*
            THE LENGTH IS CHOSEN BEFORE THE ROUND, AND CHANGING IT ABANDONS
            ONE IN PROGRESS. So it is only offered here, where there is
            nothing to abandon.
          */}
          <View style={s.lengths}>
            {['60 seconds', '2 minutes', '5 minutes'].map((l, i) => (
              <View key={l} style={[s.lengthChip, i === 0 ? s.lengthChipOn : null]}>
                <Text style={[s.lengthChipText, i === 0 ? s.lengthChipTextOn : null]}>{l}</Text>
              </View>
            ))}
          </View>
          {primary('Start')}
          {/*
            "ENTER MY REPS" IS OFFERED BEFORE THE ROUND TOO, and that is
            deliberate rather than an oversight: somebody who already did the
            movement does not have to sit through a timer to record it.
          */}
          {secondary('Enter my reps')}
        </>
      ) : phase === 'countdown' ? (
        secondary('Stop')
      ) : phase === 'round' ? (
        <>
          {secondary('Pause')}
          {secondary('Stop')}
        </>
      ) : phase === 'paused' ? (
        <>
          {primary('Resume')}
          {secondary('Stop')}
        </>
      ) : (
        <>
          {/*
            THE ONE WAY OFF THIS SCREEN WITH A NUMBER — and it is the same
            address the not-started state offers. Nothing has been recorded by
            getting here, and the target does not dress the finished round as
            though something had.
          */}
          {primary('Enter my reps')}
          {secondary('Start over')}
        </>
      )}
    </View>
  );
}

/** The panel: where you are, and something to scan. */
function Panel({ layout, status, qr }: { layout: MoveLayout; status: string; qr: boolean }) {
  const t = scale(layout);
  return (
    <View style={[s.panel, layout === 'station' ? s.panelStation : null]}>
      <Text style={[s.panelEyebrow, { fontSize: t.eyebrow }]}>AT THIS SCREEN</Text>
      <Text style={[s.panelStatus, { fontSize: t.status, lineHeight: Math.round(t.status * 1.3) }]}>
        {status}
      </Text>
      {qr ? (
        <>
          {/*
            THE PLACE A QR GOES, drawn as a plain square. A working code
            rendered into committed evidence is a live link into somebody's
            community sitting in a repository.
          */}
          <View style={[s.qr, { width: t.qr, height: t.qr }]} />
          <Text style={[s.panelNote, { fontSize: t.body, lineHeight: Math.round(t.body * 1.4) }]}>
            Scan to enter your own count on your own phone. It opens the entry page for this goal
            and asks you to sign in as yourself.
          </Text>
        </>
      ) : (
        <Text style={[s.panelNote, { fontSize: t.body, lineHeight: Math.round(t.body * 1.4) }]}>
          Enter your own count on this screen when the round is finished.
        </Text>
      )}
    </View>
  );
}

function Screen({
  id,
  layout,
  phase,
  clock,
  cue,
  status,
}: {
  id: string;
  layout: MoveLayout;
  phase: Phase;
  clock: string;
  cue: string;
  status: string;
}) {
  const t = scale(layout);
  const station = layout === 'station';
  /*
    A SCROLLVIEW, BECAUSE THE ROUTE IS ONE — at BOTH widths. /move/[goalId]
    renders its page inside a ScrollView whether or not the width makes it a
    station, unlike the kiosk, the station screen and the public display,
    whose canvases are fixed Views. A target that drew this page as a fixed
    canvas clipped its own panel off the bottom on a 390 phone and called it a
    layout, which is a defect in the drawing rather than a fact about the
    product. Where a state overflows, the capture takes a second frame
    scrolled to the end.
  */
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.page, { padding: t.pad }]}
      testID={`wsf-target-g-${id}-${layout}`}
    >
      <Chrome layout={layout} />
      <Text style={[s.eyebrow, { fontSize: t.eyebrow }]}>FOLLOW ALONG</Text>
      <Text style={[s.title, { fontSize: t.title, lineHeight: Math.round(t.title * 1.15) }]}>
        October Push-Up Challenge
      </Text>
      <Text style={[s.activity, { fontSize: t.body, lineHeight: Math.round(t.body * 1.4) }]}>
        Riverside Church · counted in push-ups
      </Text>
      <View style={station ? s.columns : s.stack}>
        <View style={station ? s.colPlayer : undefined}>
          <Player layout={layout} phase={phase} clock={clock} cue={cue} />
          <Controls layout={layout} phase={phase} />
        </View>
        <View style={station ? s.colPanel : undefined}>
          <Panel layout={layout} status={status} qr />
        </View>
      </View>
    </ScrollView>
  );
}

function Quiet({
  id,
  layout,
  title,
  body,
}: {
  id: string;
  layout: MoveLayout;
  title: string;
  body?: string;
}) {
  const t = scale(layout);
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.page, { padding: t.pad }]}
      testID={`wsf-target-g-${id}-${layout}`}
    >
      <Chrome layout={layout} />
      <View style={s.quietBlock}>
        <Text style={[layout === 'station' ? display.lg : display.md, s.quietTitle]}>{title}</Text>
        {body ? (
          <Text style={[s.quietBody, { fontSize: t.body, lineHeight: Math.round(t.body * 1.45) }]}>
            {body}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

/* ── the seven states ───────────────────────────────────────────────────── */

export function MoveReadyTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Screen
      id="ready"
      layout={layout}
      phase="ready"
      clock="1:00"
      cue="Ready when you are"
      status="Not started · 60 seconds"
    />
  );
}

export function MoveCountdownTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Screen
      id="countdown"
      layout={layout}
      phase="countdown"
      clock="3"
      cue="Get into position"
      status="Starting in 3"
    />
  );
}

export function MoveRoundTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Screen
      id="round"
      layout={layout}
      phase="round"
      clock="0:38"
      cue="Keep going"
      status="38 left in this round"
    />
  );
}

export function MovePausedTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Screen
      id="paused"
      layout={layout}
      phase="paused"
      clock="0:29"
      cue="Paused"
      status="Paused · 29 left in this round"
    />
  );
}

export function MoveFinishedTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Screen
      id="finished"
      layout={layout}
      phase="finished"
      clock="0:00"
      cue="Round finished"
      status="Round finished · enter your own count"
    />
  );
}

export function MoveLoadingTarget({ layout }: { layout: MoveLayout }) {
  return <Quiet id="loading" layout={layout} title="Loading…" />;
}

export function MoveUnavailableTarget({ layout }: { layout: MoveLayout }) {
  return (
    <Quiet
      id="unavailable"
      layout={layout}
      title="This follow-along isn’t available"
      /*
        ONE SENTENCE FOR TWO CAUSES, as the route writes it: a goal that could
        not be found and a goal not open to this screen read the same, so a
        screen in a room cannot be used to find out which goals exist.
      */
      body="The goal it belongs to could not be found, or it isn’t open to this screen."
    />
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: CREAM },
  page: { flexGrow: 1, backgroundColor: CREAM, gap: 6 },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  back: { color: INK_QUIET, fontSize: 14, fontWeight: '800' },
  eyebrow: { color: ACTION_GREEN_DEEP, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: NAVY, fontWeight: '900', letterSpacing: -0.8 },
  activity: { color: INK_QUIET },

  stack: { flex: 1, minHeight: 0, gap: 12, marginTop: 8 },
  columns: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 22, marginTop: 10 },
  colPlayer: { flex: 6, minWidth: 0, minHeight: 0, gap: 12, justifyContent: 'center' },
  colPanel: { flex: 4, minWidth: 0, minHeight: 0, justifyContent: 'center' },

  player: {
    backgroundColor: NAVY,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flexShrink: 1,
    minHeight: 0,
    ...elevation.hero,
  },
  figure: { alignItems: 'center', justifyContent: 'center' },
  figureDim: { opacity: 0.45 },
  figureHead: { borderRadius: 999, backgroundColor: PROGRESS_GREEN },
  figureBody: { borderRadius: 999, backgroundColor: PROGRESS_GREEN, marginTop: 6 },
  figureArms: { flexDirection: 'row', gap: 10, marginTop: -8 },
  limb: { borderRadius: 999, backgroundColor: 'rgba(145,203,125,0.6)' },
  clock: { color: CREAM, fontWeight: '900', letterSpacing: -2 },
  cue: { color: PROGRESS_GREEN, fontWeight: '800' },
  track: {
    height: 10,
    width: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(247,245,240,0.16)',
    overflow: 'hidden',
    marginTop: 4,
  },
  bar: { height: 10, borderRadius: 999, backgroundColor: ACTION_GREEN },

  controls: { alignItems: 'stretch' },
  lengths: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  lengthChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    paddingHorizontal: 14,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lengthChipOn: { borderColor: ACTION_GREEN_DEEP, backgroundColor: '#F1F9F3' },
  lengthChipText: { color: INK_QUIET, fontSize: 13, fontWeight: '800' },
  lengthChipTextOn: { color: ACTION_GREEN_DEEP },

  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  primaryStation: { minHeight: 68, borderRadius: 20 },
  primaryText: { color: ON_ACTION, fontSize: 17, fontWeight: '900' },
  primaryTextStation: { fontSize: 24 },
  secondary: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: HAIRLINE,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryStation: { minHeight: 62, borderRadius: 20 },
  secondaryText: { color: NAVY, fontSize: 15.5, fontWeight: '800' },
  secondaryTextStation: { fontSize: 21 },

  panel: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    gap: 8,
    alignItems: 'center',
    ...elevation.card,
  },
  panelStation: { padding: 24, gap: 12 },
  panelEyebrow: { color: INK_QUIET, fontWeight: '900', letterSpacing: 1.6 },
  panelStatus: { color: NAVY, fontWeight: '900', textAlign: 'center' },
  qr: { borderRadius: 10, backgroundColor: '#E4E8EC' },
  panelNote: { color: INK_QUIET, textAlign: 'center' },

  quietBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 10 },
  quietTitle: { color: NAVY, textAlign: 'center' },
  quietBody: { color: INK_QUIET, textAlign: 'center', maxWidth: 620 },
});
