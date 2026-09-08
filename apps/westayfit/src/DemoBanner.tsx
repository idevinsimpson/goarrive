import { StyleSheet, Text, View } from 'react-native';

import { wsfTheme } from './theme';

// Persistent banner shown on every /demo screen so the audience is never in
// doubt that the numbers are sample data, not live engagement.
export function DemoBanner() {
  return (
    <View style={styles.banner} testID="demo-banner" accessibilityRole="alert">
      <View style={styles.dot} />
      <Text style={styles.text}>Interactive demo · Sample data</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.sm,
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: wsfTheme.colors.accent,
  },
  text: {
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
