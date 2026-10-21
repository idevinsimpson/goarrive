import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WSF_BUILD_STAMP } from '../src/buildStamp';
import { wsfIsStaging } from '../src/firebase';
import { CrashRecordsCard } from '../src/ui/CrashRecordsCard';
import { kit } from '../src/ui/kit';
import { useScreenTopInset } from '../src/ui/useScreenTopInset';
import { WsfWordmark } from '../src/ui/WsfWordmark';

// kit.page's own top padding, under the status bar on a phone (INT-09).
const PAGE_TOP = 16;

export default function Health() {
  // INT-09: a root-stack screen with no header starts below the status bar. 0 on web.
  const topInset = useScreenTopInset();
  return (
    <ScrollView
      style={kit.scroll}
      contentContainerStyle={topInset > 0 ? [kit.page, { paddingTop: PAGE_TOP + topInset }] : kit.page}
    >
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
        {/* INT-01: scrubbed records from earlier launches; nothing on web. */}
        <CrashRecordsCard />
        {wsfIsStaging ? (
          <>
            {/* W12-26 (the owner's UI-copy order): plain words, no environment jargon, still truthful that
                this build uses test data and is not the live service. Wording pending the owner's sign-off
                (queue item 18e). The rows above stay: they are the QA build marker. */}
            <Text style={kit.eyebrow}>About this build</Text>
            <View style={kit.card} testID="wsf-health-environment">
              <Text style={kit.body}>
                This is a test build, not the live We Stay Fit service. Accounts, communities and totals here are
                not real and may be removed at any time.
              </Text>
            </View>
          </>
        ) : null}
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
  // Build stamps are identifiers, read character by character. INT-35:
  // 'monospace' names no font on iOS (it fell back to the proportional
  // system font); iOS has its own monospaced system family. Web unchanged.
  stamp: { fontFamily: Platform.OS === 'ios' ? 'ui-monospace' : 'monospace' },
});
