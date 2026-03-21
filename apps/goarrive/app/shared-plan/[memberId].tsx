/**
 * Shared Plan — Public-facing read-only plan viewer
 * 
 * Accessible at /shared-plan/[memberId]
 * This route bypasses the member dashboard and shows the plan directly.
 * Coaches can share this link with members before they have accounts.
 * 
 * Only shows plans with status 'presented' or 'active'.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Pressable,
  Image,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { db } from '../../lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import {
  MemberPlanData,
  DayPlan,
  goalConfig,
  typeColors,
  phaseColors,
  formatCurrency,
  calculatePricing,
} from '../../lib/planTypes';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

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

  useEffect(() => {
    if (!memberId) return;
    fetchPlan();
  }, [memberId]);

  async function fetchPlan() {
    try {
      // Try predictable ID first
      const planDocSnap = await getDoc(doc(db, 'member_plans', `plan_${memberId}`));
      if (planDocSnap.exists()) {
        const data = { id: planDocSnap.id, ...planDocSnap.data() } as MemberPlanData;
        if (data.status === 'draft') {
          setError('This plan is still being built. Check back soon!');
        } else {
          setPlan(data);
        }
      } else {
        // Fallback query
        const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', memberId));
        const snap = await getDocs(plansQuery);
        if (!snap.empty) {
          const data = { id: snap.docs[0].id, ...snap.docs[0].data() } as MemberPlanData;
          if (data.status === 'draft') {
            setError('This plan is still being built. Check back soon!');
          } else {
            setPlan(data);
          }
        } else {
          setError('Plan not found.');
        }
      }
    } catch (err: any) {
      console.error('[SharedPlan] Error:', err);
      setError('Unable to load plan. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#F5A623" />
        <Text style={{ color: '#4A5568', marginTop: 12, fontFamily: FONT_BODY }}>Loading your plan...</Text>
      </View>
    );
  }

  if (error || !plan) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 8, textAlign: 'center' }}>
          {error || 'Plan not found'}
        </Text>
        <Text style={{ fontSize: 14, color: '#8A95A3', textAlign: 'center', lineHeight: 22 }}>
          If you believe this is an error, contact your coach.
        </Text>
      </View>
    );
  }

  const memberAge = plan.memberAge || plan.age;
  const contractMonths = plan.contractLengthMonths || plan.contractMonths || 12;
  const currentPlan: DayPlan[] =
    plan.sessionsPerWeek === 4 ? plan.weekPlan4
    : plan.sessionsPerWeek === 3 ? plan.weekPlan3
    : plan.weekPlan2;

  return (
    <View style={s.root}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* GoArrive Logo */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, marginTop: 8 }}>
          <Image
            source={require('../../assets/goarrive-icon.png')}
            style={{ width: 36, height: 36, borderRadius: 8 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 11, color: '#5B9BD5', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', fontFamily: FONT_HEADING }}>
            Fitness Plan
          </Text>
        </View>

        {/* Hero */}
        <View style={{ marginBottom: 16 }}>
          <View style={[s.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.25)', marginBottom: 14 }]}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B9BD5' }} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#5B9BD5', fontFamily: FONT_HEADING, letterSpacing: 1 }}>
              {plan.identityTag?.toUpperCase() || 'FITNESS PLAN'}
            </Text>
          </View>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING, letterSpacing: -0.5, marginBottom: 4 }}>
            {plan.memberName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {memberAge ? <Text style={{ fontSize: 13, color: '#8A95A3', fontWeight: '500' }}>{memberAge} years old</Text> : null}
            {plan.referredBy ? (
              <View style={[s.badge, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.2)' }]}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#F5A623', letterSpacing: 0.4 }}>Referred by {plan.referredBy}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 4 }}>
            {plan.memberName.split(' ')[0]}'s Tailored Plan
          </Text>
          <Text style={{ fontSize: 11, color: '#5B9BD5', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            Built with GoArrive
          </Text>
          <View style={s.darkCard}>
            <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{plan.subtitle}</Text>
          </View>
        </View>

        {/* Starting Points */}
        {plan.startingPoints && plan.startingPoints.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>Where You're Starting From</Text>
            <View style={s.darkCard}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {plan.startingPoints.map((chip, i) => (
                  <View key={i} style={{ backgroundColor: '#1E2535', borderWidth: 1, borderColor: '#2A3347', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 12, color: '#C5CDD8' }}>{chip}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Goals */}
        {plan.goals && plan.goals.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>Your Health Goals</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8', marginBottom: 12 }}>What we're building toward</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              {plan.goals.map((goal, i) => {
                const cfg = (goalConfig as any)[goal] || { emoji: '🎯', color: '#8A95A3' };
                const gcfg = (goalConfig as any[]).find?.((g: any) => g.label === goal);
                return (
                  <View key={i} style={{
                    flex: 1, minWidth: '45%',
                    backgroundColor: gcfg?.bgColor || cfg.color + '15',
                    borderColor: gcfg?.borderColor || cfg.color + '40',
                    borderWidth: 1, borderRadius: 12, padding: 14,
                  }}>
                    <Text style={{ fontSize: 24, marginBottom: 6 }}>{gcfg?.icon || cfg.emoji}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: gcfg?.textColor || cfg.color }}>{goal}</Text>
                  </View>
                );
              })}
            </View>
            {(plan.currentWeight || plan.goalWeight) ? (
              <View style={[s.darkCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}>
                <View>
                  <Text style={s.miniLabel}>CURRENT</Text>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#F0F4F8' }}>{plan.currentWeight} lbs</Text>
                </View>
                <Text style={{ color: '#5B9BD5', fontSize: 18 }}>→</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.miniLabel, { color: '#5B9BD5' }]}>GOAL</Text>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#5B9BD5' }}>{plan.goalWeight}</Text>
                </View>
              </View>
            ) : null}
            {plan.goalSummary ? (
              <View style={{ borderRadius: 12, padding: 14, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.25)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>🎯</Text>
                  <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22, fontStyle: 'italic', flex: 1 }}>{plan.goalSummary}</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Why */}
        {plan.whyStatement ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>Your Why</Text>
            <View style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
              <Text style={[s.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>
                IN {plan.memberName.split(' ')[0].toUpperCase()}'S WORDS
              </Text>
              <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic' }}>
                "{plan.whyStatement}"
              </Text>
            </View>
            {plan.whyTranslation ? (
              <View style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: '#5B9BD5', marginBottom: 12 }]}>
                <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>{plan.whyTranslation}</Text>
              </View>
            ) : null}
            <View style={s.darkCard}>
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#8A95A3' }}>Readiness for Change</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#6EBB7A' }}>{plan.readiness}/10</Text>
                </View>
                <SegmentedBar value={plan.readiness} color="#6EBB7A" />
              </View>
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#8A95A3' }}>Motivation</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#5B9BD5' }}>{plan.motivation}/10</Text>
                </View>
                <SegmentedBar value={plan.motivation} color="#5B9BD5" />
              </View>
              {plan.gymConfidence !== undefined && plan.gymConfidence > 0 ? (
                <View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#8A95A3' }}>Gym Confidence</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#F5A623' }}>{plan.gymConfidence}/10</Text>
                  </View>
                  <SegmentedBar value={plan.gymConfidence} color="#F5A623" />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Weekly Plan */}
        {currentPlan && currentPlan.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>Your Weekly Plan</Text>
            <Text style={{ color: '#8A95A3', fontSize: 13, marginBottom: 10 }}>
              {plan.sessionsPerWeek} sessions/week · {contractMonths} months
            </Text>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
              {currentPlan.map((day, i) => {
                const colors = typeColors[day.type] || typeColors.rest;
                const noGo = day.label === 'No-Go Day';
                const isExpanded = expandedDay === i;
                return (
                  <Pressable
                    key={i}
                    onPress={() => { if (!noGo) setExpandedDay(isExpanded ? null : i); }}
                    style={{
                      flex: 1, alignItems: 'center', gap: 4, borderRadius: 12, paddingVertical: 10,
                      backgroundColor: noGo ? 'rgba(14,17,23,0.5)' : colors.bg,
                      borderWidth: 1, borderColor: noGo ? '#1A1F2B' : colors.border,
                      opacity: noGo ? 0.4 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '600', color: noGo ? '#3A4255' : '#8A95A3', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {day.shortDay}
                    </Text>
                    {noGo ? (
                      <Text style={{ fontSize: 14, color: '#3A4255' }}>✕</Text>
                    ) : (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot }} />
                    )}
                    <Text style={{ fontSize: 9, fontWeight: '700', color: noGo ? '#3A4255' : colors.text, textAlign: 'center' }}>
                      {noGo ? 'OFF' : day.type === 'strength' ? 'STR' : day.type === 'cardio' ? 'END' : day.type === 'optional' ? 'OPT' : 'REST'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {expandedDay !== null && (
              <View style={[s.darkCard, { borderWidth: 1, borderColor: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).text }}>
                      {currentPlan[expandedDay].day}
                    </Text>
                    <Text style={{ fontSize: 13, color: '#8A95A3' }}>— {currentPlan[expandedDay].label}</Text>
                  </View>
                  {currentPlan[expandedDay].duration ? (
                    <View style={[s.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.2)' }]}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#5B9BD5', letterSpacing: 0.4 }}>{currentPlan[expandedDay].duration}</Text>
                    </View>
                  ) : null}
                </View>
                {currentPlan[expandedDay].breakdown?.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).dot, marginTop: 7 }} />
                    <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22 }}>{item}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Coaching Evolution */}
        {plan.phases && plan.phases.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>How Your Coaching Support Evolves</Text>
            <View style={{ flexDirection: 'row', borderRadius: 12, overflow: 'hidden', height: 8, marginBottom: 12 }}>
              {plan.phases.map((phase, i) => (
                <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColors[i], opacity: 0.85 }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 14 }}>
              {plan.phases.map((phase, i) => (
                <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: phaseColors[i], textTransform: 'uppercase', letterSpacing: 0.5 }}>{phase.name}</Text>
                  <Text style={{ fontSize: 10, color: '#8A95A3', marginTop: 2 }}>{phase.weeks}w</Text>
                </View>
              ))}
            </View>
            {plan.phases.map((phase, i) => (
              <View key={phase.id} style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: phaseColors[i], marginBottom: 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <View style={{ backgroundColor: `${phaseColors[i]}20`, borderWidth: 1, borderColor: `${phaseColors[i]}40`, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: phaseColors[i] }}>Phase {phase.id}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#F0F4F8' }}>{phase.name}</Text>
                  <Text style={{ fontSize: 12, color: '#8A95A3', marginLeft: 'auto' }}>{phase.weeks} weeks</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 21 }}>{phase.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/* What's Included */}
        {plan.whatsIncluded && plan.whatsIncluded.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={s.sectionLabel}>What's Included</Text>
            <View style={s.darkCard}>
              {plan.whatsIncluded.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(110,187,122,0.15)', borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)', justifyContent: 'center', alignItems: 'center', marginTop: 1 }}>
                    <Text style={{ fontSize: 11, color: '#6EBB7A', fontWeight: '700' }}>✓</Text>
                  </View>
                  <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22, flex: 1 }}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Commit to Save */}
        {plan.commitToSaveEnabled && (() => {
          const ctsActive = plan.commitToSaveAddOnActive;
          const ctsSavings = plan.commitToSaveMonthlySavings || 100;
          return (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionLabel}>Commit to Save</Text>
              <View style={[s.darkCard, { borderColor: 'rgba(245,166,35,0.25)' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 16 }}>🔒</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>Commit to Save</Text>
                    <Text style={{ fontSize: 12, color: '#F5A623' }}>Save {formatCurrency(ctsSavings)}/mo</Text>
                  </View>
                  <View style={{ backgroundColor: ctsActive ? 'rgba(110,187,122,0.15)' : 'rgba(138,149,163,0.1)', borderWidth: 1, borderColor: ctsActive ? 'rgba(110,187,122,0.3)' : '#2A3347', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: ctsActive ? '#6EBB7A' : '#8A95A3' }}>{ctsActive ? 'Active' : 'Inactive'}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#F5A623', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Monthly Savings</Text>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(ctsSavings)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.15)', borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#5B9BD5', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Streak Bonus</Text>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#5B9BD5' }}>{plan.commitToSaveNextMonthPercentOff || 5}% off</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(138,149,163,0.06)', borderWidth: 1, borderColor: 'rgba(138,149,163,0.15)', borderRadius: 10, padding: 10 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Missed Session</Text>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#C5CDD8' }}>${plan.commitToSaveMissedSessionFee || 50}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20 }}>{plan.commitToSaveSummary}</Text>
              </View>
            </View>
          );
        })()}

        {/* Nutrition */}
        {plan.nutritionEnabled && (() => {
          const nutritionActive = plan.nutritionAddOnActive;
          const nutritionCost = plan.nutritionMonthlyCost || 100;
          return (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionLabel}>Nutrition Coaching</Text>
              <View style={[s.darkCard, { borderColor: 'rgba(110,187,122,0.25)' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 16 }}>🥗</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8' }}>Nutrition Add-On</Text>
                    <Text style={{ fontSize: 12, color: '#6EBB7A' }}>+{formatCurrency(nutritionCost)}/mo</Text>
                  </View>
                  <View style={{ backgroundColor: nutritionActive ? 'rgba(110,187,122,0.15)' : 'rgba(138,149,163,0.1)', borderWidth: 1, borderColor: nutritionActive ? 'rgba(110,187,122,0.3)' : '#2A3347', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: nutritionActive ? '#6EBB7A' : '#8A95A3' }}>{nutritionActive ? 'Added' : 'Available'}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20 }}>{plan.nutritionDescription}</Text>
                {!plan.nutritionInHouse && plan.nutritionProviderName ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <Text style={{ fontSize: 12, color: '#8A95A3' }}>Provided by</Text>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#6EBB7A' }}>{plan.nutritionProviderName}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })()}

        {/* Investment */}
        {plan.showInvestment && (() => {
          const p = plan.pricingResult || (plan.pricingInputs && plan.pricingInputs.hourlyRate > 0
            ? calculatePricing(currentPlan, plan.sessionsPerWeek, plan.contractLengthMonths, plan.phases, plan.pricingInputs, plan.sessionGuidanceProfiles || [], plan.commitToSaveAddOnActive)
            : null);
          const displayMonthly = p ? p.displayMonthlyPrice : (plan.monthlyPrice || 0);
          if (displayMonthly <= 0) return null;
          const ctsActive = plan.commitToSaveAddOnActive;
          const ctsSavings = plan.commitToSaveMonthlySavings || 100;
          const nutritionActive = plan.nutritionAddOnActive;
          const nutritionCost = plan.nutritionMonthlyCost || 100;
          const totalMonthly = displayMonthly + (nutritionActive ? nutritionCost : 0);
          const totalPayInFull = p ? Math.round(totalMonthly * contractMonths * 0.9) : (plan.payInFullPrice || 0);
          const totalSavings = totalMonthly * contractMonths - totalPayInFull;
          return (
            <View style={{ marginBottom: 20 }}>
              <Text style={s.sectionLabel}>Your Coaching Investment</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                <View style={[s.darkCard, { flex: 1, borderColor: 'rgba(91,155,213,0.35)' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#8A95A3', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Monthly</Text>
                  <Text style={{ fontSize: 30, fontWeight: '800', color: '#F0F4F8', lineHeight: 34 }}>{formatCurrency(displayMonthly)}</Text>
                  <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo</Text>
                  {p && p.perSessionPrice > 0 ? <Text style={{ fontSize: 12, color: '#5B9BD5', marginTop: 8 }}>{formatCurrency(p.perSessionPrice)} per session</Text> : null}
                </View>
                <View style={[s.darkCard, { flex: 1, backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.35)' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#F5A623', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Pay in Full</Text>
                  <Text style={{ fontSize: 30, fontWeight: '800', color: '#F5A623', lineHeight: 34 }}>{formatCurrency(Math.round(totalPayInFull / contractMonths))}</Text>
                  <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo equivalent</Text>
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.15)' }}>
                    <Text style={{ fontSize: 12, color: '#8A95A3' }}>{formatCurrency(totalPayInFull)} total</Text>
                    <Text style={{ fontSize: 12, color: '#6EBB7A', marginTop: 2, fontWeight: '600' }}>Save {formatCurrency(totalSavings)} (10% off)</Text>
                  </View>
                </View>
              </View>
              <View style={s.darkCard}>
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: '#8A95A3' }}>Base monthly rate</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#F0F4F8' }}>{formatCurrency(p ? p.baseMonthlyPrice : displayMonthly)}/mo</Text>
                  </View>
                  {ctsActive && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: '#F5A623' }}>Commit to Save</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623' }}>−{formatCurrency(ctsSavings)}/mo</Text>
                    </View>
                  )}
                  {nutritionActive && (
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
          );
        })()}

        {/* Footer */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Image
            source={require('../../assets/goarrive-icon.png')}
            style={{ width: 24, height: 24, borderRadius: 4, marginBottom: 8, opacity: 0.5 }}
            resizeMode="contain"
          />
          <Text style={{ fontSize: 11, color: '#4A5568', letterSpacing: 0.5 }}>Powered by GoArrive</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  darkCard: {
    backgroundColor: '#161B25',
    borderWidth: 1,
    borderColor: '#2A3347',
    borderRadius: 12,
    padding: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5B9BD5',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  miniLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8A95A3',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
