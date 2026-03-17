/**
 * Dashboard screen — GoArrive Coach Dashboard
 *
 * Shows today's date, key stats (members, workouts, movements), today's
 * assignments highlight, and recent check-ins.
 * Uses the GoArrive design system: dark bg, gold accents, Space Grotesk + DM Sans.
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

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function DashboardScreen() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    members: 0,
    activeWorkouts: 0,
    movements: 0,
    recentCheckins: [] as any[],
    todayAssignments: 0,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [membersSnap, workoutsSnap, movementsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'members'),
            where('coachId', '==', coachId),
            where('isArchived', '==', false),
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

      setStats({
        members: membersSnap.size,
        activeWorkouts: workoutsSnap.size,
        movements: movementsSnap.size,
        recentCheckins,
        todayAssignments,
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

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const coachName =
    user?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'Coach';

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

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
        {/* Greeting */}
        <View style={s.greetingWrap}>
          <Text style={s.greeting}>
            {greeting()}, {coachName} 👋
          </Text>
          <Text style={s.date}>{todayStr}</Text>
        </View>

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

        {/* Onboarding checklist — only shows for new coaches until all 4 steps done */}
        <OnboardingChecklist />

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
  },
  greetingWrap: {
    marginBottom: 20,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  date: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    marginTop: 4,
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
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
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
    fontSize: 24,
    fontWeight: '800',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  statLabel: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
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
