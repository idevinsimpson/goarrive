import { StyleSheet, Text, View } from 'react-native';

import { wsfIsStaging } from './firebase';
import { WSF_BUILD_STAMP } from './buildStamp';

/**
 * A permanent, undismissable marker on every screen of a staging build.
 *
 * Undismissable on purpose. The in-app-browser banner is advice, so it has a
 * Dismiss control; this one is a statement about what the data in front of you
 * IS. A screenshot of this app has to be self-evidently not a production
 * launch, and a banner that can be dismissed is a banner that is absent from
 * the screenshot that matters.
 *
 * It renders nothing at all in a production build, so production is visually
 * unchanged.
 */
export function StagingBanner() {
  if (!wsfIsStaging) return null;
  return (
    <View style={styles.container} testID="wsf-staging-banner">
      <Text style={styles.text} testID="wsf-staging-banner-text">
        STAGING — TEST DATA ONLY. Not the live We Stay Fit service. Accounts,
        communities and totals here are not real and may be deleted at any time.
      </Text>
      <Text style={styles.build} testID="wsf-staging-banner-build">
        build {WSF_BUILD_STAMP.commitSha}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#7f1d1d',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  build: {
    color: '#fecaca',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});
