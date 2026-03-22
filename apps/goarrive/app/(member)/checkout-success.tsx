/**
 * Checkout Success — Shown after Stripe Checkout completes
 *
 * Route: (member)/checkout-success
 * Query params: intent (intentId from createCheckoutSession)
 *
 * Polls the checkoutIntent document until status === 'completed',
 * then shows a success message and redirects to my-plan.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const BG = '#0E1117';
const GOLD = '#F5A623';
const ACCENT = '#6EBB7A';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

export default function CheckoutSuccessScreen() {
  const router = useRouter();
  const { intent } = useLocalSearchParams<{ intent: string }>();
  const [status, setStatus] = useState<'polling' | 'completed' | 'timeout'>('polling');

  useEffect(() => {
    if (!intent) {
      setStatus('completed');
      return;
    }

    const ref = doc(db, 'checkoutIntents', intent);
    let timeoutId: ReturnType<typeof setTimeout>;

    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists() && snap.data()?.status === 'completed') {
        setStatus('completed');
        clearTimeout(timeoutId);
      }
    });

    // Timeout after 30s — webhook may be slow
    timeoutId = setTimeout(() => {
      setStatus('timeout');
      unsub();
    }, 30000);

    return () => {
      unsub();
      clearTimeout(timeoutId);
    };
  }, [intent]);

  return (
    <View style={s.root}>
      <View style={s.card}>
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 20 }} />
            <Text style={s.title}>Confirming your payment…</Text>
            <Text style={s.subtitle}>This usually takes just a moment.</Text>
          </>
        )}

        {status === 'completed' && (
          <>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>{'🎉'}</Text>
            <Text style={s.title}>You're in!</Text>
            <Text style={s.subtitle}>
              Your coaching plan is now active. Your coach will be notified and will reach out to get started.
            </Text>
            <Pressable
              onPress={() => router.replace('/(member)/my-plan')}
              style={s.ctaBtn}
            >
              <Text style={s.ctaBtnText}>View My Plan</Text>
            </Pressable>
          </>
        )}

        {status === 'timeout' && (
          <>
            <Text style={{ fontSize: 40, marginBottom: 16 }}>{'⏳'}</Text>
            <Text style={s.title}>Almost there…</Text>
            <Text style={s.subtitle}>
              Your payment was received but confirmation is taking longer than expected. Your plan will activate shortly — check back in a moment.
            </Text>
            <Pressable
              onPress={() => router.replace('/(member)/my-plan')}
              style={s.ctaBtn}
            >
              <Text style={s.ctaBtnText}>Go to My Plan</Text>
            </Pressable>
          </>
        )}
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
  },
  ctaBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
});
