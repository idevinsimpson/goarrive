import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  DisplayBuildingTarget,
  DisplayClosedReachedTarget,
  DisplayClosedUnreachedTarget,
  DisplayLoadingTarget,
  DisplayNearTarget,
  DisplayNotAvailableTarget,
  DisplayReachedOpenTarget,
  DisplayStaleTarget,
  DisplayUnreachableTarget,
  DisplayZeroTarget,
  type Board,
} from '../../src/ui/designTarget/DisplayBoardTargets';

/**
 * ATLAS BATCH F, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 *
 * A MATRIX, NOT A LIST. Ten states across four boards is the whole of Batch
 * F, and it is laid out as a grid per board so the set can be read as a set —
 * which is what the brief means by a state matrix rather than forty isolated
 * screens.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 22;

const STATES: { id: string; label: string; tone: string; node: (b: Board) => React.ReactNode }[] = [
  { id: 'zero', label: 'Nothing yet', tone: 'open', node: (b) => <DisplayZeroTarget board={b} /> },
  { id: 'building', label: 'Building', tone: 'live', node: (b) => <DisplayBuildingTarget board={b} /> },
  { id: 'near', label: 'Nearly there', tone: 'live', node: (b) => <DisplayNearTarget board={b} /> },
  { id: 'reached-open', label: 'Reached, still open', tone: 'live', node: (b) => <DisplayReachedOpenTarget board={b} /> },
  { id: 'closed-reached', label: 'Closed, reached', tone: 'closed', node: (b) => <DisplayClosedReachedTarget board={b} /> },
  { id: 'closed-unreached', label: 'Closed, short', tone: 'closed', node: (b) => <DisplayClosedUnreachedTarget board={b} /> },
  { id: 'stale', label: 'Last confirmed', tone: 'quiet', node: (b) => <DisplayStaleTarget board={b} /> },
  { id: 'loading', label: 'Loading', tone: 'working', node: (b) => <DisplayLoadingTarget board={b} /> },
  { id: 'unreachable', label: 'Never confirmed', tone: 'error', node: (b) => <DisplayUnreachableTarget board={b} /> },
  { id: 'not-available', label: 'Nothing to show (3 causes)', tone: 'refused', node: (b) => <DisplayNotAvailableTarget board={b} /> },
];

const BOARDS: { board: Board; label: string; what: string; width: number; height: number }[] = [
  { board: 'phone', label: '390x844', what: 'a preview in somebody’s hand', width: 390, height: 844 },
  { board: 'portrait', label: '800x1280', what: 'a picture frame on a wall', width: 800, height: 1280 },
  { board: 'landscape', label: '1280x800', what: 'a booth screen', width: 1280, height: 800 },
  { board: 'wall', label: '1920x1080', what: 'a collective display across a room', width: 1920, height: 1080 },
];

export default function DisplayBoardTargetPreview() {
  if (!previewAllowed()) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          Design-target previews are not part of this build.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-display-boards-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH F · THE PUBLIC DISPLAY
        </Text>
      </View>

      {/*
        THE MATRIX. One contact sheet per board, each showing all ten states
        at a third scale, so a board can be judged as a set before any single
        frame is opened.
      */}
      <View style={st.contact} testID="wsf-contact-batch-f">
        <Text style={st.contactTitle}>Atlas Batch F — the public display</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · one route, ten states, four boards · 40 frames
        </Text>
        {BOARDS.map((b) => (
          <View key={`sheet-${b.board}`} style={st.contactGroup}>
            <View style={st.contactGroupHead}>
              <Text style={st.contactGroupTitle}>{b.label}</Text>
              <Text style={st.contactGroupRoute}>{b.what}</Text>
              <Text style={st.contactGroupCount}>{STATES.length} states</Text>
            </View>
            <View style={st.contactGrid}>
              {STATES.map((sc) => (
                <View key={`${b.board}-${sc.id}`} style={{ width: b.width / 3, gap: 4 }}>
                  <Text style={st.contactCaptionText} numberOfLines={1}>
                    {sc.label}
                  </Text>
                  <View
                    style={[st.contactFrame, { width: b.width / 3, height: b.height / 3 }]}
                  >
                    <View
                      style={{
                        width: b.width,
                        height: b.height,
                        transform: [
                          { scale: 1 / 3 },
                          { translateX: -b.width / 3 },
                          { translateY: -b.height / 3 },
                        ],
                      }}
                    >
                      {sc.node(b.board)}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {BOARDS.map((b) => (
        <View key={`full-${b.board}`} style={st.row}>
          <Text style={st.rowTitle}>
            {b.label} — {b.what}
          </Text>
          <View style={st.grid}>
            {STATES.map((sc) => (
              <View key={`${b.board}-${sc.id}-full`} style={{ width: b.width, gap: 4 }}>
                <Text style={st.cellLabel}>
                  {sc.label} · {b.label} · {sc.tone}
                </Text>
                <View
                  style={[st.frame, { width: b.width, height: b.height + FRAME_BANNER }]}
                  testID={`wsf-frame-f-${sc.id}-${b.label}`}
                >
                  <View style={st.frameBanner} testID={`wsf-frame-banner-f-${sc.id}-${b.label}`}>
                    <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
                  </View>
                  <View style={{ width: b.width, height: b.height }}>{sc.node(b.board)}</View>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#D9D5CC', padding: 20, gap: 20 },
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },

  contact: { backgroundColor: '#F7F5F0', borderRadius: 16, padding: 18, gap: 4 },
  contactTitle: { color: '#0B1F3A', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  contactSub: { color: '#6B7C93', fontSize: 12, fontWeight: '700', marginBottom: 12 },
  contactGroup: { gap: 8, marginBottom: 18 },
  contactGroupHead: { flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  contactGroupTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  contactGroupRoute: { color: '#6B7C93', fontSize: 12, fontWeight: '700' },
  contactGroupCount: { color: '#6B7C93', fontSize: 11, fontWeight: '800' },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  contactCaptionText: { color: '#0B1F3A', fontSize: 11, fontWeight: '900' },
  contactFrame: {
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#0B1F3A',
  },

  row: { gap: 12 },
  rowTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#0B1F3A',
  },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
});
