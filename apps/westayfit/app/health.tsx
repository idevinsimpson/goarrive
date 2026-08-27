import { StyleSheet, Text, View } from 'react-native';

import { WSF_BUILD_STAMP } from '../src/buildStamp';
import { wsfFirebaseProjectId } from '../src/firebase';
import { wsfTheme } from '../src/theme';

export default function Health() {
  return (
    <View style={styles.container} testID="wsf-health">
      <View style={styles.inner}>
        <Text style={styles.heading}>Health</Text>
        <Row label="App" value={WSF_BUILD_STAMP.appName} />
        <Row label="Version" value={WSF_BUILD_STAMP.version} />
        <Row label="Commit" value={WSF_BUILD_STAMP.commitSha} testID="wsf-health-commit" />
        <Row label="Built at" value={WSF_BUILD_STAMP.builtAt} testID="wsf-health-builtAt" />
        <Row label="Firebase project" value={wsfFirebaseProjectId} testID="wsf-health-project" />
      </View>
    </View>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: wsfTheme.colors.background,
    padding: wsfTheme.spacing.xl,
  },
  inner: {
    maxWidth: 640,
    width: '100%',
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.heading.fontSize,
    fontWeight: wsfTheme.typography.heading.fontWeight,
    marginBottom: wsfTheme.spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: wsfTheme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: wsfTheme.colors.border,
  },
  rowLabel: {
    color: wsfTheme.colors.textMuted,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  rowValue: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    fontFamily: 'monospace',
  },
});
