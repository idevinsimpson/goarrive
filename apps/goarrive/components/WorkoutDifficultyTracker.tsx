/**
 * WorkoutDifficultyTracker — Workout difficulty progression component
 *
 * Shows a member's workout difficulty progression over the last 30 days.
 * Queries workout_logs and groups by difficulty level to show trend.
 * Can be embedded in the member dashboard or coach member detail view.
 *
 * Props:
 *   memberId — the member's user ID
 *   coachId  — the coach's user ID (for scoping)
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface DifficultyEntry {
  date: string; // YYYY-MM-DD
  difficulty: string;
  workoutName: string;
}

interface WorkoutDifficultyTrackerProps {
  memberId: string;
  coachId: string;
}

const DIFFICULTY_ORDER: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
  elite: 4,
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#6EBB7A',
  intermediate: '#F5A623',
  advanced: '#E06B4F',
  elite: '#A855F7',
};

export default function WorkoutDifficultyTracker({
  memberId,
  coachId,
}: WorkoutDifficultyTrackerProps) {
  const [entries, setEntries] = useState<DifficultyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberId || !coachId) return;

    const load = async () => {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const q = query(
          collection(db, 'workout_logs'),
          where('memberId', '==', memberId),
          where('coachId', '==', coachId),
          where('completedAt', '>=', Timestamp.fromDate(thirtyDaysAgo)),
          orderBy('completedAt', 'desc'),
          limit(30),
        );

        const snap = await getDocs(q);
        const data: DifficultyEntry[] = [];

        snap.docs.forEach((doc) => {
          const d = doc.data();
          if (!d.difficulty) return;
          const date = d.completedAt?.toDate?.()
            ? d.completedAt.toDate().toISOString().split('T')[0]
            : 'unknown';
          data.push({
            date,
            difficulty: (d.difficulty || '').toLowerCase(),
            workoutName: d.workoutName || 'Workout',
          });
        });

        // Reverse to chronological order since query is desc for limit
        setEntries(data.reverse());
      } catch (err) {
        console.error('[WorkoutDifficultyTracker] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [memberId, coachId]);

  if (loading) {
    return (
      <View style={st.container}>
        <ActivityIndicator size="small" color="#F5A623" />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={st.container}>
        <Text style={st.emptyText}>No completed workouts in the last 30 days.</Text>
      </View>
    );
  }

  // Calculate trend
  const firstHalf = entries.slice(0, Math.ceil(entries.length / 2));
  const secondHalf = entries.slice(Math.ceil(entries.length / 2));

  const avgDifficulty = (list: DifficultyEntry[]) => {
    if (list.length === 0) return 0;
    const sum = list.reduce(
      (acc, e) => acc + (DIFFICULTY_ORDER[e.difficulty] || 1),
      0,
    );
    return sum / list.length;
  };

  const firstAvg = avgDifficulty(firstHalf);
  const secondAvg = avgDifficulty(secondHalf);
  const trend = secondAvg > firstAvg ? 'up' : secondAvg < firstAvg ? 'down' : 'stable';

  // Count by difficulty
  const counts: Record<string, number> = {};
  entries.forEach((e) => {
    counts[e.difficulty] = (counts[e.difficulty] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(counts), 1);

  // S9: Auto-progression suggestion
  const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];
  const recentFive = entries.slice(-5);
  const currentLevel = recentFive.length > 0
    ? recentFive[recentFive.length - 1].difficulty
    : 'beginner';
  const currentIdx = DIFFICULTY_LEVELS.indexOf(currentLevel);
  const allSameOrHigher = recentFive.length >= 3 &&
    recentFive.every((e) => (DIFFICULTY_ORDER[e.difficulty] || 1) >= (DIFFICULTY_ORDER[currentLevel] || 1));
  const progressionSuggestion = allSameOrHigher && currentIdx < DIFFICULTY_LEVELS.length - 1
    ? DIFFICULTY_LEVELS[currentIdx + 1]
    : null;

  return (
    <View style={st.container}>
      <View style={st.header}>
        <Text style={st.title}>Difficulty Progression</Text>
        <View style={st.trendBadge}>
          <Icon
            name={trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'minus'}
            size={14}
            color={trend === 'up' ? '#6EBB7A' : trend === 'down' ? '#E06B4F' : '#8A95A3'}
          />
          <Text
            style={[
              st.trendText,
              {
                color:
                  trend === 'up' ? '#6EBB7A' : trend === 'down' ? '#E06B4F' : '#8A95A3',
              },
            ]}
          >
            {trend === 'up' ? 'Progressing' : trend === 'down' ? 'Deloading' : 'Steady'}
          </Text>
        </View>
      </View>

      <Text style={st.subtitle}>
        {entries.length} workout{entries.length !== 1 ? 's' : ''} in the last 30 days
      </Text>

      {/* S9: Auto-progression suggestion */}
      {progressionSuggestion && (
        <View style={st.suggestionBanner}>
          <Icon name="trending-up" size={14} color="#6EBB7A" />
          <Text style={st.suggestionText}>
            Ready to progress? Consider assigning {progressionSuggestion.charAt(0).toUpperCase() + progressionSuggestion.slice(1)} workouts.
          </Text>
        </View>
      )}

      {/* Difficulty distribution bars */}
      <View style={st.bars}>
        {['beginner', 'intermediate', 'advanced', 'elite'].map((level) => {
          const count = counts[level] || 0;
          const pct = count > 0 ? (count / maxCount) * 100 : 0;
          return (
            <View key={level} style={st.barRow}>
              <Text style={st.barLabel}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Text>
              <View style={st.barTrack}>
                <View
                  style={[
                    st.barFill,
                    {
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor: DIFFICULTY_COLORS[level] || '#F5A623',
                    },
                  ]}
                />
              </View>
              <Text style={st.barCount}>{count}</Text>
            </View>
          );
        })}
      </View>

      {/* Timeline chart — difficulty dots over time */}
      <Text style={st.recentLabel}>Timeline</Text>
      <View style={st.timeline}>
        <View style={st.timelineYAxis}>
          {['elite', 'advanced', 'intermediate', 'beginner'].map((lvl) => (
            <Text key={lvl} style={st.timelineYLabel}>
              {lvl.charAt(0).toUpperCase()}
            </Text>
          ))}
        </View>
        <View style={st.timelineChart}>
          {/* Grid lines */}
          {[4, 3, 2, 1].map((lvl) => (
            <View key={lvl} style={[st.timelineGridLine, { bottom: `${((lvl - 1) / 3) * 100}%` }]} />
          ))}
          {/* Data points */}
          {entries.map((e, i) => {
            const level = DIFFICULTY_ORDER[e.difficulty] || 1;
            const xPct = entries.length > 1 ? (i / (entries.length - 1)) * 100 : 50;
            const yPct = ((level - 1) / 3) * 100;
            return (
              <View
                key={`dot-${i}`}
                style={[
                  st.timelineDot,
                  {
                    left: `${xPct}%`,
                    bottom: `${yPct}%`,
                    backgroundColor: DIFFICULTY_COLORS[e.difficulty] || '#8A95A3',
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Recent entries */}
      <Text style={[st.recentLabel, { marginTop: 12 }]}>Recent</Text>
      {entries.slice(-5).reverse().map((e, i) => (
        <View key={`${e.date}-${i}`} style={st.recentRow}>
          <View
            style={[
              st.recentDot,
              { backgroundColor: DIFFICULTY_COLORS[e.difficulty] || '#8A95A3' },
            ]}
          />
          <Text style={st.recentName} numberOfLines={1}>
            {e.workoutName}
          </Text>
          <Text style={st.recentDate}>{e.date}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E2E8F0',
    fontFamily: FH,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#1E2A3A',
  },
  trendText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FB,
  },
  subtitle: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginBottom: 16,
  },
  suggestionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(110,187,122,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.25)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  suggestionText: {
    flex: 1,
    fontSize: 13,
    color: '#6EBB7A',
    fontFamily: FB,
  },
  bars: {
    gap: 8,
    marginBottom: 16,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    width: 80,
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#1E2A3A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barCount: {
    fontSize: 11,
    color: '#E2E8F0',
    fontFamily: FB,
    width: 24,
    textAlign: 'right',
  },
  recentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  recentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recentName: {
    flex: 1,
    fontSize: 13,
    color: '#E2E8F0',
    fontFamily: FB,
  },
  recentDate: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  timeline: {
    flexDirection: 'row',
    height: 80,
    marginBottom: 8,
  },
  timelineYAxis: {
    width: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  timelineYLabel: {
    fontSize: 9,
    color: '#6B7280',
    fontFamily: FB,
  },
  timelineChart: {
    flex: 1,
    position: 'relative',
    marginLeft: 8,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#252B3B',
  },
  timelineGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#1E2A3A',
  },
  timelineDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
    marginBottom: -4,
  },
  emptyText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
