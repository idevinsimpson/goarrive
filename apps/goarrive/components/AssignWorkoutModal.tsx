/**
 * AssignWorkoutModal — Assign a workout to a member
 *
 * Adaptive multi-step flow:
 *   A) From Members screen (member known): Pick Workout → Schedule → Confirm
 *   B) From Build screen (workout known): Pick Member → Schedule → Confirm
 *   C) Standalone: Pick Workout → Pick Member → Schedule → Confirm
 *
 * Phase 4: Now includes a member picker step so coaches can assign
 * workouts from the Build screen without first navigating to Members.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useRecurringSchedule } from '../hooks/useRecurringSchedule';
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
  Linking,
} from 'react-native';
import { Icon } from './Icon';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkoutPickerItem {
  id: string;
  name: string;
  exerciseCount: number;
  category: string;
}

interface MemberPickerItem {
  id: string;
  name: string;
  email: string;
}

interface Props {
  visible: boolean;
  /** Pre-selected member name (from Members screen). Empty = show member picker. */
  memberName: string;
  /** Pre-selected member ID (from Members screen). Empty = show member picker. */
  memberId?: string;
  coachId: string;
  onClose: () => void;
  onAssign: (workoutId: string, workoutName: string, scheduledFor: Date, memberId: string) => void;
  /** When provided, skip the workout-picker step (Build screen flow) */
  preselectedWorkoutId?: string;
  preselectedWorkoutName?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getQuickDates(): Array<{ label: string; date: Date }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const nextMonday = new Date(today);
  const dayOfWeek = nextMonday.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: tomorrow },
    { label: 'Next Monday', date: nextMonday },
  ];
}

