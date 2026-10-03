import { StyleSheet, View } from 'react-native';

/**
 * FOUR GLYPHS, DRAWN FROM NOTHING.
 *
 * The app has no icon library and adding a package is the owner's call, so
 * these are built from plain Views — borders, radii and one CSS triangle. No
 * SVG, no font, no dependency, and nothing that renders as a missing-glyph
 * box if a font fails to load.
 *
 * They are deliberately simple silhouettes rather than detailed pictograms:
 * at 20px a detailed icon is mud, and these have to read at 20px next to a
 * 12px label. Each one is also distinguishable by SHAPE alone — a roof, a
 * rising series, a cluster, a figure — so the bar does not depend on colour.
 *
 * `active` only changes weight and colour; the silhouette never changes, so
 * the bar does not appear to swap icons when you move between destinations.
 */
export function TabGlyph({ name, color }: { name: 'home' | 'activity' | 'community' | 'you'; color: string }) {
  if (name === 'home') {
    return (
      <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* Roof: the borderColor triangle, the one shape Views cannot do directly. */}
        <View style={[styles.roof, { borderBottomColor: color }]} />
        <View style={[styles.house, { borderColor: color }]} />
      </View>
    );
  }
  if (name === 'activity') {
    return (
      <View style={[styles.box, styles.bars]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[7, 12, 17].map((h) => (
          <View key={h} style={[styles.bar, { height: h, backgroundColor: color }]} />
        ))}
      </View>
    );
  }
  if (name === 'community') {
    // A cluster, not a crowd: three marks, none of them a face.
    return (
      <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.dot, styles.dotTop, { backgroundColor: color }]} />
        <View style={styles.dotRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={[styles.dot, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.head, { borderColor: color }]} />
      <View style={[styles.shoulders, { borderColor: color }]} />
    </View>
  );
}

const SIZE = 20;
const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  house: { width: 14, height: 10, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 4, borderRadius: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotTop: { marginBottom: 2 },
  dotRow: { flexDirection: 'row', gap: 3 },
  head: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, marginBottom: 2 },
  shoulders: { width: 16, height: 8, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
});
