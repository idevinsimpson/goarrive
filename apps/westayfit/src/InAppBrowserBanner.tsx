import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  dismissInAppBanner,
  isInAppBannerDismissed,
  isInAppBrowser,
} from './inAppBrowser';
import { wsfTheme } from './theme';

export function InAppBrowserBanner() {
  // Detection happens on mount so SSR renders nothing, then the effect kicks
  // in on the client and either shows or hides based on UA + dismissal state.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
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
        style={styles.dismissButton}
        testID="wsf-in-app-banner-dismiss"
        accessibilityRole="button"
      >
        <Text style={styles.dismissText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: wsfTheme.colors.accent,
    padding: wsfTheme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: wsfTheme.spacing.sm,
  },
  text: {
    flex: 1,
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
  },
  emphasis: {
    fontWeight: '700',
  },
  dismissButton: {
    paddingHorizontal: wsfTheme.spacing.sm,
    paddingVertical: wsfTheme.spacing.xs,
  },
  dismissText: {
    color: wsfTheme.colors.text,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
