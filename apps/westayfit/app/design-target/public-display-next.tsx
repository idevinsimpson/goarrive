import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  PublicDisplayProgressTarget,
  PublicDisplayRefusedTarget,
  PublicDisplayStaleTarget,
  type NextClass,
} from '../../src/ui/designTarget/PublicDisplayNextTargets';

/**
 * PUBLIC DISPLAY RESPONSIVE TARGET CHECKPOINT — behind the same gate as every
 * other design-target preview route.
 *
 * Renders only when the build carries EXPO_PUBLIC_WSF_USE_EMULATORS, which
 * scripts/westayfit/build-staging.sh refuses. No deployed artifact can serve
 * this route, and nothing here is reachable from the product.
 *
 * EACH FRAME IS ITS EXACT DEVICE SIZE, in a box the producer screenshots by
 * testID rather than by viewport. A target for a 1920 screen that was captured
 * at some other width would be a picture of a different proposal.
 */
function previewAllowed(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true';
}

const SIZES: Record<NextClass, { width: number; height: number; label: string }> = {
  portrait: { width: 800, height: 1280, label: '800 × 1280 · a picture frame on a wall' },
  collective: { width: 1920, height: 1080, label: '1920 × 1080 · a display across a room' },
};

const TREATMENTS: {
  id: string;
  label: string;
  node: (cls: NextClass) => React.ReactNode;
}[] = [
  { id: 'progress', label: 'Confirmed progress', node: (c) => <PublicDisplayProgressTarget cls={c} /> },
  { id: 'stale', label: 'Stale — the number is kept, the claim is dropped', node: (c) => <PublicDisplayStaleTarget cls={c} /> },
  { id: 'refused', label: 'Refused — one generic state, centred', node: (c) => <PublicDisplayRefusedTarget cls={c} /> },
];

export default function PublicDisplayNextPreview() {
  if (!previewAllowed()) {
    return (
      <View style={s.blocked}>
        <Text style={s.blockedText}>Not available in this build.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={s.page} contentContainerStyle={s.pageBody}>
      <Text style={s.banner}>PROPOSED TARGET — NOT IMPLEMENTED</Text>
      {(Object.keys(SIZES) as NextClass[]).map((cls) => (
        <View key={cls} style={s.group}>
          <Text style={s.groupLabel}>{SIZES[cls].label}</Text>
          {TREATMENTS.map((t) => (
            <View key={`${t.id}-${cls}`} style={s.frameWrap}>
              <Text style={s.frameLabel}>{t.label}</Text>
              <View
                testID={`wsf-pdnext-frame-${t.id}-${cls}`}
                style={{ width: SIZES[cls].width, height: SIZES[cls].height }}
              >
                {t.node(cls)}
              </View>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F7F5F0' },
  pageBody: { padding: 24, gap: 32, alignItems: 'flex-start' },
  banner: { fontSize: 12, fontWeight: '900', letterSpacing: 2, color: '#15803D' },
  group: { gap: 20 },
  groupLabel: { fontSize: 16, fontWeight: '900', color: '#0B1F3A', letterSpacing: 1 },
  frameWrap: { gap: 8 },
  frameLabel: { fontSize: 12, fontWeight: '800', color: '#5A6B85' },
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  blockedText: { fontSize: 16, color: '#5A6B85' },
});
