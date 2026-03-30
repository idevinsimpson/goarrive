/**
 * CoachReviewQueue — Coach reviews member workout logs + Glow/Grow reflections
 *
 * Displays pending workout logs from the coach's members.
 * Coach can read the member's Glow/Grow, add a note, and mark as reviewed.
 * Design target: 10 seconds per review (per Product Research doc).
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Types ──────────────────────────────────────────────────────────────────
interface WorkoutLog {
  id: string;
  memberId: string;
  memberName?: string;
  workoutId: string;
  workoutName: string;
  assignmentId: string;
  completedAt: any;
  durationSec: number | null;
  journal: {
    glow: string;
    grow: string;
    energyRating: number | null;
    moodRating: number | null;
  } | null;
  reviewStatus: string; // pending | reviewed
  reviewedAt: any;
  coachNote: string;
  coachReaction: string;
}

interface CoachReviewQueueProps {
  visible: boolean;
  coachId: string;
  onClose: () => void;
  /** Optional map of memberId → memberName for display */
  memberNames?: Record<string, string>;
}

const ENERGY_LABELS = ['Drained', 'Low', 'Steady', 'Strong', 'On Fire'];
const MOOD_LABELS = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];
const REACTIONS = ['💪', '🔥', '⭐', '👏', '❤️'];

