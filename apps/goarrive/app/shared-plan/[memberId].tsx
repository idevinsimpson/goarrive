/**
 * Shared Plan — Public-facing read-only plan viewer
 * Accessible at /shared-plan/[memberId]
 * Bypasses member dashboard and shows the plan directly.
 * Only shows plans with status 'presented' or 'active'.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Platform, Pressable, Image,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { db } from '../../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import {
  MemberPlanData, DayPlan, goalConfig, typeColors, phaseColorList,
  formatCurrency, calculatePricing, monthsToWeeks,
} from '../../lib/planTypes';

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
  const [ctsExpanded, setCtsExpanded] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    fetchPlan();
  }, [memberId]);

  async function fetchPlan() {
    try {
      const planDocSnap = await getDoc(doc(db, 'member_plans', `plan_${memberId}`));
      if (planDocSnap.exists()) {
        const data = { id: planDocSnap.id, ...planDocSnap.data() } as MemberPlanData;
        if (data.status === 'draft') {
          setError('This plan is still being built. Check back soon!');
        } else {
          setPlan(data);
        }
      } else {
        const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', memberId));
        const snap = await getDocs(plansQuery);
        if (!snap.empty) {
          const planDoc = snap.docs[0];
          const data = { id: planDoc.id, ...planDoc.data() } as MemberPlanData;
          if (data.status === 'draft') {
            setError('This plan is still being built. Check back soon!');
          } else {
            setPlan(data);
          }
        } else {
          setError('No plan found for this member.');
        }
      }
    } catch (err) {
      console.error('[SharedPlan] Error:', err);
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
  const cts = getCts(plan);
  const nut = getNutrition(plan);
  const memberAge = plan.memberAge || (plan as any).age;
  const goals = plan.goals || (plan as any).healthGoals || [];
  const firstName = plan.memberName?.split(' ')[0] || '';

  // Pricing
  let pricing = plan.pricingResult;
  if (!pricing) { try { pricing = calculatePricing(plan); } catch { /* ignore */ } }
  const displayMonthly = pricing ? pricing.displayMonthlyPrice : ((plan as any).monthlyPrice || 0);
  const nutritionCost = nut.enabled ? nut.monthlyCost : 0;
  const totalMonthly = displayMonthly + nutritionCost;
  const payInFullDiscount = plan.payInFullDiscountPercent || (pricing?.payInFullDiscount) || 10;
  const totalPayInFull = Math.round(totalMonthly * contractMonths * (1 - payInFullDiscount / 100));
  const totalSavings = totalMonthly * contractMonths - totalPayInFull;
  const totalWeeks = monthsToWeeks(contractMonths);

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
                const cfg = (goalConfig as any)[goal] || { emoji: '\uD83C\uDFAF', color: '#8A95A3' };
                return (
                  <View key={i} style={{ flex: 1, minWidth: '45%', backgroundColor: cfg.color + '15', borderColor: cfg.color + '40', borderWidth: 1, borderRadius: 12, padding: 14 }}>
                    <Text style={{ fontSize: 24, marginBottom: 6 }}>{cfg.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: cfg.color }}>{goal}</Text>
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
                <Text style={{ color: '#5B9BD5', fontSize: 18 }}>{'\u2192'}</Text>
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
              <Text style={{ color: '#8A95A3', fontSize: 14, marginLeft: 6 }}>per week {'\u00B7'} {contractMonths} months</Text>
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
                <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColorList[i], opacity: 0.85 }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
              {plan.phases.map((phase, i) => (
                <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: phaseColorList[i] }}>{phase.weeks}w</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: '#8A95A3', fontSize: 12, textAlign: 'center', marginBottom: 14 }}>
              Total: {totalWeeks} weeks ({contractMonths} months)
            </Text>
            {plan.phases.map((phase, i) => (
              <View key={phase.id} style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: phaseColorList[i], marginBottom: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: phaseColorList[i] }}>{phase.name}: {phase.intensity}</Text>
                  <Text style={{ fontSize: 12, color: '#8A95A3', marginLeft: 'auto' }}>{phase.weeks} weeks</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 21 }}>{phase.description}</Text>
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
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(110,187,122,0.15)', borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)', justifyContent: 'center', alignItems: 'center', marginTop: 1 }}>
                    <Text style={{ fontSize: 11, color: '#6EBB7A', fontWeight: '700' }}>{'\u2713'}</Text>
                  </View>
                  <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22, flex: 1 }}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Commit to Save */}
        {cts.enabled ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Commit to Save</Text>
            <View style={[st.darkCard, { borderColor: 'rgba(245,166,35,0.25)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 16 }}>{'\uD83D\uDD12'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>Commit to Save</Text>
                  <Text style={{ fontSize: 12, color: '#F5A623' }}>Save {formatCurrency(cts.monthlySavings)}/mo</Text>
                </View>
              </View>
              {cts.summary ? <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 10 }}>{cts.summary}</Text> : null}
              <Pressable onPress={() => setCtsExpanded(!ctsExpanded)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#F5A623' }}>{ctsExpanded ? 'Hide details' : 'How it works'}</Text>
                <Text style={{ fontSize: 12, color: '#F5A623' }}>{ctsExpanded ? '\u25B4' : '\u25BE'}</Text>
              </Pressable>
              {ctsExpanded && (
                <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.1)' }}>
                  {[
                    { color: '#F5A623', text: `Commit to Save lowers your monthly rate by ${formatCurrency(cts.monthlySavings)} while it's active.` },
                    { color: '#5B9BD5', text: `Complete a 30-day streak and unlock an additional ${cts.nextMonthPercentOff}% discount on the following month.` },
                    { color: '#C5CDD8', text: `If you miss a session without making it up within ${cts.makeUpWindowHours} hours, a ${formatCurrency(cts.missedSessionFee)} accountability fee applies.` },
                    ...(cts.emergencyWaiverEnabled ? [{ color: '#6EBB7A', text: 'Fees are waived for family emergencies or illness.' }] : []),
                    { color: '#C5CDD8', text: 'You can opt out at any time.' },
                    ...(cts.reentryRule ? [{ color: '#C5CDD8', text: cts.reentryRule }] : []),
                  ].map((item, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: item.color, marginTop: 2, width: 12 }}>{'\u2192'}</Text>
                      <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, flex: 1 }}>{item.text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* Nutrition */}
        {nut.enabled ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Nutrition Coaching</Text>
            <View style={[st.darkCard, { borderColor: 'rgba(110,187,122,0.25)' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 16 }}>{'\uD83E\uDD57'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>
                    {nut.type === 'in-house' ? 'In-House Nutrition Coaching' : `Nutrition by ${nut.providerName || 'Partner'}`}
                  </Text>
                  {nut.monthlyCost > 0 && <Text style={{ fontSize: 12, color: '#6EBB7A' }}>+{formatCurrency(nut.monthlyCost)}/mo</Text>}
                </View>
              </View>
              {nut.description ? <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20 }}>{nut.description}</Text> : null}
            </View>
          </View>
        ) : null}

        {/* Investment */}
        {plan.showInvestment && displayMonthly > 0 ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={st.sectionLabel}>Your Coaching Investment</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <View style={[st.darkCard, { flex: 1, borderColor: 'rgba(91,155,213,0.35)' }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#8A95A3', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Monthly</Text>
                <Text style={{ fontSize: 30, fontWeight: '800', color: '#F0F4F8', lineHeight: 34 }}>{formatCurrency(displayMonthly)}</Text>
                <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo</Text>
                {pricing && pricing.perSessionPrice > 0 ? <Text style={{ fontSize: 12, color: '#5B9BD5', marginTop: 8 }}>{formatCurrency(pricing.perSessionPrice)} per session</Text> : null}
              </View>
              <View style={[st.darkCard, { flex: 1, backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.35)' }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#F5A623', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Pay in Full</Text>
                <Text style={{ fontSize: 30, fontWeight: '800', color: '#F5A623', lineHeight: 34 }}>{formatCurrency(Math.round(totalPayInFull / contractMonths))}</Text>
                <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo equivalent</Text>
                <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.15)' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>{formatCurrency(totalPayInFull)} total</Text>
                  <Text style={{ fontSize: 12, color: '#6EBB7A', marginTop: 2, fontWeight: '600' }}>Save {formatCurrency(totalSavings)} ({payInFullDiscount}% off)</Text>
                </View>
              </View>
            </View>
            <View style={st.darkCard}>
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: '#8A95A3' }}>Base monthly rate</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#F0F4F8' }}>{formatCurrency(pricing ? pricing.baseMonthlyPrice : displayMonthly)}/mo</Text>
                </View>
                {cts.active && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: '#F5A623' }}>Commit to Save</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623' }}>{'\u2212'}{formatCurrency(cts.monthlySavings)}/mo</Text>
                  </View>
                )}
                {nut.enabled && nutritionCost > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: '#6EBB7A' }}>Nutrition add-on</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#6EBB7A' }}>+{formatCurrency(nutritionCost)}/mo</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(91,155,213,0.15)' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F0F4F8' }}>Your total</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(totalMonthly)}/mo</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* Footer */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Text style={{ fontSize: 11, color: '#4A5568' }}>Powered by GoArrive</Text>
        </View>
      </ScrollView>
    </View>
  );
}

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
