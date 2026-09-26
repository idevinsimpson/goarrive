import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { YouTarget } from '../../src/ui/designTarget/YouTargets';

/** The You targets, behind the same gate as the others. */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

type State = 'member' | 'noCommunity' | 'loading' | 'failed' | 'signedOut';
type Frame = { id: string; label: string; width: number; height: number; node: React.ReactNode };

/**
 * A FULL MATRIX, NOT A SELECTION.
 *
 * The earlier list drew `member` at three classes and everything else at one
 * or two, which the generated coverage mapping surfaced as uneven device
 * coverage. A state that exists at one width and not another is a state
 * somebody loses by turning their phone, so every state is drawn at every
 * class.
 */
const STATES: { key: State; id: string; label: string }[] = [
  { key: 'member', id: 'member', label: 'Member' },
  { key: 'noCommunity', id: 'nocommunity', label: 'No community yet' },
  { key: 'loading', id: 'loading', label: 'Loading' },
  { key: 'failed', id: 'failed', label: 'Goals failed to load' },
  { key: 'signedOut', id: 'signedout', label: 'Signed out' },
];

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

const FRAMES: Frame[] = CLASSES.flatMap((c) =>
  STATES.map((st) => ({
    id: `${st.id}-${c.key}`,
    label: `${st.label} · ${c.key}`,
    width: c.width,
    height: c.height,
    node: <YouTarget state={st.key} />,
  }))
);

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
