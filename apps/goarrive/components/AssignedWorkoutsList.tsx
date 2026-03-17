/**
 * AssignedWorkoutsList — Displays workouts assigned to a member
 *
 * Renders inside MemberDetail as a section showing upcoming and past
 * workout assignments with status badges and unassign capability.
 *
 * Reads from Firestore collection: workout_assignments
 * Schema: id, memberId, coachId, workoutId, workoutName, scheduledFor,
 *         status ('scheduled' | 'completed'), createdAt
 *
 * Slice 1, Week 5 — Workout Assignment
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Icon } from './Icon';
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AssignmentItem {
  id: string;
  memberId: string;
  coachId: string;
  workoutId: string;
  workoutName: string;
  scheduledFor: any; // Firestore Timestamp
  status: 'scheduled' | 'completed';
  createdAt: any;
}

interface Props {
  memberId: string;
  coachId: string;
  refreshTrigger?: number; // increment to force reload
  onUnassign?: (assignment: AssignmentItem) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(ts: any): string {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function isUpcoming(ts: any): boolean {
  if (!ts) return false;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d >= today;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AssignedWorkoutsList({
  memberId,
  coachId,
  refreshTrigger = 0,
  onUnassign,
}: Props) {
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<AssignmentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // NEXT-C: Sort state
  type SortKey = 'newest' | 'oldest' | 'name';
  const [sortBy, setSortBy] = useState<SortKey>('newest');

  const loadAssignments = useCallback(async () => {
    if (!memberId || !coachId) return;
    try {
      const q = query(
        collection(db, 'workout_assignments'),
        where('memberId', '==', memberId),
        where('coachId', '==', coachId),
        orderBy('scheduledFor', 'desc'),
      );
      const snap = await getDocs(q);
      setAssignments(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            memberId: data.memberId ?? '',
            coachId: data.coachId ?? '',
            workoutId: data.workoutId ?? '',
            workoutName: data.workoutName ?? 'Untitled',
            scheduledFor: data.scheduledFor,
            status: data.status ?? 'scheduled',
            createdAt: data.createdAt,
          };
        }),
      );
    } catch (err) {
      console.error('Failed to load assignments:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [memberId, coachId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments, refreshTrigger]);

  function requestUnassign(a: AssignmentItem) {
    if (Platform.OS === 'web') {
      // Web: use window.confirm for confirmation
      const ok = window.confirm(
        `Remove "${a.workoutName}" from this member's schedule?`,
      );
      if (ok) executeUnassign(a);
    } else {
      // Native: use Alert.alert
      Alert.alert(
        'Unassign Workout',
        `Remove "${a.workoutName}" from this member's schedule?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => executeUnassign(a),
          },
        ],
      );
    }
  }

  async function executeUnassign(a: AssignmentItem) {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'workout_assignments', a.id));
      setAssignments((prev) => prev.filter((x) => x.id !== a.id));
      if (onUnassign) onUnassign(a);
    } catch (err) {
      console.error('Failed to unassign workout:', err);
      if (Platform.OS === 'web') {
        window.alert('Failed to unassign workout. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to unassign workout. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Assigned Workouts</Text>
        {/* Skeleton loading */}
        {[1, 2].map((i) => (
          <View key={i} style={s.skeletonCard}>
            <View style={s.skeletonIcon} />
            <View style={s.skeletonInfo}>
              <View style={s.skeletonLine} />
              <View style={[s.skeletonLine, s.skeletonLineShort]} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Assigned Workouts</Text>
        <View style={s.errorWrap}>
          <Icon name="warning" size={24} color="#E05252" />
          <Text style={s.errorText}>Failed to load assignments.</Text>
          <Pressable
            onPress={() => {
              setError(false);
              setLoading(true);
              loadAssignments();
            }}
            style={s.retryBtn}
          >
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // NEXT-C: Sort helper
  function sortedList(list: AssignmentItem[]): AssignmentItem[] {
    return [...list].sort((a, b) => {
      if (sortBy === 'name') {
        return a.workoutName.localeCompare(b.workoutName);
      }
      const aTime = a.scheduledFor?.toDate ? a.scheduledFor.toDate() : new Date(a.scheduledFor ?? 0);
      const bTime = b.scheduledFor?.toDate ? b.scheduledFor.toDate() : new Date(b.scheduledFor ?? 0);
      return sortBy === 'oldest'
        ? aTime.getTime() - bTime.getTime()
        : bTime.getTime() - aTime.getTime();
    });
  }

  const upcoming = sortedList(
    assignments.filter((a) => a.status === 'scheduled' && isUpcoming(a.scheduledFor)),
  );
  const past = sortedList(
    assignments.filter((a) => a.status === 'completed' || !isUpcoming(a.scheduledFor)),
  );

  const SORT_OPTS: Array<{ key: SortKey; label: string; icon: string }> = [
    { key: 'newest', label: 'Newest', icon: 'chevron-down' },
    { key: 'oldest', label: 'Oldest', icon: 'chevron-down' },
    { key: 'name', label: 'Name', icon: 'sort' },
  ];

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>
        Assigned Workouts ({assignments.length})
      </Text>

      {/* NEXT-C: Sort chips */}
      {assignments.length > 1 && (
        <View style={s.sortRow}>
          {SORT_OPTS.map((opt) => (
            <Pressable
              key={opt.key}
              style={[s.sortChip, sortBy === opt.key && s.sortChipActive]}
              onPress={() => setSortBy(opt.key)}
            >
              <Icon
                name={opt.icon as any}
                size={11}
                color={sortBy === opt.key ? '#F5A623' : '#4A5568'}
              />
              <Text
                style={[
                  s.sortChipText,
                  sortBy === opt.key && s.sortChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {assignments.length === 0 ? (
        <View style={s.emptyWrap}>
          <Icon name="calendar" size={24} color="#2A3040" />
          <Text style={s.emptyText}>No workouts assigned yet.</Text>
        </View>
      ) : (
        <>
          {/* Upcoming */}
          {upcoming.length > 0 && (
            <>
              <Text style={s.subLabel}>Upcoming</Text>
              {upcoming.map((a) => (
                <View key={a.id} style={s.assignmentCard}>
                  <View style={s.assignmentIcon}>
                    <Icon name="workouts" size={16} color="#F5A623" />
                  </View>
                  <View style={s.assignmentInfo}>
                    <Text style={s.assignmentName} numberOfLines={1}>
                      {a.workoutName}
                    </Text>
                    <Text style={s.assignmentDate}>
                      {formatDate(a.scheduledFor)}
                    </Text>
                  </View>
                  <View style={s.statusBadge}>
                    <Text style={s.statusText}>Scheduled</Text>
                  </View>
                  <Pressable
                    onPress={() => requestUnassign(a)}
                    hitSlop={8}
                    style={s.unassignBtn}
                  >
                    <Icon name="x-circle" size={18} color="#E05252" />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {/* Past */}
          {past.length > 0 && (
            <>
              <Text style={s.subLabel}>Past</Text>
              {past.map((a) => (
                <View key={a.id} style={[s.assignmentCard, s.pastCard]}>
                  <View style={[s.assignmentIcon, s.pastIcon]}>
                    <Icon name="workouts" size={16} color="#4A5568" />
                  </View>
                  <View style={s.assignmentInfo}>
                    <Text style={[s.assignmentName, s.pastName]} numberOfLines={1}>
                      {a.workoutName}
                    </Text>
                    <Text style={s.assignmentDate}>
                      {formatDate(a.scheduledFor)}
                    </Text>
                  </View>
                  <View style={[s.statusBadge, a.status === 'completed' ? s.completedBadge : s.pastBadge]}>
                    <Text style={[s.statusText, a.status === 'completed' ? s.completedText : s.pastStatusText]}>
                      {a.status === 'completed' ? 'Done' : 'Past'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => requestUnassign(a)}
                    hitSlop={8}
                    style={s.unassignBtn}
                  >
                    <Icon name="trash" size={16} color="#4A5568" />
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  emptyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  emptyText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  assignmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  pastCard: {
    opacity: 0.7,
  },
  assignmentIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pastIcon: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  assignmentInfo: {
    flex: 1,
  },
  assignmentName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  pastName: {
    color: '#8A95A3',
  },
  assignmentDate: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginTop: 2,
  },
  statusBadge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pastBadge: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  completedBadge: {
    backgroundColor: 'rgba(110,187,122,0.12)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pastStatusText: {
    color: '#4A5568',
  },
  completedText: {
    color: '#6EBB7A',
  },
  unassignBtn: {
    padding: 4,
  },
  // Skeleton styles
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    gap: 10,
  },
  skeletonIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonInfo: {
    flex: 1,
    gap: 6,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    width: '70%',
  },
  skeletonLineShort: {
    width: '40%',
  },
  // Error styles
  errorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(224,82,82,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.15)',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#E05252',
    fontFamily: FONT_BODY,
  },
  retryBtn: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  // NEXT-C: Sort chip styles
  sortRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  sortChipActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.2)',
  },
  sortChipText: {
    fontSize: 10,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  sortChipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },
});
