/**
 * WorkoutCalendarStrip — Horizontal week calendar for member workouts
 *
 * Shows a scrollable 2-week strip (7 days back + 7 days forward).
 * Each day shows a dot indicator:
 *   - Gold dot = workout scheduled for that day
 *   - Green dot = workout completed
 *   - Red dot = missed (past + still scheduled)
 *   - No dot = no workout
 *
 * Tapping a day scrolls the main list to that day's section.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent.
 */
import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { FB, FH } from '../lib/theme';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface Assignment {
  scheduledFor: string; // YYYY-MM-DD
  status: string;
}

interface WorkoutCalendarStripProps {
  assignments: Assignment[];
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

export default function WorkoutCalendarStrip({
  assignments,
  selectedDate,
  onSelectDate,
}: WorkoutCalendarStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const today = todayStr();

  // Generate 14-day range: 7 days back + today + 6 days forward
  const days: string[] = [];
  const baseDate = new Date();
  for (let i = -7; i <= 6; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + i);
    days.push(toDateStr(d));
  }

  // Build lookup: date → status
  const dateStatus: Record<string, 'scheduled' | 'completed' | 'missed'> = {};
  assignments.forEach((a) => {
    const existing = dateStatus[a.scheduledFor];
    if (a.status === 'completed') {
      dateStatus[a.scheduledFor] = 'completed';
    } else if (a.status === 'scheduled') {
      if (a.scheduledFor < today && existing !== 'completed') {
        dateStatus[a.scheduledFor] = 'missed';
      } else if (existing !== 'completed') {
        dateStatus[a.scheduledFor] = 'scheduled';
      }
    }
  });

  // Auto-scroll to today on mount
  useEffect(() => {
    const todayIndex = days.indexOf(today);
    if (todayIndex >= 0 && scrollRef.current) {
      // Each day cell is 52px wide + 4px margin = 56px
      const offset = Math.max(0, todayIndex * 56 - 120);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: offset, animated: false });
      }, 100);
    }
  }, []);

  return (
    <View style={st.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.scrollContent}
      >
        {days.map((dateStr) => {
          const d = new Date(dateStr + 'T12:00:00');
          const dayName = DAY_NAMES[d.getDay()];
          const dayNum = d.getDate();
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const status = dateStatus[dateStr];

          // Show month label on 1st of month or first day in strip
          const showMonth =
            dayNum === 1 || dateStr === days[0];

          return (
            <Pressable
              key={dateStr}
              style={[
                st.dayCell,
                isToday && st.dayCellToday,
                isSelected && st.dayCellSelected,
              ]}
              onPress={() => onSelectDate(dateStr)}
            >
              {showMonth && (
                <Text style={st.monthLabel}>
                  {MONTH_NAMES[d.getMonth()]}
                </Text>
              )}
              <Text
                style={[
                  st.dayName,
                  isToday && st.dayNameToday,
                ]}
              >
                {dayName}
              </Text>
              <Text
                style={[
                  st.dayNum,
                  isToday && st.dayNumToday,
                  isSelected && st.dayNumSelected,
                ]}
              >
                {dayNum}
              </Text>
              {status && (
                <View
                  style={[
                    st.dot,
                    status === 'completed' && st.dotCompleted,
                    status === 'missed' && st.dotMissed,
                    status === 'scheduled' && st.dotScheduled,
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 4,
  },
  dayCell: {
    width: 52,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
  },
  dayCellToday: {
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  dayCellSelected: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  monthLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  dayName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FB,
    marginBottom: 4,
  },
  dayNameToday: {
    color: '#F5A623',
  },
  dayNum: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
  },
  dayNumToday: {
    color: '#F0F4F8',
  },
  dayNumSelected: {
    color: '#F5A623',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 4,
  },
  dotScheduled: {
    backgroundColor: '#F5A623',
  },
  dotCompleted: {
    backgroundColor: '#6EBB7A',
  },
  dotMissed: {
    backgroundColor: '#E53E3E',
  },
});
