import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { resetDemo, useDemoState } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

type Activity = {
  id: string;
  title: string;
  helper: string;
  requires: string | null;
  href: `/demo/${string}` | null;
  status: 'live' | 'coming-soon';
};

const ACTIVITIES: Activity[] = [
  {
    id: 'squats',
    title: 'Squats',
    helper: 'Stand up, sit back, stand tall. Count your reps as you go.',
    requires: null,
    href: '/demo/squats',
    status: 'live',
  },
  {
    id: 'jumping-jacks',
    title: 'Jumping jacks',
    helper: 'Jump wide, jump back. Steady rhythm for a full minute.',
    requires: null,
    href: null,
    status: 'coming-soon',
  },
  {
    id: 'push-ups',
    title: 'Push-ups',
    helper: 'From the floor or a wall — however you push.',
    requires: null,
    href: null,
    status: 'coming-soon',
  },
  {
    id: 'planks',
    title: 'Planks',
    helper: 'Hold strong. Log your seconds.',
    requires: 'Mat suggested',
    href: null,
    status: 'coming-soon',
  },
  {
    id: 'sit-to-stands',
    title: 'Sit-to-stands',
    helper: 'Chair to standing, controlled and steady.',
    requires: 'Chair required',
    href: null,
    status: 'coming-soon',
  },
];

export default function DemoPicker() {
  const { squats } = useDemoState();

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
          Pick a movement, take a turn, and watch the community count climb together.
        </Text>

        <View style={styles.weCard} testID="demo-picker-we-total">
          <Text style={styles.weLabel}>Community squat goal</Text>
          <Text style={styles.weCount}>
            <Text style={styles.weCurrent}>{squats.current.toLocaleString()}</Text>
            <Text style={styles.weSep}> / </Text>
            <Text style={styles.weGoal}>{squats.goal.toLocaleString()} squats</Text>
          </Text>
          <View style={styles.weBarTrack} accessibilityRole="progressbar">
            <View
              style={[
                styles.weBarFill,
                { width: `${Math.min(100, Math.round((squats.current / squats.goal) * 100))}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.cardGrid}>
          {ACTIVITIES.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
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
          This is a preview experience. Numbers reset when you tap Reset demo. No live community
          data is written.
        </Text>
      </View>
    </ScrollView>
  );
}

function ActivityCard({ activity }: { activity: Activity }) {
  const isLive = activity.status === 'live';
  const card = (
    <View style={[styles.card, !isLive && styles.cardDisabled]} testID={`demo-activity-${activity.id}`}>
      <View style={styles.cardHeaderRow}>
        <Text style={[styles.cardTitle, !isLive && styles.cardTitleDisabled]}>{activity.title}</Text>
        <View style={[styles.pill, isLive ? styles.pillLive : styles.pillSoon]}>
          <Text style={[styles.pillText, isLive ? styles.pillTextLive : styles.pillTextSoon]}>
            {isLive ? 'Ready' : 'Coming soon'}
          </Text>
        </View>
      </View>
      <Text style={[styles.cardHelper, !isLive && styles.cardHelperDisabled]}>
        {activity.helper}
      </Text>
      {activity.requires ? <Text style={styles.cardRequires}>{activity.requires}</Text> : null}
    </View>
  );
  if (isLive && activity.href) {
    return (
      <Link href={activity.href} style={styles.cardLink} testID={`demo-activity-link-${activity.id}`}>
        {card}
      </Link>
    );
  }
  return card;
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
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.lg,
  },
  cardLink: {
    flexBasis: 320,
    flexGrow: 1,
    textDecorationLine: 'none' as const,
    color: wsfTheme.colors.text,
  },
  card: {
    flexBasis: 320,
    flexGrow: 1,
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.lg,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    padding: wsfTheme.spacing.lg,
    minHeight: 156,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: wsfTheme.spacing.sm,
    gap: wsfTheme.spacing.sm,
  },
  cardTitle: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize + 2,
    fontWeight: '700',
    flexShrink: 1,
  },
  cardTitleDisabled: {
    color: wsfTheme.colors.textMuted,
  },
  cardHelper: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.sm,
  },
  cardHelperDisabled: {
    color: wsfTheme.colors.textMuted,
  },
  cardRequires: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontStyle: 'italic',
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: wsfTheme.radius.pill,
    borderWidth: 1,
  },
  pillLive: {
    backgroundColor: wsfTheme.colors.accent,
    borderColor: wsfTheme.colors.accent,
  },
  pillSoon: {
    backgroundColor: wsfTheme.colors.background,
    borderColor: wsfTheme.colors.border,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pillTextLive: {
    color: wsfTheme.colors.primary,
  },
  pillTextSoon: {
    color: wsfTheme.colors.textMuted,
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
