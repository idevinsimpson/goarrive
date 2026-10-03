import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NAVY } from './kit';

/**
 * THE REVALIDATION NOTE — PERF-MOBILE-1's two refresh states, for the parity
 * views (YouParityView, ProgressParityView).
 *
 * A screen that opened on what this account already knew keeps it on screen
 * while it re-reads. If that takes longer than a moment it says it is
 * checking; if it fails it keeps what was last read and SAYS SO, with a Retry
 * that reads everything fresh. What was shown is never replaced by an empty
 * or a zero because a refresh failed.
 *
 * Pure: the route owns the timing and the re-read; this only draws the state.
 */
export type RefreshState = {
  /** A revalidation is taking longer than a moment. */
  checking: boolean;
  /** The last revalidation failed; what is shown is what was last read. */
  stale: boolean;
  onRetry: () => void;
};

export function RefreshNote({ refresh, testIDPrefix }: { refresh: RefreshState; testIDPrefix: string }) {
  if (refresh.stale) {
    return (
      <View style={s.row} testID={`${testIDPrefix}-stale`}>
        <Text style={[s.note, s.inRow]}>Couldn’t check for updates just now. This is what was last read.</Text>
        <Pressable
          onPress={refresh.onRetry}
          accessibilityRole="button"
          style={s.retry}
          testID={`${testIDPrefix}-stale-retry`}
        >
          <Text style={s.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (refresh.checking) {
    return (
      <Text style={s.note} testID={`${testIDPrefix}-checking`}>
        Checking for updates…
      </Text>
    );
  }
  return null;
}

/** The parity views' muted foreground (the reference's --muted-foreground). */
const MUTED_FG = '#4B5C71';

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  note: { color: MUTED_FG, fontSize: 13, lineHeight: 18, marginTop: 10 },
  inRow: { marginTop: 0, flexShrink: 1 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  retryText: { color: NAVY, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
});
