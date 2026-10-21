import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  dismissInAppBanner,
  isInAppBannerDismissed,
  isInAppBrowser,
} from './inAppBrowser';
import { kit, SAMPLE_TINT } from './ui/kit';

export function InAppBrowserBanner() {
  // Detection happens on mount so SSR renders nothing, then the effect kicks
  // in on the client and either shows or hides based on UA + dismissal state.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Web only. The native app is never an in-app browser, and React Native
    // defines `window` without `window.location`, so reading location.search
    // here threw from the root layout on every phone launch.
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return;
    // Support a URL override for spec runs — Playwright cannot reliably spoof
    // the UA on every browser matrix, so `?wsf_in_app=1` forces the banner
    // on. `?wsf_in_app=0` forces it off. Neither value writes anywhere.
    const params = new URLSearchParams(window.location.search);
    const override = params.get('wsf_in_app');
    if (override === '0') {
      setVisible(false);
      return;
    }
    if (override === '1') {
      setVisible(!isInAppBannerDismissed());
      return;
    }
    setVisible(isInAppBrowser() && !isInAppBannerDismissed());
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.container} testID="wsf-in-app-banner">
      <Text style={styles.text}>
        You're in Instagram's browser, so you may be signed out next time. Tap the ··· menu and
        choose <Text style={styles.emphasis}>Open in browser</Text> to stay signed in.
      </Text>
      <Pressable
        onPress={() => {
          dismissInAppBanner();
          setVisible(false);
        }}
        style={kit.tertiaryButton}
        testID="wsf-in-app-banner-dismiss"
        accessibilityRole="button"
      >
        <Text style={kit.tertiaryButtonText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // A quiet notice strip in the badge tint: the copy takes the width it can
  // get and wraps inside itself; the dismiss control drops under it only when
  // there is no room beside it.
  container: {
    backgroundColor: SAMPLE_TINT,
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    ...StyleSheet.flatten(kit.body),
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  emphasis: {
    fontWeight: '700',
  },
});
