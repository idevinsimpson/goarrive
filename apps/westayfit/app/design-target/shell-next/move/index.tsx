import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CARD_BORDER, CREAM, NAVY, SURFACE, TEXT_MUTED, display, elevation } from '../../../../src/ui/kit';
import { recordMount, recordNav } from '../../../../src/ui/shellNext/shellNextProbe';

/**
 * THE MOVE RESOLVER, AS A SHEET OVER THE MEMBER APP. PROTOTYPE ONLY.
 *
 * Stands for production `/move`.
 *
 * WHAT IS DIFFERENT HERE, AND WHY IT IS STRUCTURAL. In the shipping build
 * `/move` is listed in `SHELL_EXACT`, so the member tab bar is drawn over the
 * resolver and the raised MOVE circle sits beneath the MOVE page — a control
 * offering to take you where you already are. Here the resolver is a screen in
 * the OUTER stack, above the whole tab navigator. The bar is not hidden by a
 * flag; it is simply not on this screen, and no configuration change can put
 * it back. MOVE also has no tab route anywhere in this shell, so it has no
 * selected state to render.
 *
 * THE CONTEXT UNDERNEATH IS REAL. This is presented as a `transparentModal`,
 * so the tab the member pressed MOVE from is still mounted and genuinely
 * visible through the scrim, holding its scroll position and its loaded state.
 * Nothing is screenshotted and nothing is faked. Closing pops this one screen
 * and lands back on that exact tab, in that exact state — which is what "a
 * clear Close/Back path to the member context it came from" has to mean if it
 * means anything.
 *
 * NO CONTRIBUTION LOGIC IS TOUCHED. This frame proposes presentation only. It
 * performs no read, resolves no goal, counts nothing, and stands in for the
 * real resolver's content rather than reproducing it.
 */
export default function ShellNextMoveSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  recordMount('move-sheet');

  const close = () => {
    recordNav('move:close');
    // `back`, not a navigate to a tab: the member returns to whatever they
    // were on, which the router already knows and the sheet must not guess.
    router.back();
  };

  return (
    <View style={styles.root} testID="wsf-shell-next-move-sheet">
      {/* The scrim is the Close target as well as the dimmer, which is the
          gesture people already expect from a sheet. */}
      <Pressable
        style={styles.scrim}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close Move"
        testID="wsf-shell-next-move-scrim"
      />
      <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]}>
        <View style={styles.grabber} />
        <View style={styles.headRow}>
          <Text style={[display.md, styles.title]} accessibilityRole="header">
            What are you moving toward?
          </Text>
          <Pressable
            onPress={close}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="wsf-shell-next-move-close"
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>
          Stands in for the real resolver. No goal is read and nothing is counted here.
        </Text>
        {['A shared goal', 'Another shared goal'].map((label) => (
          <Pressable
            key={label}
            style={styles.option}
            onPress={() => {
              recordNav('move:open-player');
              router.push('/design-target/shell-next/move/player?goalId=demo-goal');
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={`wsf-shell-next-move-option-${label.replace(/\s+/g, '-').toLowerCase()}`}
          >
            <Text style={styles.optionText}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,23,41,0.42)' },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 10,
    ...elevation.hero,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: CARD_BORDER, marginBottom: 4 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: NAVY, flexShrink: 1 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' },
  closeText: { color: NAVY, fontSize: 14.5, fontWeight: '700' },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  option: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 56,
    justifyContent: 'center',
  },
  optionText: { color: NAVY, fontSize: 15, fontWeight: '700' },
});
