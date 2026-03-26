/**
 * Member Workouts — Assigned workout list + player launch + Glow/Grow journal
 *
 * Queries workout_assignments for the current member.
 * Shows today's workouts prominently, upcoming workouts below.
 * Tapping "Start Workout" launches the existing WorkoutPlayer.
 * On completion, shows PostWorkoutJournal for Glow/Grow reflection.
 * Then updates assignment status and writes a workout_log with journal data.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { Icon } from '../../components/Icon';
import WorkoutPlayer from '../../components/WorkoutPlayer';
import PostWorkoutJournal, { JournalEntry } from '../../components/PostWorkoutJournal';

// ── Constants ──────────────────────────────────────────────────────────────
const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Types ──────────────────────────────────────────────────────────────────
interface AssignedWorkout {
  id: string;
  workoutId: string;
  workoutName: string;
  scheduledFor: string; // YYYY-MM-DD
  status: string; // scheduled | completed | skipped
  assignedAt: any;
  completedAt?: any;
  /** Snapshot of workout data at assignment time (versioning) */
  workoutSnapshot?: any;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function isToday(dateStr: string): boolean {
  return dateStr === todayString();
}

function isPast(dateStr: string): boolean {
  return dateStr < todayString();
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MemberWorkoutsScreen() {
  const { user } = useAuth();
  const memberId = user?.uid ?? '';

  const [assignments, setAssignments] = useState<AssignedWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Player state
  const [playerVisible, setPlayerVisible] = useState(false);
  const [playerWorkout, setPlayerWorkout] = useState<any>(null);
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null);
  const [loadingWorkout, setLoadingWorkout] = useState<string | null>(null);

  // Journal state
  const [journalVisible, setJournalVisible] = useState(false);
  const [completedDuration, setCompletedDuration] = useState(0);
  const [completedWorkoutName, setCompletedWorkoutName] = useState('');

  // Duration tracking
  const workoutStartTime = useRef<number | null>(null);

  // ── Real-time listener for assignments ────────────────────────────────
  useEffect(() => {
    if (!memberId) return;

    const q = query(
      collection(db, 'workout_assignments'),
      where('memberId', '==', memberId),
      orderBy('scheduledFor', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: AssignedWorkout[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            workoutId: data.workoutId ?? '',
            workoutName: data.workoutName ?? 'Workout',
            scheduledFor: data.scheduledFor ?? '',
            status: data.status ?? 'scheduled',
            assignedAt: data.assignedAt,
            completedAt: data.completedAt,
            workoutSnapshot: data.workoutSnapshot ?? null,
          };
        });
        setAssignments(list);
        setLoading(false);
        setRefreshing(false);
      },
      (err) => {
        console.error('[MemberWorkouts] Listener error:', err);
        setLoading(false);
        setRefreshing(false);
      },
    );

    return () => unsub();
  }, [memberId]);

  // ── Start workout ─────────────────────────────────────────────────────
  const handleStartWorkout = useCallback(
    async (assignment: AssignedWorkout) => {
      setLoadingWorkout(assignment.id);
      try {
        let workoutData: any = null;

        // Prefer the versioned snapshot if available
        if (assignment.workoutSnapshot) {
          workoutData = assignment.workoutSnapshot;
        } else {
          // Fallback: fetch the live workout document
          const workoutDoc = await getDoc(doc(db, 'workouts', assignment.workoutId));
          if (workoutDoc.exists()) {
            workoutData = { id: workoutDoc.id, ...workoutDoc.data() };
          }
        }

        if (!workoutData) {
          Alert.alert('Workout Not Found', 'This workout may have been removed by your coach.');
          return;
        }

        // Ensure the workout has a name and blocks for the player
        if (!workoutData.name) workoutData.name = assignment.workoutName;
        if (!workoutData.blocks) workoutData.blocks = [];

        setPlayerWorkout(workoutData);
        setActiveAssignmentId(assignment.id);
        workoutStartTime.current = Date.now();
        setPlayerVisible(true);
      } catch (err) {
        console.error('[MemberWorkouts] Failed to load workout:', err);
        Alert.alert('Error', 'Could not load workout. Please try again.');
      } finally {
        setLoadingWorkout(null);
      }
    },
    [],
  );

  // ── Player complete → show journal ────────────────────────────────────
  const handlePlayerComplete = useCallback(() => {
    const durationSec = workoutStartTime.current
      ? Math.round((Date.now() - workoutStartTime.current) / 1000)
      : 0;

    setCompletedDuration(durationSec);
    setCompletedWorkoutName(playerWorkout?.name ?? 'Workout');
    setPlayerVisible(false);
    setJournalVisible(true);
  }, [playerWorkout]);

  // ── Journal submit → write log ────────────────────────────────────────
  const handleJournalSubmit = useCallback(
    async (journal: JournalEntry) => {
      if (!activeAssignmentId || !memberId) return;

      const durationSec = completedDuration;

      try {
        // Update assignment status
        await updateDoc(doc(db, 'workout_assignments', activeAssignmentId), {
          status: 'completed',
          completedAt: serverTimestamp(),
        });

        // Write workout log with journal data
        await addDoc(collection(db, 'workout_logs'), {
          memberId,
          assignmentId: activeAssignmentId,
          workoutId: playerWorkout?.id ?? '',
          workoutName: playerWorkout?.name ?? '',
          coachId: playerWorkout?.coachId ?? '',
          completedAt: serverTimestamp(),
          durationSec,
          // Journal fields
          journal: {
            glow: journal.glow || '',
            grow: journal.grow || '',
            energyRating: journal.energyRating,
            moodRating: journal.moodRating,
          },
          // Coach review status
          reviewStatus: 'pending', // pending | reviewed
          reviewedAt: null,
          coachNote: '',
        });
      } catch (err) {
        console.error('[MemberWorkouts] Failed to log completion:', err);
      }

      // Clean up
      setJournalVisible(false);
      setPlayerWorkout(null);
      setActiveAssignmentId(null);
      workoutStartTime.current = null;
    },
    [activeAssignmentId, memberId, playerWorkout, completedDuration],
  );

  // ── Journal skip → write log without journal ──────────────────────────
  const handleJournalSkip = useCallback(async () => {
    if (!activeAssignmentId || !memberId) return;

    const durationSec = completedDuration;

    try {
      await updateDoc(doc(db, 'workout_assignments', activeAssignmentId), {
        status: 'completed',
        completedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'workout_logs'), {
        memberId,
        assignmentId: activeAssignmentId,
        workoutId: playerWorkout?.id ?? '',
        workoutName: playerWorkout?.name ?? '',
        coachId: playerWorkout?.coachId ?? '',
        completedAt: serverTimestamp(),
        durationSec,
        journal: null,
        reviewStatus: 'pending',
        reviewedAt: null,
        coachNote: '',
      });
    } catch (err) {
      console.error('[MemberWorkouts] Failed to log skip:', err);
    }

    setJournalVisible(false);
    setPlayerWorkout(null);
    setActiveAssignmentId(null);
    workoutStartTime.current = null;
  }, [activeAssignmentId, memberId, playerWorkout, completedDuration]);

  // ── Categorize assignments ────────────────────────────────────────────
  const today = todayString();
  const todayWorkouts = assignments.filter(
    (a) => a.scheduledFor === today && a.status === 'scheduled',
  );
  const upcomingWorkouts = assignments.filter(
    (a) => a.scheduledFor > today && a.status === 'scheduled',
  );
  const completedWorkouts = assignments.filter((a) => a.status === 'completed');
  const missedWorkouts = assignments.filter(
    (a) => isPast(a.scheduledFor) && a.status === 'scheduled' && a.scheduledFor !== today,
  );

  // ── Render helpers ────────────────────────────────────────────────────
  const renderTodayCard = (item: AssignedWorkout) => {
    const isLoading = loadingWorkout === item.id;
    return (
      <View key={item.id} style={s.todayCard}>
        <View style={s.todayCardHeader}>
          <View style={s.todayIconWrap}>
            <Icon name="workouts" size={24} color="#F5A623" />
          </View>
          <View style={s.todayCardInfo}>
            <Text style={s.todayCardName} numberOfLines={2}>
              {item.workoutName}
            </Text>
            <Text style={s.todayCardMeta}>Scheduled for today</Text>
          </View>
        </View>

        <Pressable
          style={[s.startButton, isLoading && s.startButtonDisabled]}
          onPress={() => handleStartWorkout(item)}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#0E1117" />
          ) : (
            <>
              <Icon name="play" size={20} color="#0E1117" />
              <Text style={s.startButtonText}>Start Workout</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  const renderAssignmentCard = ({
    item,
    section,
  }: {
    item: AssignedWorkout;
    section: 'upcoming' | 'completed' | 'missed';
  }) => (
    <View style={s.assignmentCard} key={item.id}>
      <View style={s.assignmentIconWrap}>
        <Icon
          name={section === 'completed' ? 'check-circle' : 'workouts'}
          size={20}
          color={
            section === 'completed'
              ? '#6EBB7A'
              : section === 'missed'
              ? '#E53E3E'
              : '#F5A623'
          }
        />
      </View>
      <View style={s.assignmentInfo}>
        <Text style={s.assignmentName} numberOfLines={1}>
          {item.workoutName}
        </Text>
        <Text style={s.assignmentMeta}>
          {section === 'completed'
            ? `Completed · ${formatDate(item.scheduledFor)}`
            : section === 'missed'
            ? `Missed · ${formatDate(item.scheduledFor)}`
            : formatDate(item.scheduledFor)}
        </Text>
      </View>
      {section === 'upcoming' && (
        <Pressable
          style={s.miniStartBtn}
          onPress={() => handleStartWorkout(item)}
          disabled={loadingWorkout === item.id}
        >
          {loadingWorkout === item.id ? (
            <ActivityIndicator size="small" color="#F5A623" />
          ) : (
            <Icon name="play" size={16} color="#F5A623" />
          )}
        </Pressable>
      )}
      {section === 'missed' && (
        <Pressable
          style={s.miniStartBtn}
          onPress={() => handleStartWorkout(item)}
          disabled={loadingWorkout === item.id}
        >
          {loadingWorkout === item.id ? (
            <ActivityIndicator size="small" color="#F5A623" />
          ) : (
            <Text style={s.makeUpText}>Make Up</Text>
          )}
        </Pressable>
      )}
    </View>
  );

  // ── Build sections for FlatList ───────────────────────────────────────
  type SectionItem =
    | { type: 'header'; title: string; count: number }
    | { type: 'today'; item: AssignedWorkout }
    | { type: 'card'; item: AssignedWorkout; section: 'upcoming' | 'completed' | 'missed' }
    | { type: 'empty' };

  const sections: SectionItem[] = [];

  // Today section
  if (todayWorkouts.length > 0) {
    sections.push({ type: 'header', title: "Today's Workouts", count: todayWorkouts.length });
    todayWorkouts.forEach((item) => sections.push({ type: 'today', item }));
  }

  // Missed section
  if (missedWorkouts.length > 0) {
    sections.push({ type: 'header', title: 'Missed', count: missedWorkouts.length });
    missedWorkouts.forEach((item) =>
      sections.push({ type: 'card', item, section: 'missed' }),
    );
  }

  // Upcoming section
  if (upcomingWorkouts.length > 0) {
    sections.push({ type: 'header', title: 'Upcoming', count: upcomingWorkouts.length });
    upcomingWorkouts.forEach((item) =>
      sections.push({ type: 'card', item, section: 'upcoming' }),
    );
  }

  // Completed section
  if (completedWorkouts.length > 0) {
    sections.push({ type: 'header', title: 'Completed', count: completedWorkouts.length });
    completedWorkouts.forEach((item) =>
      sections.push({ type: 'card', item, section: 'completed' }),
    );
  }

  // Empty state
  if (sections.length === 0 && !loading) {
    sections.push({ type: 'empty' });
  }

  const renderSectionItem = ({ item: si }: { item: SectionItem }) => {
    switch (si.type) {
      case 'header':
        return (
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{si.title}</Text>
            <View style={s.sectionBadge}>
              <Text style={s.sectionBadgeText}>{si.count}</Text>
            </View>
          </View>
        );
      case 'today':
        return renderTodayCard(si.item);
      case 'card':
        return renderAssignmentCard({ item: si.item, section: si.section });
      case 'empty':
        return (
          <View style={s.emptyWrap}>
            <Icon name="workouts" size={56} color="#2A3040" />
            <Text style={s.emptyTitle}>No Workouts Yet</Text>
            <Text style={s.emptyText}>
              Your coach hasn't assigned any workouts yet. Check back soon!
            </Text>
          </View>
        );
      default:
        return null;
    }
  };

  // ── Main render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>My Workouts</Text>
        {todayWorkouts.length > 0 && (
          <View style={s.todayBadge}>
            <Text style={s.todayBadgeText}>
              {todayWorkouts.length} today
            </Text>
          </View>
        )}
      </View>

      <FlatList
        data={sections}
        renderItem={renderSectionItem}
        keyExtractor={(item, index) => {
          if (item.type === 'today' || item.type === 'card') return item.item.id;
          if (item.type === 'header') return `header-${item.title}-${index}`;
          return `empty-${index}`;
        }}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => setRefreshing(true)}
            tintColor="#F5A623"
            colors={['#F5A623']}
          />
        }
      />

      {/* Workout Player */}
      {playerWorkout && playerVisible && (
        <WorkoutPlayer
          visible={playerVisible}
          workout={playerWorkout}
          onClose={() => {
            setPlayerVisible(false);
            setPlayerWorkout(null);
            setActiveAssignmentId(null);
            workoutStartTime.current = null;
          }}
          onComplete={handlePlayerComplete}
        />
      )}

      {/* Post-Workout Journal */}
      <PostWorkoutJournal
        visible={journalVisible}
        workoutName={completedWorkoutName}
        durationSeconds={completedDuration}
        onSubmit={handleJournalSubmit}
        onSkip={handleJournalSkip}
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.select({ ios: 60, android: 48, web: 24, default: 24 }),
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  todayBadge: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  todayBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  listContent: {
    padding: 20,
    paddingBottom: 120,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FB,
  },

  // Today card — prominent
  todayCard: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  todayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  todayIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCardInfo: {
    flex: 1,
  },
  todayCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  todayCardMeta: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    paddingVertical: 14,
    borderRadius: 14,
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },

  // Assignment card — compact
  assignmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 12,
  },
  assignmentIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentInfo: {
    flex: 1,
  },
  assignmentName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  assignmentMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  miniStartBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  makeUpText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  emptyText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 22,
  },
});
