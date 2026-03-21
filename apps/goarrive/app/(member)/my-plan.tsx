/**
 * My Plan — Premium read-only plan viewer for members
 * Design: Dark premium, GoArrive brand colors
 * Uses new field names with backward-compat fallbacks for legacy Firestore data
 *
 * IMPORTANT: The COACHING INVESTMENT section (pricing cards, Commit to Save,
 * Nutrition Add-On, breakdown, referral rewards) is identical to the coach's
 * "Member View" preview. Members can toggle CTS and Nutrition on/off.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Platform, Pressable, Image,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  MemberPlanData, DayPlan, goalConfig, typeColors, phaseColorList,
  formatCurrency, calculatePricing, monthsToWeeks, PricingResult,
} from '../../lib/planTypes';

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
    active: plan.nutritionAddOnActive ?? false,
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
          const cfg = goalConfig[goal] || { emoji: '🎯', color: '#8A95A3' };
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
            <Text style={st.statValueLarge}>{String(plan.currentWeight || '').replace(/ lbs$/i, '')} lbs</Text>
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
      {plan.whyStatement ? (
        <View style={[st.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
          <Text style={[st.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>
            IN {plan.memberName.split(' ')[0].toUpperCase()}'S WORDS
          </Text>
          <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic' }}>
            "{plan.whyStatement}"
          </Text>
        </View>
      ) : null}
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

      {/* Day tiles — clean minimal style */}
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
        {schedule.map((day, i) => {
          const colors = typeColors[day.type] || typeColors['Rest'];
          const isRest = day.type === 'Rest';
          const isExpanded = expandedDay === i;
          const abbr = isRest ? 'OFF' : day.type === 'Strength' ? 'STR' : day.type === 'Cardio + Mobility' ? 'CARD' : 'MIX';
          return (
            <Pressable
              key={i}
              onPress={() => !isRest && setExpandedDay(isExpanded ? null : i)}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2,
                borderRadius: 10,
                backgroundColor: isRest ? 'rgba(14,17,23,0.4)' : colors.bg,
                borderWidth: 1,
                borderColor: isExpanded ? colors.text : (isRest ? '#1A2030' : colors.border),
                opacity: isRest ? 0.45 : 1,
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '600', color: isRest ? '#3A4255' : '#8A95A3', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 5 }}>
                {day.shortDay}
              </Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isRest ? '#2A3040' : colors.dot, marginBottom: 5 }} />
              <Text style={{ fontSize: 8, fontWeight: '700', color: isRest ? '#3A4255' : colors.text, textAlign: 'center', letterSpacing: 0.2 }} numberOfLines={1}>
                {abbr}
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
      {/* Phase cards */}
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


// ═══════════════════════════════════════════════════════════════════════════════
// COACHING INVESTMENT SECTION (unified: pricing cards + add-ons + breakdown)
// Matches the coach's "Member View" preview exactly.
// Members can toggle Commit to Save and Nutrition Add-On on/off.
// ═══════════════════════════════════════════════════════════════════════════════

