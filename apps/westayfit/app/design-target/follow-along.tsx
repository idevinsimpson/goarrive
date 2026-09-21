import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MoveCountdownTarget,
  MoveFinishedTarget,
  MoveLoadingTarget,
  MovePausedTarget,
  MoveReadyTarget,
  MoveRoundTarget,
  MoveUnavailableTarget,
  type MoveLayout,
} from '../../src/ui/designTarget/FollowAlongTargets';

/**
 * ATLAS BATCH G, BEHIND THE SAME GATE AS THE OTHER TARGET ROUTES.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route.
 *
 * The last uncovered route. `station` is decided by WIDTH, not by a flag, so
 * the same URL is both layouts and both are drawn.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 20;

const STATES: { id: string; label: string; tone: string; node: (l: MoveLayout) => React.ReactNode }[] = [
  { id: 'ready', label: 'Not started', tone: 'ordinary', node: (l) => <MoveReadyTarget layout={l} /> },
  { id: 'countdown', label: 'Starting in 3', tone: 'working', node: (l) => <MoveCountdownTarget layout={l} /> },
  { id: 'round', label: 'Round running', tone: 'live', node: (l) => <MoveRoundTarget layout={l} /> },
  { id: 'paused', label: 'Paused', tone: 'quiet', node: (l) => <MovePausedTarget layout={l} /> },
  { id: 'finished', label: 'Round finished', tone: 'counted', node: (l) => <MoveFinishedTarget layout={l} /> },
  { id: 'loading', label: 'Loading', tone: 'working', node: (l) => <MoveLoadingTarget layout={l} /> },
  { id: 'unavailable', label: 'Not available (2 causes)', tone: 'refused', node: (l) => <MoveUnavailableTarget layout={l} /> },
];

const LAYOUTS: { layout: MoveLayout; label: string; what: string; width: number; height: number }[] = [
  { layout: 'phone', label: '390x844', what: 'a phone in a hand', width: 390, height: 844 },
  { layout: 'station', label: '1280x800', what: 'a station beside a mat', width: 1280, height: 800 },
];

export default function FollowAlongTargetPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-follow-along-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · ATLAS BATCH G · THE FOLLOW-ALONG
        </Text>
      </View>

      <View style={st.contact} testID="wsf-contact-batch-g">
        <Text style={st.contactTitle}>Atlas Batch G — the follow-along</Text>
        <Text style={st.contactSub}>
          TARGET / CONCEPT — NOT IMPLEMENTED · one route, seven states, two layouts · 14 frames
        </Text>
        {LAYOUTS.map((l) => (
          <View key={`sheet-${l.layout}`} style={st.contactGroup}>
            <View style={st.contactGroupHead}>
              <Text style={st.contactGroupTitle}>{l.label}</Text>
              <Text style={st.contactGroupRoute}>{l.what}</Text>
              <Text style={st.contactGroupCount}>{STATES.length} states</Text>
            </View>
            <View style={st.contactGrid}>
              {STATES.map((sc) => (
                <View key={`${l.layout}-${sc.id}`} style={{ width: l.width / 2, gap: 4 }}>
                  <Text style={st.contactCaptionText} numberOfLines={1}>
                    {sc.label}
                  </Text>
                  <View style={[st.contactFrame, { width: l.width / 2, height: l.height / 2 }]}>
                    <View
                      style={{
                        width: l.width,
                        height: l.height,
                        transform: [
                          { scale: 0.5 },
                          { translateX: -l.width / 2 },
                          { translateY: -l.height / 2 },
                        ],
                      }}
                    >
                      {sc.node(l.layout)}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {LAYOUTS.map((l) => (
        <View key={`full-${l.layout}`} style={st.row}>
          <Text style={st.rowTitle}>
            {l.label} — {l.what}
          </Text>
          <View style={st.grid}>
            {STATES.map((sc) => (
              <View key={`${l.layout}-${sc.id}-full`} style={{ width: l.width, gap: 4 }}>
                <Text style={st.cellLabel}>
                  {sc.label} · {l.label} · {sc.tone}
                </Text>
                <View
                  style={[st.frame, { width: l.width, height: l.height + FRAME_BANNER }]}
                  testID={`wsf-frame-g-${sc.id}-${l.label}`}
                >
                  <View style={st.frameBanner} testID={`wsf-frame-banner-g-${sc.id}-${l.label}`}>
                    <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
                  </View>
                  <View style={{ width: l.width, height: l.height }}>{sc.node(l.layout)}</View>
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
    backgroundColor: '#F7F5F0',
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
    backgroundColor: '#F7F5F0',
  },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
});
