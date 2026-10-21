import { Platform, StyleSheet, Text, View } from 'react-native';

import { wsfIsStaging } from './firebase';
import { WSF_BUILD_STAMP } from './buildStamp';
import { CREAM } from './ui/kit';
import { useScreenTopInset } from './ui/useScreenTopInset';

/**
 * A permanent, undismissable marker on every screen of a staging build.
 *
 * Undismissable on purpose. The in-app-browser banner is advice, so it has a
 * Dismiss control; this one is a statement about what the data in front of you
 * IS. A screenshot of this app has to be self-evidently not a production
 * launch, and a banner that can be dismissed is a banner that is absent from
 * the screenshot that matters.
 *
 * Compact on purpose too: one dark-red strip that says what the data is and
 * which build this is, without dominating a phone. The full explanation of
 * what "test data" means lives on /health (Build details).
 *
 * It renders nothing at all in a production build, so production is visually
 * unchanged.
 *
 * NATIVE-INTEGRATOR-1 (INT-10). ON A PHONE IT CLEARS THE STATUS BAR ITSELF.
 * The strip paints red behind the status bar and starts its text below it
 * (the status-bar icons are light on a staging build: src/ui/statusBarPolicy.ts),
 * and the stack below it sits in its own safe-area provider, so the top bar
 * and every root-stack screen start directly under the strip instead of
 * adding the inset a second time (src/stagingShell.native.tsx). Over an iOS
 * modal, which covers this strip, the same strip is repeated inside the modal.
 * It names the binary's own commit and build time (src/nativeBuildInfo.native.ts).
 * On web it is exactly the row it was: the inset is 0 there and the text is
 * unchanged.
 */
export function StagingBanner() {
  const top = useScreenTopInset();
  if (!wsfIsStaging) return null;
  return (
    <View style={[styles.strip, top > 0 ? { paddingTop: STRIP_PAD + top } : null]} testID="wsf-staging-banner">
      <Text style={styles.text} testID="wsf-staging-banner-text">
        STAGING · TEST DATA · not the live service
      </Text>
      <Text style={styles.build} testID="wsf-staging-banner-build">
        build {WSF_BUILD_STAMP.commitSha}
        {Platform.OS !== 'web' ? builtAtLabel(WSF_BUILD_STAMP.builtAt) || null : null}
      </Text>
    </View>
  );
}

/** ` · 2026-10-21 01:23Z` for a stamped build time; nothing when the build has none. */
export function builtAtLabel(builtAt: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(builtAt);
  return m ? ` · ${m[1]} ${m[2]}Z` : '';
}

const STRIP_PAD = 6;

const STRIP_RED = '#7f1d1d';

const styles = StyleSheet.create({
  strip: {
    width: '100%',
    backgroundColor: STRIP_RED,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
    rowGap: 2,
    paddingVertical: STRIP_PAD,
    paddingHorizontal: 12,
  },
  text: {
    color: CREAM,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    flexShrink: 1,
    minWidth: 0,
  },
  build: {
    color: CREAM,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    minWidth: 0,
    marginLeft: 'auto',
  },
});
