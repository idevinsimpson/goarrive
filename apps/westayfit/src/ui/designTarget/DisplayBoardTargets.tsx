import { StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  CREAM,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
} from '../kit';

/**
 * ATLAS BATCH F — THE PUBLIC DISPLAY. TARGETS, NOT IMPLEMENTED PAGES.
 *
 *   /display/[goalId], on four boards:
 *
 *     phone      390x844     a preview in somebody's hand
 *     portrait   800x1280    a picture frame on a wall
 *     landscape  1280x800    a booth screen
 *     wall       1920x1080   a collective display across a room
 *
 *   × ten states. The brief asked for nine; the correction is below.
 *
 * ── ONE SCREEN, FOUR ROOMS ────────────────────────────────────────────────
 *
 * The display is the only surface in this product whose viewing distance is a
 * variable rather than a constant. The same goal has to read at arm's length
 * on a phone, across a hallway on a picture frame, and across a hall on a
 * 1920. What changes between the boards is NOT the content — every board
 * shows the same confirmed values, because a display that hides a number at
 * one size is lying at that size — but the composition:
 *
 *   phone      one unscrollable card; the mark above the number.
 *   portrait   the same column, breathing, at frame scale.
 *   landscape  two columns: the mark on the left, the words on the right.
 *   wall       two columns at hall scale, with the recent strip given room.
 *
 * THE DISPLAY CANNOT SCROLL, on any board. The wide canvas is a fixed
 * two-column page and the phone page is a single unscrollable card, so
 * anything that does not fit is clipped rather than reachable. That is the
 * constraint the whole batch is drawn against.
 *
 * ── WHAT THIS BATCH REFUSES ───────────────────────────────────────────────
 *
 * "UNAVAILABLE" AND "UNAUTHORIZED/REFUSED" ARE ONE STATE, NOT TWO.
 *   The brief lists them separately. The route does not, deliberately: an
 *   unknown goal, a goal this viewer may not see, and a goal whose display
 *   permission was revoked mid-poll all render the same two sentences —
 *   byte-identical to the kiosk's and the station's — so no display can ever
 *   become an oracle for which goals exist. Nine states in the brief, ten
 *   here, and they are not the same nine: two of the brief's collapse into
 *   one, and loading and unreachable are separate surfaces the brief omitted.
 *
 * THE RECENT STRIP CARRIES AN AMOUNT AND AN AGE, AND NOTHING ELSE.
 *   `wsfGoalRecentAdditions` publishes `{amount, unit, at}` with uid and name
 *   stripped server-side. So: no name, no photo, no ordinal, and in
 *   particular NO COUNT OF HOW MANY PEOPLE these lines represent — five lines
 *   may be five people or one, and a display that implied otherwise would be
 *   inventing a crowd.
 *
 * AN EMPTY RECENT LIST RENDERS NOTHING AT ALL.
 *   No empty heading, no "no activity yet" placeholder standing in for an
 *   answer this screen does not have. The zero-state board shows this.
 *
 * A STALE SCREEN KEEPS ITS NUMBER AND SAYS IT IS OLD.
 *   Across a room, a total that vanishes when a poll fails reads as a total
 *   that went away. The confirmed values and their receipt time stay exactly
 *   as they were; the screen stops presenting itself as current.
 *
 * NO PREDICTED TOTAL, NO RANKING, NO COMPARISON, NO INDIVIDUAL IDENTITY.
 *
 * ── THE HEADLINES ARE THE ROUTE'S OWN, AND THERE ARE ONLY THREE ───────────
 *
 *   openAtZero    "See what WE can do."
 *   reachedOpen   "WE did it."
 *   closedReached "Look what WE did."
 *
 * Every other phase has none, and the target invents none. A screen with a
 * slogan on it at every moment is a screen nobody reads by the third day.
 */

export type Board = 'phone' | 'portrait' | 'landscape' | 'wall';

function isWide(board: Board): boolean {
  return board === 'landscape' || board === 'wall';
}

/** Type sizes per board. One scale, four tiers — not four designs. */
function scale(board: Board) {
  switch (board) {
    case 'phone':
      return { community: 13, title: 30, period: 14, total: 40, of: 20, status: 17, headline: 22, together: 15, recent: 14, recentHead: 11, chrome: 13, we: 220, pad: 20, gap: 8 };
    case 'portrait':
      return { community: 22, title: 52, period: 20, total: 64, of: 30, status: 27, headline: 34, together: 24, recent: 22, recentHead: 16, chrome: 18, we: 360, pad: 44, gap: 14 };
    case 'landscape':
      return { community: 21, title: 50, period: 19, total: 70, of: 32, status: 28, headline: 36, together: 24, recent: 22, recentHead: 16, chrome: 17, we: 340, pad: 38, gap: 13 };
    case 'wall':
      return { community: 30, title: 82, period: 28, total: 122, of: 52, status: 44, headline: 58, together: 36, recent: 32, recentHead: 22, chrome: 24, we: 580, pad: 56, gap: 22 };
  }
}

