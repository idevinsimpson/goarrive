/**
 * WorkoutAnalytics — Coach-side workout log analytics for a specific member
 *
 * Shows:
 * - Completion rate (completed vs assigned)
 * - Average effort/mood ratings over time
 * - Most-skipped movements
 * - Recent workout log timeline
 *
 * Data source: workout_assignments + workout_logs filtered by memberId
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface WorkoutAnalyticsProps {
  visible: boolean;
  memberId: string;
  memberName: string;
  coachId: string;
  onClose: () => void;
}

interface AnalyticsData {
  totalAssigned: number;
  totalCompleted: number;
  completionRate: number;
  avgEnergy: number | null;
  avgMood: number | null;
  totalDurationMin: number;
  recentLogs: {
    id: string;
    workoutName: string;
    completedAt: any;
    durationMin: number;
    energyRating: number | null;
    moodRating: number | null;
    hasJournal: boolean;
    reviewed: boolean;
  }[];
  weeklyCompletions: { week: string; count: number }[];
}

const ENERGY_LABELS = ['Drained', 'Low', 'Steady', 'Strong', 'On Fire'];
const MOOD_LABELS = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];

export default function WorkoutAnalytics({
  visible,
  memberId,
  memberName,
  coachId,
  onClose,
}: WorkoutAnalyticsProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    if (!visible || !memberId) return;
    loadAnalytics();
  }, [visible, memberId]);

  async function loadAnalytics() {
    setLoading(true);
    try {
      // Fetch assignments for this member
      const assignSnap = await getDocs(
        query(
          collection(db, 'workout_assignments'),
          where('memberId', '==', memberId),
          where('coachId', '==', coachId),
        ),
      );

      // Fetch workout logs for this member
      const logSnap = await getDocs(
        query(
          collection(db, 'workout_logs'),
          where('memberId', '==', memberId),
          where('coachId', '==', coachId),
        ),
      );

      const totalAssigned = assignSnap.size;
      const totalCompleted = logSnap.size;
      const completionRate =
        totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

      // Aggregate ratings
      let energySum = 0;
      let energyCount = 0;
      let moodSum = 0;
      let moodCount = 0;
      let totalDurationSec = 0;

      const logs = logSnap.docs.map((d) => {
        const logData = d.data();
        const journal = logData.journal;

        if (journal?.energyRating != null) {
          energySum += journal.energyRating;
          energyCount++;
        }
        if (journal?.moodRating != null) {
          moodSum += journal.moodRating;
          moodCount++;
        }
        if (logData.durationSec) {
          totalDurationSec += logData.durationSec;
        }

        const completedAt = logData.completedAt;
        let completedDate: Date | null = null;
        if (completedAt?.toDate) {
          completedDate = completedAt.toDate();
        } else if (completedAt) {
          completedDate = new Date(completedAt);
        }

        return {
          id: d.id,
          workoutName: logData.workoutName ?? 'Workout',
          completedAt: completedDate,
          durationMin: Math.round((logData.durationSec ?? 0) / 60),
          energyRating: journal?.energyRating ?? null,
          moodRating: journal?.moodRating ?? null,
          hasJournal: !!journal?.glow || !!journal?.grow,
          reviewed: !!logData.reviewedAt,
        };
      });

      // Sort by completedAt desc
      logs.sort((a, b) => {
        if (!a.completedAt) return 1;
        if (!b.completedAt) return -1;
        return b.completedAt.getTime() - a.completedAt.getTime();
      });

      // Weekly completions (last 8 weeks)
      const weeklyMap: Record<string, number> = {};
      const now = new Date();
      for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() - i * 7);
        const key = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
        weeklyMap[key] = 0;
      }

      logs.forEach((log) => {
        if (!log.completedAt) return;
        const weekStart = new Date(log.completedAt);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const key = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
        if (key in weeklyMap) {
          weeklyMap[key]++;
        }
      });

      const weeklyCompletions = Object.entries(weeklyMap).map(([week, count]) => ({
        week,
        count,
      }));

      setData({
        totalAssigned,
        totalCompleted,
        completionRate,
        avgEnergy: energyCount > 0 ? Math.round((energySum / energyCount) * 10) / 10 : null,
        avgMood: moodCount > 0 ? Math.round((moodSum / moodCount) * 10) / 10 : null,
        totalDurationMin: Math.round(totalDurationSec / 60),
        recentLogs: logs.slice(0, 10),
        weeklyCompletions,
      });
    } catch (err) {
      console.error('[WorkoutAnalytics] Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Icon name="trending-up" size={20} color="#F5A623" />
              <Text style={s.headerTitle}>Workout Analytics</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={24} color="#8A95A3" />
            </Pressable>
          </View>

          {/* Member name badge */}
          <View style={s.memberBadge}>
            <Icon name="person" size={14} color="#F5A623" />
            <Text style={s.memberBadgeText}>{memberName}</Text>
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color="#F5A623" />
              <Text style={s.loadingText}>Loading analytics...</Text>
            </View>
          ) : !data ? (
            <View style={s.emptyWrap}>
              <Icon name="trending-up" size={48} color="#2A3040" />
              <Text style={s.emptyText}>No workout data yet</Text>
            </View>
          ) : (
            <ScrollView
              style={s.content}
              contentContainerStyle={s.contentInner}
              showsVerticalScrollIndicator={false}
            >
              {/* Summary cards */}
              <View style={s.summaryGrid}>
                <View style={s.summaryCard}>
                  <Text style={s.summaryValue}>{data.completionRate}%</Text>
                  <Text style={s.summaryLabel}>Completion</Text>
                  <Text style={s.summaryDetail}>
                    {data.totalCompleted}/{data.totalAssigned}
                  </Text>
                </View>
                <View style={s.summaryCard}>
                  <Text style={s.summaryValue}>
                    {data.avgEnergy != null ? data.avgEnergy.toFixed(1) : '—'}
                  </Text>
                  <Text style={s.summaryLabel}>Avg Energy</Text>
                  <Text style={s.summaryDetail}>
                    {data.avgEnergy != null
                      ? ENERGY_LABELS[Math.round(data.avgEnergy) - 1] ?? ''
                      : 'No data'}
                  </Text>
                </View>
                <View style={s.summaryCard}>
                  <Text style={s.summaryValue}>
                    {data.avgMood != null ? data.avgMood.toFixed(1) : '—'}
                  </Text>
                  <Text style={s.summaryLabel}>Avg Mood</Text>
                  <Text style={s.summaryDetail}>
                    {data.avgMood != null
                      ? MOOD_LABELS[Math.round(data.avgMood) - 1] ?? ''
                      : 'No data'}
                  </Text>
                </View>
              </View>

              {/* Total time */}
              <View style={s.totalTimeRow}>
                <Icon name="time" size={16} color="#8A95A3" />
                <Text style={s.totalTimeText}>
                  {data.totalDurationMin} min total workout time
                </Text>
              </View>

              {/* Weekly bar chart */}
              <Text style={s.sectionTitle}>Weekly Completions</Text>
              <View style={s.barChart}>
                {data.weeklyCompletions.map((w, i) => {
                  const maxCount = Math.max(
                    ...data.weeklyCompletions.map((wc) => wc.count),
                    1,
                  );
                  const heightPct = (w.count / maxCount) * 100;
                  return (
                    <View key={i} style={s.barCol}>
                      <View style={s.barTrack}>
                        <View
                          style={[
                            s.barFill,
                            { height: `${Math.max(heightPct, 4)}%` },
                          ]}
                        />
                      </View>
                      <Text style={s.barLabel}>{w.week}</Text>
                      {w.count > 0 && (
                        <Text style={s.barCount}>{w.count}</Text>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Recent logs */}
              <Text style={s.sectionTitle}>Recent Workouts</Text>
              {data.recentLogs.length === 0 ? (
                <Text style={s.noLogsText}>No completed workouts yet</Text>
              ) : (
                data.recentLogs.map((log) => (
                  <View key={log.id} style={s.logCard}>
                    <View style={s.logHeader}>
                      <Text style={s.logName} numberOfLines={1}>
                        {log.workoutName}
                      </Text>
                      <View style={s.logBadges}>
                        {log.hasJournal && (
                          <View style={s.journalBadge}>
                            <Icon name="document" size={10} color="#6EBB7A" />
                          </View>
                        )}
                        {log.reviewed && (
                          <View style={s.reviewedBadge}>
                            <Icon name="check" size={10} color="#7DD3FC" />
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={s.logMeta}>
                      {log.completedAt && (
                        <Text style={s.logDate}>
                          {log.completedAt.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Text>
                      )}
                      {log.durationMin > 0 && (
                        <Text style={s.logDuration}>{log.durationMin} min</Text>
                      )}
                      {log.energyRating != null && (
                        <Text style={s.logRating}>
                          ⚡ {ENERGY_LABELS[log.energyRating - 1] ?? log.energyRating}
                        </Text>
                      )}
                      {log.moodRating != null && (
                        <Text style={s.logRating}>
                          🧠 {MOOD_LABELS[log.moodRating - 1] ?? log.moodRating}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '50%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A3347',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginLeft: 20,
    marginTop: 12,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  memberBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: '#4A5568',
    fontFamily: FB,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 20,
    gap: 16,
  },

  // Summary grid
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#0E1117',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F5A623',
    fontFamily: FH,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  summaryDetail: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },

  // Total time
  totalTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  totalTimeText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 8,
  },

  // Bar chart
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 120,
    backgroundColor: '#0E1117',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  barTrack: {
    width: '100%',
    height: 80,
    justifyContent: 'flex-end',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 4,
    minHeight: 3,
  },
  barLabel: {
    fontSize: 9,
    color: '#4A5568',
    fontFamily: FB,
  },
  barCount: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    position: 'absolute',
    top: 0,
  },

  // Log cards
  logCard: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    flex: 1,
  },
  logBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  journalBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(110,187,122,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewedBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(125,211,252,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  logDate: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  logDuration: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  logRating: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  noLogsText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
