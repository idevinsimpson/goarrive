import { StyleSheet, Text, View } from 'react-native';

import { wsfIsStaging } from './firebase';
import { WSF_BUILD_STAMP } from './buildStamp';
import { CREAM } from './ui/kit';

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
 */
export function StagingBanner() {
  if (!wsfIsStaging) return null;
  return (
    <View style={styles.strip} testID="wsf-staging-banner">
      <Text style={styles.text} testID="wsf-staging-banner-text">
        STAGING · TEST DATA · not the live service
      </Text>
      <Text style={styles.build} testID="wsf-staging-banner-build">
        build {WSF_BUILD_STAMP.commitSha}
      </Text>
    </View>
  );
}

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
    paddingVertical: 6,
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