function Texture() {
  return (
    <View pointerEvents="none" style={s.texture}>
      <View style={[s.band, s.band1]} />
      <View style={[s.band, s.band2]} />
      <View style={[s.band, s.band3]} />
      <View style={s.glow} />
    </View>
  );
}

function Canvas({
  id,
  board,
  children,
}: {
  id: string;
  board: Board;
  children: React.ReactNode;
}) {
  const t = scale(board);
  return (
    <View
      style={[s.canvas, { padding: t.pad }]}
      testID={`wsf-target-f-${id}-${board}`}
    >
      <Texture />
      {children}
    </View>
  );
}

function Chrome({ board, confirmed, stale }: { board: Board; confirmed: string; stale?: boolean }) {
  const t = scale(board);
  return (
    <View style={s.chrome}>
      <WsfWordmark variant="white" height={board === 'phone' ? 20 : board === 'wall' ? 44 : 34} />
      <View style={s.chromeRight}>
        {/*
          THE STALE PILL APPEARS WITHOUT ANYBODY ACTING — the poll simply
          stopped succeeding — so it is a change of standing, not an
          interruption, and it sits beside the receipt time rather than over
          the number.
        */}
        {stale ? (
          <Text style={[s.stalePill, { fontSize: t.chrome }]}>Connection interrupted</Text>
        ) : null}
        <Text style={[s.confirmed, { fontSize: t.chrome }]}>
          {`${stale ? 'Last confirmed' : 'Confirmed'} ${confirmed}`}
        </Text>
      </View>
    </View>
  );
}

type Phase =
  | 'openAtZero'
  | 'building'
  | 'nearGoal'
  | 'reachedOpen'
  | 'closedReached'
  | 'closedUnreached';

const HEADLINE: Partial<Record<Phase, string>> = {
  openAtZero: 'See what WE can do.',
  reachedOpen: 'WE did it.',
  closedReached: 'Look what WE did.',
};

