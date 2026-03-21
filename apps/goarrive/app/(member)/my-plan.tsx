/**
 * My Plan — Premium read-only plan viewer for members
 * Design: Dark premium, GoArrive brand colors
 * Uses new field names with backward-compat fallbacks for legacy Firestore data
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Platform, Pressable, Image,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  MemberPlanData, DayPlan, goalConfig, typeColors, phaseColors,
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
    reentryRule: plan.commitToSaveReentryRule ?? 'If you opt out, you can re-enter at the start of the next billing cycle.',
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
        <View
          key={i}
          style={{
            flex: 1, height: 6, borderRadius: 2,
            backgroundColor: i < value ? color : '#2A3347',
          }}
        />
      ))}
    </View>
  );
}

// ─── Hero Section ───────────────────────────────────────────────────────────

function HeroSection({ plan }: { plan: MemberPlanData }) {
  const memberAge = plan.memberAge || (plan as any).age;
  return (
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
      <Text style={st.heroPlanTitle}>{plan.memberName.split(' ')[0]}'s Tailored Plan</Text>
      <Text style={st.heroBranding}>Built with GoArrive</Text>
      {plan.subtitle ? (
        <View style={st.darkCard}>
          <Text style={st.subtitleText}>{plan.subtitle}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Starting Point Section ─────────────────────────────────────────────────

function StartingPointSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.startingPoints?.length) return null;
  return (
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
            <View key={i} style={st.chip}>
              <Text style={st.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Goals Section ──────────────────────────────────────────────────────────

function GoalsSection({ plan }: { plan: MemberPlanData }) {
  const goals = plan.goals || (plan as any).healthGoals || [];
  if (goals.length === 0) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>Your Health Goals</Text>
      <Text style={st.sectionSubtitle}>What we're building toward</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {goals.map((goal: string, i: number) => {
          const cfg = (goalConfig as any)[goal] || { emoji: '\uD83C\uDFAF', color: '#8A95A3' };
          return (
            <View key={i} style={{
              flex: 1, minWidth: '45%',
              backgroundColor: cfg.color + '15', borderColor: cfg.color + '40',
              borderWidth: 1, borderRadius: 12, padding: 14,
            }}>
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
          <Text style={{ color: '#5B9BD5', fontSize: 18 }}>{"\u2192"}</Text>
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
  );
}

// ─── Why Section ────────────────────────────────────────────────────────────

function WhySection({ plan }: { plan: MemberPlanData }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>Your Why</Text>
      <View style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
        <Text style={[st.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>
          IN {plan.memberName.split(' ')[0].toUpperCase()}'S WORDS
        </Text>
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
  );
}

// ─── Weekly Plan Section ────────────────────────────────────────────────────

function WeeklyPlanSection({ plan }: { plan: MemberPlanData }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const schedule = getSchedule(plan);
  if (!schedule.length) return null;
  const contractMonths = getContractMonths(plan);

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>Your Weekly Plan</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 }}>
        <Text style={{ color: '#6EBB7A', fontSize: 20, fontWeight: '700' }}>{plan.sessionsPerWeek} Sessions</Text>
        <Text style={{ color: '#8A95A3', fontSize: 14, marginLeft: 6 }}>per week {"\u00B7"} {contractMonths} months</Text>
      </View>

      {/* Day tiles — Forge style */}
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
        {schedule.map((day, i) => {
          const colors = typeColors[day.type] || typeColors['Rest'];
          const isRest = day.type === 'Rest';
          const isExpanded = expandedDay === i;
          return (
            <Pressable
              key={i}
              onPress={() => !isRest && setExpandedDay(isExpanded ? null : i)}
              style={{
                flex: 1, alignItems: 'center', gap: 4,
                borderRadius: 12, paddingVertical: 10,
                backgroundColor: isRest ? 'rgba(14,17,23,0.5)' : colors.bg,
                borderWidth: 1,
                borderColor: isExpanded ? colors.text : (isRest ? '#1A1F2B' : colors.border),
                opacity: isRest ? 0.5 : 1,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '600', color: isRest ? '#3A4255' : '#8A95A3', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {day.shortDay}
              </Text>
              {isRest ? (
                <Text style={{ fontSize: 14, color: '#3A4255' }}>{'\u2715'}</Text>
              ) : (
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dot }} />
              )}
              <Text style={{ fontSize: 9, fontWeight: '700', color: isRest ? '#3A4255' : colors.text, textAlign: 'center' }}>
                {isRest ? 'OFF' : day.type === 'Strength' ? 'STR' : day.type === 'Cardio + Mobility' ? 'CARD' : day.type === 'Mix' ? 'MIX' : day.label?.substring(0, 4).toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Expanded day detail */}
      {expandedDay !== null && schedule[expandedDay] && (
        <View style={[st.darkCard, { borderWidth: 1, borderColor: (typeColors[schedule[expandedDay].type] || typeColors['Rest']).border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: (typeColors[schedule[expandedDay].type] || typeColors['Rest']).text }}>
                {schedule[expandedDay].day}
              </Text>
              <Text style={{ fontSize: 13, color: '#8A95A3' }}>
                {"\u2014"} {schedule[expandedDay].label || schedule[expandedDay].type}
              </Text>
            </View>
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
  );
}

// ─── Coaching Evolution Section ─────────────────────────────────────────────

function CoachingEvolutionSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.phases?.length) return null;
  const contractMonths = getContractMonths(plan);
  const totalWeeks = monthsToWeeks(contractMonths);
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>How Your Coaching Support Evolves</Text>
      {/* Phase bar */}
      <View style={{ flexDirection: 'row', borderRadius: 12, overflow: 'hidden', height: 8, marginBottom: 6 }}>
        {plan.phases.map((phase, i) => (
          <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColors[i], opacity: 0.85 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
        {plan.phases.map((phase, i) => (
          <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: phaseColors[i] }}>{phase.weeks}w</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: '#8A95A3', fontSize: 12, textAlign: 'center', marginBottom: 14 }}>
        Total: {totalWeeks} weeks ({contractMonths} months)
      </Text>
      {/* Phase cards */}
      {plan.phases.map((phase, i) => (
        <View key={phase.id} style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: phaseColors[i], marginBottom: 10 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: phaseColors[i] }}>{phase.name}: {phase.intensity}</Text>
            <Text style={{ fontSize: 12, color: '#8A95A3', marginLeft: 'auto' }}>{phase.weeks} weeks</Text>
          </View>
          <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 21 }}>{phase.description}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── What's Included Section ────────────────────────────────────────────────

function WhatsIncludedSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.whatsIncluded?.length) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>What's Included</Text>
      <View style={st.darkCard}>
        {plan.whatsIncluded.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: 'rgba(110,187,122,0.15)', borderWidth: 1, borderColor: 'rgba(110,187,122,0.3)',
              justifyContent: 'center', alignItems: 'center', marginTop: 1,
            }}>
              <Text style={{ fontSize: 11, color: '#6EBB7A', fontWeight: '700' }}>{'\u2713'}</Text>
            </View>
            <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22, flex: 1 }}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Commit to Save Section ─────────────────────────────────────────────────

function CommitToSaveSection({ plan }: { plan: MemberPlanData }) {
  const [expanded, setExpanded] = useState(false);
  const cts = getCts(plan);
  if (!cts.enabled) return null;
  return (
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
          <View style={{ backgroundColor: cts.active ? 'rgba(110,187,122,0.15)' : 'rgba(138,149,163,0.1)', borderWidth: 1, borderColor: cts.active ? 'rgba(110,187,122,0.3)' : '#2A3347', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: cts.active ? '#6EBB7A' : '#8A95A3' }}>{cts.active ? 'Active' : 'Inactive'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(245,166,35,0.06)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.15)', borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#F5A623', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Monthly Savings</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(cts.monthlySavings)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: 'rgba(91,155,213,0.06)', borderWidth: 1, borderColor: 'rgba(91,155,213,0.15)', borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#5B9BD5', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Streak Bonus</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#5B9BD5' }}>{cts.nextMonthPercentOff}% off</Text>
            <Text style={{ fontSize: 10, color: '#8A95A3' }}>next month</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: 'rgba(138,149,163,0.06)', borderWidth: 1, borderColor: 'rgba(138,149,163,0.15)', borderRadius: 10, padding: 10 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: '#8A95A3', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Missed Session</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#C5CDD8' }}>{formatCurrency(cts.missedSessionFee)}</Text>
            <Text style={{ fontSize: 10, color: '#8A95A3' }}>if not made up</Text>
          </View>
        </View>
        {cts.summary ? <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 10 }}>{cts.summary}</Text> : null}
        <Pressable onPress={() => setExpanded(!expanded)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#F5A623' }}>{expanded ? 'Hide details' : 'How it works'}</Text>
          <Text style={{ fontSize: 12, color: '#F5A623' }}>{expanded ? '\u25B4' : '\u25BE'}</Text>
        </Pressable>
        {expanded && (
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.1)' }}>
            {[
              { color: '#F5A623', text: `Commit to Save lowers your monthly rate by ${formatCurrency(cts.monthlySavings)} while it's active.` },
              { color: '#5B9BD5', text: `Complete a 30-day streak and unlock an additional ${cts.nextMonthPercentOff}% discount on the following month.` },
              { color: '#C5CDD8', text: `If you miss a session without making it up within ${cts.makeUpWindowHours} hours, a ${formatCurrency(cts.missedSessionFee)} accountability fee applies.` },
              ...(cts.emergencyWaiverEnabled ? [{ color: '#6EBB7A', text: 'Fees are waived for family emergencies or illness.' }] : []),
              { color: '#C5CDD8', text: 'You can opt out at any time.' },
              { color: '#C5CDD8', text: cts.reentryRule },
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
  );
}

// ─── Nutrition Section ──────────────────────────────────────────────────────

function NutritionSection({ plan }: { plan: MemberPlanData }) {
  const nut = getNutrition(plan);
  if (!nut.enabled) return null;
  return (
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
  );
}

// ─── Investment Section ─────────────────────────────────────────────────────

function InvestmentSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.showInvestment) return null;
  const contractMonths = getContractMonths(plan);
  const cts = getCts(plan);
  const nut = getNutrition(plan);

  // Try to calculate pricing
  let pricing = plan.pricingResult;
  if (!pricing) {
    try { pricing = calculatePricing(plan); } catch { /* ignore */ }
  }

  const displayMonthly = pricing ? pricing.displayMonthlyPrice : ((plan as any).monthlyPrice || 0);
  if (displayMonthly <= 0) return null;

  const nutritionCost = nut.enabled ? nut.monthlyCost : 0;
  const totalMonthly = displayMonthly + nutritionCost;
  const payInFullDiscount = plan.payInFullDiscountPercent || (pricing?.payInFullDiscount) || 10;
  const totalPayInFull = Math.round(totalMonthly * contractMonths * (1 - payInFullDiscount / 100));
  const totalSavings = totalMonthly * contractMonths - totalPayInFull;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>Your Coaching Investment</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <View style={[st.darkCard, { flex: 1, borderColor: 'rgba(91,155,213,0.35)' }]}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#8A95A3', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Monthly</Text>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#F0F4F8', lineHeight: 34 }}>{formatCurrency(displayMonthly)}</Text>
          <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo</Text>
          {pricing && pricing.perSessionPrice > 0 ? (
            <Text style={{ fontSize: 12, color: '#5B9BD5', marginTop: 8 }}>{formatCurrency(pricing.perSessionPrice)} per session</Text>
          ) : null}
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
        <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 20, marginBottom: 10 }}>
          Your monthly rate is calculated from your coach's hourly rate, the length of each session, how many sessions you have per week, monthly check-in calls, and the time your coach spends building your program.
        </Text>
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12, color: '#8A95A3' }}>Pay in full ({contractMonths} months)</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#F5A623' }}>{formatCurrency(totalPayInFull)} (save {formatCurrency(totalSavings)})</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Main My Plan Screen ────────────────────────────────────────────────────