function CoachingInvestmentSection({ plan, pricing, onChange }: {
  plan: MemberPlanData; pricing: PricingResult;
  onChange: (updates: Partial<MemberPlanData>) => void;
}) {
  // If coach hid the investment section, don't show it
  if (plan.showInvestment === false) return null;

  const cts = plan.commitToSave || getCts(plan);
  const nut = plan.nutrition || getNutrition(plan);
  const ctsEnabled = cts?.enabled ?? false; // coach enabled it as an option
  const ctsActive = cts?.active ?? false;    // member (or coach) toggled it on
  const nutEnabled = nut?.enabled ?? false;  // coach enabled it as an option
  const nutActive = (nut as any)?.active ?? false;     // member (or coach) toggled it on

  // Compute prices with and without add-ons for display
  const ctsSavings = cts?.monthlySavings ?? 100;
  const nutCost = nut?.monthlyCost ?? 100;

  // The displayMonthlyPrice already includes commit-to-save if active
  const monthlyPrice = pricing.displayMonthlyPrice;
  const payInFullTotal = pricing.payInFullPrice;
  const payInFullMonthly = Math.round(payInFullTotal / (plan.contractMonths || 12));
  const payInFullSavings = Math.round(monthlyPrice * (plan.contractMonths || 12) - payInFullTotal);
  const payInFullPct = plan.payInFullDiscountPercent || 10;

  const totalSessions = pricing.totalSessions;
  const perSession = pricing.perSessionPrice;
  const programTotal = Math.round(monthlyPrice * (plan.contractMonths || 12));

  // Toggle commit to save active state
  const toggleCommitToSave = () => {
    onChange({
      commitToSave: {
        ...(cts || { monthlySavings: 100, nextMonthPercentOff: 5, missedSessionFee: 50, makeUpWindowHours: 48, emergencyWaiverEnabled: true, reentryRule: '', summary: '', enabled: true }),
        active: !ctsActive,
      },
    });
  };

  // Toggle nutrition active state (member adds/removes)
  const toggleNutrition = () => {
    if (!nut) return;
    onChange({
      nutrition: {
        ...nut,
        active: !nutActive,
      },
    });
  };

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.sectionLabel}>COACHING INVESTMENT</Text>

      {/* ── Two pricing cards side by side ── */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        {/* Monthly card */}
        <View style={[inv.priceCard, { flex: 1 }]}>
          <Text style={inv.priceLabel}>MONTHLY</Text>
          <Text style={inv.priceAmount}>{formatCurrency(monthlyPrice)}<Text style={inv.priceSuffix}> /mo</Text></Text>
          <Text style={inv.priceDetail}>{formatCurrency(perSession)} per session</Text>
        </View>
        {/* Pay in Full card */}
        <View style={[inv.priceCard, { flex: 1, borderColor: GOLD_BORDER }]}>
          <Text style={[inv.priceLabel, { color: GOLD }]}>PAY IN FULL</Text>
          <Text style={inv.priceAmount}>{formatCurrency(payInFullMonthly)}<Text style={inv.priceSuffix}> /mo</Text></Text>
          <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>{formatCurrency(payInFullTotal)} total</Text>
          <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '600', marginTop: 2 }}>Save {formatCurrency(payInFullSavings)} ({payInFullPct}% off)</Text>
        </View>
      </View>

      {/* ── Stats row ── */}
      <View style={[inv.statsRow]}>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>SESSIONS</Text>
          <Text style={inv.statsValue}>{totalSessions}</Text>
          <Text style={inv.statsDetail}>over {plan.contractMonths} months</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>PER SESSION</Text>
          <Text style={[inv.statsValue, { color: GOLD }]}>{formatCurrency(perSession)}</Text>
          <Text style={inv.statsDetail}>effective rate</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={inv.statsLabel}>PROGRAM</Text>
          <Text style={[inv.statsValue, { color: ACCENT }]}>{formatCurrency(programTotal)}</Text>
          <Text style={inv.statsDetail}>total value</Text>
        </View>
      </View>

      {/* ── Commit to Save card ── */}
      {ctsEnabled && (
        <CommitToSaveCard
          plan={plan}
          isActive={ctsActive}
          onToggle={toggleCommitToSave}
          monthlyPrice={monthlyPrice}
          ctsSavings={ctsSavings}
        />
      )}

      {/* ── Nutrition Add-On card ── */}
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

      {/* ── How we got these numbers ── */}
      <HowWeGotTheseNumbers plan={plan} pricing={pricing} />

      {/* ── Referral Rewards ── */}
      <View style={[inv.statsRow, { marginTop: 12, paddingVertical: 14, paddingHorizontal: 16 }]}>
        <Text style={{ color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
          <Text style={{ color: GOLD, fontWeight: '700' }}>Referral Rewards: </Text>
          Invite 3 friends into a yearly plan and your base membership is refunded.
        </Text>
      </View>
    </View>
  );
}

