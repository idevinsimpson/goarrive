/**
 * Shared Plan — Public-facing read-only plan viewer
 * Accessible at /shared-plan/[memberId]
 * Bypasses member dashboard and shows the plan directly.
 * Uses the getSharedPlan Cloud Function to fetch plan data
 * so unauthenticated visitors can view shared plans.
 * Only shows plans with status 'presented', 'accepted', or 'active'.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Platform, Pressable, Image,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  MemberPlanData, DayPlan, goalConfig, typeColors, phaseColorList,
  formatCurrency, calculatePricing, monthsToWeeks, PricingResult,
  getGoalEmoji, getGoalColor, PostContract,
} from '../../lib/planTypes';

// Cloud Function URL for fetching shared plan data (no auth required)
const GET_SHARED_PLAN_URL = 'https://us-central1-goarrive.cloudfunctions.net/getSharedPlan';

// ─── Helpers to normalize old/new field names ───────────────────────────────

function getSchedule(plan: MemberPlanData): DayPlan[] {
  if (plan.weeklySchedule?.length) return plan.weeklySchedule;
  const s = plan.sessionsPerWeek;
  if (s === 4 && (plan as any).weekPlan4?.length) return (plan as any).weekPlan4;
  if (s === 3 && (plan as any).weekPlan3?.length) return (plan as any).weekPlan3;
  if (s === 2 && (plan as any).weekPlan2?.length) return (plan as any).weekPlan2;
  if ((plan as any).weeklyPlan?.length) return (plan as any).weeklyPlan;
  return [];
}
function getContractMonths(plan: MemberPlanData): number {
  return plan.contractMonths || plan.contractLengthMonths || 12;
}
function getCts(plan: MemberPlanData) {
  if (plan.commitToSave) return plan.commitToSave;
  return {
    enabled: plan.commitToSaveEnabled ?? false,
    active: plan.commitToSaveAddOnActive ?? false,
    monthlySavings: plan.commitToSaveMonthlySavings ?? 100,
    missedSessionFee: plan.commitToSaveMissedSessionFee ?? 50,
    nextMonthPercentOff: plan.commitToSaveNextMonthPercentOff ?? 5,
    summary: plan.commitToSaveSummary ?? '',
    makeUpWindowHours: plan.commitToSaveMakeUpWindowHours ?? 48,
    reentryRule: plan.commitToSaveReentryRule ?? '',
    emergencyWaiverEnabled: plan.commitToSaveEmergencyWaiverEnabled ?? true,
  };
}
function getNutrition(plan: MemberPlanData) {
  if (plan.nutrition) return plan.nutrition;
  return {
    enabled: plan.nutritionEnabled ?? false,
    type: (plan.nutritionInHouse ? 'in-house' : 'outsourced') as 'in-house' | 'outsourced',
    providerName: plan.nutritionProviderName ?? '',
    monthlyCost: plan.nutritionMonthlyCost ?? 100,
    description: plan.nutritionDescription ?? '',
  };
}

// ─── Segmented Bar ──────────────────────────────────────────────────────────

function SegmentedBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {Array.from({ length: max }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 6, borderRadius: 2, backgroundColor: i < value ? color : '#2A3347' }} />
      ))}
    </View>
  );
}

export default function SharedPlanScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [localPlan, setLocalPlan] = useState<MemberPlanData | null>(null);

  useEffect(() => {
    if (!memberId) return;
    fetchPlanViaCloudFunction();
  }, [memberId]);

  async function fetchPlanViaCloudFunction() {
    try {
      const url = `${GET_SHARED_PLAN_URL}?memberId=${encodeURIComponent(memberId as string)}`;
      const resp = await fetch(url);
      const json = await resp.json();

      if (!resp.ok) {
        setError(json.error || 'Something went wrong loading this plan.');
        return;
      }

      const planData = json.plan as MemberPlanData;
      if (planData) {
        setPlan(planData);
      } else {
        setError('No plan found for this member.');
      }
    } catch (err) {
      console.error('[SharedPlan] Error fetching plan via CF:', err);
      setError('Something went wrong loading this plan.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={st.root}>
        <View style={st.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
          <Text style={{ color: '#8A95A3', marginTop: 12, fontSize: 14 }}>Loading your fitness plan...</Text>
        </View>
      </View>
    );
  }

  if (error || !plan) {
    return (
      <View style={st.root}>
        <View style={st.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCCB'}</Text>
          <Text style={st.emptyTitle}>{error || 'Plan not found'}</Text>
        </View>
      </View>
    );
  }

  const schedule = getSchedule(plan);
  const contractMonths = getContractMonths(plan);
  const memberAge = plan.memberAge || (plan as any).age;
  const goals = plan.goals || (plan as any).healthGoals || [];
  const firstName = plan.memberName?.split(' ')[0] || '';

  // Use localPlan for interactive toggles, fallback to fetched plan
  const activePlan = localPlan || plan;

  // Pricing
  let pricing: PricingResult | null = activePlan.pricingResult || null;
  if (!pricing) { try { pricing = calculatePricing(activePlan); } catch { /* ignore */ } }

  // Local toggle handler (no Firestore writes on shared-plan)
  const handleLocalChange = (updates: Partial<MemberPlanData>) => {
    const updated = { ...(localPlan || plan), ...updates } as MemberPlanData;
    // Recalculate pricing after toggle
    try { updated.pricingResult = calculatePricing(updated); } catch { /* ignore */ }
    setLocalPlan(updated);
  };

  return (
    <View style={st.root}>
      {/* Header bar */}
      <View style={st.planBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            source={require('../../assets/goarrive-icon.png')}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            resizeMode="contain"
          />
          <View style={[st.badge, { backgroundColor: 'rgba(110,187,122,0.12)', borderColor: 'rgba(110,187,122,0.25)' }]}>
            <Text style={[st.badgeText, { color: '#6EBB7A' }]}>Fitness Plan</Text>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}>
        {/* Hero */}
        <View style={{ marginTop: 20, marginBottom: 16 }}>
          {plan.identityTag ? (
            <View style={{ marginBottom: 14 }}>
              <View style={[st.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.25)' }]}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B9BD5' }} />
                <Text style={[st.badgeText, { color: '#5B9BD5' }]}>{plan.identityTag}</Text>
              </View>
            </View>
          ) : null}
          <Text style={st.heroName}>{plan.memberName}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {memberAge ? <Text style={st.heroAge}>{memberAge} years old</Text> : null}
            {plan.referredBy ? (
              <View style={[st.badge, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.2)' }]}>
                <Text style={[st.badgeText, { color: '#F5A623' }]}>Referred by {plan.referredBy}</Text>
              </View>
            ) : null}
          </View>
          <Text style={st.heroPlanTitle}>{firstName}'s Tailored Plan</Text>
          <Text style={st.heroBranding}>Built with GoArrive</Text>
          {plan.subtitle ? (
            <View style={st.darkCard}>
              <Text style={st.subtitleText}>{plan.subtitle}</Text>
            </View>
          ) : null}
        </View>

        {/* Starting Points */}
        {plan.startingPoints?.length ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Where You're Starting From</Text>
            <View style={st.darkCard}>
              {plan.startingPointIntro ? (
                <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22, fontStyle: 'italic', marginBottom: 12 }}>
                  {plan.startingPointIntro}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {plan.startingPoints.map((chip, i) => (
                  <View key={i} style={st.chip}><Text style={st.chipText}>{chip}</Text></View>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {/* Goals */}
        {goals.length > 0 ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Your Health Goals</Text>
            <Text style={st.sectionSubtitle}>What we're building toward</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              {goals.map((goal: string, i: number) => {
                const emoji = getGoalEmoji(goal, plan.goalEmojis);
                const color = getGoalColor(goal);
                return (
                  <View key={i} style={{ flex: 1, minWidth: '45%', backgroundColor: color + '15', borderColor: color + '40', borderWidth: 1, borderRadius: 12, padding: 14 }}>
                    <Text style={{ fontSize: 24, marginBottom: 6 }}>{emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: color }}>{goal}</Text>
                  </View>
                );
              })}
            </View>
            {(plan.currentWeight || plan.goalWeight) ? (
              <View style={[st.darkCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}>
                <View>
                  <Text style={st.miniLabel}>CURRENT</Text>
                  <Text style={st.statValueLarge}>{plan.currentWeight} lbs</Text>
                </View>
                <Text style={{ color: '#5B9BD5', fontSize: 18 }}>{'→'}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[st.miniLabel, { color: '#5B9BD5' }]}>GOAL</Text>
                  <Text style={[st.statValueLarge, { color: '#5B9BD5' }]}>{plan.goalWeight}</Text>
                </View>
              </View>
            ) : null}
            {plan.goalSummary ? (
              <View style={{ borderRadius: 12, padding: 14, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.25)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>{'\uD83C\uDFAF'}</Text>
                  <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22, fontStyle: 'italic', flex: 1 }}>{plan.goalSummary}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Why */}
        <View style={{ marginBottom: 20 }}>
          <Text style={st.sectionLabel}>Your Why</Text>
          <View style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
            <Text style={[st.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>IN {firstName.toUpperCase()}'S WORDS</Text>
            <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic' }}>
              "{plan.whyStatement}"
            </Text>
          </View>
          {plan.whyTranslation ? (
            <View style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: '#5B9BD5', marginBottom: 12 }]}>
              <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{plan.whyTranslation}</Text>
            </View>
          ) : null}
          <View style={st.darkCard}>
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={st.statLabel}>Readiness for Change</Text>
                <Text style={[st.statValue, { color: '#6EBB7A' }]}>{plan.readiness}/10</Text>
              </View>
              <SegmentedBar value={plan.readiness} color="#6EBB7A" />
            </View>
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={st.statLabel}>Motivation</Text>
                <Text style={[st.statValue, { color: '#5B9BD5' }]}>{plan.motivation}/10</Text>
              </View>
              <SegmentedBar value={plan.motivation} color="#5B9BD5" />
            </View>
            {plan.gymConfidence !== undefined && plan.gymConfidence > 0 ? (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={st.statLabel}>Gym Confidence</Text>
                  <Text style={[st.statValue, { color: '#F5A623' }]}>{plan.gymConfidence}/10</Text>
                </View>
                <SegmentedBar value={plan.gymConfidence} color="#F5A623" />
              </View>
            ) : null}
          </View>
        </View>

        {/* Weekly Plan */}
        {schedule.length > 0 ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Your Weekly Plan</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 }}>
              <Text style={{ color: '#6EBB7A', fontSize: 20, fontWeight: '700' }}>{plan.sessionsPerWeek} Sessions</Text>
              <Text style={{ color: '#8A95A3', fontSize: 14, marginLeft: 6 }}>per week {'·'} {contractMonths} months</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
              {schedule.map((day, i) => {
                const colors = typeColors[day.type] || typeColors['Rest'];
                const isRest = day.type === 'Rest';
                const isExpanded = expandedDay === i;
                const abbr = isRest ? 'OFF' : day.type === 'Strength' ? 'STR' : day.type === 'Cardio + Mobility' ? 'CARD' : 'MIX';
                return (
                  <Pressable key={i} onPress={() => !isRest && setExpandedDay(isExpanded ? null : i)}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2, borderRadius: 10, backgroundColor: isRest ? 'rgba(14,17,23,0.4)' : colors.bg, borderWidth: 1, borderColor: isExpanded ? colors.text : (isRest ? '#1A2030' : colors.border), opacity: isRest ? 0.45 : 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '600', color: isRest ? '#3A4255' : '#8A95A3', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 5 }}>{day.shortDay}</Text>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isRest ? '#2A3040' : colors.dot, marginBottom: 5 }} />
                    <Text style={{ fontSize: 8, fontWeight: '700', color: isRest ? '#3A4255' : colors.text, textAlign: 'center', letterSpacing: 0.2 }} numberOfLines={1}>{abbr}</Text>
                  </Pressable>
                );
              })}
            </View>
            {expandedDay !== null && schedule[expandedDay] && (
              <View style={[st.darkCard, { borderWidth: 1, borderColor: (typeColors[schedule[expandedDay].type] || typeColors['Rest']).border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: (typeColors[schedule[expandedDay].type] || typeColors['Rest']).text }}>
                    {schedule[expandedDay].day} {'\u2014'} {schedule[expandedDay].label || schedule[expandedDay].type}
                  </Text>
                  {schedule[expandedDay].duration ? (
                    <View style={[st.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.2)' }]}>
                      <Text style={[st.badgeText, { color: '#5B9BD5' }]}>{schedule[expandedDay].duration} min</Text>
                    </View>
                  ) : null}
                </View>
                {schedule[expandedDay].breakdown?.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: (typeColors[schedule[expandedDay].type] || typeColors['Rest']).dot, marginTop: 7 }} />
                    <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22 }}>{item}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* Coaching Evolution */}
        {plan.phases?.length ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>How Your Coaching Support Evolves</Text>
            <View style={{ flexDirection: 'row', borderRadius: 12, overflow: 'hidden', height: 8, marginBottom: 6 }}>
              {plan.phases.map((phase, i) => (
                <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColorList[i % 3] }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: MUTED, fontSize: 11, fontWeight: '600' }}>WEEK 1</Text>
              <Text style={{ color: MUTED, fontSize: 11, fontWeight: '600' }}>WEEK {monthsToWeeks(contractMonths)}</Text>
            </View>
            {plan.phases.map((phase, i) => (
              <View key={phase.id} style={[st.darkCard, { marginBottom: 10, borderLeftWidth: 3, borderLeftColor: phaseColorList[i % 3] }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: phaseColorList[i % 3], fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>PHASE {i + 1}</Text>
                  <View style={[st.badge, { backgroundColor: phaseColorList[i % 3] + '15', borderColor: phaseColorList[i % 3] + '30' }]}>
                    <Text style={[st.badgeText, { color: phaseColorList[i % 3] }]}>{phase.weeks} weeks</Text>
                  </View>
                </View>
                <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{phase.name}</Text>
                <Text style={{ color: '#8A95A3', fontSize: 13, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{phase.intensity}</Text>
                <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{phase.description}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* What's Included */}
        {plan.whatsIncluded?.length ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>What's Included</Text>
            <View style={st.darkCard}>
              {plan.whatsIncluded.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <Text style={{ fontSize: 16 }}>{'\u2705'}</Text>
                  <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 20, flex: 1 }}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Coaching Investment */}
        {pricing && (
          (activePlan.showInvestment !== false ||
            (activePlan.commitToSave?.enabled ?? false) ||
            (activePlan.nutrition?.enabled ?? false) ||
            (activePlan.postContract?.enabled ?? false)
          ) && (
            <CoachingInvestmentSection
              plan={activePlan}
              pricing={pricing}
              onChange={handleLocalChange}
            />
          )
        )}

        {/* Footer */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Text style={{ fontSize: 11, color: '#4A5568' }}>Powered by GoArrive</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Design tokens (match [memberId].tsx exactly) ──────────────────────────
const ACCENT = '#6EBB7A';
const PRIMARY = '#5B9BD5';
const GOLD = '#F5A623';
const BG = '#0E1117';
const CARD = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8899AA';
const GOLD_BG = 'rgba(245,166,35,0.12)';
const GOLD_BORDER = 'rgba(245,166,35,0.5)';
const GREEN_BORDER = 'rgba(110,187,122,0.5)';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';

// ═══════════════════════════════════════════════════════════════════════════════
// COACHING INVESTMENT SECTION (unified: pricing cards + add-ons + breakdown)
// Matches the coach's "Member View" preview exactly.
// ═══════════════════════════════════════════════════════════════════════════════

function CoachingInvestmentSection({ plan, pricing, onChange }: {
  plan: MemberPlanData; pricing: PricingResult;
  onChange: (updates: Partial<MemberPlanData>) => void;
}) {
  const [selected, setSelected] = useState<'monthly' | 'pay_in_full' | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState('');

  const pcEnabled = plan.postContract?.enabled ?? false;
  const ctsEnabledCheck = plan.commitToSave?.enabled ?? false;
  const nutEnabledCheck = plan.nutrition?.enabled ?? false;
  const hasVisibleAddOns = ctsEnabledCheck || nutEnabledCheck || pcEnabled;
  if (plan.showInvestment === false && !hasVisibleAddOns) return null;

  const cts = plan.commitToSave || getCts(plan);
  const nut = plan.nutrition || getNutrition(plan);
  const ctsEnabled = cts?.enabled ?? false;
  const ctsActive = cts?.active ?? false;
  const nutEnabled = nut?.enabled ?? false;
  const nutActive = (nut as any)?.active ?? false;

  const ctsSavings = cts?.monthlySavings ?? 100;
  const nutCost = nut?.monthlyCost ?? 100;

  const monthlyPrice = pricing.displayMonthlyPrice;
  const payInFullTotal = pricing.payInFullPrice;
  const payInFullMonthly = Math.round(payInFullTotal / (plan.contractMonths || 12));
  const payInFullSavings = Math.round(monthlyPrice * (plan.contractMonths || 12) - payInFullTotal);
  const payInFullPct = plan.payInFullDiscountPercent || 10;

  const totalSessions = pricing.totalSessions;
  const perSession = pricing.perSessionPrice;
  const programTotal = Math.round(monthlyPrice * (plan.contractMonths || 12));

  const toggleCommitToSave = () => {
    onChange({
      commitToSave: {
        ...(cts || { monthlySavings: 100, nextMonthPercentOff: 5, missedSessionFee: 50, makeUpWindowHours: 48, emergencyWaiverEnabled: true, reentryRule: '', summary: '', enabled: true }),
        active: !ctsActive,
      },
    });
  };

  const toggleNutrition = () => {
    if (!nut) return;
    onChange({
      nutrition: {
        ...nut,
        active: !nutActive,
      },
    });
  };

  const handleProceed = async () => {
    if (!selected) return;
    setCheckoutLoading(true);
    setError('');
    try {
      const functions = getFunctions();
      const createCheckout = httpsCallable(functions, 'createCheckoutSession');
      const result = await createCheckout({
        planId: plan.id || plan.memberId,
        memberId: plan.memberId,
        paymentOption: selected,
      });
      const { sessionUrl } = result.data as { sessionUrl: string };
      if (sessionUrl) {
        if (Platform.OS === 'web') {
          window.location.href = sessionUrl;
        } else {
          // Fallback for native
          import('expo-router').then(({ router }) => {
            router.push(sessionUrl as any);
          });
        }
      }
    } catch (err: any) {
      console.error('[SharedPlan] Checkout error:', err);
      setError(err.message || 'Could not start checkout. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>COACHING INVESTMENT</Text>

      {/* Pricing options selection */}
      <View style={{ gap: 10, marginBottom: 16 }}>
        {/* Monthly card */}
        <Pressable
          onPress={() => setSelected('monthly')}
          style={[ips.optionCard, selected === 'monthly' && ips.optionCardSelected]}
        >
          <View style={ips.optionHeader}>
            <View style={ips.optionRadio}>
              {selected === 'monthly' && <View style={ips.optionRadioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ips.optionTitle}>Monthly</Text>
              <Text style={ips.optionSubtitle}>Flexible · Cancel after contract ends</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={ips.optionPrice}>{formatCurrency(monthlyPrice)}</Text>
              <Text style={ips.optionPriceSuffix}>/mo</Text>
            </View>
          </View>
          <View style={ips.optionDetail}>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>Contract total</Text>
              <Text style={ips.detailValue}>{formatCurrency(monthlyPrice * (plan.contractMonths || 12))}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>After contract</Text>
              <Text style={ips.detailValue}>{formatCurrency(plan.postContract?.monthlyRate || 199)}/mo</Text>
            </View>
          </View>
        </Pressable>

        {/* Pay in Full card */}
        <Pressable
          onPress={() => setSelected('pay_in_full')}
          style={[ips.optionCard, selected === 'pay_in_full' && ips.optionCardSelectedGold]}
        >
          <View style={ips.optionHeader}>
            <View style={[ips.optionRadio, { borderColor: GOLD }]}>
              {selected === 'pay_in_full' && <View style={[ips.optionRadioDot, { backgroundColor: GOLD }]} />}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={ips.optionTitle}>Pay in Full</Text>
                <View style={{ backgroundColor: GOLD_BG, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ color: GOLD, fontSize: 10, fontWeight: '700' }}>{payInFullPct}% OFF</Text>
                </View>
              </View>
              <Text style={ips.optionSubtitle}>One payment · Best value</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[ips.optionPrice, { color: GOLD }]}>{formatCurrency(payInFullMonthly)}</Text>
              <Text style={ips.optionPriceSuffix}>/mo</Text>
            </View>
          </View>
          <View style={ips.optionDetail}>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>One payment today</Text>
              <Text style={[ips.detailValue, { color: '#FFF', fontWeight: '600' }]}>{formatCurrency(payInFullTotal)}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>You save</Text>
              <Text style={[ips.detailValue, { color: ACCENT, fontWeight: '600' }]}>{formatCurrency(payInFullSavings)}</Text>
            </View>
            <View style={ips.detailRow}>
              <Text style={ips.detailLabel}>After contract</Text>
              <Text style={ips.detailValue}>{formatCurrency(plan.postContract?.monthlyRate || 199)}/mo</Text>
            </View>
          </View>
        </Pressable>
      </View>

      {ctsEnabled && (
        <CommitToSaveCard
          plan={plan}
          isActive={ctsActive}
          onToggle={toggleCommitToSave}
          monthlyPrice={monthlyPrice}
          ctsSavings={ctsSavings}
          selected={selected}
          payInFullMonthly={payInFullMonthly}
        />
      )}

      {nutEnabled && (
        <NutritionAddOnCard
          plan={plan}
          isActive={nutActive}
          onToggle={toggleNutrition}
          monthlyPrice={monthlyPrice}
          nutCost={nutCost}
          payInFullMonthly={payInFullMonthly}
        />
      )}


      {plan.showInvestment !== false && (
        <View style={[inv.statsRow, { marginTop: 12, paddingVertical: 14, paddingHorizontal: 16 }]}>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
            <Text style={{ color: GOLD, fontWeight: '700' }}>Referral Rewards: </Text>
            Invite 3 friends into a yearly plan and your base membership is refunded.
          </Text>
        </View>
      )}

      {/* ── Post-Contract Ongoing Support card ── */}
      {pcEnabled && (
        <PostContractCard
          plan={plan}
          sessionsPerMonth={Math.round((plan.sessionsPerWeek || 3) * (52 / 12))}
        />
      )}

      {/* Error message */}
      {error ? (
        <View style={{ padding: 12, backgroundColor: 'rgba(224,82,82,0.1)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(224,82,82,0.3)', marginTop: 16 }}>
          <Text style={{ color: '#E05252', fontSize: 13, textAlign: 'center' }}>{error}</Text>
        </View>
      ) : null}

      {/* Main Payment CTA */}
      <Pressable
        onPress={handleProceed}
        disabled={!selected || checkoutLoading}
        style={[ips.ctaBtn, (!selected || checkoutLoading) && { opacity: 0.5 }]}
      >
        {checkoutLoading ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={ips.ctaBtnText}>
            {selected === 'pay_in_full'
              ? `Pay ${formatCurrency(payInFullTotal)} Now`
              : selected === 'monthly'
              ? `Pay ${formatCurrency(monthlyPrice)} Now`
              : 'Select a payment option'}
          </Text>
        )}
      </Pressable>

      {/* Fine print */}
      <Text style={{ color: '#4A5568', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 12 }}>
        Payments are processed securely by Stripe. By proceeding you agree to the GoArrive coaching terms. You may cancel month-to-month continuation at any time after your contract ends.
      </Text>
    </View>
  );
}

function CommitToSaveCard({ plan, isActive, onToggle, monthlyPrice, ctsSavings, selected, payInFullMonthly }: {
  plan: MemberPlanData; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; ctsSavings: number;
  selected: 'monthly' | 'pay_in_full' | null; payInFullMonthly: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const cts = plan.commitToSave || getCts(plan);
  const baseRate = selected === 'pay_in_full' ? payInFullMonthly : monthlyPrice;
  const rateAfter = baseRate - ctsSavings;

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GOLD_BORDER, backgroundColor: GOLD_BG }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? GOLD : 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>💡</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Commit to Save</Text>
            <Pressable onPress={onToggle} style={[inv.addBtn, isActive && inv.addBtnActive]}>
              {isActive ? (
                <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>✓ Added</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: '600' }}>Add</Text>
              )}
            </Pressable>
          </View>
          <Text style={{ color: GOLD, fontSize: 12, marginTop: 2 }}>
            Consistency reward · −{formatCurrency(ctsSavings)}/mo
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            Save {formatCurrency(ctsSavings)} per month when you commit to showing up consistently.
          </Text>
          <Pressable onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
            <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {expanded ? 'Hide details ▴' : 'How it works ▾'}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
              <Text style={inv.detailLine}>→  Commit to Save lowers your monthly rate by {formatCurrency(ctsSavings)} while it's active.</Text>
              <Text style={inv.detailLine}>→  Complete a 30-day streak and unlock an additional {cts?.nextMonthPercentOff || 5}% discount on the following month.</Text>
              <Text style={inv.detailLine}>→  If you miss a session without making it up within {cts?.makeUpWindowHours || 48} hours, a {formatCurrency(cts?.missedSessionFee || 50)} accountability fee applies.</Text>
              <Text style={inv.detailLine}>→  Fees are waived for family emergencies or illness.</Text>
              <Text style={inv.detailLine}>→  You can opt out at any time.</Text>
              <Text style={inv.detailLine}>→  If you opt out, you can re-enter at the start of the next year.</Text>
              <View style={{ marginTop: 10, padding: 12, backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)' }}>
                <Text style={{ color: GOLD, fontSize: 12, lineHeight: 18, fontStyle: 'italic' }}>
                  This is a commitment reward system built to help you follow through on what you already said you want to do. Best for highly committed members who want to save.
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
      {isActive && (
        <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.2)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>YOU SAVE</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(ctsSavings)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>YOUR RATE</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(rateAfter)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
        </View>
      )}
    </View>
  );
}

function NutritionAddOnCard({ plan, isActive, onToggle, monthlyPrice, nutCost, payInFullMonthly }: {
  plan: MemberPlanData; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; nutCost: number; payInFullMonthly: number;
}) {
  const nut = plan.nutrition || getNutrition(plan);
  const providerName = nut?.providerName || 'Partner';
  const description = nut?.description || 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins with a dedicated nutrition coach.';
  const newMonthly = isActive ? monthlyPrice : monthlyPrice + nutCost;
  const newPayInFull = Math.round(newMonthly * (plan.contractMonths || 12) * (1 - (plan.payInFullDiscountPercent || 10) / 100) / (plan.contractMonths || 12));

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.08)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? ACCENT : 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🥗</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Nutrition Add-On</Text>
            <Pressable onPress={onToggle} style={[inv.addBtn, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.08)' }]}>
              {isActive ? (
                <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '600' }}>✓ Added</Text>
              ) : (
                <Text style={{ color: MUTED, fontSize: 13, fontWeight: '600' }}>Add</Text>
              )}
            </Pressable>
          </View>
          <Text style={{ color: ACCENT, fontSize: 12, marginTop: 2 }}>
            With {providerName} · +{formatCurrency(nutCost)}/mo
          </Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            {description}
          </Text>
        </View>
      </View>
      {isActive && (
        <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(110,187,122,0.2)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>NEW MONTHLY</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(newMonthly)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: ACCENT, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>PAY IN FULL</Text>
            <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '700', fontFamily: FH }}>{formatCurrency(newPayInFull)}<Text style={{ fontSize: 13, color: MUTED }}>/mo</Text></Text>
          </View>
        </View>
      )}
    </View>
  );
}

function PostContractCard({ plan, sessionsPerMonth }: {
  plan: MemberPlanData; sessionsPerMonth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const pc = plan.postContract;
  const hourlyRate = pc?.hourlyRate ?? (plan as any).hourlyRate ?? 100;
  const sessionMinutes = pc?.sessionMinutes ?? 3.5;
  const nutCost = pc?.nutritionMonthlyCost ?? 25;
  const nutEnabled = plan.nutrition?.enabled ?? false;
  const monthlyRate = Math.round(hourlyRate * (sessionMinutes / 60) * sessionsPerMonth);
  const yearlyRate = monthlyRate * 12;
  const payInFullMonthly = Math.round(yearlyRate * 0.9 / 12);
  const payInFullSavings = Math.round(yearlyRate - yearlyRate * 0.9);
  const ctsMonthly = pc?.ctsMonthlySavings != null ? pc.ctsMonthlySavings : Math.round(monthlyRate * 0.5);
  const withNutMonthly = monthlyRate + nutCost;
  return (
    <View style={[inv.addonCard, { borderColor: 'rgba(91,155,213,0.4)', backgroundColor: 'rgba(91,155,213,0.05)', marginTop: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(91,155,213,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🔄</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Ongoing Support</Text>
          <Text style={{ color: PRIMARY, fontSize: 12, marginTop: 2 }}>After your contract · Month-to-month</Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
            You've built the foundation. Ongoing support keeps you accountable, progressing, and connected to your coach — on your terms.
          </Text>
          <Pressable onPress={() => setExpanded(!expanded)} style={{ marginTop: 6 }}>
            <Text style={{ color: PRIMARY, fontSize: 13, fontWeight: '600' }}>
              {expanded ? 'Hide details ▴' : 'See your ongoing rate ▾'}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={[inv.priceCard, { flex: 1 }]}>
                  <Text style={inv.priceLabel}>MONTHLY</Text>
                  <Text style={inv.priceAmount}>{formatCurrency(monthlyRate)}<Text style={inv.priceSuffix}>/mo</Text></Text>
                  <Text style={inv.priceDetail}>Cancel anytime</Text>
                </View>
                <View style={[inv.priceCard, { flex: 1, borderColor: GOLD_BORDER }]}>
                  <Text style={[inv.priceLabel, { color: GOLD }]}>PAY IN FULL</Text>
                  <Text style={inv.priceAmount}>{formatCurrency(payInFullMonthly)}<Text style={inv.priceSuffix}>/mo</Text></Text>
                  <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Save {formatCurrency(payInFullSavings)}/yr</Text>
                </View>
              </View>
              <View style={{ padding: 10, backgroundColor: GOLD_BG, borderRadius: 8, borderWidth: 1, borderColor: GOLD_BORDER, marginBottom: 8 }}>
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>💡 Commit to Save — Half Off</Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Stay consistent and lock in {formatCurrency(ctsMonthly)}/mo — half your standard monthly rate. The same accountability rules apply.
                </Text>
              </View>
              {nutEnabled && (
                <View style={{ padding: 10, backgroundColor: 'rgba(110,187,122,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)', marginBottom: 8 }}>
                  <Text style={{ color: ACCENT, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>🥗 Nutrition Add-On</Text>
                  <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                    Continue your nutrition coaching for +{formatCurrency(nutCost)}/mo. New monthly: {formatCurrency(withNutMonthly)}.
                  </Text>
                </View>
              )}
              <View style={{ padding: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
                <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 2 }}>🎁 Referral Clock Resets</Text>
                <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
                  Refer 3 friends into a yearly plan within {plan.contractMonths || 12} months and your base membership is refunded — same as your original contract.
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function HowWeGotTheseNumbers({ plan, pricing }: { plan: MemberPlanData; pricing: PricingResult }) {
  const [isOpen, setIsOpen] = useState(false);
  const months = plan.contractMonths;
  const sessionLength = pricing.sessionLengthMinutes || plan.sessionLengthMinutes || 60;

  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        onPress={() => setIsOpen(!isOpen)}
        style={[inv.statsRow, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 }]}
      >
        <Text style={{ color: PRIMARY, fontSize: 14, fontWeight: '600' }}>
          {isOpen ? 'Hide breakdown' : 'How we got these numbers'}
        </Text>
        <Text style={{ color: PRIMARY, fontSize: 14 }}>{isOpen ? '▴' : '▾'}</Text>
      </Pressable>

      {isOpen && (
        <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Monthly price: </Text>
            Based on your hourly coaching rate, session length ({sessionLength} min), {plan.sessionsPerWeek} sessions/week, monthly check-in calls, and initial program build time.
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Per session: </Text>
            {formatCurrency(pricing.displayMonthlyPrice)} × {months} months ÷ {pricing.totalSessions} total sessions = {formatCurrency(pricing.perSessionPrice)}
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 6 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' }}>Pay in full: </Text>
            {formatCurrency(pricing.displayMonthlyPrice)} × {months} months, minus {plan.payInFullDiscountPercent || 10}% discount = {formatCurrency(pricing.payInFullPrice)}
          </Text>
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTMENT SECTION STYLES (match [memberId].tsx exactly)
// ═══════════════════════════════════════════════════════════════════════════════

const inv = StyleSheet.create({
  priceCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  priceLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  priceAmount: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: FH,
  },
  priceSuffix: {
    fontSize: 14,
    fontWeight: '400',
    color: MUTED,
  },
  priceDetail: {
    color: MUTED,
    fontSize: 12,
    marginTop: 4,
  },
  statsRow: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    marginBottom: 12,
  },
  statsLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  statsValue: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FH,
  },
  statsDetail: {
    color: MUTED,
    fontSize: 11,
    marginTop: 2,
  },
  addonCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  addBtnActive: {
    borderColor: GOLD_BORDER,
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  detailLine: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  },
});

const ips = StyleSheet.create({
  optionCard: {
    backgroundColor: '#161B25',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#2A3347',
  },
  optionCardSelected: { borderColor: '#5B9BD5' },
  optionCardSelectedGold: { borderColor: '#F5A623' },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#5B9BD5',
    alignItems: 'center', justifyContent: 'center',
  },
  optionRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#5B9BD5' },
  optionTitle: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  optionSubtitle: { color: '#7A8A9A', fontSize: 12, marginTop: 1 },
  optionPrice: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  optionPriceSuffix: { color: '#7A8A9A', fontSize: 11 },
  optionDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  detailLabel: { color: '#7A8A9A', fontSize: 12 },
  detailValue: { color: '#7A8A9A', fontSize: 12 },
  ctaBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});

// ─── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 8, textAlign: 'center' },
  planBar: {
    flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#2A3347',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#5B9BD5',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8,
  },
  sectionSubtitle: { fontSize: 15, fontWeight: '700', color: '#F0F4F8', marginBottom: 12 },
  heroName: { fontSize: 28, fontWeight: '700', color: '#F0F4F8', letterSpacing: -0.5, marginBottom: 4 },
  heroAge: { fontSize: 13, color: '#8A95A3', fontWeight: '500' },
  heroPlanTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 4 },
  heroBranding: { fontSize: 11, color: '#5B9BD5', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  darkCard: { backgroundColor: '#161B25', borderWidth: 1, borderColor: '#2A3347', borderRadius: 12, padding: 14 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, borderWidth: 1, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  chip: { backgroundColor: '#1E2535', borderWidth: 1, borderColor: '#2A3347', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, color: '#C5CDD8' },
  subtitleText: { color: '#C5CDD8', fontSize: 14, lineHeight: 22 },
  miniLabel: { fontSize: 10, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.8, textTransform: 'uppercase' },
  statValueLarge: { fontSize: 17, fontWeight: '700', color: '#F0F4F8' },
  statLabel: { fontSize: 13, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.4 },
  statValue: { fontSize: 14, fontWeight: '700' },
});
