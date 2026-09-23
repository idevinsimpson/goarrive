import { StyleSheet, Text, View } from 'react-native';

import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  CREAM,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
} from '../kit';

/**
 * THE PHYSICAL PRODUCT, END TO END — one inspectable board.
 *
 * Every other target in this atlas draws a screen. This one draws the thing
 * the screens are for: two equivalent interactive stations in a room, the way
 * people get from a phone into them, what happens during a turn, how a count
 * is recorded and reconciled, and how the screen is left for the next person —
 * with the collective display running beside all of it rather than inside it.
 *
 * WHY IT EXISTS. A route-by-route atlas silently redefines the product as the
 * union of what the routes currently do. That is backwards: a route's current
 * limitation is not the destination. This board states the destination and
 * marks each step for what it actually is today, so the gap is inspectable
 * instead of implied.
 *
 * EVERY STATUS BELOW IS FROM THE SOURCE, not from memory:
 *
 *   BUILT          a route or callable does this today.
 *   TARGET ONLY    drawn in this atlas, not implemented.
 *   PROOF NEEDED   the server contract holds and is unit-tested, but the
 *                  behaviour has never been driven end to end in a room.
 *   SEAM           named capability the product does not have. Not drawn as
 *                  though it did.
 *
 * TWO STATIONS ARE REAL. `wsfCallNext` takes a `stationId` and a secret,
 * stations are enrolled into numbered slots, and
 * `tests/callable/wsf-turn.test.ts` has "two stations calling at the same
 * instant cannot assign the same person" — a counter makes the contention
 * unconditional rather than leaving it to the two stations happening to pick
 * the same row. Since staging run 45 the contract has also run HOSTED: its
 * turn-service row enrolled two stations, called a member, let the lease
 * expire, rejoined them and recorded once from the phone with both retries
 * adding nothing. What has never been driven end to end is a room: two paired
 * screens, a real line, and people walking between them.
 *
 * The accepted render of this board (review/physical-flow/) predates the
 * copy correction below; it is the historical reference and is not repainted
 * by a source edit.
 */

type Status = 'built' | 'target' | 'proof' | 'seam';

const STATUS_LABEL: Record<Status, string> = {
  built: 'BUILT',
  target: 'TARGET ONLY',
  proof: 'PROOF NEEDED',
  seam: 'SEAM',
};