// ── Commit to Save interactive card ─────────────────────────────────────────
function CommitToSaveCard({ plan, isActive, onToggle, monthlyPrice, ctsSavings }: {
  plan: MemberPlanData; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; ctsSavings: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const cts = plan.commitToSave || getCts(plan);
  const rateAfter = monthlyPrice; // displayMonthlyPrice already includes CTS if active

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GOLD_BORDER, backgroundColor: GOLD_BG }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? GOLD : 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>💡</Text>
        </View>
        {/* Content */}
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
      {/* Summary row when active */}
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

// ── Nutrition Add-On interactive card ───────────────────────────────────────
function NutritionAddOnCard({ plan, isActive, onToggle, monthlyPrice, nutCost, payInFullMonthly }: {
  plan: MemberPlanData; isActive: boolean;
  onToggle: () => void; monthlyPrice: number; nutCost: number; payInFullMonthly: number;
}) {
  const nut = plan.nutrition || getNutrition(plan);
  const providerName = nut?.providerName || 'Partner';
  const description = nut?.description || 'Add personalized nutrition coaching to your plan. Includes a custom nutrition strategy, macro targets, and monthly check-ins with a dedicated nutrition coach.';
  // When nutrition is active, the price already includes it
  // When toggled on, new monthly = current + nutCost
  const newMonthly = isActive ? monthlyPrice : monthlyPrice + nutCost;
  const newPayInFull = Math.round(newMonthly * (plan.contractMonths || 12) * (1 - (plan.payInFullDiscountPercent || 10) / 100) / (plan.contractMonths || 12));

  return (
    <View style={[inv.addonCard, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.08)' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        {/* Icon */}
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isActive ? ACCENT : 'rgba(110,187,122,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 16 }}>🥗</Text>
        </View>
        {/* Content */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700', fontFamily: FH }}>Nutrition Add-On</Text>
            <Pressable onPress={onToggle} style={[inv.addBtn, isActive && { borderColor: GREEN_BORDER, backgroundColor: 'rgba(110,187,122,0.1)' }]}>
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
      {/* Summary row when active */}
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

// ── How we got these numbers (expandable breakdown — member version) ────────
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


// ─── Main My Plan Screen ────────────────────────────────────────────────────

export default function MyPlan() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchPlan();
  }, [user]);

  // Save plan updates to Firestore and update local state
  const handlePlanChange = useCallback(async (updates: Partial<MemberPlanData>) => {
    if (!plan?.id) return;
    try {
      const newPlan = { ...plan, ...updates };
      setPlan(newPlan as MemberPlanData);
      await updateDoc(doc(db, 'member_plans', plan.id), {
        ...updates,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error('[MyPlan] Error saving plan update:', err);
    }
  }, [plan]);

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
    // Helper: pick the best plan from a list — prefer presented/accepted over pending/draft
    function pickBestPlan(docs: Array<{ id: string; data: () => any }>): MemberPlanData | null {
      if (docs.length === 0) return null;
      const priority = ['accepted', 'presented', 'pending', 'draft'];
      const sorted = [...docs].sort((a, b) => {
        const ai = priority.indexOf(a.data().status ?? 'draft');
        const bi = priority.indexOf(b.data().status ?? 'draft');
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      const best = sorted[0];
      return { id: best.id, ...best.data() } as MemberPlanData;
    }

    try {
      // Collect all candidate plan docs, then pick the best one
      const candidates: Array<{ id: string; data: () => any }> = [];

      // 1. Direct doc by uid
      const planByUid = await getDoc(doc(db, 'member_plans', user!.uid));
      if (planByUid.exists()) candidates.push(planByUid);

      // 2. Legacy key format: plan_{uid}
      const planByLegacy = await getDoc(doc(db, 'member_plans', `plan_${user!.uid}`));
      if (planByLegacy.exists()) candidates.push(planByLegacy);

      // 3. Query by memberId field
      const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', user!.uid));
      const snap = await getDocs(plansQuery);
      snap.docs.forEach(d => {
        if (!candidates.find(c => c.id === d.id)) candidates.push(d);
      });

      // 4. Check if the member doc in Firestore has a different doc ID
      const membersQuery = query(collection(db, 'members'), where('uid', '==', user!.uid));
      const membersSnap = await getDocs(membersQuery);
      if (!membersSnap.empty) {
        const memberDocId = membersSnap.docs[0].id;
        if (memberDocId !== user!.uid) {
          const planByDocId = await getDoc(doc(db, 'member_plans', memberDocId));
          if (planByDocId.exists() && !candidates.find(c => c.id === planByDocId.id)) {
            candidates.push(planByDocId);
          }
        }
      }

      if (candidates.length > 0) {
        const best = pickBestPlan(candidates);
        console.log('[MyPlan] Best plan:', best?.id, 'status:', best?.status, 'from', candidates.length, 'candidates');
        setPlan(best);
      } else {
        console.log('[MyPlan] No plan found for uid:', user!.uid);
      }
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

  if (!plan) {
    return (
      <View style={st.root}>
        <AppHeader />
        <View style={st.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCCB'}</Text>
          <Text style={st.emptyTitle}>No Plan Yet</Text>
          <Text style={st.emptyText}>
            Your coach hasn't created your fitness plan yet.{'\n'}
            Complete your intake to get started.
          </Text>
        </View>
      </View>
    );
  }

  // Compute pricing for the investment section
  let pricing: PricingResult | null = plan.pricingResult || null;
  if (!pricing) {
    try { pricing = calculatePricing(plan); } catch { /* ignore */ }
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

        {/* ── UNIFIED COACHING INVESTMENT (matches coach's Member View) ── */}
        {plan.showInvestment !== false && pricing && (
          <CoachingInvestmentSection
            plan={plan}
            pricing={pricing}
            onChange={handlePlanChange}
          />
        )}

        {/* ─── PLAN ACCEPTANCE ──────────────────────────────────────────────── */}
        {(plan.status === 'presented' || plan.status === 'pending') && (
          <View style={{ marginBottom: 20 }}>
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
          <View style={{ marginBottom: 20 }}>
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
  section: { marginBottom: 20 },
});
