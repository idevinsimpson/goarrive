import { StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { WsfWordmark } from '../WsfWordmark';
import { ACTION_GREEN, CREAM, NAVY, ON_NAVY, ON_NAVY_MUTED, PROGRESS_GREEN } from '../kit';

/**
 * PUBLIC DISPLAY — RESPONSIVE TARGET CHECKPOINT. PROPOSED, NOT IMPLEMENTED.
 *
 * W2's packet from the Director's Board 10 verdict (PR #422, `5786952407`):
 * turn the completed 00–11 reference into an IMPLEMENTATION-READY surface for
 * two classes only, rather than repeat board production.
 *
 *     portrait     800×1280    a picture frame on a wall
 *     collective   1920×1080   a display across a room
 *
 * WHAT THIS IS NOT. Not a route, not a page, not a capability. It renders only
 * behind the same gate as every other design-target preview
 * (`EXPO_PUBLIC_WSF_USE_EMULATORS`, which `build-staging.sh` refuses), so no
 * deployed artifact can serve it. Nothing here changes polling, auth, the
 * backend or the production display route.
 *
 * ── WHY A NEW COMPONENT RATHER THAN BATCH F's ─────────────────────────────
 *
 * The locked direction is `DisplayBoardTargets`, and this follows it: the same
 * navy canvas and texture, the same one-scale-four-tiers idea, the same
 * Figure / Words / Chrome structure, the same tokens, and the product's own
 * `LivingWeProgress` rather than a drawn mark. What it does NOT do is edit
 * that file, because Batch F's forty accepted frames are rendered from it and
 * its strings are fixed to the Riverside Church fixture.
 *
 * THE ONE SUBSTANTIVE DIFFERENCE, AND IT IS THE POINT OF THE CHECKPOINT: this
 * carries the SAME FIXTURE AS THE ACTUAL BEFORE CAPTURES — Maple Street
 * Movers, 241 of 500 squats, confirmed at the same clock. Batch F's targets
 * are drawn on a different community with a different goal, so a
 * BEFORE → TARGET pair across the two sets is not like for like and cannot be
 * read as one change. Here the only thing that differs between the two halves
 * of a pair is the composition, which is what is actually being proposed.
 *
 * ── WHAT THE PROPOSAL CHANGES, AND WHAT IT REFUSES TO ─────────────────────
 *
 * CHANGED, against the three gaps the Director named:
 *
 *   1. 800×1280 gets its own tier. The current build's breakpoint is
 *      `windowWidth >= 900`, so a picture frame takes the phone layout and the
 *      phone mark cap — 320px on 800px of glass. The portrait tier here is a
 *      single column at frame scale with the mark and the number given the
 *      lower half.
 *
 *   2. Room-scale type and status. The current wide build renders the booth's
 *      sizes on a 1920, and `weWidth` caps at 640 so the instrument falls from
 *      42% of the glass to 33%. The collective tier scales both with the room,
 *      and the freshness line scales with it too — today `freshness` has no
 *      wide variant at all, so the one element that tells a room its number is
 *      old is the least legible thing on the wall.
 *
 *      THE MARK SIZES ARE THE ONE PLACE THIS DEPARTS FROM BATCH F's TIERS, and
 *      it departs deliberately: Batch F draws the wall mark at 580px, which is
 *      SMALLER than the 640px the shipped route already gives a 1920. A
 *      proposal that argues the instrument must grow with the room cannot
 *      hand the room a smaller one. So portrait is 440 against the shipped
 *      320, and collective is 760 against the shipped 640, and the producer
 *      asserts both exceed what ships rather than leaving it to the eye.
 *
 *   3. The refusal is CENTRED. The current wide refusal is pinned to the top
 *      edge, because `canvasWide` is `space-between` and the refusal renders
 *      two children. A refusal on a wall is the whole screen's message and
 *      belongs in the middle of it.
 *
 * REFUSED, deliberately:
 *
 *   · No new data. Amount, unit and age, and no count of how many people the
 *     recent lines represent — five lines may be five people or one.
 *   · No member chrome. No tab bar, no MOVE, no identity, no control a viewer
 *     could press except the refusal's own `Check again`.
 *   · The percentage stays. Batch F's drawing omits it and leads on
 *     "N to go"; the shipped route shows both, and dropping a confirmed value
 *     from a proposal is a product decision this checkpoint has no mandate to
 *     take. Both are here, at distance-readable size.
 *   · The QR is a SEAM. It is drawn as a labelled placeholder with no encoded
 *     code, exactly as Batch F has it, and named unbuilt wherever it appears.
 *   · The phone composition is untouched. It is not in this checkpoint at all.
 */

export type NextClass = 'portrait' | 'collective';

/**
 * One scale, two tiers. The portrait tier is Batch F's `portrait`; the
 * collective tier is its `wall`. Reused rather than re-invented, so this
 * proposal is the locked direction applied to the real fixture and not a
 * second opinion about type.
 */
function scale(cls: NextClass) {
  return cls === 'portrait'
    ? { community: 22, title: 52, period: 20, total: 64, of: 30, percent: 30, status: 27, recent: 22, recentHead: 16, chrome: 20, we: 440, pad: 44, refuseTitle: 56, refuseBody: 26 }
    : { community: 30, title: 82, period: 28, total: 122, of: 52, percent: 48, status: 44, recent: 32, recentHead: 22, chrome: 30, we: 760, pad: 56, refuseTitle: 92, refuseBody: 40 };
}

/** The fixture, identical to the actual BEFORE captures in this package. */
const FIXTURE = {
  community: 'MAPLE STREET MOVERS',
  title: 'Squats together this week',
  period: 'Open · Ends Mon, Oct 5',
  completed: 241,
  target: 500,
  unit: 'squats',
  percent: '48.2% complete',
  status: '259 to go',
  confirmed: '11:16 PM',
  recent: [
    '+20 squats · 1 min ago',
    '+35 squats · 4 min ago',
    '+12 squats · 9 min ago',
    '+50 squats · 14 min ago',
    '+25 squats · 22 min ago',
  ],
};

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

function Canvas({ id, cls, children }: { id: string; cls: NextClass; children: React.ReactNode }) {
  const t = scale(cls);
  return (
    <View style={[s.canvas, { padding: t.pad }]} testID={`wsf-pdnext-${id}-${cls}`}>
      <Texture />
      {children}
    </View>
  );
}

/**
 * THE FRESHNESS LINE SCALES WITH THE ROOM. This is change 2, and it is the
 * whole of it: the pill and the receipt time take the tier's chrome size
 * rather than the phone's fixed one.
 */
function Chrome({ cls, stale }: { cls: NextClass; stale?: boolean }) {
  const t = scale(cls);
  return (
    <View style={s.chrome}>
      <WsfWordmark variant="white" height={cls === 'collective' ? 44 : 34} />
      <View style={s.chromeRight}>
        {stale ? (
          <Text style={[s.stalePill, { fontSize: t.chrome }]} testID="wsf-pdnext-stale">
            Connection interrupted
          </Text>
        ) : null}
        <Text style={[s.confirmed, { fontSize: t.chrome }]}>
          {`${stale ? 'Last confirmed' : 'Confirmed'} ${FIXTURE.confirmed}`}
        </Text>
      </View>
    </View>
  );
}

/** The mark and the number, at the tier's scale. One mark, and it is the real one. */
function Figure({ cls }: { cls: NextClass }) {
  const t = scale(cls);
  return (
    <View style={s.figure}>
      <LivingWeProgress
        completed={FIXTURE.completed}
        target={FIXTURE.target}
        unit={FIXTURE.unit}
        width={t.we}
        surface="dark"
        testID="wsf-pdnext-we"
      />
      <Text style={[s.total, { fontSize: t.total, lineHeight: Math.round(t.total * 1.08) }]} numberOfLines={1}>
        {FIXTURE.completed.toLocaleString('en-US')}
      </Text>
      <Text
        style={[s.totalOf, { fontSize: t.of, lineHeight: Math.round(t.of * 1.25) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {`of ${FIXTURE.target.toLocaleString('en-US')} ${FIXTURE.unit}`}
      </Text>
    </View>
  );
}

function Words({ cls }: { cls: NextClass }) {
  const t = scale(cls);
  return (
    <>
      <Text style={[s.community, { fontSize: t.community }]}>{FIXTURE.community}</Text>
      <Text style={[s.title, { fontSize: t.title, lineHeight: Math.round(t.title * 1.12) }]}>
        {FIXTURE.title}
      </Text>
      <Text style={[s.period, { fontSize: t.period }]}>{FIXTURE.period}</Text>
      {/* Both confirmed values, at distance. Neither is dropped to tidy the page. */}
      <Text style={[s.percent, { fontSize: t.percent, lineHeight: Math.round(t.percent * 1.25) }]}>
        {FIXTURE.percent}
      </Text>
      <Text style={[s.status, { fontSize: t.status, lineHeight: Math.round(t.status * 1.3) }]}>
        {FIXTURE.status}
      </Text>
    </>
  );
}

function Recent({ cls }: { cls: NextClass }) {
  const t = scale(cls);
  return (
    <View style={s.recent} testID="wsf-pdnext-recent">
      <Text style={[s.recentHead, { fontSize: t.recentHead }]}>RECENT</Text>
      {FIXTURE.recent.map((line) => (
        <Text key={line} style={[s.recentLine, { fontSize: t.recent, lineHeight: Math.round(t.recent * 1.35) }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** The way in, drawn and named unbuilt. No encoder, no code, no claim. */
function JoinSeam({ cls }: { cls: NextClass }) {
  const t = scale(cls);
  return (
    <View style={s.joinWay} testID="wsf-pdnext-join-seam">
      <View style={[s.joinQr, { width: t.we * 0.22, height: t.we * 0.22 }]} />
      <View style={s.joinWords}>
        <Text style={[s.joinTitle, { fontSize: t.status }]}>Scan to join in</Text>
        <Text style={[s.joinNote, { fontSize: t.period, lineHeight: Math.round(t.period * 1.35) }]}>
          Maple Street Movers · add your own count from your phone
        </Text>
        <Text style={[s.joinSeam, { fontSize: t.recentHead }]}>INTENDED SEAM · NOT WIRED</Text>
      </View>
    </View>
  );
}

/**
 * PORTRAIT, 800×1280 — one column at frame scale, which is the tier the
 * current build does not have. Words above, the mark and the number given the
 * lower half, the recent strip and the seam at the foot.
 */
function PortraitBody() {
  /*
    THE FIGURE ABSORBS THE SLACK, NOT THE SEAM.

    The first draft laid this out with `space-between` over three children and
    the seam block fell off the bottom edge of the 1280 — the one label that
    has to be legible, clipped. A fixed-height canvas that cannot scroll gives
    no second chance, so the words and the seam take their natural height and
    the middle grows or shrinks between them.
  */
  return (
    <View style={s.portraitBody}>
      <View style={s.portraitWords}>
        <Words cls="portrait" />
        <Recent cls="portrait" />
      </View>
      <View style={s.portraitFigure}>
        <Figure cls="portrait" />
      </View>
      <JoinSeam cls="portrait" />
    </View>
  );
}

/** COLLECTIVE, 1920×1080 — two columns at hall scale. */
function CollectiveBody() {
  return (
    <View style={s.wideBody}>
      <View style={s.wideLeft}>
        <Figure cls="collective" />
      </View>
      <View style={s.wideRight}>
        <Words cls="collective" />
        <Recent cls="collective" />
        <JoinSeam cls="collective" />
      </View>
    </View>
  );
}

export function PublicDisplayProgressTarget({ cls }: { cls: NextClass }) {
  return (
    <Canvas id="progress" cls={cls}>
      <Chrome cls={cls} />
      {cls === 'portrait' ? <PortraitBody /> : <CollectiveBody />}
    </Canvas>
  );
}

/**
 * STALE. The number and the mark are RETAINED exactly as confirmed; only the
 * claim changes. The one difference from the progress treatment is the chrome,
 * and that is deliberate: a stale screen that rearranged itself would read as
 * a different screen rather than the same one, older.
 */
export function PublicDisplayStaleTarget({ cls }: { cls: NextClass }) {
  return (
    <Canvas id="stale" cls={cls}>
      <Chrome cls={cls} stale />
      {cls === 'portrait' ? <PortraitBody /> : <CollectiveBody />}
    </Canvas>
  );
}

/**
 * REFUSED — CENTRED. This is change 3. Unknown goal, unauthorized viewer and
 * a permission revoked mid-poll are ONE state and say the route's own two
 * sentences, so no display becomes an oracle for which goals exist. No
 * context, no total, no mark, no list, and no QR: there is nothing here to
 * join.
 */
export function PublicDisplayRefusedTarget({ cls }: { cls: NextClass }) {
  const t = scale(cls);
  return (
    <Canvas id="refused" cls={cls}>
      <View style={s.refuseBody} testID="wsf-pdnext-refused">
        <WsfWordmark variant="white" height={cls === 'collective' ? 56 : 40} />
        <Text
          style={[s.refuseTitle, { fontSize: t.refuseTitle, lineHeight: Math.round(t.refuseTitle * 1.1) }]}
        >
          Nothing to show here
        </Text>
        <Text style={[s.refuseCopy, { fontSize: t.refuseBody, lineHeight: Math.round(t.refuseBody * 1.35) }]}>
          This display isn’t currently available.
        </Text>
        <View style={[s.refuseButton, { paddingHorizontal: t.refuseBody, paddingVertical: t.refuseBody * 0.5 }]}>
          <Text style={[s.refuseButtonText, { fontSize: t.refuseBody }]}>Check again</Text>
        </View>
      </View>
    </Canvas>
  );
}

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
  chromeRight: { alignItems: 'flex-end', gap: 6 },
  confirmed: { color: ON_NAVY_MUTED, fontWeight: '700' },
  stalePill: { color: '#FFC9C9', fontWeight: '900' },

  portraitBody: { flex: 1, paddingTop: 22 },
  portraitWords: { gap: 6 },
  portraitFigure: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  wideBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 56 },
  wideLeft: { flex: 5, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  wideRight: { flex: 6, minWidth: 0, justifyContent: 'center' },

  figure: { alignItems: 'center', gap: 10 },

  community: { color: PROGRESS_GREEN, fontWeight: '900', letterSpacing: 2 },
  title: { color: ON_NAVY, fontWeight: '900', letterSpacing: -1.2 },
  period: { color: ON_NAVY_MUTED, fontWeight: '700' },
  percent: { color: PROGRESS_GREEN, fontWeight: '900' },
  status: { color: ON_NAVY_MUTED, fontWeight: '800' },
  total: { color: CREAM, fontWeight: '900', letterSpacing: -2, textAlign: 'center' },
  totalOf: { color: ON_NAVY_MUTED, fontWeight: '800', textAlign: 'center' },

  recent: { marginTop: 14, borderLeftWidth: 4, borderLeftColor: ACTION_GREEN, paddingLeft: 14, gap: 2 },
  recentHead: { color: PROGRESS_GREEN, fontWeight: '900', letterSpacing: 2 },
  recentLine: { color: ON_NAVY, fontWeight: '700' },

  joinWay: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 },
  joinQr: { borderRadius: 10, backgroundColor: 'rgba(247,245,240,0.22)' },
  joinWords: { flexShrink: 1, gap: 2 },
  joinTitle: { color: ON_NAVY, fontWeight: '900' },
  joinNote: { color: ON_NAVY_MUTED, fontWeight: '700' },
  joinSeam: { color: ACTION_GREEN, fontWeight: '900', letterSpacing: 2, marginTop: 4 },

  refuseBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  refuseTitle: { color: CREAM, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center' },
  refuseCopy: { color: ON_NAVY_MUTED, fontWeight: '700', textAlign: 'center' },
  refuseButton: { borderRadius: 999, borderWidth: 2, borderColor: 'rgba(247,245,240,0.55)' },
  refuseButtonText: { color: CREAM, fontWeight: '900' },
});