export default function MyPlan() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchPlan();
  }, [user]);

  async function handleAcceptPlan() {
    if (!user || !plan) return;
    try {
      await updateDoc(doc(db, 'member_plans', plan.id), {
        status: 'accepted',
        updatedAt: new Date(),
      });
      setPlan(prev => prev ? { ...prev, status: 'accepted' } : null);
    } catch (err) {
      console.error('Error accepting plan:', err);
    }
  }

  async function fetchPlan() {
    try {
      // Strategy: try multiple keys in order of likelihood
      // 1. Direct doc by uid (coach saves plan at member's uid for intake-created members)
      const planByUid = await getDoc(doc(db, 'member_plans', user!.uid));
      if (planByUid.exists()) {
        console.log('[MyPlan] Found plan at uid key:', user!.uid);
        setPlan({ id: planByUid.id, ...planByUid.data() } as MemberPlanData);
        return;
      }

      // 2. Legacy key format: plan_{uid}
      const planByLegacy = await getDoc(doc(db, 'member_plans', `plan_${user!.uid}`));
      if (planByLegacy.exists()) {
        console.log('[MyPlan] Found plan at legacy key: plan_' + user!.uid);
        setPlan({ id: planByLegacy.id, ...planByLegacy.data() } as MemberPlanData);
        return;
      }

      // 3. Query by memberId field (covers all other cases)
      const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', user!.uid));
      const snap = await getDocs(plansQuery);
      if (!snap.empty) {
        const planDoc = snap.docs[0];
        console.log('[MyPlan] Found plan via query, doc id:', planDoc.id);
        setPlan({ id: planDoc.id, ...planDoc.data() } as MemberPlanData);
        return;
      }

      // 4. Check if the member doc in Firestore has a different doc ID
      // (e.g., member was added manually by coach, doc ID != uid)
      // Look up member doc to find the Firestore doc ID used by the coach
      const membersQuery = query(collection(db, 'members'), where('uid', '==', user!.uid));
      const membersSnap = await getDocs(membersQuery);
      if (!membersSnap.empty) {
        const memberDocId = membersSnap.docs[0].id;
        if (memberDocId !== user!.uid) {
          const planByDocId = await getDoc(doc(db, 'member_plans', memberDocId));
          if (planByDocId.exists()) {
            console.log('[MyPlan] Found plan at member doc id:', memberDocId);
            setPlan({ id: planByDocId.id, ...planByDocId.data() } as MemberPlanData);
            return;
          }
        }
      }

      console.log('[MyPlan] No plan found for uid:', user!.uid);
    } catch (err) {
      console.error('[MyPlan] Error fetching plan:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={st.root}>
        <AppHeader />
        <View style={st.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  if (!plan || plan.status === 'draft') {
    return (
      <View style={st.root}>
        <AppHeader />
        <View style={st.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCCB'}</Text>
          <Text style={st.emptyTitle}>Plan In Progress</Text>
          <Text style={st.emptyText}>
            Your coach is building your personalized fitness plan.{'\n'}
            You'll see it here once it's ready.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={st.root}>
      <AppHeader />
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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: Platform.OS === 'web' ? 100 : 24 }}
      >
        <HeroSection plan={plan} />
        <StartingPointSection plan={plan} />
        <GoalsSection plan={plan} />
        <WhySection plan={plan} />
        <WeeklyPlanSection plan={plan} />
        <CoachingEvolutionSection plan={plan} />
        <WhatsIncludedSection plan={plan} />
        <CommitToSaveSection plan={plan} />
        <NutritionSection plan={plan} />
        <InvestmentSection plan={plan} />

        {/* ─── PLAN ACCEPTANCE ──────────────────────────────────────────────── */}
        {plan.status === 'pending' && (
          <View style={st.section}>
            <Text style={st.sectionLabel}>PLAN ACCEPTANCE</Text>
            <View style={st.darkCard}>
              <Text style={st.subtitleText}>Your coach has prepared this personalized fitness plan for you. Please review all the details. If you're ready to commit, accept the plan below.</Text>
              <Pressable style={st.acceptBtn} onPress={handleAcceptPlan}>
                <Text style={st.acceptBtnText}>Accept Plan</Text>
              </Pressable>
            </View>
          </View>
        )}

        {plan.status === 'accepted' && (
          <View style={st.section}>
            <Text style={st.sectionLabel}>PLAN STATUS</Text>
            <View style={st.darkCard}>
              <Text style={st.subtitleText}>Congratulations! You have accepted your fitness plan. Let's get to work!</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#A0AEC0', textAlign: 'center', lineHeight: 22 },
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
  acceptBtn: {
    backgroundColor: '#6EBB7A',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  acceptBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});
