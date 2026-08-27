import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { wsfTheme } from './theme';

export function AuthFlagOffPanel({ title, testID }: { title: string; testID: string }) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.inner}>
        <Text style={styles.eyebrow}>We Stay Fit</Text>
        <Text style={styles.heading}>{title}</Text>
        <Text style={styles.body}>
          Accounts are opening soon. Check back once we invite the first champions.
        </Text>
        <Link href="/" style={styles.link}>
          Back to home
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
    maxWidth: 480,
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
  body: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  link: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
