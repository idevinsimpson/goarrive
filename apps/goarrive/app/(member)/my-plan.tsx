/**
 * My Plan — Read-only plan view for members
 *
 * Displays the member's training plan when it's been presented by the coach.
 * Shows a pending state if the plan is still being built.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface PlanData {
  id: string;
  status: string;
  hero?: {
    planTitle?: string;
    statusText?: string;
    description?: string;
  };
  goals?: {
    selected?: string[];
    weightCurrent?: number;
    weightGoal?: string;
  };
  why?: {
    statement?: string;
    readinessForChange?: number;
    motivation?: number;
  };
  weeklyPlan?: {
    sessionsPerWeek?: number;
    contractMonths?: number;
    days?: Array<{
      day: string;
      status: string;
      time?: string;
      sessionType?: string;
    }>;
  };
  phases?: Array<{
    phaseNumber: number;
    name: string;
    durationWeeks: number;
    description: string;
  }>;
  inclusions?: string[];
  pricing?: {
    monthlyRate?: number;
    perSession?: number;
    payInFull?: number;
    payInFullDiscount?: number;
  };
}

export default function MyPlan() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchPlan();
  }, [user]);

  async function fetchPlan() {
    try {
      const plansQuery = query(
        collection(db, 'member_plans'),
        where('memberId', '==', user!.uid)
      );
      const snap = await getDocs(plansQuery);
      if (!snap.empty) {
        const planDoc = snap.docs[0];
        setPlan({ id: planDoc.id, ...planDoc.data() } as PlanData);
      }
    } catch (err) {
      console.error('[MyPlan] Error fetching plan:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <AppHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  if (!plan || plan.status === 'draft') {
    return (
      <View style={styles.root}>
        <AppHeader />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>Plan In Progress</Text>
          <Text style={styles.emptyText}>
            Your coach is building your personalized training plan.
            You'll see it here once it's ready.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Plan Hero */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>
            {plan.hero?.planTitle || 'Your Training Plan'}
          </Text>
          {plan.hero?.description ? (
            <Text style={styles.heroDescription}>{plan.hero.description}</Text>
          ) : null}
        </View>

        {/* Goals */}
        {plan.goals?.selected && plan.goals.selected.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Goals</Text>
            <View style={styles.chipContainer}>
              {plan.goals.selected.map((goal, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipText}>{goal}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Why Statement */}
        {plan.why?.statement ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Why</Text>
            <Text style={styles.cardText}>{plan.why.statement}</Text>
            {plan.why.readinessForChange && (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Readiness for Change</Text>
                <Text style={styles.statValue}>{plan.why.readinessForChange}/10</Text>
              </View>
            )}
            {plan.why.motivation && (
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Motivation</Text>
                <Text style={styles.statValue}>{plan.why.motivation}/10</Text>
              </View>
            )}
          </View>
        ) : null}

        {/* Weekly Schedule */}
        {plan.weeklyPlan?.days && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Weekly Schedule</Text>
            <Text style={styles.cardSubtitle}>
              {plan.weeklyPlan.sessionsPerWeek} sessions/week | {plan.weeklyPlan.contractMonths}-month commitment
            </Text>
            {plan.weeklyPlan.days.map((day, i) => (
              <View key={i} style={styles.dayRow}>
                <Text style={[
                  styles.dayLabel,
                  day.status === 'active' && styles.dayLabelActive,
                ]}>
                  {day.day}
                </Text>
                <Text style={[
                  styles.dayStatus,
                  day.status === 'active' && styles.dayStatusActive,
                  day.status === 'optional' && styles.dayStatusOptional,
                ]}>
                  {day.status === 'active'
                    ? `${day.sessionType || 'Training'}${day.time ? ` — ${day.time}` : ''}`
                    : day.status === 'optional'
                    ? 'Optional'
                    : 'Rest'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Coaching Phases */}
        {plan.phases && plan.phases.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coaching Phases</Text>
            {plan.phases.map((phase, i) => (
              <View key={i} style={styles.phaseRow}>
                <View style={styles.phaseNumber}>
                  <Text style={styles.phaseNumberText}>{phase.phaseNumber}</Text>
                </View>
                <View style={styles.phaseContent}>
                  <Text style={styles.phaseName}>{phase.name}</Text>
                  <Text style={styles.phaseDuration}>{phase.durationWeeks} weeks</Text>
                  <Text style={styles.phaseDescription}>{phase.description}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* What's Included */}
        {plan.inclusions && plan.inclusions.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What's Included</Text>
            {plan.inclusions.map((item, i) => (
              <View key={i} style={styles.inclusionRow}>
                <Text style={styles.inclusionCheck}>✓</Text>
                <Text style={styles.inclusionText}>{item}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Investment (only if coach has enabled visibility) */}
        {plan.pricing?.monthlyRate ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Investment</Text>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Monthly</Text>
              <Text style={styles.priceValue}>${plan.pricing.monthlyRate}/mo</Text>
            </View>
            {plan.pricing.perSession ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Per Session</Text>
                <Text style={styles.priceValue}>${plan.pricing.perSession}</Text>
              </View>
            ) : null}
            {plan.pricing.payInFull ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>
                  Pay in Full ({plan.pricing.payInFullDiscount || 10}% off)
                </Text>
                <Text style={styles.priceValue}>${plan.pricing.payInFull}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'web' ? 100 : 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#A0AEC0',
    textAlign: 'center',
    lineHeight: 22,
  },
  heroSection: {
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 14,
    color: '#A0AEC0',
    lineHeight: 22,
  },
  card: {
    backgroundColor: '#151B26',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 12,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 12,
  },
  cardText: {
    fontSize: 14,
    color: '#A0AEC0',
    lineHeight: 22,
    marginBottom: 12,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipText: {
    fontSize: 13,
    color: '#F5A623',
    fontWeight: '600',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statLabel: { fontSize: 13, color: '#718096' },
  statValue: { fontSize: 14, fontWeight: '700', color: '#F5A623' },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  dayLabel: { fontSize: 14, color: '#718096', fontWeight: '600', width: 50 },
  dayLabelActive: { color: '#F0F4F8' },
  dayStatus: { fontSize: 13, color: '#718096', flex: 1, textAlign: 'right' },
  dayStatusActive: { color: '#F5A623' },
  dayStatusOptional: { color: '#48BB78' },
  phaseRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  phaseNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  phaseNumberText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
  },
  phaseContent: { flex: 1 },
  phaseName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 2,
  },
  phaseDuration: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 4,
  },
  phaseDescription: {
    fontSize: 13,
    color: '#A0AEC0',
    lineHeight: 20,
  },
  inclusionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  inclusionCheck: {
    fontSize: 14,
    color: '#48BB78',
    fontWeight: '700',
    marginRight: 10,
    marginTop: 1,
  },
  inclusionText: {
    fontSize: 14,
    color: '#A0AEC0',
    flex: 1,
    lineHeight: 22,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  priceLabel: { fontSize: 14, color: '#A0AEC0' },
  priceValue: { fontSize: 16, fontWeight: '700', color: '#F5A623' },
});