function showAlert(title: string, msg: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${msg}`);
  } else {
    Alert.alert(title, msg);
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ── Component ──────────────────────────────────────────────────────────────

type Step = 'pickWorkout' | 'pickMember' | 'schedule' | 'success';

export default function AssignWorkoutModal({
  visible,
  memberName,
  memberId: preselectedMemberId,
  coachId,
  onClose,
  onAssign,
  preselectedWorkoutId,
  preselectedWorkoutName,
}: Props) {
  // ── State ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('pickWorkout');
  const [workouts, setWorkouts] = useState<WorkoutPickerItem[]>([]);
  const [members, setMembers] = useState<MemberPickerItem[]>([]);
  const [loadingWorkouts, setLoadingWorkouts] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [workoutSearch, setWorkoutSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutPickerItem | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberPickerItem | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState(toDateString(new Date()));
  const [assigning, setAssigning] = useState(false);

  // Workout preview
  const [previewBlocks, setPreviewBlocks] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Recurring schedule
  const recurring = useRecurringSchedule();
  const { isRecurring, recurringDays, recurringWeeks } = recurring;

  // Success state
  const [lastAssignedName, setLastAssignedName] = useState('');

  // Derived: do we need a member picker?
  const hasMemberPreselected = !!(preselectedMemberId && memberName);
  // Derived: do we need a workout picker?
  const hasWorkoutPreselected = !!(preselectedWorkoutId && preselectedWorkoutName);

  // The effective member name for display
  const effectiveMemberName = selectedMember?.name || memberName || '';
  const effectiveMemberId = selectedMember?.id || preselectedMemberId || '';

  // ── Load workouts ─────────────────────────────────────────────────────

  const loadWorkouts = useCallback(async () => {
    if (!coachId) return;
    setLoadingWorkouts(true);
    try {
      const q = query(
        collection(db, 'workouts'),
        where('coachId', '==', coachId),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      setWorkouts(
        snap.docs
          .filter((d) => !d.data().isArchived)
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name ?? 'Untitled',
              exerciseCount: Array.isArray(data.exercises) ? data.exercises.length : 0,
              category: data.category ?? '',
            };
          }),
      );
    } catch (err) {
      console.error('Failed to load workouts for assignment:', err);
    } finally {
      setLoadingWorkouts(false);
    }
  }, [coachId]);

  // ── Load members ──────────────────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    if (!coachId) return;
    setLoadingMembers(true);
    try {
      const q = query(
        collection(db, 'members'),
        where('coachId', '==', coachId),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      setMembers(
        snap.docs
          .filter((d) => !d.data().isArchived)
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name || data.displayName || (data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : '') || 'Unnamed',
              email: data.email ?? '',
            };
          }),
      );
    } catch (err) {
      console.error('Failed to load members for assignment:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [coachId]);

  // ── Reset state when modal opens ──────────────────────────────────────

  useEffect(() => {
    if (visible) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedDate(today);
      setDateInput(toDateString(today));
      setAssigning(false);
      setLastAssignedName('');
      setWorkoutSearch('');
      setMemberSearch('');
      setPreviewBlocks([]);
      recurring.reset();

      if (hasWorkoutPreselected) {
        // Build screen flow: workout known, need member
        setSelectedWorkout({
          id: preselectedWorkoutId!,
          name: preselectedWorkoutName!,
          exerciseCount: 0,
          category: '',
        });
        if (hasMemberPreselected) {
          // Both known — go straight to schedule
          setSelectedMember({ id: preselectedMemberId!, name: memberName, email: '' });
          setStep('schedule');
        } else {
          // Need to pick a member
          setSelectedMember(null);
          setStep('pickMember');
          loadMembers();
        }
      } else if (hasMemberPreselected) {
        // Members screen flow: member known, need workout
        setSelectedMember({ id: preselectedMemberId!, name: memberName, email: '' });
        setSelectedWorkout(null);
        setStep('pickWorkout');
        loadWorkouts();
      } else {
        // Standalone: need both
        setSelectedWorkout(null);
        setSelectedMember(null);
        setStep('pickWorkout');
        loadWorkouts();
      }
    }
  }, [visible, loadWorkouts, loadMembers, preselectedWorkoutId, preselectedWorkoutName, preselectedMemberId, memberName]);

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleSelectWorkout(w: WorkoutPickerItem) {
    setSelectedWorkout(w);
    // Load preview
    setPreviewLoading(true);
    setPreviewBlocks([]);
    try {
      const workoutDoc = await getDoc(doc(db, 'workouts', w.id));
      if (workoutDoc.exists()) {
        setPreviewBlocks(workoutDoc.data().blocks ?? []);
      }
    } catch (err) {
      console.warn('Could not load workout preview:', err);
    } finally {
      setPreviewLoading(false);
    }

    if (hasMemberPreselected || selectedMember) {
      // Member already known — go to schedule
      setStep('schedule');
    } else {
      // Need to pick a member next
      setStep('pickMember');
      loadMembers();
    }
  }

  function handleSelectMember(m: MemberPickerItem) {
    setSelectedMember(m);
    setStep('schedule');
    // If workout was preselected, load its preview now
    if (hasWorkoutPreselected && previewBlocks.length === 0) {
      setPreviewLoading(true);
      getDoc(doc(db, 'workouts', preselectedWorkoutId!))
        .then((snap) => {
          if (snap.exists()) setPreviewBlocks(snap.data().blocks ?? []);
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    }
  }

  function handleBack() {
    if (step === 'schedule') {
      if (!hasMemberPreselected && !hasWorkoutPreselected) {
        // Standalone: go back to member picker
        setStep('pickMember');
      } else if (hasWorkoutPreselected && !hasMemberPreselected) {
        // Build flow: go back to member picker
        setStep('pickMember');
      } else {
        // Members flow: go back to workout picker
        setStep('pickWorkout');
        setSelectedWorkout(null);
      }
    } else if (step === 'pickMember') {
      if (!hasWorkoutPreselected) {
        // Standalone: go back to workout picker
        setStep('pickWorkout');
        setSelectedWorkout(null);
      } else {
        // Build flow: member picker is first step, close modal
        onClose();
      }
    }
  }

  function handleDateInputChange(text: string) {
    setDateInput(text);
    const parts = text.split('-');
    if (parts.length === 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      if (!isNaN(y) && !isNaN(m) && !isNaN(d) && y > 2000) {
        const parsed = new Date(y, m, d);
        parsed.setHours(0, 0, 0, 0);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (!isNaN(parsed.getTime()) && parsed >= now) {
          setSelectedDate(parsed);
        }
      }
    }
  }

  function handleQuickDate(date: Date) {
    setSelectedDate(date);
    setDateInput(toDateString(date));
  }

  async function handleConfirm() {
    if (!selectedWorkout || assigning) return;
    if (!effectiveMemberId) {
      showAlert('No Member Selected', 'Please select a member to assign this workout to.');
      return;
    }
    // Validate date
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (selectedDate < now) {
      showAlert('Invalid Date', 'Cannot assign a workout to a past date. Please select today or a future date.');
      return;
    }
    setAssigning(true);
    try {
      const dates = recurring.generateDates(selectedDate);
      for (const d of dates) {
        await onAssign(selectedWorkout.id, selectedWorkout.name, d, effectiveMemberId);
      }
      setLastAssignedName(selectedWorkout.name);
      setStep('success');
    } finally {
      setAssigning(false);
    }
  }

  function handleAssignAnother() {
    setSelectedWorkout(hasWorkoutPreselected ? selectedWorkout : null);
    setSelectedMember(hasMemberPreselected ? selectedMember : null);
    setWorkoutSearch('');
    setMemberSearch('');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
    setDateInput(toDateString(today));
    recurring.reset();
    // Go back to the first step that needs selection
    if (hasWorkoutPreselected && hasMemberPreselected) {
      setStep('schedule');
    } else if (hasWorkoutPreselected) {
      setStep('pickMember');
    } else {
      setStep('pickWorkout');
    }
  }

  // ── Filtered lists ────────────────────────────────────────────────────

  const filteredWorkouts = workouts.filter((w) => {
    if (!workoutSearch) return true;
    const q = workoutSearch.toLowerCase();
    return w.name.toLowerCase().includes(q) || w.category.toLowerCase().includes(q);
  });

  const filteredMembers = members.filter((m) => {
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  const quickDates = getQuickDates();

  // ── Header ────────────────────────────────────────────────────────────

  function getHeaderTitle(): string {
    switch (step) {
      case 'pickWorkout': return 'Choose Workout';
      case 'pickMember': return 'Choose Member';
      case 'schedule': return 'Schedule';
      case 'success': return 'Assigned!';
    }
  }

  const showBackButton = step === 'schedule' || (step === 'pickMember' && !hasWorkoutPreselected);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            {step === 'success' ? (
              <View style={{ width: 24 }} />
            ) : showBackButton ? (
              <Pressable onPress={handleBack} hitSlop={12}>
                <Icon name="arrow-left" size={24} color="#8A95A3" />
              </Pressable>
            ) : (
              <Pressable onPress={onClose} hitSlop={12}>
                <Icon name="close" size={24} color="#8A95A3" />
              </Pressable>
            )}
            <Text style={s.headerTitle}>{getHeaderTitle()}</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Context badges — show what's already selected */}
          <View style={s.badgeRow}>
            {selectedWorkout && step !== 'pickWorkout' && (
              <View style={s.contextBadge}>
                <Icon name="workouts" size={12} color="#F5A623" />
                <Text style={s.contextBadgeText} numberOfLines={1}>{selectedWorkout.name}</Text>
              </View>
            )}
            {effectiveMemberName && step !== 'pickMember' && (
              <View style={[s.contextBadge, s.memberContextBadge]}>
                <Icon name="person" size={12} color="#7DD3FC" />
                <Text style={[s.contextBadgeText, { color: '#7DD3FC' }]} numberOfLines={1}>{effectiveMemberName}</Text>
              </View>
            )}
          </View>

          {/* ── SUCCESS STEP ──────────────────────────────────────── */}
          {step === 'success' ? (
            <View style={s.successWrap}>
              <View style={s.successIconWrap}>
                <Icon name="check-circle" size={56} color="#6EBB7A" />
              </View>
              <Text style={s.successTitle}>Workout Assigned!</Text>
              <Text style={s.successSub}>
                "{lastAssignedName}" has been assigned to {effectiveMemberName}.
              </Text>

              <Pressable style={s.assignAnotherBtn} onPress={handleAssignAnother}>
                <Icon name="add" size={20} color="#F5A623" />
                <Text style={s.assignAnotherText}>Assign Another</Text>
              </Pressable>

              {/* Google Calendar deep link */}
              <Pressable
                style={s.calendarBtn}
                onPress={() => {
                  const start = new Date(selectedDate);
                  start.setHours(9, 0, 0, 0);
                  const end = new Date(start);
                  end.setHours(10, 0, 0, 0);
                  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
                  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(lastAssignedName || 'Workout')}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent('Assigned via GoArrive. Open the app to start your workout.')}`;
                  Linking.openURL(url).catch(() => {});
                }}
              >
                <Icon name="calendar" size={18} color="#5B9BD5" />
                <Text style={s.calendarBtnText}>Add to Google Calendar</Text>
              </Pressable>

              <Pressable style={s.doneBtn} onPress={onClose}>
                <Text style={s.doneBtnText}>Done</Text>
              </Pressable>
            </View>

          /* ── PICK WORKOUT STEP ──────────────────────────────────── */
          ) : step === 'pickWorkout' ? (
            <>
              <View style={s.searchRow}>
                <View style={s.searchWrap}>
                  <Icon name="search" size={16} color="#4A5568" />
                  <TextInput
                    style={s.searchInput}
                    value={workoutSearch}
                    onChangeText={setWorkoutSearch}
                    placeholder="Search workouts…"
                    placeholderTextColor="#4A5568"
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {workoutSearch.length > 0 && (
                    <Pressable onPress={() => setWorkoutSearch('')} hitSlop={8}>
                      <Icon name="x-circle" size={16} color="#4A5568" />
                    </Pressable>
                  )}
                </View>
              </View>

              {loadingWorkouts ? (
                <View style={s.loadingWrap}>
                  <ActivityIndicator size="small" color="#F5A623" />
                </View>
              ) : filteredWorkouts.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Icon name="workouts" size={40} color="#2A3040" />
                  <Text style={s.emptyText}>
                    {workoutSearch
                      ? 'No workouts match your search.'
                      : 'No active workouts to assign. Create a workout first.'}
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={s.list}
                  contentContainerStyle={s.listContent}
                  showsVerticalScrollIndicator={false}
                >
                  {filteredWorkouts.map((w) => (
                    <Pressable
                      key={w.id}
                      style={s.workoutCard}
                      onPress={() => handleSelectWorkout(w)}
                    >
                      <View style={s.workoutIcon}>
                        <Icon name="workouts" size={20} color="#F5A623" />
                      </View>
                      <View style={s.cardInfo}>
                        <Text style={s.cardName} numberOfLines={1}>{w.name}</Text>
                        <Text style={s.cardMeta}>
                          {w.exerciseCount} exercise{w.exerciseCount !== 1 ? 's' : ''}
                          {w.category ? ` · ${w.category}` : ''}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={18} color="#4A5568" />
                    </Pressable>
                  ))}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </>

          /* ── PICK MEMBER STEP ──────────────────────────────────── */
          ) : step === 'pickMember' ? (
            <>
              <View style={s.searchRow}>
                <View style={s.searchWrap}>
                  <Icon name="search" size={16} color="#4A5568" />
                  <TextInput
                    style={s.searchInput}
                    value={memberSearch}
                    onChangeText={setMemberSearch}
                    placeholder="Search members…"
                    placeholderTextColor="#4A5568"
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {memberSearch.length > 0 && (
                    <Pressable onPress={() => setMemberSearch('')} hitSlop={8}>
                      <Icon name="x-circle" size={16} color="#4A5568" />
                    </Pressable>
                  )}
                </View>
              </View>

              {loadingMembers ? (
                <View style={s.loadingWrap}>
                  <ActivityIndicator size="small" color="#F5A623" />
                </View>
              ) : filteredMembers.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Icon name="person" size={40} color="#2A3040" />
                  <Text style={s.emptyText}>
                    {memberSearch
                      ? 'No members match your search.'
                      : 'No active members. Add a member first.'}
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={s.list}
                  contentContainerStyle={s.listContent}
                  showsVerticalScrollIndicator={false}
                >
                  {filteredMembers.map((m) => (
                    <Pressable
                      key={m.id}
                      style={s.memberCard}
                      onPress={() => handleSelectMember(m)}
                    >
                      <View style={s.memberAvatar}>
                        <Text style={s.memberAvatarText}>{getInitials(m.name)}</Text>
                      </View>
                      <View style={s.cardInfo}>
                        <Text style={s.cardName} numberOfLines={1}>{m.name}</Text>
                        {m.email ? (
                          <Text style={s.cardMeta} numberOfLines={1}>{m.email}</Text>
                        ) : null}
                      </View>
                      <Icon name="chevron-right" size={18} color="#4A5568" />
                    </Pressable>
                  ))}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </>

          /* ── SCHEDULE STEP ──────────────────────────────────────── */
          ) : (
            <ScrollView
              style={s.list}
              contentContainerStyle={s.scheduleContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Selected workout summary */}
              <View style={s.selectedSummary}>
                <Icon name="workouts" size={18} color="#F5A623" />
                <Text style={s.selectedName} numberOfLines={1}>
                  {selectedWorkout?.name}
                </Text>
              </View>

              {/* Workout preview */}
              {previewLoading ? (
                <ActivityIndicator size="small" color="#F5A623" style={{ marginVertical: 8 }} />
              ) : previewBlocks.length > 0 ? (
                <View style={s.previewSection}>
                  <Text style={s.previewTitle}>Workout Preview</Text>
                  {previewBlocks.map((block: any, bi: number) => (
                    <View key={bi} style={s.previewBlock}>
                      <Text style={s.previewBlockLabel}>
                        {block.label || block.type || `Block ${bi + 1}`}
                        {block.rounds ? ` · ${block.rounds} rounds` : ''}
                      </Text>
                      {Array.isArray(block.movements) && block.movements.map((mv: any, mi: number) => (
                        <Text key={mi} style={s.previewMovement}>
                          {'  '}• {mv.movementName || 'Movement'}
                          {mv.sets ? ` — ${mv.sets} sets` : ''}
                          {mv.reps ? ` × ${mv.reps}` : ''}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Quick date buttons */}
              <Text style={s.sectionLabel}>Quick Select</Text>
              <View style={s.quickDateRow}>
                {quickDates.map((qd) => {
                  const isActive = toDateString(selectedDate) === toDateString(qd.date);
                  return (
                    <Pressable
                      key={qd.label}
                      style={[s.quickDateBtn, isActive && s.quickDateBtnActive]}
                      onPress={() => handleQuickDate(qd.date)}
                    >
                      <Text
                        style={[
                          s.quickDateBtnText,
                          isActive && s.quickDateBtnTextActive,
                        ]}
                      >
                        {qd.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Manual date input */}
              <Text style={s.sectionLabel}>Or Enter Date</Text>
              <TextInput
                style={s.dateInput}
                value={dateInput}
                onChangeText={handleDateInputChange}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#4A5568"
                keyboardType="default"
                autoCorrect={false}
              />
              <Text style={s.datePreview}>
                {formatDateDisplay(selectedDate)}
              </Text>

              {/* Recurring toggle */}
              <View style={s.recurringSection}>
                <Pressable
                  style={s.recurringToggle}
                  onPress={recurring.toggleRecurring}
                >
                  <View style={[s.checkbox, isRecurring && s.checkboxActive]}>
                    {isRecurring && <Icon name="check" size={12} color="#0E1117" />}
                  </View>
                  <Text style={s.recurringLabel}>Repeat weekly</Text>
                </Pressable>

                {isRecurring && (
                  <View style={s.recurringOptions}>
                    <Text style={s.recurringSubLabel}>Days of the week</Text>
                    <View style={s.dayRow}>
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => {
                        const active = recurringDays.includes(i);
                        return (
                          <Pressable
                            key={label}
                            style={[s.dayBtn, active && s.dayBtnActive]}
                            onPress={() => recurring.toggleDay(i)}
                          >
                            <Text style={[s.dayBtnText, active && s.dayBtnTextActive]}>
                              {label.charAt(0)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={s.recurringSubLabel}>For how many weeks?</Text>
                    <View style={s.weeksRow}>
                      {[2, 4, 6, 8].map((w) => (
                        <Pressable
                          key={w}
                          style={[s.weekBtn, recurringWeeks === w && s.weekBtnActive]}
                          onPress={() => recurring.setRecurringWeeks(w)}
                        >
                          <Text style={[s.weekBtnText, recurringWeeks === w && s.weekBtnTextActive]}>
                            {w}w
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* Confirm button */}
              <Pressable
                style={[s.confirmBtn, assigning && s.confirmBtnDisabled]}
                onPress={handleConfirm}
                disabled={assigning}
              >
                {assigning ? (
                  <ActivityIndicator size="small" color="#0E1117" />
                ) : (
                  <>
                    <Icon name="check" size={20} color="#0E1117" />
                    <Text style={s.confirmBtnText}>
                      Assign to {effectiveMemberName}
                    </Text>
                  </>
                )}
              </Pressable>

              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    overflow: "hidden" as const,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '60%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
  },
  contextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  memberContextBadge: {
    backgroundColor: 'rgba(125,211,252,0.1)',
    borderColor: 'rgba(125,211,252,0.2)',
  },
  contextBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    maxWidth: 140,
  },
  searchRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 22,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    paddingTop: 12,
  },
  // Workout card
  workoutCard: {
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
  workoutIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  cardMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginTop: 2,
  },
  // Member card
  memberCard: {
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
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(125,211,252,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FONT_HEADING,
  },
  // Schedule step
  scheduleContent: {
    padding: 20,
  },
  selectedSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  selectedName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    flex: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  quickDateBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  quickDateBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  quickDateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  quickDateBtnTextActive: {
    color: '#F5A623',
  },
  dateInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  datePreview: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginBottom: 32,
    paddingLeft: 4,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    paddingVertical: 16,
    borderRadius: 14,
  },
  confirmBtnDisabled: {
    opacity: 0.6,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  // Workout preview
  previewSection: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  previewBlock: {
    marginBottom: 8,
  },
  previewBlockLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    marginBottom: 4,
  },
  previewMovement: {
    fontSize: 12,
    color: '#A0AEC0',
    fontFamily: FONT_BODY,
    lineHeight: 18,
  },
  // Success step
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
    gap: 12,
  },
  successIconWrap: {
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  successSub: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  assignAnotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
  },
  assignAnotherText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(91,155,213,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.25)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
  },
  calendarBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#5B9BD5',
    fontFamily: FONT_HEADING,
  },
  doneBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  // Recurring schedule
  recurringSection: {
    marginTop: 20,
    marginBottom: 16,
  },
  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4A5568',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  recurringLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
  },
  recurringOptions: {
    marginTop: 14,
    gap: 10,
  },
  recurringSubLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayRow: {
    flexDirection: 'row',
    gap: 6,
  },
  dayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dayBtnActive: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  dayBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  dayBtnTextActive: {
    color: '#0E1117',
  },
  weeksRow: {
    flexDirection: 'row',
    gap: 8,
  },
  weekBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  weekBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.4)',
  },
  weekBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  weekBtnTextActive: {
    color: '#F5A623',
  },
});
