/**
 * WorkoutLogReview — Coach review queue for unreviewed workout logs
 *
 * Shows a scrollable list of unreviewed workout logs with journal data,
 * movement swaps (via SwapLogDisplay), and quick review actions.
 * Coaches can mark logs as reviewed with an optional reaction/comment.
 *
 * Props:
 *   visible — whether the modal is shown
 *   onClose — callback to close the modal
 *   coachId — the coach's user ID for querying their logs
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';
import SwapLogDisplay from './SwapLogDisplay';
import { FB, FH } from '../lib/theme';

interface WorkoutLog {
  id: string;
  memberId: string;
  memberName?: string;
  workoutName?: string;
  completedAt: any;
  durationMin?: number;
  journalGlow?: string;
  journalGrow?: string;
  difficultyRating?: number;
  movementSwaps?: any[];
  reviewedAt?: any;
}

interface WorkoutLogReviewProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
}

export default function WorkoutLogReview({
  visible,
  onClose,
  coachId,
}: WorkoutLogReviewProps) {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [reaction, setReaction] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'workout_logs'),
          where('coachId', '==', coachId),
        ),
      );
      const unreviewedLogs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as WorkoutLog))
        .filter((l) => !l.reviewedAt)
        .sort((a, b) => {
          const at = a.completedAt?.toDate?.() ?? new Date(0);
          const bt = b.completedAt?.toDate?.() ?? new Date(0);
          return bt.getTime() - at.getTime();
        })
        .slice(0, 20);
      setLogs(unreviewedLogs);
    } catch (err) {
      console.error('Error fetching workout logs:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    if (visible) fetchLogs();
  }, [visible, fetchLogs]);

  const handleReview = async (logId: string) => {
    try {
      await updateDoc(doc(db, 'workout_logs', logId), {
        reviewedAt: serverTimestamp(),
        coachReaction: reaction || null,
        coachComment: comment || null,
      });
      setLogs((prev) => prev.filter((l) => l.id !== logId));
      setReviewingId(null);
      setComment('');
      setReaction(null);
    } catch (err) {
      console.error('Error reviewing log:', err);
    }
  };

  const REACTIONS = ['💪', '🔥', '⭐', '👏', '❤️'];

  const formatDate = (ts: any) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const difficultyLabel = (r: number | undefined) => {
    if (!r) return null;
    const labels: Record<number, string> = {
      1: 'Too Easy',
      2: 'Easy',
      3: 'Just Right',
      4: 'Hard',
      5: 'Too Hard',
    };
    return labels[r] || `${r}/5`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={st.overlay}>
        <View style={st.sheet}>
          {/* Header */}
          <View style={st.header}>
            <Text style={st.headerTitle}>Review Queue</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={20} color="#8A95A3" />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator
              color="#F5A623"
              size="large"
              style={{ marginTop: 40 }}
            />
          ) : logs.length === 0 ? (
            <View style={st.emptyState}>
              <Icon name="checkmark-circle" size={48} color="#34D399" />
              <Text style={st.emptyTitle}>All Caught Up!</Text>
              <Text style={st.emptySubtext}>
                No workout logs need review right now.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={st.scrollArea}
              showsVerticalScrollIndicator={false}
            >
              <Text style={st.countText}>
                {logs.length} log{logs.length !== 1 ? 's' : ''} to review
              </Text>

              {logs.map((log) => (
                <View key={log.id} style={st.logCard}>
                  {/* Log header */}
                  <View style={st.logHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.memberName}>
                        {log.memberName || 'Member'}
                      </Text>
                      <Text style={st.workoutName}>
                        {log.workoutName || 'Workout'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={st.dateText}>
                        {formatDate(log.completedAt)}
                      </Text>
                      {log.durationMin != null && (
                        <Text style={st.durationText}>
                          {log.durationMin} min
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Difficulty */}
                  {log.difficultyRating != null && (
                    <View style={st.difficultyRow}>
                      <Text style={st.difficultyLabel}>Difficulty:</Text>
                      <Text
                        style={[
                          st.difficultyValue,
                          {
                            color:
                              log.difficultyRating <= 2
                                ? '#34D399'
                                : log.difficultyRating <= 3
                                ? '#F5A623'
                                : '#E05252',
                          },
                        ]}
                      >
                        {difficultyLabel(log.difficultyRating)}
                      </Text>
                    </View>
                  )}

                  {/* Journal entries */}
                  {log.journalGlow && (
                    <View style={st.journalRow}>
                      <Text style={st.journalEmoji}>🌟</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={st.journalLabel}>Glow</Text>
                        <Text style={st.journalText}>{log.journalGlow}</Text>
                      </View>
                    </View>
                  )}
                  {log.journalGrow && (
                    <View style={st.journalRow}>
                      <Text style={st.journalEmoji}>🌱</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={st.journalLabel}>Grow</Text>
                        <Text style={st.journalText}>{log.journalGrow}</Text>
                      </View>
                    </View>
                  )}

                  {/* Movement swaps */}
                  {log.movementSwaps && log.movementSwaps.length > 0 && (
                    <SwapLogDisplay swaps={log.movementSwaps} />
                  )}

                  {/* Review actions */}
                  {reviewingId === log.id ? (
                    <View style={st.reviewActions}>
                      <View style={st.reactionRow}>
                        {REACTIONS.map((r) => (
                          <Pressable
                            key={r}
                            onPress={() =>
                              setReaction(reaction === r ? null : r)
                            }
                            style={[
                              st.reactionBtn,
                              reaction === r && st.reactionBtnActive,
                            ]}
                          >
                            <Text style={st.reactionEmoji}>{r}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <TextInput
                        style={st.commentInput}
                        placeholder="Add a comment (optional)"
                        placeholderTextColor="#6B7280"
                        value={comment}
                        onChangeText={setComment}
                        multiline
                      />
                      <View style={st.reviewBtns}>
                        <Pressable
                          style={st.cancelBtn}
                          onPress={() => {
                            setReviewingId(null);
                            setComment('');
                            setReaction(null);
                          }}
                        >
                          <Text style={st.cancelBtnText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          style={st.markReviewedBtn}
                          onPress={() => handleReview(log.id)}
                        >
                          <Icon
                            name="checkmark"
                            size={14}
                            color="#0E1117"
                          />
                          <Text style={st.markReviewedText}>
                            Mark Reviewed
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      style={st.reviewBtn}
                      onPress={() => setReviewingId(log.id)}
                    >
                      <Icon name="checkmark-circle" size={14} color="#F5A623" />
                      <Text style={st.reviewBtnText}>Review</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 16,
    overflow: "hidden" as const,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2330',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
  },
  scrollArea: {
    paddingHorizontal: 16,
  },
  countText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 12,
    marginBottom: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  logCard: {
    backgroundColor: '#161B26',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E2330',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
  },
  workoutName: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  dateText: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: FB,
  },
  durationText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  difficultyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  difficultyLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: FB,
  },
  difficultyValue: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FH,
  },
  journalRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E2330',
  },
  journalEmoji: {
    fontSize: 16,
    marginTop: 2,
  },
  journalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  journalText: {
    fontSize: 13,
    color: '#E2E8F0',
    fontFamily: FB,
    marginTop: 2,
    lineHeight: 18,
  },
  reviewActions: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E2330',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  reactionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1A1F2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#252B3B',
  },
  reactionBtnActive: {
    borderColor: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.15)',
  },
  reactionEmoji: {
    fontSize: 18,
  },
  commentInput: {
    backgroundColor: '#1A1F2E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E2E8F0',
    fontFamily: FB,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#252B3B',
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  reviewBtns: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#252B3B',
  },
  cancelBtnText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  markReviewedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5A623',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  markReviewedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F5A623',
  },
  reviewBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
});
