/**
 * BatchAssignModal — Assign a workout to multiple members at once
 *
 * Flow:
 *   1. Select members (multi-select with search)
 *   2. Pick a date
 *   3. Confirm → creates one workout_assignment per member
 *
 * Used from WorkoutDetail when coach wants to assign to multiple members.
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  Platform,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import ModalSheet from './ModalSheet';
import { Icon } from './Icon';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { FB, FH } from '../lib/theme';

interface MemberItem {
  id: string;
  displayName: string;
  email: string;
}

interface Props {
  visible: boolean;
  coachId: string;
  workoutId: string;
  workoutName: string;
  /** Optional workout snapshot for versioning */
  workoutSnapshot?: any;
  onClose: () => void;
  onDone: (count: number) => void;
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function BatchAssignModal({
  visible,
  coachId,
  workoutId,
  workoutName,
  workoutSnapshot,
  onClose,
  onDone,
}: Props) {
  const [step, setStep] = useState<'members' | 'schedule' | 'assigning' | 'done'>('members');
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState(toDateString(new Date()));
  const [assignedCount, setAssignedCount] = useState(0);
  const [progress, setProgress] = useState(0);

  // Load coach's members
  const loadMembers = useCallback(async () => {
    if (!coachId) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'users'),
        where('coachId', '==', coachId),
        where('role', '==', 'member'),
      );
      const snap = await getDocs(q);
      setMembers(
        snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            displayName: data.displayName || data.name || 'Unknown',
            email: data.email || '',
          };
        }).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    } catch (err) {
      console.error('[BatchAssign] Failed to load members:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    if (visible) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedDate(today);
      setDateInput(toDateString(today));
      setSelected(new Set());
      setStep('members');
      setAssignedCount(0);
      setProgress(0);
      setSearch('');
      loadMembers();
    }
  }, [visible, loadMembers]);

  const toggleMember = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((m) => m.id)));
    }
  };

  const handleDateInputChange = (text: string) => {
    setDateInput(text);
    const parts = text.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y > 2000) {
        const parsed = new Date(y, m, d);
        if (!isNaN(parsed.getTime())) setSelectedDate(parsed);
      }
    }
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    setStep('assigning');

    const memberIds = Array.from(selected);
    // Firestore writeBatch supports up to 500 operations per batch
    const BATCH_LIMIT = 500;
    let totalCount = 0;

    try {
      for (let batchStart = 0; batchStart < memberIds.length; batchStart += BATCH_LIMIT) {
        const chunk = memberIds.slice(batchStart, batchStart + BATCH_LIMIT);
        const batch = writeBatch(db);

        for (const memberId of chunk) {
          const member = members.find((m) => m.id === memberId);
          const ref = doc(collection(db, 'workout_assignments'));
          const assignmentData: any = {
            workoutId,
            workoutName,
            memberId,
            memberName: member?.displayName || '',
            coachId,
            scheduledFor: toDateString(selectedDate),
            status: 'scheduled',
            assignedAt: serverTimestamp(),
          };
          if (workoutSnapshot) {
            assignmentData.workoutSnapshot = workoutSnapshot;
          }
          batch.set(ref, assignmentData);
        }

        await batch.commit();
        totalCount += chunk.length;
        setProgress(Math.round((totalCount / memberIds.length) * 100));
      }

      setAssignedCount(totalCount);
      setStep('done');
    } catch (err) {
      console.error('[BatchAssign] Batch write failed:', err);
      Alert.alert('Error', 'Failed to assign workouts. Please try again.');
      setStep('schedule');
    }
  };

  const filtered = members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    );
  });

  // Quick dates
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <ModalSheet visible={visible} onClose={onClose} maxHeightPct={0.85} sheetBg="#151921" backdropColor="rgba(0,0,0,0.7)" borderRadius={24}>
          {/* Header */}
          <View style={st.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={24} color="#8A95A3" />
            </Pressable>
            <Text style={st.headerTitle}>
              {step === 'members'
                ? 'Select Members'
                : step === 'schedule'
                ? 'Pick Date'
                : step === 'assigning'
                ? 'Assigning…'
                : 'Done!'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Workout badge */}
          <View style={st.workoutBadge}>
            <Icon name="workouts" size={14} color="#F5A623" />
            <Text style={st.workoutBadgeText} numberOfLines={1}>
              {workoutName}
            </Text>
          </View>

          {step === 'members' && (
            <>
              {/* Search + Select All */}
              <View style={st.searchRow}>
                <View style={st.searchWrap}>
                  <Icon name="search" size={16} color="#4A5568" />
                  <TextInput
                    style={st.searchInput}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search members…"
                    placeholderTextColor="#4A5568"
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </View>
                <Pressable style={st.selectAllBtn} onPress={selectAll}>
                  <Text style={st.selectAllText}>
                    {selected.size === filtered.length && filtered.length > 0
                      ? 'Deselect All'
                      : 'Select All'}
                  </Text>
                </Pressable>
              </View>

              {loading ? (
                <View style={st.loadingWrap}>
                  <ActivityIndicator size="large" color="#F5A623" />
                </View>
              ) : (
                <ScrollView style={st.listWrap} showsVerticalScrollIndicator={false}>
                  {filtered.map((m) => {
                    const isSelected = selected.has(m.id);
                    return (
                      <Pressable
                        key={m.id}
                        style={[st.memberRow, isSelected && st.memberRowSelected]}
                        onPress={() => toggleMember(m.id)}
                      >
                        <View
                          style={[
                            st.checkbox,
                            isSelected && st.checkboxChecked,
                          ]}
                        >
                          {isSelected && (
                            <Icon name="check" size={14} color="#0E1117" />
                          )}
                        </View>
                        <View style={st.memberInfo}>
                          <Text style={st.memberName}>{m.displayName}</Text>
                          {m.email ? (
                            <Text style={st.memberEmail}>{m.email}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <Text style={st.emptyText}>No members found</Text>
                  )}
                </ScrollView>
              )}

              {/* Footer */}
              <View style={st.footer}>
                <Text style={st.selectedCount}>
                  {selected.size} member{selected.size !== 1 ? 's' : ''} selected
                </Text>
                <Pressable
                  style={[st.nextBtn, selected.size === 0 && st.nextBtnDisabled]}
                  onPress={() => selected.size > 0 && setStep('schedule')}
                  disabled={selected.size === 0}
                >
                  <Text style={st.nextBtnText}>Next</Text>
                  <Icon name="arrow-right" size={18} color="#0E1117" />
                </Pressable>
              </View>
            </>
          )}

          {step === 'schedule' && (
            <View style={st.scheduleWrap}>
              <Text style={st.scheduleLabel}>Schedule for:</Text>

              {/* Quick dates */}
              <View style={st.quickRow}>
                <Pressable
                  style={[
                    st.quickBtn,
                    toDateString(selectedDate) === toDateString(today) && st.quickBtnActive,
                  ]}
                  onPress={() => {
                    setSelectedDate(today);
                    setDateInput(toDateString(today));
                  }}
                >
                  <Text
                    style={[
                      st.quickBtnText,
                      toDateString(selectedDate) === toDateString(today) && st.quickBtnTextActive,
                    ]}
                  >
                    Today
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    st.quickBtn,
                    toDateString(selectedDate) === toDateString(tomorrow) && st.quickBtnActive,
                  ]}
                  onPress={() => {
                    setSelectedDate(tomorrow);
                    setDateInput(toDateString(tomorrow));
                  }}
                >
                  <Text
                    style={[
                      st.quickBtnText,
                      toDateString(selectedDate) === toDateString(tomorrow) && st.quickBtnTextActive,
                    ]}
                  >
                    Tomorrow
                  </Text>
                </Pressable>
              </View>

              {/* Date input */}
              <TextInput
                style={st.dateInput}
                value={dateInput}
                onChangeText={handleDateInputChange}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#4A5568"
                keyboardType="numbers-and-punctuation"
              />
              <Text style={st.datePreview}>{formatDateDisplay(selectedDate)}</Text>

              <Text style={st.summaryText}>
                Assign "{workoutName}" to {selected.size} member
                {selected.size !== 1 ? 's' : ''} on {formatDateDisplay(selectedDate)}
              </Text>

              <View style={st.scheduleFooter}>
                <Pressable style={st.backBtn} onPress={() => setStep('members')}>
                  <Icon name="arrow-left" size={18} color="#8A95A3" />
                  <Text style={st.backBtnText}>Back</Text>
                </Pressable>
                <Pressable style={st.confirmBtn} onPress={handleConfirm}>
                  <Icon name="check" size={18} color="#0E1117" />
                  <Text style={st.confirmBtnText}>Assign All</Text>
                </Pressable>
              </View>
            </View>
          )}

          {step === 'assigning' && (
            <View style={st.progressWrap}>
              <ActivityIndicator size="large" color="#F5A623" />
              <Text style={st.progressText}>
                Assigning to {selected.size} members… {progress}%
              </Text>
              <View style={st.progressBar}>
                <View style={[st.progressFill, { width: `${progress}%` }]} />
              </View>
            </View>
          )}

          {step === 'done' && (
            <View style={st.doneWrap}>
              <Icon name="check-circle" size={56} color="#6EBB7A" />
              <Text style={st.doneTitle}>
                {assignedCount} Assignment{assignedCount !== 1 ? 's' : ''} Created
              </Text>
              <Text style={st.doneSub}>
                "{workoutName}" assigned to {assignedCount} member
                {assignedCount !== 1 ? 's' : ''} for {formatDateDisplay(selectedDate)}
              </Text>
              <Pressable
                style={st.doneBtn}
                onPress={() => {
                  onDone(assignedCount);
                  onClose();
                }}
              >
                <Text style={st.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          )}
    </ModalSheet>
  );
}

const st = StyleSheet.create({
  // overlay + sheet styles removed — now handled by ModalSheet component
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  workoutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 12,
  },
  workoutBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
    maxWidth: 200,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FB,
    paddingVertical: 10,
  },
  selectAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  listWrap: {
    maxHeight: 320,
    paddingHorizontal: 20,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  memberRowSelected: {
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4A5568',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  memberEmail: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 40,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  selectedCount: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5A623',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  nextBtnDisabled: {
    opacity: 0.4,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  scheduleWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  scheduleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    marginBottom: 12,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  quickBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  quickBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: '#F5A623',
  },
  quickBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
  },
  quickBtnTextActive: {
    color: '#F5A623',
  },
  dateInput: {
    fontSize: 16,
    color: '#F0F4F8',
    fontFamily: FB,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  datePreview: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginBottom: 20,
  },
  summaryText: {
    fontSize: 14,
    color: '#C8CED6',
    fontFamily: FB,
    lineHeight: 22,
    marginBottom: 20,
    textAlign: 'center',
  },
  scheduleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  backBtnText: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FH,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5A623',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  progressWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    gap: 16,
  },
  progressText: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#1A1E26',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  doneWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 12,
  },
  doneTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  doneSub: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneBtn: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 12,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
});
