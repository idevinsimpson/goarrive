import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useDemoState } from '../../src/demoState';
import { wsfTheme } from '../../src/theme';

// Community-display view. Designed for a large screen next to the kiosks —
// audience can glance at it while activities happen. Live updates come from
// the shared demo store via useDemoState (same tab) and the storage event
// (other tabs of the same browser).
export default function DemoDisplay() {
  const { squats } = useDemoState();
  // Multiply first, divide second — avoids a float-rounding artifact where
  // 1015/1000*100 == 101.4999… and Math.round returns 101 instead of 102.
  const rawPercent = squats.goal > 0 ? Math.round((squats.current * 100) / squats.goal) : 0;
  const barPercent = Math.min(100, rawPercent);
  const goalReached = squats.current >= squats.goal;
  const overGoal = squats.current > squats.goal;
  const past = overGoal ? squats.current - squats.goal : 0;

  return (
    <View style={styles.root} testID="demo-display">
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>Community display · Live</Text>
        <Text style={styles.headline}>We Stay Fit — Squat Challenge</Text>

        <View style={[styles.numberCard, goalReached && styles.numberCardGoal]}>
          <Text
            style={[styles.numberValue, goalReached && styles.numberValueGoal]}
            testID="demo-display-value"
          >
            {squats.current.toLocaleString()}
          </Text>
          <Text style={[styles.numberSuffix, goalReached && styles.numberSuffixGoal]}>
            squats logged
          </Text>
        </View>

        <View style={styles.goalRow}>
          <Text style={styles.goalLabel}>Goal</Text>
          <Text style={styles.goalNumber}>{squats.goal.toLocaleString()}</Text>
          <Text style={styles.goalPercent} testID="demo-display-percent">
            {rawPercent}%
          </Text>
        </View>

        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${barPercent}%` }]} />
        </View>

        {goalReached ? (
          <View style={styles.celebration} testID="demo-display-celebration">
            <Text style={styles.celebrationEyebrow}>Goal reached</Text>
            <Text style={styles.celebrationHeadline}>
              The community hit {squats.goal.toLocaleString()} squats together.
            </Text>
            <Text style={styles.celebrationBody}>
              Every rep from every person added up. That's what We Stay Fit means.
              {overGoal ? ` And we kept going — ${past.toLocaleString()} past the goal.` : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.encourage} testID="demo-display-encourage">
            <Text style={styles.encourageHeadline}>
              {(squats.goal - squats.current).toLocaleString()} squats to go.
            </Text>
            <Text style={styles.encourageBody}>
              Head to a kiosk, log your reps, and watch this number climb.
            </Text>
          </View>
        )}

        <View style={styles.footerRow}>
          <Link href="/demo" style={styles.footerLink} testID="demo-display-back">
            Back to activities
          </Link>
        </View>

        <Text style={styles.captionRow}>
          Live within this browser session. Sample data only — reset anytime from the picker.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: wsfTheme.colors.primary,
    padding: wsfTheme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 1100,
  },
  eyebrow: {
    color: wsfTheme.colors.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.sm,
  },
  headline: {
    color: wsfTheme.colors.surface,
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 48,
    marginBottom: wsfTheme.spacing.lg,
  },
  numberCard: {
    backgroundColor: wsfTheme.colors.surface,
    borderRadius: wsfTheme.radius.lg,
    paddingVertical: wsfTheme.spacing.xl,
    paddingHorizontal: wsfTheme.spacing.lg,
    marginBottom: wsfTheme.spacing.lg,
    alignItems: 'center',
  },
  numberCardGoal: {
    backgroundColor: wsfTheme.colors.accent,
  },
  numberValue: {
    color: wsfTheme.colors.primary,
    fontSize: 160,
    fontWeight: '900',
    lineHeight: 168,
    letterSpacing: -3,
  },
  numberValueGoal: {
    color: wsfTheme.colors.primary,
  },
  numberSuffix: {
    color: wsfTheme.colors.primary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: wsfTheme.spacing.sm,
  },
  numberSuffixGoal: {
    color: wsfTheme.colors.primary,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.md,
    marginBottom: wsfTheme.spacing.sm,
  },
  goalLabel: {
    color: wsfTheme.colors.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  goalNumber: {
    color: wsfTheme.colors.surface,
    fontSize: 22,
    fontWeight: '700',
  },
  goalPercent: {
    color: wsfTheme.colors.accent,
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 'auto' as unknown as number,
  },
  barTrack: {
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
    marginBottom: wsfTheme.spacing.xl,
  },
  barFill: {
    height: 16,
    backgroundColor: wsfTheme.colors.accent,
  },
  celebration: {
    backgroundColor: wsfTheme.colors.accent,
    borderRadius: wsfTheme.radius.lg,
    padding: wsfTheme.spacing.lg,
  },
  celebrationEyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.sm,
  },
  celebrationHeadline: {
    color: wsfTheme.colors.primary,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 40,
    marginBottom: wsfTheme.spacing.sm,
  },
  celebrationBody: {
    color: wsfTheme.colors.primary,
    fontSize: 18,
    lineHeight: 26,
  },
  encourage: {
    padding: wsfTheme.spacing.md,
  },
  encourageHeadline: {
    color: wsfTheme.colors.surface,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: wsfTheme.spacing.sm,
  },
  encourageBody: {
    color: wsfTheme.colors.textMuted,
    fontSize: 18,
    lineHeight: 26,
  },
  footerRow: {
    marginTop: wsfTheme.spacing.lg,
  },
  footerLink: {
    color: wsfTheme.colors.accent,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  captionRow: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.caption.fontSize,
    marginTop: wsfTheme.spacing.lg,
    fontStyle: 'italic',
  },
});