function Chip({ status }: { status: Status }) {
  return (
    <View style={[s.chip, s[`chip_${status}` as const]]}>
      <Text style={[s.chipText, s[`chipText_${status}` as const]]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

function Step({
  n,
  title,
  where,
  status,
  body,
  note,
}: {
  n: string;
  title: string;
  where: string;
  status: Status;
  body: string;
  note?: string;
}) {
  return (
    <View style={s.step}>
      <View style={s.stepHead}>
        <View style={s.stepNum}>
          <Text style={s.stepNumText}>{n}</Text>
        </View>
        <Text style={s.stepTitle}>{title}</Text>
      </View>
      <Chip status={status} />
      <Text style={s.stepWhere}>{where}</Text>
      <Text style={s.stepBody}>{body}</Text>
      {note ? <Text style={s.stepNote}>{note}</Text> : null}
    </View>
  );
}

function Arrow() {
  return (
    <View style={s.arrow}>
      <View style={s.arrowLine} />
      <View style={s.arrowHead} />
    </View>
  );
}

export function PhysicalFlowBoard() {
  return (
    <View style={s.board} testID="wsf-target-physical-flow">
      <View style={s.header}>
        <WsfWordmark variant="white" height={38} />
        <View style={s.headerText}>
          <Text style={s.eyebrow}>THE PHYSICAL PRODUCT, END TO END</Text>
          <Text style={s.title}>One event, two stations, one shared total</Text>
        </View>
        <View style={s.legend}>
          {(['built', 'proof', 'target', 'seam'] as Status[]).map((k) => (
            <View key={k} style={s.legendItem}>
              <Chip status={k} />
            </View>
          ))}
        </View>
      </View>

      {/* THE ROOM: two equivalent screens, and what stands beside them. */}
      <View style={s.room}>
        <View style={s.roomLane}>
          <Text style={s.laneLabel}>IN THE ROOM</Text>
          <View style={s.stationRow}>
            <View style={s.stationBox}>
              <Text style={s.stationName}>Station 1</Text>
              <Text style={s.stationMeta}>paired · calls from the same line</Text>
            </View>
            <View style={s.stationBox}>
              <Text style={s.stationName}>Station 2</Text>
              <Text style={s.stationMeta}>paired · calls from the same line</Text>
            </View>
          </View>
          <Text style={s.laneNote}>
            Equivalent, not primary-and-backup. Either may call the next person; the server
            guarantees they cannot call the same one.
          </Text>
        </View>
        <View style={s.displayLane}>
          <Text style={s.laneLabel}>BESIDE IT, NOT INSIDE IT</Text>
          <View style={s.displayBox}>
            <Text style={s.stationName}>Collective display</Text>
            <Text style={s.stationMeta}>/display/[goalId] · 800×1280 · 1280×800 · 1920×1080</Text>
            <Text style={s.displayBody}>
              Shows the shared total and recent movement. Takes no input, runs no turn, and holds
              no session.
            </Text>
            <View style={s.displaySeam}>
              <Chip status="seam" />
              <Text style={s.displaySeamText}>
                QR-to-join has no source on this route: it imports no join URL and no encoder,
                though /station/[goalId] builds and renders one. Drawn in Batch F, named here.
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* THE JOURNEY, left to right. */}
      <View style={s.flow}>
        <Step
          n="1"
          title="Getting in"
          where="/station/[goalId] shows two QRs · /join/[joinCode] · /event/[goalId]"
          status="built"
          body="One code admits somebody to the community; the other takes a member already in it to this event. They are labelled by what they do."
          note="A device asked whose screen it is before any account is made."
        />
        <Arrow />
        <Step
          n="2"
          title="Phone or the line"
          where="/event/[goalId]"
          status="built"
          body="Two ways on, and you are in neither until you pick one. Opening either puts nobody in a line."
          note="The name a screen will read is chosen here, by the person it is about, before anything is sent."
        />
        <Arrow />
        <Step
          n="3"
          title="Which activity"
          where="/event/[goalId] · the event's frozen activity list"
          status="built"
          body="Chosen from what this event is configured to count. A scan decides nothing — the scanned activity is offered like any other and never pre-selected."
          note="No global movement catalog exists, and none is drawn."
        />
        <Arrow />
        <Step
          n="4"
          title="The movement"
          where="/move/[goalId] · the same player the station runs"
          status="built"
          body="A clock and a movement. It watches nobody and counts nothing."
          note="The QR handoff belongs on the shared screen only — the route does not gate it by layout. Batch G draws it correctly."
        />
        <Arrow />
        <Step
          n="5"
          title="Your own count"
          where="/contribute/[goalId] · the queue's record panel · the station's"
          status="built"
          body="One attempt id, minted once. Recording on the phone and at the station are the same write under the same key — whichever lands first counts, and the other adds nothing."
          note="Reconciliation is the design: an unresolved attempt is kept so the same id replays to the original receipt instead of booking a second contribution."
        />
        <Arrow />
        <Step
          n="6"
          title="Clean for the next person"
          where="/station/[goalId] · /contribute/[goalId]?kiosk=1"
          status="built"
          body="The moment a turn is recorded every name on the station is gone; ten seconds later the code and number go too. Finish signs the kiosk out and returns it to its start screen."
          note="SEAM: nothing deletes a turn entry and there is no TTL, so the chosen name is not erased from storage — only from the screen."
        />
      </View>

      <View style={s.footRow}>
        <View style={s.footBlock}>
          <Text style={s.footLabel}>WHAT HAS NEVER BEEN DRIVEN IN A ROOM</Text>
          <Text style={s.footBody}>
            Two paired screens, a real line and people walking between them. The server contract
            holds, is unit-tested and ran hosted on staging (run 45); the room is not.
          </Text>
          <Chip status="proof" />
        </View>
        <View style={s.footBlock}>
          <Text style={s.footLabel}>WHAT IS DRAWN BUT NOT BUILT TO ITS TARGET</Text>
          <Text style={s.footBody}>
            Batches C–G: their routes and callables exist and run today; the accepted drawings
            stay reference. Target existence is not visual acceptance and is not implementation.
          </Text>
          <Chip status="target" />
        </View>
        <View style={s.footBlock}>
          <Text style={s.footLabel}>WHAT THE PRODUCT DOES NOT HAVE</Text>
          <Text style={s.footBody}>
            Turn-name retention · private dated history · Champion administration screens ·
            join-by-code as its own route · QR-to-join on the display.
          </Text>
          <Chip status="seam" />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  board: { flex: 1, backgroundColor: NAVY, padding: 34, gap: 20 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  headerText: { flexShrink: 1, minWidth: 0, gap: 3 },
  eyebrow: { color: PROGRESS_GREEN, fontSize: 14, fontWeight: '900', letterSpacing: 2.4 },
  title: { color: ON_NAVY, fontSize: 34, lineHeight: 40, fontWeight: '900', letterSpacing: -1 },
  legend: { flexDirection: 'row', gap: 8, marginLeft: 'auto', flexWrap: 'wrap', maxWidth: 460 },
  legendItem: {},

  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1 },
  chip_built: { backgroundColor: ACTION_GREEN },
  chipText_built: { color: ON_ACTION },
  chip_proof: { backgroundColor: 'rgba(247,245,240,0.16)' },
  chipText_proof: { color: ON_NAVY },
  chip_target: { backgroundColor: 'rgba(145,203,125,0.20)' },
  chipText_target: { color: PROGRESS_GREEN },
  chip_seam: { backgroundColor: 'rgba(255,190,120,0.18)' },
  chipText_seam: { color: '#FFC98A' },

  room: { flexDirection: 'row', gap: 20, minHeight: 190 },
  roomLane: {
    flex: 6,
    minWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  displayLane: { flex: 4, minWidth: 0 },
  laneLabel: { color: PROGRESS_GREEN, fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  stationRow: { flexDirection: 'row', gap: 14 },
  stationBox: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: ACTION_GREEN,
    padding: 14,
    gap: 3,
  },
  stationName: { color: CREAM, fontSize: 19, fontWeight: '900' },
  stationMeta: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 17 },
  laneNote: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  displayBox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 20,
    padding: 18,
    gap: 6,
    marginTop: 6,
  },
  displayBody: { color: ON_NAVY_MUTED, fontSize: 13, lineHeight: 18 },
  displaySeam: { gap: 5, marginTop: 4 },
  displaySeamText: { color: '#FFC98A', fontSize: 12, lineHeight: 17 },

  flow: { flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 4 },
  step: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACTION_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: ON_ACTION, fontSize: 12, fontWeight: '900' },
  stepTitle: { color: CREAM, fontSize: 16, fontWeight: '900', flexShrink: 1, minWidth: 0 },
  stepWhere: { color: PROGRESS_GREEN, fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  stepBody: { color: ON_NAVY, fontSize: 13, lineHeight: 18.5 },
  stepNote: { color: ON_NAVY_MUTED, fontSize: 12, lineHeight: 16.5, marginTop: 'auto' },

  arrow: { width: 16, alignItems: 'center', justifyContent: 'center' },
  arrowLine: { width: 10, height: 2, backgroundColor: 'rgba(247,245,240,0.4)' },
  arrowHead: {
    position: 'absolute',
    right: 1,
    width: 7,
    height: 7,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(247,245,240,0.4)',
    transform: [{ rotate: '45deg' }],
  },

  footRow: { flexDirection: 'row', gap: 16 },
  footBlock: {
    flex: 1,
    minWidth: 0,
    borderTopWidth: 2,
    borderTopColor: 'rgba(247,245,240,0.16)',
    paddingTop: 10,
    gap: 6,
  },
  footLabel: { color: PROGRESS_GREEN, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.5 },
  footBody: { color: ON_NAVY_MUTED, fontSize: 12.5, lineHeight: 17.5 },
});