/** The mark and the number: what every board leads with, at its own scale. */
function Figure({
  board,
  completed,
  target,
  unit,
}: {
  board: Board;
  completed: number;
  target: number;
  unit: string;
}) {
  const t = scale(board);
  return (
    <>
      <LivingWeProgress
        completed={completed}
        target={target}
        unit={unit}
        width={t.we}
        surface="dark"
      />
      {/*
        THE NUMBER AND ITS DENOMINATOR ARE TWO LINES, NOT ONE WRAPPED LINE.

        Inline, `of 10,000 push-ups` broke mid-word on the wide boards —
        "push-" on one line and "ups" orphaned below the figure. A hyphenated
        unit at hall scale in a column sized for a number will always find a
        width where that happens, so the denominator gets its own line and
        `numberOfLines={1}` with `adjustsFontSizeToFit` keeps it on one
        whatever the unit is called.
      */}
      <Text
        style={[s.total, { fontSize: t.total, lineHeight: Math.round(t.total * 1.08) }]}
        numberOfLines={1}
      >
        {completed.toLocaleString('en-US')}
      </Text>
      <Text
        style={[s.totalOf, { fontSize: t.of, lineHeight: Math.round(t.of * 1.25) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {`of ${target.toLocaleString('en-US')} ${unit}`}
      </Text>
    </>
  );
}

function Words({
  board,
  phase,
  status,
  together,
  recent,
}: {
  board: Board;
  phase: Phase;
  status: string;
  together?: string;
  recent?: string[];
}) {
  const t = scale(board);
  const headline = HEADLINE[phase];
  return (
    <>
      <Text style={[s.community, { fontSize: t.community }]}>RIVERSIDE CHURCH</Text>
      <Text style={[s.title, { fontSize: t.title, lineHeight: Math.round(t.title * 1.12) }]}>
        October Push-Up Challenge
      </Text>
      <Text style={[s.period, { fontSize: t.period }]}>
        {phase === 'closedReached' || phase === 'closedUnreached'
          ? 'Oct 1 — Oct 31'
          : 'Ends Fri, Oct 31'}
      </Text>
      {headline ? (
        <Text style={[s.headline, { fontSize: t.headline, lineHeight: Math.round(t.headline * 1.15) }]}>
          {headline}
        </Text>
      ) : null}
      <Text
        style={[
          s.status,
          phase === 'nearGoal' ? s.statusNear : null,
          { fontSize: t.status, lineHeight: Math.round(t.status * 1.3) },
        ]}
      >
        {status}
      </Text>
      {/*
        THE TOGETHER LINE IS A CLOSING LINE. It is built only when the goal has
        closed, and it is suppressed on closedReached, where the headline
        already says it. Two celebrations of one fact is one too many.
      */}
      {together ? (
        <Text style={[s.together, { fontSize: t.together, lineHeight: Math.round(t.together * 1.35) }]}>
          {together}
        </Text>
      ) : null}
      {/*
        AN AMOUNT AND AN AGE, AND NOTHING ELSE. No name, no photo, no ordinal,
        and no count of how many people these lines represent — five lines may
        be five people or one. An empty list renders nothing at all rather
        than a heading over a placeholder.
      */}
      {recent && recent.length > 0 ? (
        <View style={s.recent}>
          <Text style={[s.recentHead, { fontSize: t.recentHead }]}>RECENT</Text>
          {recent.map((line) => (
            <Text key={line} style={[s.recentLine, { fontSize: t.recent, lineHeight: Math.round(t.recent * 1.4) }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

function Ready({
  id,
  board,
  phase,
  completed,
  target,
  status,
  together,
  recent,
  stale,
}: {
  id: string;
  board: Board;
  phase: Phase;
  completed: number;
  target: number;
  status: string;
  together?: string;
  recent?: string[];
  stale?: boolean;
}) {
  const t = scale(board);
  const wide = isWide(board);
  return (
    <Canvas id={id} board={board}>
      <Chrome board={board} confirmed="2:14 PM" stale={stale} />
      {wide ? (
        /*
          TWO COLUMNS ON A WIDE BOARD. The mark on the left, the words on the
          right, both centred on the same axis — a single centred column on a
          1920 leaves two thirds of the glass unused and makes the number
          smaller than the room needs.
        */
        <View style={[s.wideBody, { gap: t.pad }]}>
          <View style={s.wideLeft}>
            <Figure board={board} completed={completed} target={target} unit="push-ups" />
          </View>
          <View style={[s.wideRight, { gap: t.gap }]}>
            <Words board={board} phase={phase} status={status} together={together} recent={recent} />
          </View>
        </View>
      ) : (
        <View style={[s.column, { gap: t.gap }]}>
          <Words board={board} phase={phase} status={status} together={together} recent={recent} />
          <View style={s.columnFigure}>
            <Figure board={board} completed={completed} target={target} unit="push-ups" />
          </View>
        </View>
      )}
    </Canvas>
  );
}

function Generic({
  id,
  board,
  headline,
  body,
  action,
}: {
  id: string;
  board: Board;
  headline: string;
  body?: string;
  action?: boolean;
}) {
  const t = scale(board);
  return (
    <Canvas id={id} board={board}>
      <View style={s.genericBlock}>
        <WsfWordmark variant="white" height={board === 'phone' ? 22 : board === 'wall' ? 48 : 40} />
        <Text
          style={[s.genericHeadline, { fontSize: t.title, lineHeight: Math.round(t.title * 1.14) }]}
        >
          {headline}
        </Text>
        {body ? (
          <Text style={[s.genericBody, { fontSize: t.status, lineHeight: Math.round(t.status * 1.35) }]}>
            {body}
          </Text>
        ) : null}
        {action ? (
          <View style={s.recheck}>
            <Text style={[s.recheckText, { fontSize: t.period }]}>Check again</Text>
          </View>
        ) : null}
      </View>
    </Canvas>
  );
}

/* ── the ten states ─────────────────────────────────────────────────────── */

/** Nothing yet. No recent strip at all — an empty list renders nothing. */
export function DisplayZeroTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="zero"
      board={board}
      phase="openAtZero"
      completed={0}
      target={10000}
      status="10,000 to go"
    />
  );
}

export function DisplayBuildingTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="building"
      board={board}
      phase="building"
      completed={6420}
      target={10000}
      status="3,580 to go"
      recent={['+30 push-ups · just now', '+12 push-ups · 2m ago', '+45 push-ups · 6m ago']}
    />
  );
}

export function DisplayNearTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="near"
      board={board}
      phase="nearGoal"
      completed={9580}
      target={10000}
      /* "Only" is the route's own word, and the one place the status line
         changes colour — because near the end is the one moment a room can
         still do something about. */
      status="Only 420 to go"
      recent={['+25 push-ups · just now', '+40 push-ups · 1m ago', '+15 push-ups · 4m ago']}
    />
  );
}

export function DisplayReachedOpenTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="reached-open"
      board={board}
      phase="reachedOpen"
      completed={10840}
      target={10000}
      status="840 beyond our goal · still open"
      recent={['+30 push-ups · just now', '+20 push-ups · 3m ago']}
    />
  );
}

export function DisplayClosedReachedTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="closed-reached"
      board={board}
      phase="closedReached"
      completed={10840}
      target={10000}
      status="840 beyond our goal"
      /* No together line here: the headline "Look what WE did." already says
         it, and the route suppresses it for exactly that reason. */
    />
  );
}

export function DisplayClosedUnreachedTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="closed-unreached"
      board={board}
      phase="closedUnreached"
      completed={6420}
      target={10000}
      /*
        CLOSED SHORT IS STATED, NOT SOFTENED AND NOT DRESSED UP. "Closed at
        64%" is the route's own sentence. What follows it is the together
        line, which is the true and generous thing to say about six thousand
        push-ups nobody had to do.
      */
      status="Closed at 64%"
      together="6,420 push-ups completed together."
    />
  );
}

