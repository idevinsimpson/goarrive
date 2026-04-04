/**
 * AdminWorkoutMetrics — Platform-wide workout analytics dashboard
 *
 * Shows aggregate metrics across all coaches and members:
 * - Total workouts created, assigned, completed
 * - Completion rate
 * - Average review turnaround
 * - Top coaches by assignment volume
 *
 * Only visible to platform admins.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  getDocs,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface CoachStat {
  coachId: string;
  coachName: string;
  assignmentCount: number;
  completionCount: number;
}

export default function AdminWorkoutMetrics({ visible, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalWorkouts: 0,
    totalAssignments: 0,
    totalCompleted: 0,
    totalLogs: 0,
    totalReviewed: 0,
    avgReviewHours: 0,
  });
  const [coachStats, setCoachStats] = useState<CoachStat[]>([]);

  useEffect(() => {
    if (!visible) return;
    fetchMetrics();
  }, [visible]);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      // Fetch workouts count
      const workoutsSnap = await getDocs(collection(db, 'workouts'));
      const totalWorkouts = workoutsSnap.size;

      // Fetch assignments
      const assignSnap = await getDocs(collection(db, 'workout_assignments'));
      const totalAssignments = assignSnap.size;
      let totalCompleted = 0;
      const coachMap: Record<string, { name: string; assigned: number; completed: number }> = {};

      assignSnap.forEach((doc) => {
        const d = doc.data();
        if (d.status === 'completed') totalCompleted++;
        const cId = d.coachId || 'unknown';
        if (!coachMap[cId]) {
          coachMap[cId] = { name: d.coachName || cId, assigned: 0, completed: 0 };
        }
        coachMap[cId].assigned++;
        if (d.status === 'completed') coachMap[cId].completed++;
      });

      // Fetch workout logs
      const logsSnap = await getDocs(collection(db, 'workout_logs'));
      const totalLogs = logsSnap.size;
      let totalReviewed = 0;
      let reviewHoursSum = 0;
      let reviewCount = 0;

      logsSnap.forEach((doc) => {
        const d = doc.data();
        if (d.reviewedAt) {
          totalReviewed++;
          if (d.completedAt) {
            const completed = d.completedAt instanceof Timestamp
              ? d.completedAt.toDate()
              : new Date(d.completedAt);
            const reviewed = d.reviewedAt instanceof Timestamp
              ? d.reviewedAt.toDate()
              : new Date(d.reviewedAt);
            const diffHours = (reviewed.getTime() - completed.getTime()) / (1000 * 60 * 60);
            if (diffHours > 0 && diffHours < 720) { // ignore outliers > 30 days
              reviewHoursSum += diffHours;
              reviewCount++;
            }
          }
        }
      });

      const avgReviewHours = reviewCount > 0 ? reviewHoursSum / reviewCount : 0;

      // Build coach leaderboard
      const coachList: CoachStat[] = Object.entries(coachMap)
        .map(([id, data]) => ({
          coachId: id,
          coachName: data.name,
          assignmentCount: data.assigned,
          completionCount: data.completed,
        }))
        .sort((a, b) => b.assignmentCount - a.assignmentCount)
        .slice(0, 10);

      setStats({
        totalWorkouts,
        totalAssignments,
        totalCompleted,
        totalLogs,
        totalReviewed,
        avgReviewHours,
      });
      setCoachStats(coachList);
    } catch (err) {
      console.error('[AdminWorkoutMetrics] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const completionRate =
    stats.totalAssignments > 0
      ? Math.round((stats.totalCompleted / stats.totalAssignments) * 100)
      : 0;

  const reviewRate =
    stats.totalLogs > 0
      ? Math.round((stats.totalReviewed / stats.totalLogs) * 100)
      : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Icon name="stats" size={20} color="#F5A623" />
            <Text style={s.headerTitle}>Workout Metrics</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Icon name="close" size={20} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color="#F5A623" />
              <Text style={s.loadingText}>Loading metrics...</Text>
            </View>
          ) : (
            <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
              {/* KPI Grid */}
              <View style={s.kpiGrid}>
                <View style={s.kpiCard}>
                  <Text style={s.kpiValue}>{stats.totalWorkouts}</Text>
                  <Text style={s.kpiLabel}>Workouts Created</Text>
                </View>
                <View style={s.kpiCard}>
                  <Text style={s.kpiValue}>{stats.totalAssignments}</Text>
                  <Text style={s.kpiLabel}>Assignments</Text>
                </View>
                <View style={s.kpiCard}>
                  <Text style={[s.kpiValue, { color: '#6EBB7A' }]}>{completionRate}%</Text>
                  <Text style={s.kpiLabel}>Completion Rate</Text>
                </View>
                <View style={s.kpiCard}>
                  <Text style={[s.kpiValue, { color: '#7DD3FC' }]}>{reviewRate}%</Text>
                  <Text style={s.kpiLabel}>Review Rate</Text>
                </View>
              </View>

              {/* Detailed Stats */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Detailed Metrics</Text>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Total Completed</Text>
                  <Text style={s.statValue}>{stats.totalCompleted}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Total Logs</Text>
                  <Text style={s.statValue}>{stats.totalLogs}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Reviewed Logs</Text>
                  <Text style={s.statValue}>{stats.totalReviewed}</Text>
                </View>
                <View style={s.statRow}>
                  <Text style={s.statLabel}>Avg Review Turnaround</Text>
                  <Text style={s.statValue}>
                    {stats.avgReviewHours < 1
                      ? `${Math.round(stats.avgReviewHours * 60)}m`
                      : `${stats.avgReviewHours.toFixed(1)}h`}
                  </Text>
                </View>
              </View>

              {/* Coach Leaderboard */}
              {coachStats.length > 0 && (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Top Coaches by Assignments</Text>
                  {coachStats.map((coach, i) => (
                    <View key={coach.coachId} style={s.coachRow}>
                      <View style={s.coachRank}>
                        <Text style={s.coachRankText}>{i + 1}</Text>
                      </View>
                      <View style={s.coachInfo}>
                        <Text style={s.coachName} numberOfLines={1}>
                          {coach.coachName}
                        </Text>
                        <Text style={s.coachMeta}>
                          {coach.assignmentCount} assigned · {coach.completionCount} completed
                        </Text>
                      </View>
                      <Text style={s.coachRate}>
                        {coach.assignmentCount > 0
                          ? Math.round((coach.completionCount / coach.assignmentCount) * 100)
                          : 0}
                        %
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    overflow: "hidden" as const,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  closeBtn: {
    padding: 4,
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  kpiCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  kpiValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  kpiLabel: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 0.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  statLabel: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  coachRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coachRankText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  coachInfo: {
    flex: 1,
  },
  coachName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  coachMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  coachRate: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6EBB7A',
    fontFamily: FH,
  },
});
