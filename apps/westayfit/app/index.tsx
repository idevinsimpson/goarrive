import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { wsfAuthEnabled } from '../src/featureFlags';
import { wsfTheme } from '../src/theme';

export default function BrandShell() {
  return (
    <View style={styles.container} testID="wsf-brand-shell">
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>We Stay Fit</Text>
        <Text style={styles.heading}>Turn your community into a place that moves.</Text>
        <Text style={styles.subline}>Shared challenges. More movement. Stronger communities.</Text>
        {/*
          The front door has to match what the build can actually do. With auth
          ON, /signup and /signin work -- but nothing here linked to them, and
          the shell copy told visitors outright that there was no signup. The
          app was reachable only by typing the URL.

          The eyebrow, heading and subline are the chartered brand lines and are
          identical in both states. Only the sentence below them changes, because
          only that sentence makes a claim about what the build does.
        */}
        {wsfAuthEnabled ? (
          <View style={styles.actions}>
            <Link href="/signup" style={styles.primaryAction} testID="wsf-home-signup">
              Create an account
            </Link>
            <Link href="/signin" style={styles.secondaryAction} testID="wsf-home-signin">
              Sign in
            </Link>
          </View>
        ) : (
          <Text style={styles.body}>
            We Stay Fit is coming soon. This shell exists so the app can ship, deploy, and be
            verified. It intentionally has no content, no signup, and no reads or writes.
          </Text>
        )}
        <Link href="/health" style={styles.link}>
          Build details
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: wsfTheme.spacing.xl,
  },
  inner: {
    maxWidth: 640,
    width: '100%',
  },
  eyebrow: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: wsfTheme.spacing.md,
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.heading.fontSize,
    fontWeight: wsfTheme.typography.heading.fontWeight,
    lineHeight: wsfTheme.typography.heading.lineHeight,
    marginBottom: wsfTheme.spacing.md,
  },
  subline: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    lineHeight: wsfTheme.typography.subheading.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  body: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.xl,
  },
  primaryAction: {
    backgroundColor: wsfTheme.colors.primary,
    color: wsfTheme.colors.surface,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '700',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.xl,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    paddingVertical: wsfTheme.spacing.md,
    paddingHorizontal: wsfTheme.spacing.xl,
    borderRadius: wsfTheme.radius.pill,
    textAlign: 'center',
  },
  link: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