export function DisplayStaleTarget({ board }: { board: Board }) {
  return (
    <Ready
      id="stale"
      board={board}
      phase="building"
      completed={6420}
      target={10000}
      status="3,580 to go"
      recent={['+30 push-ups · 4m ago', '+12 push-ups · 6m ago']}
      stale
    />
  );
}

export function DisplayLoadingTarget({ board }: { board: Board }) {
  return <Generic id="loading" board={board} headline="Loading display…" />;
}

export function DisplayUnreachableTarget({ board }: { board: Board }) {
  return (
    <Generic
      id="unreachable"
      board={board}
      headline="Connection interrupted"
      body="Nothing has been confirmed yet. Check again when you’re connected."
      action
    />
  );
}

/** Unknown goal, unauthorized goal and revoked permission — one state. */
export function DisplayNotAvailableTarget({ board }: { board: Board }) {
  return (
    <Generic
      id="not-available"
      board={board}
      headline="Nothing to show here"
      body="This display isn’t currently available."
      action
    />
  );
}

/* ── styles ─────────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: NAVY, overflow: 'hidden' },
  texture: { ...StyleSheet.absoluteFillObject },
  band: {
    position: 'absolute',
    height: 70,
    width: 2200,
    backgroundColor: 'rgba(145,203,125,0.08)',
    transform: [{ rotate: '-18deg' }],
  },
  band1: { top: 20, left: 200 },
  band2: { top: 190, left: 320, backgroundColor: 'rgba(145,203,125,0.055)' },
  band3: { top: 360, left: 440, backgroundColor: 'rgba(145,203,125,0.04)' },
  glow: {
    position: 'absolute',
    right: -240,
    top: -300,
    width: 820,
    height: 820,
    borderRadius: 410,
    backgroundColor: 'rgba(34,197,94,0.10)',
  },

  chrome: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  chromeRight: { alignItems: 'flex-end', gap: 4 },
  confirmed: { color: ON_NAVY_MUTED, fontWeight: '700' },
  stalePill: { color: '#FFC9C9', fontWeight: '900' },

  /* narrow boards: one column */
  column: { flex: 1, justifyContent: 'center' },
  columnFigure: { alignItems: 'center', gap: 10, marginTop: 6 },

  /* wide boards: two columns on one axis */
  wideBody: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  wideLeft: { flex: 4, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 14 },
  wideRight: { flex: 6, minWidth: 0, justifyContent: 'center' },

  community: { color: PROGRESS_GREEN, fontWeight: '900', letterSpacing: 2 },
  title: { color: ON_NAVY, fontWeight: '900', letterSpacing: -1.2 },
  period: { color: ON_NAVY_MUTED, fontWeight: '700' },
  headline: { color: CREAM, fontWeight: '900', letterSpacing: -1 },
  total: { color: CREAM, fontWeight: '900', letterSpacing: -2, textAlign: 'center' },
  totalOf: { color: ON_NAVY_MUTED, fontWeight: '800', letterSpacing: 0, textAlign: 'center' },
  status: { color: ON_NAVY_MUTED, fontWeight: '800' },
  statusNear: { color: PROGRESS_GREEN },
  together: { color: ON_NAVY_MUTED },

  recent: {
    marginTop: 10,
    borderLeftWidth: 4,
    borderLeftColor: ACTION_GREEN,
    paddingLeft: 14,
    gap: 2,
  },
  recentHead: { color: PROGRESS_GREEN, fontWeight: '900', letterSpacing: 2 },
  recentLine: { color: ON_NAVY, fontWeight: '700' },

  genericBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  genericHeadline: { color: ON_NAVY, fontWeight: '900', letterSpacing: -1.4, textAlign: 'center' },
  genericBody: { color: ON_NAVY_MUTED, textAlign: 'center', maxWidth: 900 },
  recheck: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(247,245,240,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recheckText: { color: ON_NAVY, fontWeight: '800' },
});
