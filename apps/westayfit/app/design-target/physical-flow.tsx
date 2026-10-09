import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PhysicalFlowBoard } from '../../src/ui/designTarget/PhysicalFlowBoard';

/** The physical-flow board, behind the same gate as the other target routes. */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const FRAME_BANNER = 22;
const W = 1920;
const H = 1080;

export default function PhysicalFlowPreview() {
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
    <ScrollView contentContainerStyle={st.page} testID="wsf-target-physical-flow-batch">
      <View style={st.banner}>
        <Text style={st.bannerText}>
          TARGET / CONCEPT — NOT IMPLEMENTED · THE PHYSICAL PRODUCT, END TO END
        </Text>
      </View>
      <Text style={st.cellLabel}>Physical flow board · {`${W}x${H}`}</Text>
      <View
        style={[st.frame, { width: W, height: H + FRAME_BANNER }]}
        testID={`wsf-frame-flow-board-${W}x${H}`}
      >
        <View style={st.frameBanner} testID={`wsf-frame-banner-flow-board-${W}x${H}`}>
          <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
        </View>
        <View style={{ width: W, height: H }}>
          <PhysicalFlowBoard />
        </View>
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#D9D5CC', padding: 20, gap: 12 },
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
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
