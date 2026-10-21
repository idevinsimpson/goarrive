import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clearCrashRecords, readCrashRecords, type CrashRecord } from '../crashRecords';
import type { DeviceKv } from '../storage/kv';
import { kit } from './kit';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). WHAT THE LAST LAUNCHES RECORDED, IN BUILD
 * DETAILS.
 *
 * src/crashContainment.native.ts writes a scrubbed record (src/crashRecords.ts)
 * for a fatal timer or event error and an unhandled rejection, and the route
 * fallback writes one for every render error it caught. This card shows them on
 * the next launch so a tester can read them off the device, and renders
 * nothing when there are none. iOS and Android only: the web build gets
 * src/ui/CrashRecordsCard.tsx, which renders nothing and reads nothing.
 */
export function CrashRecordsCard({ kv }: { kv?: DeviceKv }) {
  const [records, setRecords] = useState<CrashRecord[]>([]);
  useEffect(() => {
    let live = true;
    void readCrashRecords(kv).then((r) => {
      if (live) setRecords(r);
    });
    return () => {
      live = false;
    };
  }, [kv]);
  if (records.length === 0) return null;
  return (
    <>
      <Text style={kit.eyebrow}>Recorded errors</Text>
      <View style={kit.card} testID="wsf-health-crashes">
        {records.map((r, i) => (
          <View key={`${r.at}-${i}`} style={styles.record} testID={`wsf-health-crash-${i}`}>
            <Text style={kit.cardMeta}>
              {r.at} · {r.kind} · {r.platform} · {r.build}
            </Text>
            <Text style={kit.body}>
              {r.name}
              {r.message ? `: ${r.message}` : ''}
            </Text>
            {r.frames[0] ? <Text style={kit.caption}>{r.frames.slice(0, 3).join('  ')}</Text> : null}
          </View>
        ))}
        <Pressable
          onPress={() => {
            void clearCrashRecords(kv).then(() => setRecords([]));
          }}
          style={kit.tertiaryButton}
          accessibilityRole="button"
          testID="wsf-health-crashes-clear"
        >
          <Text style={kit.tertiaryButtonText}>Clear</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  record: { gap: 2, paddingBottom: 10 },
});
