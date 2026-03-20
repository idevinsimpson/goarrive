/**
 * My Plan — Premium read-only plan viewer for members
 * Ported from the GoArrive Plan-Building legacy repo (MemberView)
 * Design: Dark premium, Space Grotesk + DM Sans, GoArrive brand colors
 * 
 * IMPORTANT: This view must be IDENTICAL to the coach's Preview mode.
 * Any changes here must be mirrored in the PlanPreview component in
 * (app)/member-plan/[memberId].tsx
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
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  MemberPlanData,
  DayPlan,
  goalConfig,
  typeColors,
  phaseColors,
} from '../../lib/planTypes';

// ─── Segmented Bar Component ─────────────────────────────────────────────────

function SegmentedBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {Array.from({ length: max }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 2,
            backgroundColor: i < value ? color : '#2A3347',
          }}
        />
      ))}
    </View>
  );
}

// ─── Hero Section ────────────────────────────────────────────────────────────

function HeroSection({ plan }: { plan: MemberPlanData }) {
  const memberAge = plan.memberAge || plan.age;
  return (
    <View style={{ marginTop: 20, marginBottom: 16 }}>
      {/* Identity tag */}
      <View style={{ marginBottom: 14 }}>
        <View style={[s.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.25)' }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B9BD5' }} />
          <Text style={[s.badgeText, { color: '#5B9BD5' }]}>{plan.identityTag}</Text>
        </View>
      </View>

      {/* Member name */}
      <Text style={s.heroName}>{plan.memberName}</Text>

      {/* Age + referred by */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {memberAge ? <Text style={s.heroAge}>{memberAge} years old</Text> : null}
        {plan.referredBy ? (
          <View style={[s.badge, { backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.2)' }]}>
            <Text style={[s.badgeText, { color: '#F5A623' }]}>Referred by {plan.referredBy}</Text>
          </View>
        ) : null}
      </View>

      {/* Plan title */}
      <Text style={s.heroPlanTitle}>{plan.memberName.split(' ')[0]}'s Tailored Plan</Text>
      <Text style={s.heroBranding}>Built with GoArrive</Text>

      {/* Subtitle card */}
      <View style={s.darkCard}>
        <Text style={s.subtitleText}>{plan.subtitle}</Text>
      </View>
    </View>
  );
}

// ─── Starting Point Section ──────────────────────────────────────────────────

function StartingPointSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.startingPoints || plan.startingPoints.length === 0) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>Where You're Starting From</Text>
      <View style={s.darkCard}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {plan.startingPoints.map((chip, i) => (
            <View key={i} style={s.chip}>
              <Text style={s.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Goals Section ───────────────────────────────────────────────────────────

function GoalsSection({ plan }: { plan: MemberPlanData }) {
  const goals = plan.goals || plan.healthGoals || [];
  if (goals.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>Your Health Goals</Text>
      <Text style={s.sectionSubtitle}>What we're building toward</Text>

      {/* Goal grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        {goals.map((goal, i) => {
          const cfg = (goalConfig as any)[goal] || { emoji: '🎯', color: '#8A95A3' };
          const gcfg = (goalConfig as any[]).find?.((g: any) => g.label === goal);
          return (
            <View
              key={i}
              style={{
                flex: 1,
                minWidth: '45%',
                backgroundColor: gcfg?.bgColor || cfg.color + '15',
                borderColor: gcfg?.borderColor || cfg.color + '40',
                borderWidth: 1,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <Text style={{ fontSize: 24, marginBottom: 6 }}>{gcfg?.icon || cfg.emoji}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: gcfg?.textColor || cfg.color }}>{goal}</Text>
            </View>
          );
        })}
      </View>

      {/* Weight progress */}
      {(plan.currentWeight || plan.goalWeight) ? (
        <View style={[s.darkCard, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}>
          <View>
            <Text style={s.miniLabel}>CURRENT</Text>
            <Text style={s.statValueLarge}>{plan.currentWeight} lbs</Text>
          </View>
          <Text style={{ color: '#5B9BD5', fontSize: 18 }}>→</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.miniLabel, { color: '#5B9BD5' }]}>GOAL</Text>
            <Text style={[s.statValueLarge, { color: '#5B9BD5' }]}>{plan.goalWeight}</Text>
          </View>
        </View>
      ) : null}

      {/* Goal summary */}
      {plan.goalSummary ? (
        <View style={{
          borderRadius: 12,
          padding: 14,
          backgroundColor: 'rgba(91,155,213,0.06)',
          borderWidth: 1,
          borderColor: 'rgba(91,155,213,0.25)',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ fontSize: 16 }}>🎯</Text>
            <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22, fontStyle: 'italic', flex: 1 }}>
              {plan.goalSummary}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ─── Why Section ─────────────────────────────────────────────────────────────

function WhySection({ plan }: { plan: MemberPlanData }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>Your Why</Text>

      {/* Quote card */}
      <View style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: '#F5A623', marginBottom: 10 }]}>
        <Text style={[s.miniLabel, { color: '#F5A623', marginBottom: 8 }]}>
          IN {plan.memberName.split(' ')[0].toUpperCase()}'S WORDS
        </Text>
        <Text style={{ color: '#F0F4F8', fontSize: 16, fontWeight: '600', lineHeight: 24, fontStyle: 'italic' }}>
          "{plan.whyStatement}"
        </Text>
      </View>

      {/* Translation */}
      {plan.whyTranslation ? (
        <View style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: '#5B9BD5', marginBottom: 12 }]}>
          <Text style={{ color: '#C5CDD8', fontSize: 14, lineHeight: 22 }}>
            {plan.whyTranslation}
          </Text>
        </View>
      ) : null}

      {/* Readiness + Motivation + Gym Confidence */}
      <View style={s.darkCard}>
        <View style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={s.statLabel}>Readiness for Change</Text>
            <Text style={[s.statValue, { color: '#6EBB7A' }]}>{plan.readiness}/10</Text>
          </View>
          <SegmentedBar value={plan.readiness} color="#6EBB7A" />
        </View>
        <View style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={s.statLabel}>Motivation</Text>
            <Text style={[s.statValue, { color: '#5B9BD5' }]}>{plan.motivation}/10</Text>
          </View>
          <SegmentedBar value={plan.motivation} color="#5B9BD5" />
        </View>
        {plan.gymConfidence !== undefined && plan.gymConfidence > 0 ? (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={s.statLabel}>Gym Confidence</Text>
              <Text style={[s.statValue, { color: '#F5A623' }]}>{plan.gymConfidence}/10</Text>
            </View>
            <SegmentedBar value={plan.gymConfidence} color="#F5A623" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Weekly Plan Section ─────────────────────────────────────────────────────

function WeeklyPlanSection({ plan }: { plan: MemberPlanData }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  const currentPlan: DayPlan[] =
    plan.sessionsPerWeek === 4
      ? plan.weekPlan4
      : plan.sessionsPerWeek === 3
      ? plan.weekPlan3
      : plan.weekPlan2;

  if (!currentPlan || currentPlan.length === 0) return null;

  const contractMonths = plan.contractLengthMonths || plan.contractMonths || 12;
  const isNoGo = (day: DayPlan) => day.label === 'No-Go Day';

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>Your Weekly Plan</Text>
      <Text style={{ color: '#8A95A3', fontSize: 13, marginBottom: 10 }}>
        {plan.sessionsPerWeek} sessions/week · {contractMonths} months
      </Text>

      {/* Day tiles */}
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
        {currentPlan.map((day, i) => {
          const colors = typeColors[day.type] || typeColors.rest;
          const noGo = isNoGo(day);
          const isExpanded = expandedDay === i;
          return (
            <Pressable
              key={i}
              onPress={() => {
                if (!noGo) setExpandedDay(isExpanded ? null : i);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 4,
                borderRadius: 12,
                paddingVertical: 10,
                backgroundColor: noGo ? 'rgba(14,17,23,0.5)' : colors.bg,
                borderWidth: 1,
                borderColor: noGo ? '#1A1F2B' : colors.border,
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

      {/* Expanded day detail */}
      {expandedDay !== null && (
        <View style={[s.darkCard, { borderWidth: 1, borderColor: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: (typeColors[currentPlan[expandedDay].type] || typeColors.rest).text }}>
                {currentPlan[expandedDay].day}
              </Text>
              <Text style={{ fontSize: 13, color: '#8A95A3' }}>
                — {currentPlan[expandedDay].label}
              </Text>
            </View>
            {currentPlan[expandedDay].duration ? (
              <View style={[s.badge, { backgroundColor: 'rgba(91,155,213,0.12)', borderColor: 'rgba(91,155,213,0.2)' }]}>
                <Text style={[s.badgeText, { color: '#5B9BD5' }]}>{currentPlan[expandedDay].duration}</Text>
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
  );
}

// ─── Coaching Evolution Section ──────────────────────────────────────────────

function CoachingEvolutionSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.phases || plan.phases.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>How Your Coaching Support Evolves</Text>

      {/* Phase bar */}
      <View style={{ flexDirection: 'row', borderRadius: 12, overflow: 'hidden', height: 8, marginBottom: 12 }}>
        {plan.phases.map((phase, i) => (
          <View key={phase.id} style={{ flex: phase.weeks, backgroundColor: phaseColors[i], opacity: 0.85 }} />
        ))}
      </View>

      {/* Phase labels */}
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 14 }}>
        {plan.phases.map((phase, i) => (
          <View key={phase.id} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: phaseColors[i], textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {phase.name}
            </Text>
            <Text style={{ fontSize: 10, color: '#8A95A3', marginTop: 2 }}>{phase.weeks}w</Text>
          </View>
        ))}
      </View>

      {/* Phase cards */}
      {plan.phases.map((phase, i) => (
        <View key={phase.id} style={[s.darkCard, { borderLeftWidth: 3, borderLeftColor: phaseColors[i], marginBottom: 10 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{
              backgroundColor: `${phaseColors[i]}20`,
              borderWidth: 1,
              borderColor: `${phaseColors[i]}40`,
              borderRadius: 12,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: phaseColors[i] }}>Phase {phase.id}</Text>
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#F0F4F8' }}>{phase.name}</Text>
            <Text style={{ fontSize: 12, color: '#8A95A3', marginLeft: 'auto' }}>{phase.weeks} weeks</Text>
          </View>
          <Text style={{ fontSize: 13, color: '#C5CDD8', lineHeight: 21 }}>{phase.description}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── What's Included Section ─────────────────────────────────────────────────

function WhatsIncludedSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.whatsIncluded || plan.whatsIncluded.length === 0) return null;
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>What's Included</Text>
      <View style={s.darkCard}>
        {plan.whatsIncluded.map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <View style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: 'rgba(110,187,122,0.15)',
              borderWidth: 1,
              borderColor: 'rgba(110,187,122,0.3)',
              justifyContent: 'center',
              alignItems: 'center',
              marginTop: 1,
            }}>
              <Text style={{ fontSize: 11, color: '#6EBB7A', fontWeight: '700' }}>✓</Text>
            </View>
            <Text style={{ fontSize: 14, color: '#C5CDD8', lineHeight: 22, flex: 1 }}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Investment Section ──────────────────────────────────────────────────────

function InvestmentSection({ plan }: { plan: MemberPlanData }) {
  if (!plan.showInvestment || !plan.monthlyPrice) return null;
  const contractMonths = plan.contractLengthMonths || plan.contractMonths || 12;
  const payInFullMonthly = plan.payInFullPrice
    ? Math.round(plan.payInFullPrice / contractMonths)
    : null;
  const savings = plan.payInFullPrice
    ? Math.round(plan.monthlyPrice * contractMonths - plan.payInFullPrice)
    : null;
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={s.sectionLabel}>Your Investment</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {/* Monthly card */}
        <View style={[s.darkCard, { flex: 1, borderColor: 'rgba(91,155,213,0.35)' }]}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#8A95A3', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Monthly</Text>
          <Text style={{ fontSize: 30, fontWeight: '800', color: '#F0F4F8', lineHeight: 34 }}>${plan.monthlyPrice}</Text>
          <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo</Text>
          {plan.perSessionPrice ? (
            <Text style={{ fontSize: 12, color: '#5B9BD5', marginTop: 8 }}>${plan.perSessionPrice} per session</Text>
          ) : null}
        </View>
        {/* Pay in Full card */}
        {plan.payInFullPrice ? (
          <View style={[s.darkCard, { flex: 1, backgroundColor: 'rgba(245,166,35,0.08)', borderColor: 'rgba(245,166,35,0.35)' }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#F5A623', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Pay in Full</Text>
            {/* Monthly equivalent — PROMINENT */}
            <Text style={{ fontSize: 30, fontWeight: '800', color: '#F5A623', lineHeight: 34 }}>${payInFullMonthly}</Text>
            <Text style={{ fontSize: 12, color: '#8A95A3', marginTop: 2 }}>/mo equivalent</Text>
            {/* Total and savings — less prominent */}
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(245,166,35,0.15)' }}>
              <Text style={{ fontSize: 12, color: '#8A95A3' }}>${plan.payInFullPrice} total</Text>
              {savings ? (
                <Text style={{ fontSize: 12, color: '#6EBB7A', marginTop: 2, fontWeight: '600' }}>Save ${savings} ({plan.payInFullDiscount || 10}% off)</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Main My Plan Screen ─────────────────────────────────────────────────────

export default function MyPlan() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchPlan();
  }, [user]);

  async function fetchPlan() {
    try {
      // Try predictable ID first
      const planDocSnap = await getDoc(doc(db, 'member_plans', `plan_${user!.uid}`));
      if (planDocSnap.exists()) {
        setPlan({ id: planDocSnap.id, ...planDocSnap.data() } as MemberPlanData);
      } else {
        // Fallback to query
        const plansQuery = query(
          collection(db, 'member_plans'),
          where('memberId', '==', user!.uid)
        );
        const snap = await getDocs(plansQuery);
        if (!snap.empty) {
          const planDoc = snap.docs[0];
          setPlan({ id: planDoc.id, ...planDoc.data() } as MemberPlanData);
        }
      }
    } catch (err) {
      console.error('[MyPlan] Error fetching plan:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={s.root}>
        <AppHeader />
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  if (!plan || plan.status === 'draft') {
    return (
      <View style={s.root}>
        <AppHeader />
        <View style={s.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
          <Text style={s.emptyTitle}>Plan In Progress</Text>
          <Text style={s.emptyText}>
            Your coach is building your personalized fitness plan.{'\n'}
            You'll see it here once it's ready.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Logo + "Fitness Plan" badge bar */}
      <View style={s.planBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            source={require('../../assets/goarrive-icon.png')}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            resizeMode="contain"
          />
          <View style={[s.badge, { backgroundColor: 'rgba(110,187,122,0.12)', borderColor: 'rgba(110,187,122,0.25)' }]}>
            <Text style={[s.badgeText, { color: '#6EBB7A' }]}>Fitness Plan</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Platform.OS === 'web' ? 100 : 24,
        }}
      >
        <HeroSection plan={plan} />
        <StartingPointSection plan={plan} />
        <GoalsSection plan={plan} />
        <WhySection plan={plan} />
        <WeeklyPlanSection plan={plan} />
        <CoachingEvolutionSection plan={plan} />
        <WhatsIncludedSection plan={plan} />
        <InvestmentSection plan={plan} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#A0AEC0', textAlign: 'center', lineHeight: 22 },

  planBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },

  // Section
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5B9BD5',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 12,
  },

  // Hero
  heroName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F0F4F8',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroAge: {
    fontSize: 13,
    color: '#8A95A3',
    fontWeight: '500',
  },
  heroPlanTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 4,
  },
  heroBranding: {
    fontSize: 11,
    color: '#5B9BD5',
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Cards
  darkCard: {
    backgroundColor: '#161B25',
    borderWidth: 1,
    borderColor: '#2A3347',
    borderRadius: 12,
    padding: 14,
  },

  // Badge
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
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },

  // Chips
  chip: {
    backgroundColor: '#1E2535',
    borderWidth: 1,
    borderColor: '#2A3347',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    color: '#C5CDD8',
  },

  // Text
  bodyText: {
    fontSize: 14,
    lineHeight: 22,
  },
  subtitleText: {
    color: '#C5CDD8',
    fontSize: 14,
    lineHeight: 22,
  },

  // Stats
  miniLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8A95A3',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statValueLarge: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
  },
});
