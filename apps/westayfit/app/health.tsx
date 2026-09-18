import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { WSF_BUILD_STAMP } from '../src/buildStamp';
import { kit } from '../src/ui/kit';
import { WsfWordmark } from '../src/ui/WsfWordmark';

export default function Health() {
  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
      <View style={kit.column} testID="wsf-health">
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-health-wordmark" />
        </View>
        <Text style={kit.heading}>Health</Text>
        <View style={kit.card}>
          <Row label="App" value={WSF_BUILD_STAMP.appName} />
          <Row label="Version" value={WSF_BUILD_STAMP.version} />
          <Row label="Commit" value={WSF_BUILD_STAMP.commitSha} testID="wsf-health-commit" />
          <Row label="Built at" value={WSF_BUILD_STAMP.builtAt} testID="wsf-health-builtAt" />
        </View>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={kit.row}>
      <Text style={kit.rowLabel}>{label}</Text>
      <Text style={[kit.rowValue, styles.stamp]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Build stamps are identifiers, read character by character.
  stamp: { fontFamily: 'monospace' },
});
