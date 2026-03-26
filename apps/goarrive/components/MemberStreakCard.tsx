/**
 * MemberStreakCard — Shows workout streak and weekly consistency for a member
 *
 * Displays:
 *   - Current streak (consecutive days with a completed workout)
 *   - Best streak (all-time)
 *   - This week's completion dots (Mon–Sun)
 *   - Weekly consistency percentage
 *
 * Reads from workout_logs collection filtered by memberId.
 */
import React, { useState, useEffect } from 'react';
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
  getDocs,
  Timestamp,
} from 'firebase/firestore';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface Props {
  memberId: string;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function MemberStreakCard({ memberId }: Props) {
  const [loading, setLoading] = useState(true);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [weekDots, setWeekDots] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const [weekPct, setWeekPct] = useState(0);

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;

    (async () => {
      try {
        // Risk 7: Limit query to last 90 days to avoid expensive full-collection
        // scans for members with hundreds of completed workouts.
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        ninetyDaysAgo.setHours(0, 0, 0, 0);

        const snap = await getDocs(
          query(
            collection(db, 'workout_logs'),
            where('memberId', '==', memberId),
            where('completedAt', '>=', Timestamp.fromDate(ninetyDaysAgo)),
            orderBy('completedAt', 'desc'),
          ),
        );

        if (cancelled) return;

        // Collect unique completion dates (YYYY-MM-DD)
        const completionDates = new Set<string>();
        snap.docs.forEach((d) => {
          const ca = d.data().completedAt;
          if (!ca) return;
          const date = ca.toDate ? ca.toDate() : new Date(ca);
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          completionDates.add(key);
        });

        // Sort dates descending
        const sorted = Array.from(completionDates).sort().reverse();

        // Calculate current streak
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkDate = new Date(today);

        // Check if today has a workout; if not, start from yesterday
        const todayKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        if (!completionDates.has(todayKey)) {
          checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
          const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
          if (completionDates.has(key)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }

        // Calculate best streak
        let best = 0;
        let current = 0;
        const sortedAsc = Array.from(completionDates).sort();
        for (let i = 0; i < sortedAsc.length; i++) {
          if (i === 0) {
            current = 1;
          } else {
            const prev = new Date(sortedAsc[i - 1]);
            const curr = new Date(sortedAsc[i]);
            const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
            if (diff === 1) {
              current++;
            } else {
              current = 1;
            }
          }
          best = Math.max(best, current);
        }

        // This week's dots (Mon=0 ... Sun=6)
        const monday = new Date(today);
        const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
        const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        monday.setDate(today.getDate() - daysFromMon);
        monday.setHours(0, 0, 0, 0);

        const dots: boolean[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          dots.push(completionDates.has(key));
        }

        const completed = dots.filter(Boolean).length;
        // Only count days up to today for percentage
        const daysElapsed = daysFromMon + 1; // days from Mon through today
        const pct = daysElapsed > 0 ? Math.round((completed / daysElapsed) * 100) : 0;

        setCurrentStreak(streak);
        setBestStreak(best);
        setWeekDots(dots);
        setWeekPct(pct);
      } catch (err) {
        console.error('MemberStreakCard fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [memberId]);

  if (loading) {
    return (
      <View style={st.card}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  return (
    <View style={st.card}>
      {/* Streak numbers */}
      <View style={st.streakRow}>
        <View style={st.streakItem}>
          <Text style={st.streakNum}>{currentStreak}</Text>
          <Text style={st.streakLabel}>Current{'\n'}Streak</Text>
        </View>
        <View style={st.streakDivider} />
        <View style={st.streakItem}>
          <Text style={st.streakNum}>{bestStreak}</Text>
          <Text style={st.streakLabel}>Best{'\n'}Streak</Text>
        </View>
        <View style={st.streakDivider} />
        <View style={st.streakItem}>
          <Text style={[st.streakNum, { color: weekPct >= 80 ? '#6EBB7A' : weekPct >= 50 ? '#F5A623' : '#E05252' }]}>
            {weekPct}%
          </Text>
          <Text style={st.streakLabel}>This{'\n'}Week</Text>
        </View>
      </View>

      {/* Welcome-back / motivational message (Risk 4) */}
      {currentStreak === 0 && bestStreak > 0 && (
        <Text style={st.welcomeBack}>
          Welcome back! Your best streak was {bestStreak} day{bestStreak !== 1 ? 's' : ''}. Let's build a new one.
        </Text>
      )}
      {currentStreak === 0 && bestStreak === 0 && (
        <Text style={st.welcomeBack}>
          Complete your first workout to start your streak!
        </Text>
      )}
      {currentStreak >= 3 && (
        <Text style={st.streakMotivation}>
          {currentStreak >= 7 ? 'On fire! ' : 'Nice momentum! '}
          Keep it going.
        </Text>
      )}

      {/* Week dots */}
      <View style={st.dotsRow}>
        {DAY_LABELS.map((label, i) => (
          <View key={i} style={st.dotCol}>
            <View
              style={[
                st.dot,
                weekDots[i] && st.dotActive,
              ]}
            />
            <Text style={st.dotLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 16,
    marginBottom: 16,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    marginBottom: 16,
  },
  streakItem: {
    alignItems: 'center',
    flex: 1,
  },
  streakDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#1E2A3A',
  },
  streakNum: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  streakLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 14,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  dotCol: {
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1E2A3A',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  dotActive: {
    backgroundColor: '#6EBB7A',
    borderColor: '#6EBB7A',
  },
  welcomeBack: {
    fontSize: 12,
    color: '#94A3B8',
    fontFamily: FB,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  streakMotivation: {
    fontSize: 12,
    color: '#6EBB7A',
    fontFamily: FB,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  dotLabel: {
    fontSize: 10,
    color: '#4A5568',
    fontFamily: FB,
    fontWeight: '600',
  },
});
