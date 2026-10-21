import { router, Unmatched } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CREAM, kit } from '../src/ui/kit';
import { useScreenTopInset } from '../src/ui/useScreenTopInset';

/**
 * INT-28 (W12-14) — A LINK TO NOTHING, ON A PHONE.
 *
 * expo-router's own unmatched screen is a developer's page: "Unmatched Route"
 * and a link to the Sitemap, every route the app has. On iOS and Android a
 * member who follows a stale or mistyped westayfit:// link gets this app's
 * own screen instead: what happened, in a sentence, and Go Home. The web
 * keeps expo-router's Unmatched, exactly as before.
 */
export default function NotFound() {
  if (Platform.OS === 'web') return <Unmatched />;
  return <NativeNotFound />;
}

function NativeNotFound() {
  const top = useScreenTopInset();
  return (
    <View style={[styles.screen, { paddingTop: 24 + top }]} testID="wsf-not-found">
      <View style={[kit.card, styles.cardGap]}>
        <Text style={kit.cardTitle} accessibilityRole="header">
          This page isn’t here
        </Text>
        <Text style={kit.body}>The link you followed doesn’t lead anywhere in We Stay Fit. Home has everything that does.</Text>
        <Pressable
          onPress={() => router.replace('/')}
          style={kit.primaryButton}
          accessibilityRole="button"
          testID="wsf-not-found-home"
        >
          <Text style={kit.primaryButtonText}>Go Home</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 20 },
  cardGap: { gap: 12 },
});
