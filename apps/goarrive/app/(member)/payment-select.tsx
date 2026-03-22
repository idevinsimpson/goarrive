/**
 * Payment Select — Member payment option selection before Stripe Checkout
 *
 * Route: (member)/payment-select
 * Query params: planId (required)
 *
 * Displays:
 *   - Monthly subscription option (with two-phase: contract → continuation)
 *   - Pay in Full option (10% discount, deferred continuation subscription)
 *   - Commit to Save explanation
 *
 * On selection: calls createCheckoutSession Cloud Function, then redirects
 * to Stripe Checkout URL.
 *
 * ME-001: Requires STRIPE_SECRET_KEY configured in Cloud Functions.
 * ME-003: Requires APP_BASE_URL configured for redirect URLs.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
  StyleSheet, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import type { MemberPlanData } from '../../lib/planTypes';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG = '#0E1117';
const CARD_BG = '#161B25';
const BORDER = '#2A3347';
const MUTED = '#7A8A9A';
const PRIMARY = '#5B9BD5';
const ACCENT = '#6EBB7A';
const GOLD = '#F5A623';
const GOLD_BG = 'rgba(245,166,35,0.08)';
const GOLD_BORDER = 'rgba(245,166,35,0.3)';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';

function formatCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

type PaymentOption = 'monthly' | 'pay_in_full';

export default function PaymentSelectScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { user } = useAuth();

  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PaymentOption | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load plan ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!planId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'member_plans', planId));
        if (snap.exists()) {
          setPlan({ id: snap.id, ...snap.data() } as MemberPlanData);
        }
      } catch (err) {
        console.warn('[PaymentSelect] Failed to load plan:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [planId]);

  // ── Compute pricing ────────────────────────────────────────────────────────
  const sessionsPerWeek = plan?.sessionsPerWeek ?? 3;
  const sessionsPerMonth = Math.round(sessionsPerWeek * (52 / 12));
  const contractMonths = plan?.contractMonths ?? 12;

  const displayMonthlyPrice = Math.round(
    (plan as any)?.pricingResult?.displayMonthlyPrice ??
    (plan as any)?.monthlyPriceOverride ??
    (plan as any)?.pricingResult?.calculatedMonthlyPrice ??
    ((plan?.hourlyRate ?? 100) * ((plan?.sessionLengthMinutes ?? 60) / 60) * sessionsPerMonth)
  );

  const contractTotal = displayMonthlyPrice * contractMonths;
  const payInFullTotal = Math.round(contractTotal * 0.9);
  const payInFullMonthly = Math.round(payInFullTotal / contractMonths);
  const payInFullSavings = contractTotal - payInFullTotal;

  // Continuation pricing
  const cp = (plan as any)?.continuationPricing;
  const contHr = cp?.continuationHourlyRate ?? plan?.hourlyRate ?? 100;
  const contMin = cp?.continuationMinutesPerSession ?? 3.5;
  const continuationMonthly = Math.round(contHr * (contMin / 60) * sessionsPerMonth);

  // CTS
  const ctsSavings = plan?.postContract?.ctsMonthlySavings ?? Math.round(displayMonthlyPrice * 0.5);

  // ── Handle checkout ────────────────────────────────────────────────────────
  async function handleProceed() {
    if (!selected || !planId || !user) return;
    setCheckoutLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const createCheckout = httpsCallable<
        { planId: string; memberId: string; paymentOption: PaymentOption },
        { sessionUrl: string; intentId: string; snapshotId: string }
      >(functions, 'createCheckoutSession');

      const result = await createCheckout({
        planId,
        memberId: user.uid,
        paymentOption: selected,
      });

      const { sessionUrl } = result.data;
      if (sessionUrl) {
        if (Platform.OS === 'web') {
          window.location.href = sessionUrl;
        } else {
          const Linking = require('expo-linking');
          await Linking.openURL(sessionUrl);
        }
      } else {
        setError('No checkout URL returned. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: Payment system is not yet configured. Please contact your coach.');
      } else if (msg.includes('failed-precondition') || msg.includes('FAILED_PRECONDITION')) {
        setError(msg.replace('FAILED_PRECONDITION: ', ''));
      } else {
        setError(msg);
      }
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={s.root}>
        <View style={s.center}>
          <Text style={{ color: MUTED, fontSize: 14 }}>Plan not found.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: PRIMARY, fontSize: 14 }}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
          <Text style={{ color: PRIMARY, fontSize: 22 }}>{'←'}</Text>
        </Pressable>
        <Text style={s.headerTitle}>Choose Your Payment</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content}>
        {/* Headline */}
        <Text style={s.headline}>You're one step away.</Text>
        <Text style={s.subheadline}>
          {`${contractMonths}-month contract · ${sessionsPerWeek}x/week · Continues month-to-month after`}
        </Text>

        {/* Option: Monthly */}
        <Pressable
          onPress={() => setSelected('monthly')}
          style={[s.optionCard, selected === 'monthly' && s.optionCardSelected]}
        >
          <View style={s.optionHeader}>
            <View style={s.optionRadio}>
              {selected === 'monthly' && <View style={s.optionRadioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>Monthly</Text>
              <Text style={s.optionSubtitle}>Flexible · Cancel after contract ends</Text>
            </View>
            <View style={s.optionPriceWrap}>
              <Text style={s.optionPrice}>{formatCurrency(displayMonthlyPrice)}</Text>
              <Text style={s.optionPriceSuffix}>/mo</Text>
            </View>
          </View>

          <View style={s.optionDetail}>
            <DetailRow label="Contract total" value={formatCurrency(contractTotal)} />
            <DetailRow label="After contract" value={`${formatCurrency(continuationMonthly)}/mo`} />
            <DetailRow label="Commit to Save rate" value={`${formatCurrency(ctsSavings)}/mo`} accent />
          </View>
        </Pressable>

        {/* Option: Pay in Full */}
        <Pressable
          onPress={() => setSelected('pay_in_full')}
          style={[s.optionCard, selected === 'pay_in_full' && s.optionCardSelected, { borderColor: selected === 'pay_in_full' ? GOLD : GOLD_BORDER }]}
        >
          <View style={s.optionHeader}>
            <View style={[s.optionRadio, { borderColor: GOLD }]}>
              {selected === 'pay_in_full' && <View style={[s.optionRadioDot, { backgroundColor: GOLD }]} />}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.optionTitle}>Pay in Full</Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: GOLD_BG, borderRadius: 10, borderWidth: 1, borderColor: GOLD_BORDER }}>
                  <Text style={{ color: GOLD, fontSize: 10, fontWeight: '700' }}>10% OFF</Text>
                </View>
              </View>
              <Text style={s.optionSubtitle}>One payment · Best value</Text>
            </View>
            <View style={s.optionPriceWrap}>
              <Text style={[s.optionPrice, { color: GOLD }]}>{formatCurrency(payInFullMonthly)}</Text>
              <Text style={s.optionPriceSuffix}>/mo</Text>
            </View>
          </View>

          <View style={s.optionDetail}>
            <DetailRow label="One payment today" value={formatCurrency(payInFullTotal)} highlight />
            <DetailRow label="You save" value={formatCurrency(payInFullSavings)} accent />
            <DetailRow label="After contract" value={`${formatCurrency(continuationMonthly)}/mo`} />
          </View>
        </Pressable>

        {/* Commit to Save callout */}
        <View style={s.ctsCallout}>
          <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
            {'💡'} Commit to Save — available after contract
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
            {`Stay consistent during your continuation period and lock in ${formatCurrency(ctsSavings)}/mo — half your standard rate. Same accountability rules apply.`}
          </Text>
        </View>

        {/* Error */}
        {error && (
          <View style={s.errorBox}>
            <Text style={{ color: '#E05252', fontSize: 12, lineHeight: 18 }}>{error}</Text>
          </View>
        )}

        {/* CTA */}
        <Pressable
          onPress={handleProceed}
          disabled={!selected || checkoutLoading}
          style={[s.ctaBtn, (!selected || checkoutLoading) && { opacity: 0.5 }]}
        >
          {checkoutLoading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={s.ctaBtnText}>
              {selected === 'pay_in_full'
                ? `Pay ${formatCurrency(payInFullTotal)} Now`
                : selected === 'monthly'
                ? `Start at ${formatCurrency(displayMonthlyPrice)}/mo`
                : 'Select a payment option'}
            </Text>
          )}
        </Pressable>

        {/* Fine print */}
        <Text style={s.finePrint}>
          {'Payments are processed securely by Stripe. By proceeding you agree to the GoArrive coaching terms. You may cancel month-to-month continuation at any time after your contract ends.'}
        </Text>
      </ScrollView>
    </View>
  );
}

function DetailRow({
  label, value, accent, highlight,
}: { label: string; value: string; accent?: boolean; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
      <Text style={{ color: MUTED, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: highlight ? '#FFF' : accent ? ACCENT : MUTED, fontSize: 12, fontWeight: highlight ? '700' : '400' }}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { color: '#F0F4F8', fontSize: 16, fontWeight: '600', fontFamily: FH },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  headline: { color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH, textAlign: 'center', marginTop: 8 },
  subheadline: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  optionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  optionCardSelected: { borderColor: PRIMARY },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: PRIMARY,
    alignItems: 'center', justifyContent: 'center',
  },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PRIMARY },
  optionTitle: { color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH },
  optionSubtitle: { color: MUTED, fontSize: 12, marginTop: 1 },
  optionPriceWrap: { alignItems: 'flex-end' },
  optionPrice: { color: '#FFF', fontSize: 20, fontWeight: '700', fontFamily: FH },
  optionPriceSuffix: { color: MUTED, fontSize: 11 },
  optionDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  ctsCallout: {
    padding: 12,
    backgroundColor: GOLD_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  errorBox: {
    padding: 12,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.25)',
  },
  ctaBtn: {
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700', fontFamily: FH },
  finePrint: { color: '#4A5568', fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
