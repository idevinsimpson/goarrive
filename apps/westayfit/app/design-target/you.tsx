import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { YouTarget } from '../../src/ui/designTarget/YouTargets';

/** The You targets, behind the same gate as the others. */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

type Frame = { id: string; label: string; width: number; height: number; node: React.ReactNode };

const P = { w: 390, h: 844 };
const SHORT = { w: 390, h: 640 };
const BIG = { w: 430, h: 932 };

const FRAMES: Frame[] = [
  {
    id: 'member-390x844',
    label: 'You · signed in, in a community · 390×844',
    width: P.w,
    height: P.h,
    node: <YouTarget state="member" />,
  },
  {
    id: 'nocommunity-390x844',
    label: 'You · signed in, no community yet · 390×844',
    width: P.w,
    height: P.h,
    node: <YouTarget state="noCommunity" />,
  },
  {
    id: 'loading-390x844',
    label: 'You · loading · 390×844',
    width: P.w,
    height: P.h,
    node: <YouTarget state="loading" />,
  },
  {
    id: 'failed-390x844',
    label: 'You · could not be loaded · 390×844',
    width: P.w,
    height: P.h,
    node: <YouTarget state="failed" />,
  },
  {
    id: 'signedout-390x844',
    label: 'You · not signed in · 390×844',
    width: P.w,
    height: P.h,
    node: <YouTarget state="signedOut" />,
  },
  {
    id: 'member-390x640',
    label: 'You · signed in, in a community · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <YouTarget state="member" />,
  },
  {
    id: 'signedout-390x640',
    label: 'You · not signed in · 390×640',
    width: SHORT.w,
    height: SHORT.h,
    node: <YouTarget state="signedOut" />,
  },
  {
    id: 'member-430x932',
    label: 'You · signed in, in a community · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <YouTarget state="member" />,
  },
  {
    id: 'nocommunity-430x932',
    label: 'You · signed in, no community yet · 430×932',
    width: BIG.w,
    height: BIG.h,
    node: <YouTarget state="noCommunity" />,
  },
];

/** The label strip burnt into every captured frame. */
const FRAME_BANNER = 18;

export default function YouPreview() {
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
    <ScrollView contentContainerStyle={st.sheet} testID="wsf-target-you">
      <View style={st.banner}>
        <Text style={st.bannerText}>TARGET / CONCEPT — NOT IMPLEMENTED · YOU</Text>
      </View>
      <View style={st.grid}>
        {FRAMES.map((f) => (
          <View key={f.id} style={[st.cell, { width: f.width }]}>
            <Text style={st.cellLabel}>{f.label}</Text>
            {/* The label travels with the frame; the strip is added to the
                frame's height so the device area below it stays exact. */}
            <View
              style={[st.frame, { width: f.width, height: f.height + FRAME_BANNER }]}
              testID={`wsf-frame-${f.id}`}
            >
              <View style={st.frameBanner} testID={`wsf-frame-banner-${f.id}`}>
                <Text style={st.frameBannerText}>TARGET / CONCEPT — NOT IMPLEMENTED</Text>
              </View>
              <View style={{ height: f.height }}>{f.node}</View>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  sheet: { backgroundColor: '#D9D5CC', padding: 20, gap: 16 },
  banner: { backgroundColor: '#22C55E', paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  bannerText: { color: '#04260F', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { gap: 4 },
  cellLabel: { color: '#0B1F3A', fontSize: 13, fontWeight: '900' },
  frameBanner: {
    height: FRAME_BANNER,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBannerText: { color: '#04260F', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  frame: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#B9B4A9',
    backgroundColor: '#F7F5F0',
  },
});
