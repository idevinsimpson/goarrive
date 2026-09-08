import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { resetDemo, useDemoState } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

// Concepts we've discussed but haven't built into this demo. Listed here as
// design inputs only — not release promises, not "coming soon" commitments.
const CONCEPT_IDEAS = [
  'Jumping jacks',
  'Push-ups',
  'Planks',
  'Sit-to-stands',
  'Sit-ups',
];

export default function DemoPicker() {
  const { squats } = useDemoState();
  const percent = Math.min(100, Math.round((squats.current / squats.goal) * 100));

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      testID="demo-picker"
    >
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>We Stay Fit</Text>
        <Text style={styles.heading}>Add your movement to the WE total.</Text>
        <Text style={styles.subline}>
          Take a turn and watch the community count climb together. Every rep from every person
          adds up.
        </Text>

        <View style={styles.weCard} testID="demo-picker-we-total">
          <Text style={styles.weLabel}>Community squat goal</Text>
          <Text style={styles.weCount}>
            <Text style={styles.weCurrent}>{squats.current.toLocaleString()}</Text>
            <Text style={styles.weSep}> / </Text>
            <Text style={styles.weGoal}>{squats.goal.toLocaleString()} squats</Text>
          </Text>
          <View style={styles.weBarTrack} accessibilityRole="progressbar">
            <View style={[styles.weBarFill, { width: `${percent}%` }]} />
          </View>
        </View>

        <Text style={styles.sectionEyebrow}>Take your turn</Text>
        <Link
          href="/demo/squats"
          style={styles.heroLink}
          testID="demo-activity-link-squats"
        >
          <View style={styles.heroCard} testID="demo-activity-squats">
            <View style={styles.heroHeaderRow}>
              <Text style={styles.heroTitle}>Squats</Text>
              <View style={styles.pillLive}>
                <Text style={styles.pillTextLive}>Ready</Text>
              </View>
            </View>
            <Text style={styles.heroHelper}>
              Stand up, sit back, stand tall. Do a set at your own pace, then log how many you did.
            </Text>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>Log a squat set →</Text>
            </View>
          </View>
        </Link>

        <View style={styles.conceptsBlock} testID="demo-picker-concepts">
          <Text style={styles.sectionEyebrow}>Not in this demo</Text>
          <Text style={styles.conceptsIntro}>
            Ideas we've discussed but haven't built yet. Listed for the conversation, not scheduled.
          </Text>
          <View style={styles.conceptsRow}>
            {CONCEPT_IDEAS.map((idea) => (
              <View key={idea} style={styles.conceptChip} testID={`demo-concept-${idea.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                <Text style={styles.conceptText}>{idea}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footerRow}>
          <Link href="/demo/display" style={styles.footerPrimary} testID="demo-picker-display-link">
            Open community display
          </Link>
          <Pressable
            onPress={resetDemo}
            style={styles.footerSecondary}
            testID="demo-picker-reset"
            accessibilityRole="button"
          >
            <Text style={styles.footerSecondaryText}>Reset demo</Text>
          </Pressable>
          <Link href="/" style={styles.footerLink} testID="demo-picker-exit">
            Exit demo
          </Link>
        </View>

        <Text style={styles.disclaimer}>
          This is a preview experience. Sample data only — nothing here is written to a real
          community.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
  },
  scrollContent: {
    padding: wsfTheme.spacing.lg,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 720,
  },
  eyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.sm,
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
    marginBottom: wsfTheme.spacing.sm,
  },
  subline: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.subheading.fontSize,
    lineHeight: wsfTheme.typography.subheading.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  weCard: {
    backgroundColor: wsfTheme.colors.primary,
    borderRadius: wsfTheme.radius.lg,
    padding: wsfTheme.spacing.lg,
    marginBottom: wsfTheme.spacing.lg,
  },
  weLabel: {
    color: wsfTheme.colors.accent,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.xs,
  },
  weCount: {
    color: wsfTheme.colors.surface,
    marginBottom: wsfTheme.spacing.md,
  },
  weCurrent: {
    color: wsfTheme.colors.surface,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 48,
  },
  weSep: {
    color: wsfTheme.colors.textMuted,
    fontSize: 22,
    fontWeight: '500',
  },
  weGoal: {
    color: wsfTheme.colors.surface,
    fontSize: 22,
    fontWeight: '600',
  },
  weBarTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  weBarFill: {
    height: 10,
    backgroundColor: wsfTheme.colors.accent,
  },
  sectionEyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.sm,
    marginTop: wsfTheme.spacing.sm,
  },
  heroLink: {
    textDecorationLine: 'none' as const,
    color: wsfTheme.colors.text,
    marginBottom: wsfTheme.spacing.lg,
  },
  heroCard: {
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.lg,
    borderWidth: 2,
    borderColor: wsfTheme.colors.primary,
    padding: wsfTheme.spacing.lg,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: wsfTheme.spacing.sm,
    gap: wsfTheme.spacing.sm,
  },
  heroTitle: {
    color: wsfTheme.colors.text,
    fontSize: 26,
    fontWeight: '800',
    flexShrink: 1,
  },
  heroHelper: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  heroCta: {
    alignSelf: 'flex-start',
    backgroundColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.sm,
    paddingHorizontal: wsfTheme.spacing.md,
    borderRadius: wsfTheme.radius.pill,
  },
  heroCtaText: {
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  pillLive: {
    backgroundColor: wsfTheme.colors.accent,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: wsfTheme.radius.pill,
  },
  pillTextLive: {
    color: wsfTheme.colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  conceptsBlock: {
    backgroundColor: wsfTheme.colors.background,
    borderRadius: wsfTheme.radius.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    padding: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.lg,
  },
  conceptsIntro: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.sm,
  },
  conceptsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
  },
  conceptChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: wsfTheme.radius.pill,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    backgroundColor: wsfTheme.colors.surface,
  },
  conceptText: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
    alignItems: 'center',
    marginTop: wsfTheme.spacing.md,
  },
  footerPrimary: {
    backgroundColor: wsfTheme.colors.primary,
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
    textDecorationLine: 'none' as const,
  },
  footerSecondary: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.primary,
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.lg,
    borderRadius: wsfTheme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSecondaryText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
  },
  footerLink: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.sm,
    textDecorationLine: 'underline',
  },
  disclaimer: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    marginTop: wsfTheme.spacing.lg,
    fontStyle: 'italic',
  },
});
