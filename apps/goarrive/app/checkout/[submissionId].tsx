/**
 * Checkout placeholder — PR-H replaces this with actual Stripe checkout.
 *
 * This page receives the submissionId written by the onboarding wizard and
 * will be wired to createCheckoutSession by PR-H.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function CheckoutPlaceholder() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Almost there!</Text>
      <Text style={styles.body}>
        Your program selection has been saved. Complete your enrollment for $19.99/mo.
      </Text>
      <Text style={styles.hint}>Submission ID: {submissionId}</Text>
      {/* PR-H replaces this button with the real Stripe checkout session redirect */}
      <Pressable style={styles.btn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Continue to Payment</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontFamily: FONT_HEADING,
    fontSize: 26,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  body: {
    fontFamily: FONT_BODY,
    fontSize: 16,
    color: '#CCCCCC',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 24,
  },
  hint: {
    fontFamily: FONT_BODY,
    fontSize: 12,
    color: '#555',
    marginBottom: 32,
  },
  btn: {
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 40,
  },
  btnText: {
    fontFamily: FONT_HEADING,
    fontSize: 15,
    color: '#000',
    fontWeight: '700',
  },
});
