/**
 * CoachWorkoutStatsWidget — Dashboard widget showing workout stats at a glance
 *
 * Displays:
 *   - Total workouts completed this week
 *   - Average difficulty rating
 *   - Completion rate (completed / assigned)
 *   - Most active member
 *
 * Props:
 *   coachId — the coach's user ID
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface CoachWorkoutStatsWidgetProps {
  coachId: string;
}

interface WeekStats {
  completedCount: number;
  assignedCount: number;
  avgDifficulty: number | null;
  mostActiveMember: string | null;
}

export default function CoachWorkoutStatsWidget({
  coachId,
}: CoachWorkoutStatsWidgetProps) {
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const weekTs = Timestamp.fromDate(weekAgo);

      // Fetch completed logs this week
      const logsSnap = await getDocs(
        query(
          collection(db, 'workout_logs'),
          where('coachId', '==', coachId),
          where('completedAt', '>=', weekTs),
        ),
      );
      const logs = logsSnap.docs.map((d) => d.data());

      // Fetch assignments this week
      const assignSnap = await getDocs(
        query(
          collection(db, 'workout_assignments'),
          where('coachId', '==', coachId),
          where('scheduledFor', '>=', weekTs),
        ),
      );

      // Calculate stats
      const completedCount = logs.length;
      const assignedCount = assignSnap.docs.length;

      // Average difficulty
      const difficulties = logs
        .map((l) => l.difficultyRating)
        .filter((d): d is number => typeof d === 'number' && d > 0);
      const avgDifficulty =
        difficulties.length > 0
          ? Math.round(
              (difficulties.reduce((a, b) => a + b, 0) / difficulties.length) *
                10,
            ) / 10
          : null;

      // Most active member
      const memberCounts: Record<string, { count: number; name: string }> = {};
      for (const l of logs) {
        const mid = l.memberId || 'unknown';
        if (!memberCounts[mid]) {
          memberCounts[mid] = { count: 0, name: l.memberName || 'Member' };
        }
        memberCounts[mid].count++;
      }
      let mostActiveMember: string | null = null;
      let maxCount = 0;
      for (const [, v] of Object.entries(memberCounts)) {
        if (v.count > maxCount) {
          maxCount = v.count;
          mostActiveMember = v.name;
        }
      }

      setStats({
        completedCount,
        assignedCount,
        avgDifficulty,
        mostActiveMember,
      });
    } catch (err) {
      console.error('Error fetching workout stats:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <View style={st.container}>
        <ActivityIndicator color="#F5A623" size="small" />
      </View>
    );
  }

  if (!stats) return null;

  const completionRate =
    stats.assignedCount > 0
      ? Math.round((stats.completedCount / stats.assignedCount) * 100)
      : null;

  return (
    <View style={st.container}>
      <Text style={st.title}>Workout Stats This Week</Text>
      <View style={st.grid}>
        {/* Completed */}
        <View style={st.statBox}>
          <Icon name="checkmark-circle" size={20} color="#34D399" />
          <Text style={st.statValue}>{stats.completedCount}</Text>
          <Text style={st.statLabel}>Completed</Text>
        </View>

        {/* Completion Rate */}
        <View style={st.statBox}>
          <Icon name="trending-up" size={20} color="#F5A623" />
          <Text style={st.statValue}>
            {completionRate != null ? `${completionRate}%` : '—'}
          </Text>
          <Text style={st.statLabel}>Completion</Text>
        </View>

        {/* Avg Difficulty */}
        <View style={st.statBox}>
          <Icon name="flame" size={20} color="#E05252" />
          <Text style={st.statValue}>
            {stats.avgDifficulty != null ? `${stats.avgDifficulty}/5` : '—'}
          </Text>
          <Text style={st.statLabel}>Avg Difficulty</Text>
        </View>

        {/* Most Active */}
        <View style={st.statBox}>
          <Icon name="star" size={20} color="#F5A623" />
          <Text style={st.statValue} numberOfLines={1}>
            {stats.mostActiveMember || '—'}
          </Text>
          <Text style={st.statLabel}>Most Active</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    fontFamily: FH,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statBox: {
    flex: 1,
    minWidth: 70,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statValue: {
    fontFamily: FH,
    fontSize: 20,
    color: '#FFFFFF',
    marginTop: 6,
  },
  statLabel: {
    fontFamily: FB,
    fontSize: 11,
    color: '#8A95A3',
    marginTop: 2,
    textAlign: 'center',
  },
});
