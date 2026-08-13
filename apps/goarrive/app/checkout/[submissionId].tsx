/**
 * Funnel Checkout Page
 *
 * Route: /checkout/[submissionId]
 * Query params: submissionId (required), cancelled (optional — returned from Stripe cancel)
 *
 * Displayed after PR-G questionnaire step 3. Loads the onboarding submission,
 * looks up the subscription path's monthly price, accepts an optional discount
 * code, then calls createFunnelCheckoutSession and redirects to Stripe Checkout.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  StyleSheet, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../lib/firebase';

interface FunnelFolderResult {
  folder: {
    id: string;
    name: string;
    subscriptionPaths: SubscriptionPath[];
    emailTemplate: { subject: string; body: string } | null;
    funnelPhotoUrl: string | null;
    campaignName: string | null;
  };
  coach: {
    id: string;
    displayName: string;
    brandColor: string | null;
    funnelPhotoUrl: string | null;
  };
}

const BG = '#0E1117';
const CARD_BG = '#161B25';
const BORDER = '#2A3347';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const ACCENT = '#6EBB7A';
const RED = '#E05252';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

const FALLBACK_MONTHLY_CENTS = 1999;

interface Submission {
  coachId: string;
  programName?: string;
  status?: string;
  firstName?: string;
  email?: string;
  folderId?: string;
  subscriptionPathId?: string;
}

interface SubscriptionPath {
  id: string;
  label: string;
  templatePlaybookId: string;
  musicStyle?: string;
  pricePerMonthCents?: number;
}

export default function FunnelCheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { submissionId, cancelled } = useLocalSearchParams<{ submissionId: string; cancelled?: string }>();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [monthlyCents, setMonthlyCents] = useState<number>(FALLBACK_MONTHLY_CENTS);
  const [resolvedProgramName, setResolvedProgramName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discountCode, setDiscountCode] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!submissionId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'onboarding_submissions', submissionId));
        if (!snap.exists()) {
          setError('Submission not found. Please restart the sign-up flow.');
          return;
        }
        const sub = snap.data() as Submission;
        setSubmission(sub);

        if (sub.folderId && sub.coachId) {
          try {
            const getFunnelFolder = httpsCallable<
              { coachId: string; folderId: string },
              FunnelFolderResult
            >(getFunctions(), 'getFunnelFolder');
            const { data } = await getFunnelFolder({ coachId: sub.coachId, folderId: sub.folderId });
            if (data.folder.name) setResolvedProgramName(data.folder.name);
            const path = data.folder.subscriptionPaths.find((p) => p.id === sub.subscriptionPathId);
            if (path?.pricePerMonthCents && path.pricePerMonthCents > 0) {
              setMonthlyCents(path.pricePerMonthCents);
            }
          } catch {
            // Fall back to default price on lookup failure — server will do the same on checkout.
          }
        }
      } catch (err) {
        setError('Failed to load your submission. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  async function handleContinue() {
    if (!submissionId) return;
    setError(null);
    setCheckoutLoading(true);

    try {
      const functions = getFunctions();
      const createFunnelCheckoutSession = httpsCallable<
        { submissionId: string; discountCode?: string },
        { url: string; sessionId: string }
      >(functions, 'createFunnelCheckoutSession');

      const result = await createFunnelCheckoutSession({
        submissionId,
        ...(discountCode.trim() ? { discountCode: discountCode.trim() } : {}),
      });

      const { url } = result.data;
      if (url && Platform.OS === 'web') {
        window.location.href = url;
      } else if (url) {
        router.push(url as any);
      } else {
        setError('Failed to create checkout session. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={PRIMARY} />
      </View>
    );
  }

  if (!submission) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: RED, textAlign: 'center', fontSize: 15 }}>
          {error || 'Submission not found.'}
        </Text>
      </View>
    );
  }

  const programName = resolvedProgramName || submission.programName || 'Coaching Program';
  const priceDollars = (monthlyCents / 100).toFixed(2);

  return (
    <View style={[s.container, { paddingTop: Math.max(Platform.OS === 'web' ? 12 : 56, insets.top) }]}>
      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <Text style={s.headline}>Complete Your Enrollment</Text>
        <Text style={s.sub}>You're one step away from starting {programName}.</Text>

        {cancelled === '1' && (
          <View style={s.notice}>
            <Text style={{ color: MUTED, fontSize: 13 }}>
              Checkout was cancelled. No charge was made.
            </Text>
          </View>
        )}

        {/* Pricing card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{programName}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 8 }}>
            <Text style={{ color: '#FFF', fontSize: 36, fontWeight: '800', fontFamily: FH }}>${priceDollars}</Text>
            <Text style={{ color: MUTED, fontSize: 14 }}>/month</Text>
          </View>
          <Text style={{ color: MUTED, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Recurring monthly subscription. Cancel anytime.
          </Text>

          {/* Bullets */}
          <View style={{ marginTop: 16, gap: 8 }}>
            {[
              'Custom workouts built for you',
              'Direct coach access',
              'Video-guided exercises',
              'Progress tracking',
            ].map((item) => (
              <View key={item} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: ACCENT, fontSize: 14 }}>✓</Text>
                <Text style={{ color: MUTED, fontSize: 13 }}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Discount code */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Discount Code</Text>
          <Text style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
            Have a code from your coach? Enter it below.
          </Text>
          <TextInput
            style={s.input}
            placeholder="e.g. COACH20"
            placeholderTextColor={MUTED}
            value={discountCode}
            onChangeText={(t) => setDiscountCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={{ color: RED, fontSize: 13 }}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleContinue}
          disabled={checkoutLoading}
          style={[s.cta, checkoutLoading && { opacity: 0.6 }]}
        >
          {checkoutLoading
            ? <ActivityIndicator color="#FFF" />
            : <Text style={s.ctaText}>Continue to Payment</Text>
          }
        </Pressable>

        <Text style={{ color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
          Secured by Stripe. Your card info is never stored on our servers.
        </Text>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scrollContent: { padding: 20, paddingBottom: 60, gap: 16 },
  headline: {
    color: '#FFF', fontSize: 24, fontWeight: '800', fontFamily: FH,
    textAlign: 'center', marginBottom: 4,
  },
  sub: { color: MUTED, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  notice: {
    backgroundColor: CARD_BG, borderRadius: 10, borderWidth: 1,
    borderColor: BORDER, padding: 12, alignItems: 'center',
  },
  card: {
    backgroundColor: CARD_BG, borderRadius: 12, borderWidth: 1,
    borderColor: BORDER, padding: 16,
  },
  cardTitle: {
    color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, color: '#FFF',
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    fontFamily: FH,
  },
  errorBox: {
    backgroundColor: RED + '15', borderRadius: 8,
    borderWidth: 1, borderColor: RED + '44', padding: 12,
  },
  cta: {
    backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { color: '#FFF', fontSize: 16, fontWeight: '700', fontFamily: FH },
});
