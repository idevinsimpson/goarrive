/**
 * CoachWorkoutCalendar — Weekly calendar view of all workout assignments (Suggestion 4)
 *
 * Shows a bird's-eye view of all assignments across all members for the week.
 * Coaches managing 10+ members can see at a glance who has what scheduled.
 *
 * Props:
 *   - coachId: string
 *   - visible: boolean
 *   - onClose: () => void
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
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
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface CoachWorkoutCalendarProps {
  coachId: string;
  visible: boolean;
  onClose: () => void;
}

interface Assignment {
  id: string;
  memberId: string;
  memberName: string;
  workoutName: string;
  scheduledFor: Date;
  status: string;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CoachWorkoutCalendar({
  coachId,
  visible,
  onClose,
}: CoachWorkoutCalendarProps) {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this week, 1 = next, -1 = prev

  // Calculate week start (Monday) and end (Sunday)
  const { weekStart, weekEnd, weekLabel } = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMon + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const label = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

    return { weekStart: monday, weekEnd: sunday, weekLabel: label };
  }, [weekOffset]);

  // Fetch assignments for the week
  useEffect(() => {
    if (!visible || !coachId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, 'workout_assignments'),
            where('coachId', '==', coachId),
            where('scheduledFor', '>=', Timestamp.fromDate(weekStart)),
            where('scheduledFor', '<=', Timestamp.fromDate(weekEnd)),
            orderBy('scheduledFor', 'asc'),
          ),
        );

        if (cancelled) return;

        const list: Assignment[] = snap.docs.map((d) => {
          const data = d.data();
          const sf = data.scheduledFor?.toDate ? data.scheduledFor.toDate() : new Date(data.scheduledFor);
          return {
            id: d.id,
            memberId: data.memberId || '',
            memberName: data.memberName || 'Member',
            workoutName: data.workoutName || 'Workout',
            scheduledFor: sf,
            status: data.status || 'scheduled',
          };
        });

        setAssignments(list);
      } catch (err) {
        console.error('[CoachWorkoutCalendar] Fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, coachId, weekStart, weekEnd]);

  // Group assignments by day of week (0=Mon ... 6=Sun)
  const dayGroups = useMemo(() => {
    const groups: Assignment[][] = [[], [], [], [], [], [], []];
    assignments.forEach((a) => {
      const jsDay = a.scheduledFor.getDay(); // 0=Sun
      const idx = jsDay === 0 ? 6 : jsDay - 1; // Convert to Mon=0
      groups[idx].push(a);
    });
    return groups;
  }, [assignments]);

  // Get the date for each day column
  const dayDates = useMemo(() => {
    return DAY_LABELS.map((_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const isToday = (date: Date) => {
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} style={st.backBtn}>
            <Icon name="x" size={22} color="#F0F4F8" />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Workout Calendar</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Week navigation */}
        <View style={st.weekNav}>
          <TouchableOpacity onPress={() => setWeekOffset((o) => o - 1)} style={st.navBtn}>
            <Icon name="chevron-left" size={20} color="#F0F4F8" />
          </TouchableOpacity>
          <Text style={st.weekLabel}>{weekLabel}</Text>
          <TouchableOpacity onPress={() => setWeekOffset((o) => o + 1)} style={st.navBtn}>
            <Icon name="chevron-right" size={20} color="#F0F4F8" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator color="#F5A623" size="large" />
          </View>
        ) : (
          <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent}>
            {DAY_LABELS.map((label, i) => {
              const dayAssignments = dayGroups[i];
              const date = dayDates[i];
              const today = isToday(date);

              return (
                <View key={i} style={[st.dayRow, today && st.dayRowToday]}>
                  <View style={st.dayLabelCol}>
                    <Text style={[st.dayLabel, today && st.dayLabelToday]}>{label}</Text>
                    <Text style={[st.dayDate, today && st.dayDateToday]}>
                      {date.getDate()}
                    </Text>
                  </View>
                  <View style={st.dayContent}>
                    {dayAssignments.length === 0 ? (
                      <Text style={st.emptyDay}>—</Text>
                    ) : (
                      dayAssignments.map((a) => (
                        <View
                          key={a.id}
                          style={[
                            st.assignmentChip,
                            a.status === 'completed' && st.assignmentCompleted,
                          ]}
                        >
                          <Text style={st.assignmentMember} numberOfLines={1}>
                            {a.memberName}
                          </Text>
                          <Text style={st.assignmentWorkout} numberOfLines={1}>
                            {a.workoutName}
                          </Text>
                          {a.status === 'completed' && (
                            <Icon name="check-circle" size={12} color="#6EBB7A" />
                          )}
                        </View>
                      ))
                    )}
                  </View>
                </View>
              );
            })}

            {/* Summary */}
            <View style={st.summary}>
              <Text style={st.summaryText}>
                {assignments.length} assignment{assignments.length !== 1 ? 's' : ''} this week ·{' '}
                {assignments.filter((a) => a.status === 'completed').length} completed
              </Text>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 16,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1E2A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    minWidth: 160,
    textAlign: 'center',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  dayRow: {
    flexDirection: 'row',
    marginBottom: 2,
    borderRadius: 10,
    padding: 10,
  },
  dayRowToday: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#F5A623',
  },
  dayLabelCol: {
    width: 44,
    alignItems: 'center',
    marginRight: 12,
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  dayLabelToday: {
    color: '#F5A623',
  },
  dayDate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  dayDateToday: {
    color: '#F5A623',
  },
  dayContent: {
    flex: 1,
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
  },
  emptyDay: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
  },
  assignmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  assignmentCompleted: {
    backgroundColor: '#1A2E1A',
    borderWidth: 1,
    borderColor: '#2D4A2D',
  },
  assignmentMember: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    maxWidth: 100,
  },
  assignmentWorkout: {
    flex: 1,
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  summary: {
    marginTop: 16,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
});
