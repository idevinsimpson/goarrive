import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CREAM, NAVY, ON_NAVY, ON_NAVY_MUTED, display } from '../../../../src/ui/kit';
import { recordMount, recordNav } from '../../../../src/ui/shellNext/shellNextProbe';

/**
 * THE PLAYER. PROTOTYPE ONLY. Stands for production `/move/[goalId]`.
 *
 * Static path with the id in the query, for the hosting reason set out in
 * `(tabs)/community/detail.tsx`. Production's `/move/[goalId]` keeps its
 * brackets and its rewrite.
 *
 * ALREADY NO-TAB TODAY, AND STILL NO-TAB HERE — but for a better reason. The
 * shipping build keeps the bar off this route by not matching its path
 * (`SHELL_EXACT` is '/move' exactly, deliberately not a prefix, so the bar
 * covers the resolver but not the player). In this shell the player is a
 * screen in the outer stack, outside the tab navigator entirely, so there is
 * no bar to keep off and no rule to get wrong later. One way out, where a
 * member's thumb expects it, and no four ways to leave mid-round.
 */
export default function ShellNextPlayer() {
  const { goalId } = useLocalSearchParams<{ goalId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  recordMount('move-player');
  return (
    <View
      style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}
      testID="wsf-shell-next-move-player"
    >
      <Pressable
        onPress={() => {
          recordNav('player:back');
          router.back();
        }}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="wsf-shell-next-player-back"
      >
        <Text style={styles.backText}>← Back</Text>
      </Pressable>
      <View style={styles.centre}>
        <Text style={[display.lg, styles.title]} accessibilityRole="header">
          Player
        </Text>
        <Text style={styles.note}>
          {`Stands in for /move/${goalId ?? '<goalId>'}. No member chrome of any kind.`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY, paddingHorizontal: 18 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  backText: { color: ON_NAVY, fontSize: 15, fontWeight: '700' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { color: CREAM },
  note: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
});
