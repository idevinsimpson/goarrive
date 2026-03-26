/**
 * Dashboard screen — GoArrive Coach Dashboard
 *
 * Shows COACH DASHBOARD label, full name greeting, COACH role badge,
 * stats grid, onboarding checklist, coaching tools feature cards,
 * and recent activity.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Platform,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from 'firebase/firestore';
import { AppHeader } from '../../components/AppHeader';
import CheckInCard from '../../components/CheckInCard';
import ListSkeleton from '../../components/ListSkeleton';
import { Icon } from '../../components/Icon';
import OnboardingChecklist from '../../components/OnboardingChecklist';
import { router } from 'expo-router';
import AdminWorkoutMetrics from '../../components/AdminWorkoutMetrics';
import AssignWorkoutModal from '../../components/AssignWorkoutModal';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface FeatureCard {
  title: string;
  description: string;
  week: string;
  color: string;
  route: '/(app)/movements' | '/(app)/workouts' | '/(app)/members' | '/(app)/admin' | '/(app)/billing' | '/(app)/scheduling';
}

const FEATURE_CARDS: FeatureCard[] = [
  {
    title: 'Member Plans',
    description: 'Build and send personalized plans to your members.',
    week: '',
    color: '#C084FC',
    route: '/(app)/members',
  },
  {
    title: 'Movement Library',
    description: 'Browse and manage exercises with video demos and muscle-group tags.',
    week: '',
    color: '#7DD3FC',
    route: '/(app)/movements',
  },
  {
    title: 'Workout Builder',
    description: 'Compose structured workouts and assign them to members.',
    week: '',
    color: '#86EFAC',
    route: '/(app)/workouts',
  },
  {
    title: 'Member List',
    description: 'View and manage your roster, progress, and program assignments.',
    week: '',
    color: '#F5A623',
    route: '/(app)/members',
  },
  {
    title: 'Scheduling',
    description: 'Manage Zoom rooms, recurring slots, and session allocation.',
    week: '',
    color: '#34D399',
    route: '/(app)/scheduling',
  },
  {
    title: 'Billing',
    description: 'Stripe Connect status, payment tasks, and tier split.',
    week: '',
    color: '#F5A623',
    route: '/(app)/billing',
  },
];

/** Admin-only cards shown only to platformAdmin role */
const ADMIN_CARDS: FeatureCard[] = [
  {
    title: 'Admin Config',
    description: 'Configure rule_versions, fee tiers, and platform settings.',
    week: '',
    color: '#8A95A3',
    route: '/(app)/admin',
  },
];

