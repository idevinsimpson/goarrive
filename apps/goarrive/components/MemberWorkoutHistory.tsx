/**
 * MemberWorkoutHistory — Past workout log timeline for members
 *
 * Shows completed workouts with duration, journal preview, coach reaction,
 * and coach note. Designed for the member to see their progress and feel
 * acknowledged by their coach.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';

interface HistoryLog {
  id: string;
  workoutName: string;
  completedAt: any;
  durationSec: number | null;
  journal: {
    glow: string;
    grow: string;
    energyRating: number | null;
    moodRating: number | null;
  } | null;
  coachReaction: string;
  coachNote: string;
  reviewStatus: string;
}

interface MemberWorkoutHistoryProps {
  visible: boolean;
  memberId: string;
  memberName?: string;
  onClose: () => void;
}

const ENERGY_LABELS = ['Drained', 'Low', 'Steady', 'Strong', 'On Fire'];
const MOOD_LABELS = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];

export default function MemberWorkoutHistory({
  visible,
  memberId,
  onClose,
}: MemberWorkoutHistoryProps) {
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !memberId) return;

    const q = query(
      collection(db, 'workout_logs'),
      where('memberId', '==', memberId),
      orderBy('completedAt', 'desc'),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: HistoryLog[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            workoutName: data.workoutName ?? 'Workout',
            completedAt: data.completedAt,
            durationSec: data.durationSec ?? null,
            journal: data.journal ?? null,
            coachReaction: data.coachReaction ?? '',
            coachNote: data.coachNote ?? '',
            reviewStatus: data.reviewStatus ?? 'pending',
          };
        });
        setLogs(list);
        setLoading(false);
      },
      (err) => {
        console.error('[MemberWorkoutHistory] Listener error:', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [visible, memberId]);

  const formatDuration = (sec: number | null): string => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    return m > 0 ? `${m} min` : `${sec}s`;
  };

  const formatDate = (ts: any): string => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const renderLog = ({ item }: { item: HistoryLog }) => {
    const isExpanded = expandedId === item.id;
    const hasJournal = item.journal && (item.journal.glow || item.journal.grow);
    const isReviewed = item.reviewStatus === 'reviewed';

    return (
      <TouchableOpacity
        style={st.logCard}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.7}
      >
        {/* Top row */}
        <View style={st.logTop}>
          <View style={st.logInfo}>
            <Text style={st.logName}>{item.workoutName}</Text>
            <Text style={st.logDate}>{formatDate(item.completedAt)}</Text>
          </View>
          <View style={st.logRight}>
            {item.durationSec ? (
              <Text style={st.logDuration}>{formatDuration(item.durationSec)}</Text>
            ) : null}
            {item.coachReaction ? (
              <Text style={st.logReaction}>{item.coachReaction}</Text>
            ) : isReviewed ? (
              <Icon name="check-circle" size={16} color="#6EBB7A" />
            ) : (
              <View style={st.pendingDot} />
            )}
          </View>
        </View>

        {/* Ratings row */}
        {item.journal && (item.journal.energyRating || item.journal.moodRating) && (
          <View style={st.ratingsRow}>
            {item.journal.energyRating ? (
              <View style={st.ratingChip}>
                <Text style={st.ratingChipText}>
                  ⚡ {ENERGY_LABELS[item.journal.energyRating - 1]}
                </Text>
              </View>
            ) : null}
            {item.journal.moodRating ? (
              <View style={st.ratingChip}>
                <Text style={st.ratingChipText}>
                  💛 {MOOD_LABELS[item.journal.moodRating - 1]}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Expanded detail */}
        {isExpanded && (
          <View style={st.expandedSection}>
            {hasJournal && (
              <View style={st.journalBox}>
                {item.journal!.glow ? (
                  <View style={st.journalItem}>
                    <Text style={st.journalLabel}>☀️ Glow</Text>
                    <Text style={st.journalText}>{item.journal!.glow}</Text>
                  </View>
                ) : null}
                {item.journal!.grow ? (
                  <View style={st.journalItem}>
                    <Text style={st.journalLabel}>🌱 Grow</Text>
                    <Text style={st.journalText}>{item.journal!.grow}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {item.coachNote ? (
              <View style={st.coachNoteBox}>
                <Text style={st.coachNoteLabel}>Coach Feedback</Text>
                <Text style={st.coachNoteText}>{item.coachNote}</Text>
              </View>
            ) : null}

            {!hasJournal && !item.coachNote && (
              <Text style={st.noDetailText}>No reflection or feedback yet</Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="close" size={24} color="#8A95A3" />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Workout History</Text>
          <View style={st.countBadge}>
            <Text style={st.countBadgeText}>{logs.length}</Text>
          </View>
        </View>

        {/* Stats summary */}
        {logs.length > 0 && (
          <View style={st.statsRow}>
            <View style={st.statItem}>
              <Text style={st.statNum}>{logs.length}</Text>
              <Text style={st.statLabel}>Completed</Text>
            </View>
            <View style={st.statItem}>
              <Text style={st.statNum}>
                {logs.filter((l) => l.reviewStatus === 'reviewed').length}
              </Text>
              <Text style={st.statLabel}>Reviewed</Text>
            </View>
            <View style={st.statItem}>
              <Text style={st.statNum}>
                {logs.filter((l) => l.coachReaction).length}
              </Text>
              <Text style={st.statLabel}>Reactions</Text>
            </View>
          </View>
        )}

        {/* List */}
        {loading ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : logs.length === 0 ? (
          <View style={st.emptyWrap}>
            <Icon name="fitness" size={48} color="#2A3040" />
            <Text style={st.emptyTitle}>No Workouts Yet</Text>
            <Text style={st.emptyText}>
              Complete your first assigned workout to start building your history.
            </Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            renderItem={renderLog}
            keyExtractor={(item) => item.id}
            contentContainerStyle={st.listContent}
            showsVerticalScrollIndicator={false}
          />
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
    paddingHorizontal: 20,
    paddingTop: Platform.select({ ios: 56, android: 44, web: 20, default: 20 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  countBadge: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 28,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  statItem: {
    alignItems: 'center',
  },
  statNum: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  statLabel: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  logCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  logTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  logInfo: {
    flex: 1,
  },
  logName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  logDate: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  logRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  logDuration: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  logReaction: {
    fontSize: 20,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8A95A3',
    marginTop: 4,
  },
  ratingsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  ratingChip: {
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ratingChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  expandedSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  journalBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  journalItem: {
    marginBottom: 8,
  },
  journalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 2,
  },
  journalText: {
    fontSize: 13,
    color: '#C0C8D4',
    fontFamily: FB,
    lineHeight: 20,
  },
  coachNoteBox: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  coachNoteLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    marginBottom: 4,
  },
  coachNoteText: {
    fontSize: 13,
    color: '#C0C8D4',
    fontFamily: FB,
    lineHeight: 20,
  },
  noDetailText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    fontStyle: 'italic',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
