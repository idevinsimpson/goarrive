import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CARD_BORDER, CREAM, INK_QUIET, NAVY, SURFACE, TEXT_MUTED, display } from '../kit';
import { recordMount } from './shellNextProbe';
import { SHELL_BOTTOM_INSET } from './shellNextBottomInset';
import { SHELL_COLUMN_MAX, SHELL_FIRST_CONTENT, SHELL_PAGE_GUTTER } from './shellNextMetrics';

/**
 * THE COMMON PAGE SCAFFOLD FOR THE PROTOTYPE'S TABS. PROTOTYPE ONLY.
 *
 * Every tab in the prototype renders through this, which is what makes the
 * geometry claim testable rather than aspirational: there is exactly one
 * definition of where a page starts, so four tabs cannot drift into four
 * answers the way the four production routes have.
 *
 * THE TITLE IS CONTENT, NOT CHROME. It sits below the persistent bar at
 * `SHELL_FIRST_CONTENT`, in the page, on every tab. Putting it in the bar
 * would make the bar's contents route-dependent again — which is the defect,
 * not the fix.
 *
 * WHAT THE COUNTERS ARE FOR. `mounts` is this screen's mount ordinal and
 * `steps` is a piece of loaded screen state the member themselves changed.
 * Together they are the evidence for the two invisible claims in this packet:
 * if tapping the active tab reloads the page the ordinal goes up, and if a tab
 * switch throws state away the step count goes back to zero. Both are rendered
 * into the frame, so a capture carries its own proof instead of a caption
 * asserting one.
 *
 * NO FULL-SCREEN SKELETON. `settling` replaces the BODY only. The bar above
 * and the navigation below are outside this component entirely and never
 * unmount, so a page that is still fetching looks like an app filling in
 * rather than a new screen arriving.
 */
export function ShellNextPage({
  id,
  title,
  lede,
  settling = false,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  settling?: boolean;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // The ordinal is captured once, on mount, and never recomputed: a re-render
  // is not a remount and must not be counted as one.
  const mountRef = useRef<number | null>(null);
  if (mountRef.current === null) mountRef.current = recordMount(id);
  const [steps, setSteps] = useState(0);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    // Nothing to do; the mount was recorded above. This exists so the screen
    // has a real effect boundary, which is where a remount would show up.
  }, []);

  return (
    <View style={styles.screen} testID={`wsf-shell-next-page-${id}`}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.page,
          { paddingBottom: SHELL_BOTTOM_INSET + insets.bottom + 16 },
        ]}
        scrollEventThrottle={64}
        onScroll={(e) => setScrollY(Math.round(e.nativeEvent.contentOffset.y))}
        testID={`wsf-shell-next-scroll-${id}`}
      >
        <View style={styles.column}>
          <Text
            style={[display.md, styles.title]}
            accessibilityRole="header"
            testID={`wsf-shell-next-title-${id}`}
          >
            {title}
          </Text>
          {lede ? <Text style={styles.lede}>{lede}</Text> : null}

          {/* The prototype's own instrument panel. It is not a product
              element and it is labelled as one so no reviewer mistakes it
              for a proposed surface. */}
          <View style={styles.probe} testID={`wsf-shell-next-probe-${id}`}>
            <Text style={styles.probeTag}>PROTOTYPE INSTRUMENT · NOT A PRODUCT ELEMENT</Text>
            <Text style={styles.probeLine}>
              {'mounts '}
              <Text style={styles.probeValue} testID={`wsf-shell-next-mounts-${id}`}>
                {String(mountRef.current)}
              </Text>
              {'   ·   steps '}
              <Text style={styles.probeValue} testID={`wsf-shell-next-steps-${id}`}>
                {String(steps)}
              </Text>
              {'   ·   scrollY '}
              <Text style={styles.probeValue} testID={`wsf-shell-next-scrolly-${id}`}>
                {String(scrollY)}
              </Text>
            </Text>
            <Pressable
              onPress={() => setSteps((n) => n + 1)}
              style={styles.probeButton}
              accessibilityRole="button"
              accessibilityLabel={`Add a step on ${title}`}
              testID={`wsf-shell-next-step-${id}`}
            >
              <Text style={styles.probeButtonText}>Change this screen's state</Text>
            </Pressable>
          </View>

          {settling ? (
            <View style={styles.settling} testID={`wsf-shell-next-settling-${id}`}>
              <View style={[styles.blockLine, { width: '62%' }]} />
              <View style={[styles.blockLine, { width: '88%' }]} />
              <View style={[styles.blockLine, { width: '74%' }]} />
            </View>
          ) : (
            children
          )}

          {/* Enough height that the page genuinely scrolls at 390x844 with
              room to spare, so the scroll-preservation claim is exercised
              rather than nominally satisfied. The first run of the spec had
              eight rows, which left 75px of travel on the standard phone --
              enough for the check to pass on and far too little for it to
              mean anything. */}
          <View style={styles.filler} testID={`wsf-shell-next-filler-${id}`}>
            {Array.from({ length: 16 }).map((_, i) => (
              <View key={i} style={styles.fillerCard}>
                <Text style={styles.fillerText}>{`${title} · row ${i + 1}`}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  scroll: { flex: 1, backgroundColor: CREAM },
  page: {
    alignItems: 'center',
    paddingHorizontal: SHELL_PAGE_GUTTER,
    // THE NUMBER. One first-content inset, every tab, so the title cannot
    // move vertically when the member switches.
    paddingTop: SHELL_FIRST_CONTENT,
  },
  column: { width: '100%', maxWidth: SHELL_COLUMN_MAX, gap: 12 },
  title: { color: NAVY },
  lede: { color: TEXT_MUTED, fontSize: 14.5, lineHeight: 20, marginTop: -4 },
  probe: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  probeTag: { color: INK_QUIET, fontSize: 9.5, fontWeight: '900', letterSpacing: 0.8 },
  probeLine: { color: TEXT_MUTED, fontSize: 12, lineHeight: 17 },
  probeValue: { color: NAVY, fontWeight: '800' },
  probeButton: {
    minHeight: 34,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  probeButtonText: { color: NAVY, fontSize: 12.5, fontWeight: '700' },
  settling: { gap: 8, paddingVertical: 4 },
  blockLine: { height: 14, borderRadius: 7, backgroundColor: CARD_BORDER },
  filler: { gap: 8 },
  fillerCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  fillerText: { color: TEXT_MUTED, fontSize: 13 },
});