export default function DashboardScreen() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const isAdmin = claims?.role === 'admin' || claims?.role === 'platform_admin';
  const [showAdminMetrics, setShowAdminMetrics] = useState(false);
  const [showQuickAssign, setShowQuickAssign] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    members: 0,
    activeWorkouts: 0,
    movements: 0,
    recentCheckins: [] as any[],
    todayAssignments: 0,
    needsReview: 0,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [membersSnap, workoutsSnap, movementsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'members'),
            where('coachId', '==', coachId),
            // Note: no isArchived filter here — no composite index exists for coachId+isArchived.
            // We filter client-side below.
          ),
        ),
        getDocs(
          query(collection(db, 'workouts'), where('coachId', '==', coachId)),
        ),
        getDocs(
          query(collection(db, 'movements'), where('coachId', '==', coachId)),
        ),
      ]);

      // Today's assignments
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const assignSnap = await getDocs(
        query(
          collection(db, 'workout_assignments'),
          where('coachId', '==', coachId),
          orderBy('scheduledFor', 'desc'),
          limit(20),
        ),
      ).catch(() => ({ docs: [] as any[] }));

      const todayAssignments = assignSnap.docs.filter((d) => {
        const sf = d.data().scheduledFor;
        if (!sf) return false;
        const sfDate = sf.toDate ? sf.toDate() : new Date(sf);
        return sfDate >= today && sfDate < tomorrow;
      }).length;

      // Needs review — unreviewed workout logs
      const reviewSnap = await getDocs(
        query(
          collection(db, 'workout_logs'),
          where('coachId', '==', coachId),
        ),
      ).catch(() => ({ docs: [] as any[] }));

      const needsReview = reviewSnap.docs.filter((d) => {
        const data = d.data();
        return !data.reviewedAt;
      }).length;

      // Recent check-ins
      const checkinsSnap = await getDocs(
        query(
          collection(db, 'checkins'),
          orderBy('timestamp', 'desc'),
          limit(5),
        ),
      ).catch(() => ({ docs: [] as any[] }));

      const recentCheckins = checkinsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Filter archived members client-side (no composite index for coachId+isArchived)
      const activeMembers = membersSnap.docs.filter((d) => !d.data().isArchived);

      setStats({
        members: activeMembers.length,
        activeWorkouts: workoutsSnap.size,
        movements: movementsSnap.size,
        recentCheckins,
        todayAssignments,
        needsReview,
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, coachId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const coachName = user?.displayName ?? user?.email?.split('@')[0] ?? 'Coach';
  const role = claims?.role ?? 'coach';
  const roleLabel =
    role === 'platformAdmin'
      ? 'Platform Admin'
      : role === 'coachAssistant'
      ? 'Coach Assistant'
      : 'Coach';

  return (
    <View style={s.root}>
      <AppHeader />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F5A623"
            colors={['#F5A623']}
          />
        }
      >
        {/* Hero greeting */}
        <View style={s.heroSection}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={s.heroLabel}>COACH DASHBOARD</Text>
            <View style={{ backgroundColor: 'rgba(245,166,35,0.15)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)' }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#F5A623', letterSpacing: 1, fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold' }}>BETA</Text>
            </View>
          </View>
          <Text style={s.heroName}>Welcome back,{'\n'}{coachName}</Text>
          <View style={s.roleBadge}>
            <Text style={s.roleText}>{roleLabel.toUpperCase()}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* Today's highlight banner */}
        {stats.todayAssignments > 0 && (
          <View style={s.todayBanner}>
            <Icon name="calendar" size={18} color="#F5A623" />
            <Text style={s.todayBannerText}>
              {stats.todayAssignments} workout
              {stats.todayAssignments !== 1 ? 's' : ''} scheduled for today
            </Text>
          </View>
        )}

        {/* Needs Review banner */}
        {stats.needsReview > 0 && (
          <Pressable
            style={s.reviewBanner}
            onPress={() => router.push('/(app)/members')}
          >
            <View style={s.reviewBannerLeft}>
              <Icon name="document" size={18} color="#E05252" />
              <Text style={s.reviewBannerText}>
                {stats.needsReview} workout log{stats.needsReview !== 1 ? 's' : ''} need{stats.needsReview === 1 ? 's' : ''} review
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color="#E05252" />
          </Pressable>
        )}

        {/* Quick Assign shortcut */}
        <Pressable
          style={s.quickAssignBtn}
          onPress={() => setShowQuickAssign(true)}
        >
          <Icon name="workouts" size={18} color="#0E1117" />
          <Text style={s.quickAssignBtnText}>Quick Assign Workout</Text>
        </Pressable>

        {/* Admin: Platform Workout Metrics */}
        {isAdmin && (
          <Pressable
            style={s.adminMetricsBtn}
            onPress={() => setShowAdminMetrics(true)}
          >
            <Icon name="stats" size={18} color="#F5A623" />
            <Text style={s.adminMetricsBtnText}>Platform Workout Metrics</Text>
            <Icon name="chevron-right" size={16} color="#F5A623" />
          </Pressable>
        )}

        {/* Stats grid */}
        <View style={s.statsGrid}>
          <Pressable
            style={s.statCard}
            onPress={() => router.push('/(app)/members')}
          >
            <View style={[s.statIcon, { backgroundColor: 'rgba(245,166,35,0.1)' }]}>
              <Icon name="members" size={20} color="#F5A623" />
            </View>
            <Text style={s.statNumber}>{stats.members}</Text>
            <Text style={s.statLabel}>Members</Text>
          </Pressable>

          <Pressable
            style={s.statCard}
            onPress={() => router.push('/(app)/workouts')}
          >
            <View style={[s.statIcon, { backgroundColor: 'rgba(125,211,252,0.1)' }]}>
              <Icon name="workouts" size={20} color="#7DD3FC" />
            </View>
            <Text style={s.statNumber}>{stats.activeWorkouts}</Text>
            <Text style={s.statLabel}>Workouts</Text>
          </Pressable>

          <Pressable
            style={s.statCard}
            onPress={() => router.push('/(app)/movements')}
          >
            <View style={[s.statIcon, { backgroundColor: 'rgba(134,239,172,0.1)' }]}>
              <Icon name="movements" size={20} color="#86EFAC" />
            </View>
            <Text style={s.statNumber}>{stats.movements}</Text>
            <Text style={s.statLabel}>Movements</Text>
          </Pressable>
        </View>

        {/* Onboarding checklist */}
        <OnboardingChecklist />

        {/* Divider */}
        <View style={s.divider} />

        {/* Feature cards */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionSuper}>PLATFORM FEATURES</Text>
          <Text style={s.sectionTitle}>Your Coaching Tools</Text>
        </View>

        <View style={s.featureList}>
          {[...FEATURE_CARDS, ...(role === 'platformAdmin' ? ADMIN_CARDS : [])].map((card) => (
            <Pressable
              key={card.title}
              style={({ pressed }) => [s.featureCard, pressed && s.featureCardPressed]}
              onPress={() => router.push(card.route as any)}
            >
              <View style={s.featureCardInner}>
                <View style={s.featureCardLeft}>
                  <Text style={[s.featureTitle, { color: card.color }]}>{card.title}</Text>
                  <Text style={s.featureDesc}>{card.description}</Text>
                </View>
                <View style={s.featureCardRight}>
                  {card.week ? <Text style={s.featureWeek}>{card.week}</Text> : null}
                  <Icon name="chevron-right" size={16} color="#4A5568" />
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* Recent activity */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Recent Activity</Text>
        </View>

        {loading ? (
          <ListSkeleton count={3} />
        ) : stats.recentCheckins.length > 0 ? (
          stats.recentCheckins.map((checkin) => (
            <CheckInCard key={checkin.id} />
          ))
        ) : (
          <View style={s.emptyState}>
            <Icon name="clock" size={40} color="#2A3347" />
            <Text style={s.emptyTitle}>No recent activity</Text>
            <Text style={s.emptyBody}>
              Check-ins and activity will appear here.
            </Text>
          </View>
        )}

        <View style={s.bottomPad} />
      </ScrollView>

      {/* Admin Workout Metrics Modal */}
      <AdminWorkoutMetrics
        visible={showAdminMetrics}
        onClose={() => setShowAdminMetrics(false)}
      />

      {/* Quick Assign Modal */}
      <AssignWorkoutModal
        visible={showQuickAssign}
        onClose={() => setShowQuickAssign(false)}
        coachId={coachId}
        onAssign={async (workoutId, memberId, scheduledFor) => {
          const { addDoc, collection: col, Timestamp } = await import('firebase/firestore');
          await addDoc(col(db, 'workout_assignments'), {
            workoutId,
            memberId,
            coachId,
            scheduledFor: Timestamp.fromDate(scheduledFor),
            status: 'assigned',
            createdAt: Timestamp.now(),
          });
          setShowQuickAssign(false);
          fetchData();
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 100,
  },
  heroSection: {
    marginBottom: 20,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FONT_BODY,
    letterSpacing: 2,
    marginBottom: 8,
  },
  heroName: {
    fontSize: 30,
    fontWeight: '800',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    lineHeight: 34,
    marginBottom: 12,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_BODY,
    letterSpacing: 1.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E2A3A',
    marginVertical: 20,
  },
  todayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  todayBannerText: {
    fontSize: 15,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '600',
  },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
  },
  reviewBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  reviewBannerText: {
    fontSize: 15,
    color: '#E05252',
    fontFamily: FONT_BODY,
    fontWeight: '600',
  },
  quickAssignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  quickAssignBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  adminMetricsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    gap: 8,
  },
  adminMetricsBtnText: {
    flex: 1,
    fontSize: 15,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    gap: 6,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statNumber: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  statLabel: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
  sectionHeader: {
    marginBottom: 14,
    gap: 4,
  },
  sectionSuper: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FONT_BODY,
    letterSpacing: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  featureList: {
    gap: 10,
    marginBottom: 4,
  },
  featureCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    overflow: 'hidden',
  },
  featureCardPressed: {
    backgroundColor: '#1A2035',
  },
  featureCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  featureCardLeft: {
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_HEADING,
  },
  featureDesc: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    lineHeight: 18,
  },
  featureCardRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  featureWeek: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A5568',
    fontFamily: FONT_BODY,
    letterSpacing: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FONT_HEADING,
    marginTop: 8,
  },
  emptyBody: {
    fontSize: 13,
    color: '#2A3347',
    fontFamily: FONT_BODY,
    textAlign: 'center',
  },
  bottomPad: {
    height: 20,
  },
});