// ── Component ──────────────────────────────────────────────────────────────
export default function CoachReviewQueue({
  visible,
  coachId,
  onClose,
  memberNames = {},
}: CoachReviewQueueProps) {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);

  // Review state
  const [activeLog, setActiveLog] = useState<WorkoutLog | null>(null);
  const [coachNote, setCoachNote] = useState('');
  const [selectedReaction, setSelectedReaction] = useState('');
  const [saving, setSaving] = useState(false);

  // Filter & sort state
  const [filterMember, setFilterMember] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'energy' | 'mood'>('date');

  // ── Real-time listener ────────────────────────────────────────────────
  useEffect(() => {
    if (!visible || !coachId) return;

    const q = query(
      collection(db, 'workout_logs'),
      where('coachId', '==', coachId),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: WorkoutLog[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            memberId: data.memberId ?? '',
            memberName: memberNames[data.memberId] || data.memberName || 'Member',
            workoutId: data.workoutId ?? '',
            workoutName: data.workoutName ?? 'Workout',
            assignmentId: data.assignmentId ?? '',
            completedAt: data.completedAt,
            durationSec: data.durationSec ?? null,
            journal: data.journal ?? null,
            reviewStatus: data.reviewStatus ?? 'pending',
            reviewedAt: data.reviewedAt,
            coachNote: data.coachNote ?? '',
            coachReaction: data.coachReaction ?? '',
          };
        });
        setLogs(list);
        setLoading(false);
        setRefreshing(false);
      },
      (err) => {
        console.error('[CoachReviewQueue] Listener error:', err);
        setLoading(false);
        setRefreshing(false);
      },
    );

    return () => unsub();
  }, [visible, coachId]);

  // ── Filter & sort logs ────────────────────────────────────────────────
  const pendingLogs = logs.filter((l) => l.reviewStatus === 'pending');
  const reviewedLogs = logs.filter((l) => l.reviewStatus === 'reviewed');
  const baseLogs = showReviewed ? reviewedLogs : pendingLogs;

  // Apply member filter
  const memberFiltered = filterMember === 'all'
    ? baseLogs
    : baseLogs.filter((l) => l.memberId === filterMember);

  // Apply sort
  const displayLogs = [...memberFiltered].sort((a, b) => {
    if (sortBy === 'energy') {
      const ae = a.journal?.energyRating ?? 0;
      const be = b.journal?.energyRating ?? 0;
      return ae - be; // lowest energy first (needs attention)
    }
    if (sortBy === 'mood') {
      const am = a.journal?.moodRating ?? 0;
      const bm = b.journal?.moodRating ?? 0;
      return am - bm; // lowest mood first
    }
    // Default: date descending (newest first)
    const at = a.completedAt?.toDate?.() ?? new Date(0);
    const bt = b.completedAt?.toDate?.() ?? new Date(0);
    return bt.getTime() - at.getTime();
  });

  // Unique member list for filter
  const uniqueMembers = Array.from(
    new Map(logs.map((l) => [l.memberId, l.memberName || 'Member'])).entries(),
  );

  // ── Mark reviewed ─────────────────────────────────────────────────────
  const handleMarkReviewed = useCallback(
    async (logId: string, note: string, reaction: string) => {
      setSaving(true);
      try {
        await updateDoc(doc(db, 'workout_logs', logId), {
          reviewStatus: 'reviewed',
          reviewedAt: serverTimestamp(),
          coachNote: note.trim(),
          coachReaction: reaction,
        });
        setActiveLog(null);
        setCoachNote('');
        setSelectedReaction('');
      } catch (err) {
        console.error('[CoachReviewQueue] Failed to mark reviewed:', err);
      }
      setSaving(false);
    },
    [],
  );

  // ── Quick reaction (one-tap from card) ────────────────────────────────
  const handleQuickReaction = useCallback(
    async (logId: string, reaction: string) => {
      try {
        await updateDoc(doc(db, 'workout_logs', logId), {
          reviewStatus: 'reviewed',
          reviewedAt: serverTimestamp(),
          coachReaction: reaction,
        });
      } catch (err) {
        console.error('[CoachReviewQueue] Quick reaction failed:', err);
      }
    },
    [],
  );

  // Quick review — mark reviewed without opening detail
  const handleQuickReview = useCallback(
    async (logId: string) => {
      try {
        await updateDoc(doc(db, 'workout_logs', logId), {
          reviewStatus: 'reviewed',
          reviewedAt: serverTimestamp(),
          coachNote: '',
        });
      } catch (err) {
        console.error('[CoachReviewQueue] Quick review failed:', err);
      }
    },
    [],
  );

  // ── Format helpers ────────────────────────────────────────────────────
  const formatDuration = (sec: number | null): string => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    return m > 0 ? `${m}m` : `${sec}s`;
  };

  const formatDate = (ts: any): string => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // ── Render log card ───────────────────────────────────────────────────
  const renderLogCard = ({ item }: { item: WorkoutLog }) => {
    const hasJournal = item.journal && (item.journal.glow || item.journal.grow);
    const isPending = item.reviewStatus === 'pending';

    return (
      <TouchableOpacity
        style={[st.logCard, isPending && st.logCardPending]}
        onPress={() => {
          setActiveLog(item);
          setCoachNote(item.coachNote || '');
          setSelectedReaction(item.coachReaction || '');
        }}
        activeOpacity={0.7}
      >
        <View style={st.logCardTop}>
          <View style={st.logCardInfo}>
            <Text style={st.logMemberName}>{item.memberName}</Text>
            <Text style={st.logWorkoutName}>{item.workoutName}</Text>
          </View>
          <View style={st.logCardRight}>
            {item.durationSec ? (
              <Text style={st.logDuration}>{formatDuration(item.durationSec)}</Text>
            ) : null}
            <Text style={st.logDate}>{formatDate(item.completedAt)}</Text>
          </View>
        </View>

        {/* Journal preview */}
        {hasJournal && (
          <View style={st.journalPreview}>
            {item.journal!.glow ? (
              <Text style={st.journalLine} numberOfLines={1}>
                ☀️ {item.journal!.glow}
              </Text>
            ) : null}
            {item.journal!.grow ? (
              <Text style={st.journalLine} numberOfLines={1}>
                🌱 {item.journal!.grow}
              </Text>
            ) : null}
          </View>
        )}

        {/* Ratings */}
        {item.journal && (item.journal.energyRating || item.journal.moodRating) && (
          <View style={st.ratingsRow}>
            {item.journal.energyRating ? (
              <View style={st.ratingChip}>
                <Icon name="bolt" size={12} color="#F5A623" />
                <Text style={st.ratingChipText}>
                  {ENERGY_LABELS[item.journal.energyRating - 1]}
                </Text>
              </View>
            ) : null}
            {item.journal.moodRating ? (
              <View style={st.ratingChip}>
                <Icon name="heart" size={12} color="#F5A623" />
                <Text style={st.ratingChipText}>
                  {MOOD_LABELS[item.journal.moodRating - 1]}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Quick reactions + quick review for pending */}
        {isPending && (
          <View style={st.quickActions}>
            <View style={st.reactionRow}>
              {REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={st.reactionBtn}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleQuickReaction(item.id, emoji);
                  }}
                >
                  <Text style={st.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={st.quickReviewBtn}
              onPress={(e) => {
                e.stopPropagation?.();
                handleQuickReview(item.id);
              }}
            >
              <Icon name="check-circle" size={16} color="#6EBB7A" />
              <Text style={st.quickReviewText}>Mark Reviewed</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Show reaction on reviewed cards */}
        {!isPending && item.coachReaction ? (
          <View style={st.reviewedReaction}>
            <Text style={st.reviewedReactionText}>{item.coachReaction}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="close" size={24} color="#8A95A3" />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Review Queue</Text>
          <View style={st.pendingBadge}>
            <Text style={st.pendingBadgeText}>{pendingLogs.length}</Text>
          </View>
        </View>

        {/* Tab toggle */}
        <View style={st.tabs}>
          <TouchableOpacity
            style={[st.tab, !showReviewed && st.tabActive]}
            onPress={() => setShowReviewed(false)}
          >
            <Text style={[st.tabText, !showReviewed && st.tabTextActive]}>
              Pending ({pendingLogs.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tab, showReviewed && st.tabActive]}
            onPress={() => setShowReviewed(true)}
          >
            <Text style={[st.tabText, showReviewed && st.tabTextActive]}>
              Reviewed ({reviewedLogs.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Filter & Sort bar */}
        <View style={st.filterBar}>
          {/* Member filter */}
          <View style={st.filterGroup}>
            <TouchableOpacity
              style={[st.filterChip, filterMember === 'all' && st.filterChipActive]}
              onPress={() => setFilterMember('all')}
            >
              <Text style={[st.filterChipText, filterMember === 'all' && st.filterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {uniqueMembers.map(([id, name]) => (
              <TouchableOpacity
                key={id}
                style={[st.filterChip, filterMember === id && st.filterChipActive]}
                onPress={() => setFilterMember(filterMember === id ? 'all' : id)}
              >
                <Text
                  style={[st.filterChipText, filterMember === id && st.filterChipTextActive]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Sort options */}
          <View style={st.sortGroup}>
            <Text style={st.sortLabel}>Sort:</Text>
            {([['date', 'Date'], ['energy', 'Energy'], ['mood', 'Mood']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[st.sortChip, sortBy === key && st.sortChipActive]}
                onPress={() => setSortBy(key)}
              >
                <Text style={[st.sortChipText, sortBy === key && st.sortChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* List */}
        {loading ? (
          <View style={st.loadingWrap}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : displayLogs.length === 0 ? (
          <View style={st.emptyWrap}>
            <Icon name="check-circle" size={48} color="#2A3040" />
            <Text style={st.emptyTitle}>
              {showReviewed ? 'No Reviewed Logs' : 'All Caught Up!'}
            </Text>
            <Text style={st.emptyText}>
              {showReviewed
                ? 'Reviewed workout logs will appear here.'
                : 'No pending workout reviews. Great job staying on top of it!'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayLogs}
            renderItem={renderLogCard}
            keyExtractor={(item) => item.id}
            contentContainerStyle={st.listContent}
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
        )}

        {/* Detail / Review Modal */}
        {activeLog && (
          <Modal visible={!!activeLog} animationType="slide" transparent>
            <View style={st.detailOverlay}>
              <View style={st.detailCard}>
                <View style={st.detailHeader}>
                  <Text style={st.detailTitle}>{activeLog.memberName}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setActiveLog(null);
                      setCoachNote('');
                    }}
                  >
                    <Icon name="close" size={20} color="#8A95A3" />
                  </TouchableOpacity>
                </View>

                <Text style={st.detailWorkout}>{activeLog.workoutName}</Text>
                <Text style={st.detailMeta}>
                  {formatDate(activeLog.completedAt)}
                  {activeLog.durationSec ? ` · ${formatDuration(activeLog.durationSec)}` : ''}
                </Text>

                {/* Full journal */}
                {activeLog.journal && (
                  <View style={st.detailJournal}>
                    {activeLog.journal.glow ? (
                      <View style={st.detailJournalSection}>
                        <Text style={st.detailJournalLabel}>☀️ Glow</Text>
                        <Text style={st.detailJournalText}>{activeLog.journal.glow}</Text>
                      </View>
                    ) : null}
                    {activeLog.journal.grow ? (
                      <View style={st.detailJournalSection}>
                        <Text style={st.detailJournalLabel}>🌱 Grow</Text>
                        <Text style={st.detailJournalText}>{activeLog.journal.grow}</Text>
                      </View>
                    ) : null}
                    {activeLog.journal.energyRating ? (
                      <Text style={st.detailRating}>
                        Energy: {ENERGY_LABELS[activeLog.journal.energyRating - 1]} ({activeLog.journal.energyRating}/5)
                      </Text>
                    ) : null}
                    {activeLog.journal.moodRating ? (
                      <Text style={st.detailRating}>
                        Mood: {MOOD_LABELS[activeLog.journal.moodRating - 1]} ({activeLog.journal.moodRating}/5)
                      </Text>
                    ) : null}
                  </View>
                )}

                {!activeLog.journal && (
                  <Text style={st.noJournalText}>No reflection submitted</Text>
                )}

                {/* Quick reaction picker */}
                <Text style={st.coachNoteLabel}>Quick Reaction</Text>
                <View style={st.reactionRow}>
                  {REACTIONS.map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={[
                        st.reactionBtn,
                        selectedReaction === emoji && st.reactionBtnActive,
                      ]}
                      onPress={() =>
                        setSelectedReaction((prev) => (prev === emoji ? '' : emoji))
                      }
                    >
                      <Text style={st.reactionEmoji}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Coach note */}
                <Text style={st.coachNoteLabel}>Coach Note (optional)</Text>
                <TextInput
                  style={st.coachNoteInput}
                  value={coachNote}
                  onChangeText={setCoachNote}
                  placeholder="Great work! Keep it up..."
                  placeholderTextColor="#555"
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                />

                {/* Actions */}
                <TouchableOpacity
                  style={[st.reviewBtn, saving && st.reviewBtnDisabled]}
                  onPress={() => handleMarkReviewed(activeLog.id, coachNote, selectedReaction)}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#0E1117" />
                  ) : (
                    <Text style={st.reviewBtnText}>
                      {activeLog.reviewStatus === 'reviewed' ? 'Update Note' : 'Mark Reviewed'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
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
  pendingBadge: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 28,
    alignItems: 'center',
  },
  pendingBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
  },
  tabTextActive: {
    color: '#F5A623',
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

  // Log card
  logCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  logCardPending: {
    borderColor: 'rgba(245,166,35,0.2)',
  },
  logCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  logCardInfo: {
    flex: 1,
  },
  logMemberName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  logWorkoutName: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  logCardRight: {
    alignItems: 'flex-end',
  },
  logDuration: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  logDate: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  journalPreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  journalLine: {
    fontSize: 13,
    color: '#C0C8D4',
    fontFamily: FB,
    marginBottom: 2,
  },
  ratingsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  quickActions: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  reactionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.25)',
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  reactionEmoji: {
    fontSize: 18,
  },
  reviewedReaction: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  reviewedReactionText: {
    fontSize: 20,
  },
  quickReviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(110,187,122,0.1)',
  },
  quickReviewText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6EBB7A',
    fontFamily: FH,
  },

  // Empty
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

  // Detail modal
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    backgroundColor: '#151922',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  detailWorkout: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  detailMeta: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
    marginBottom: 16,
  },
  detailJournal: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  detailJournalSection: {
    marginBottom: 12,
  },
  detailJournalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 4,
  },
  detailJournalText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FB,
    lineHeight: 22,
  },
  detailRating: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
  },
  noJournalText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  coachNoteLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 8,
    marginTop: 12,
  },
  coachNoteInput: {
    backgroundColor: '#1A1E26',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2E36',
    color: '#FFFFFF',
    fontFamily: FB,
    fontSize: 14,
    padding: 12,
    minHeight: 60,
    maxHeight: 100,
    marginBottom: 16,
  },
  reviewBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reviewBtnDisabled: {
    opacity: 0.6,
  },
  reviewBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },

  // Filter & sort bar
  filterBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  filterGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  filterChipActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.4)',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    maxWidth: 80,
  },
  filterChipTextActive: {
    color: '#F5A623',
  },
  sortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FH,
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sortChipActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  sortChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
  },
  sortChipTextActive: {
    color: '#F5A623',
  },
});
