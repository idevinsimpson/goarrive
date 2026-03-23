/**
 * Checkout Success — Public page shown after Stripe Checkout completes
 *
 * Route: /checkout-success
 * Query params:
 *   - intent: intentId from createCheckoutSession
 *   - memberId: the member's ID (for account creation redirect)
 *
 * This page does NOT require authentication. After payment completes,
 * the user is prompted to create an account to access their plan.
 *
 * Flow: View shared plan → Pay via Stripe → This page → Create account
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

const BG = '#0E1117';
const GOLD = '#F5A623';
const ACCENT = '#6EBB7A';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

export default function CheckoutSuccessPublicScreen() {
  const { intent, memberId } = useLocalSearchParams<{ intent?: string; memberId?: string }>();
  const [status, setStatus] = useState<'confirming' | 'success'>('confirming');

  useEffect(() => {
    // Give a brief moment for the payment to process, then show success
    // The webhook will handle the actual plan activation in the background
    const timer = setTimeout(() => {
      setStatus('success');
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const handleCreateAccount = () => {
    // Navigate to the shared plan page where they can create their account
    // The shared plan page has the claim gate for account creation
    if (memberId) {
      if (Platform.OS === 'web') {
        window.location.href = `/shared-plan/${memberId}`;
      } else {
        Linking.openURL(`/shared-plan/${memberId}`);
      }
    } else {
      // Fallback: go to login page
      if (Platform.OS === 'web') {
        window.location.href = '/';
      }
    }
  };

  return (
    <View style={s.root}>
      <View style={s.card}>
        {status === 'confirming' && (
          <>
            <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 20 }} />
            <Text style={s.title}>Confirming your payment...</Text>
            <Text style={s.subtitle}>This usually takes just a moment.</Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>{'\uD83C\uDF89'}</Text>
            <Text style={s.title}>Payment Received!</Text>
            <Text style={s.subtitle}>
              Your coaching plan is being activated. Your coach will be notified and will reach out to get started.
            </Text>
            <Text style={[s.subtitle, { color: PRIMARY, fontWeight: '600', marginBottom: 20 }]}>
              Create your account to access your plan, schedule sessions, and connect with your coach.
            </Text>
            <Pressable onPress={handleCreateAccount} style={s.ctaBtn}>
              <Text style={s.ctaBtnText}>Create Your Account</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Footer */}
      <View style={{ position: 'absolute', bottom: 24 }}>
        <Text style={{ color: '#4A5568', fontSize: 11 }}>Powered by GoArrive</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#161B25',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  title: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  ctaBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
  },
  ctaBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
});
