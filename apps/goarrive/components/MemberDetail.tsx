/**
 * MemberDetail — Member Hub bottom sheet
 *
 * Tapping a member opens this full-featured hub. The top section shows the
 * member's name, contact info, and quick-action buttons. Below that is a grid
 * of action tiles — some live now, others marked "Coming Soon" for future
 * features described in the GoArrive blueprint.
 *
 * Live actions:
 *   - View Plan / Intake (navigates to member-plan page)
 *   - Edit Profile (opens MemberForm)
 *   - Archive / Restore
 *   - Schedule (assign recurring time slot with multi-day support)
 *
 * Coming Soon tiles (future blueprint features):
 *   - Workouts & Playlist
 *   - Sessions & Stats
 *   - Messages
 *   - Check-in Call
 *   - Measurements & Photos
 *   - Coach Notes
 *   - Referrals
 *   - Coach Videos
 *   - Journal
 *   - Send Password Reset
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { router } from 'expo-router';
import { DAY_LABELS, DAY_SHORT_LABELS, formatTime, addMinutesToTime, type GuidancePhase, type SessionType, type RoomSource } from '../lib/schedulingTypes';
import { type Phase, type MemberPlanData, resolvePhaseColor } from '../lib/planTypes';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const BG = '#0E1117';
const CARD = '#111827';
const CARD2 = '#151B28';
const BORDER = '#1E2A3A';
const MUTED = '#8A95A3';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const BLUE = '#7DD3FC';
const RED = '#E05252';

const { width: SCREEN_W } = Dimensions.get('window');

interface MemberDetailProps {
  member: any;
  onClose: () => void;
  onEdit: (member: any) => void;
  onArchive: (member: any) => void;
}

interface HubTile {
  icon: string;
  label: string;
  sublabel?: string;
  color: string;
  bgColor: string;
  live: boolean;
  onPress?: () => void;
}

// ── Time slot options ────────────────────────────────────────────────────────
const TIME_OPTIONS: string[] = [];
for (let h = 5; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

const DURATION_OPTIONS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

const TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
];

// Phase mapping: plan intensity → scheduling guidance phase
const INTENSITY_TO_PHASE: Record<string, GuidancePhase> = {
  'Fully Guided': 'coach_guided',
  'Shared Guidance': 'shared_guidance',
  'Self-Reliant': 'self_guided',
};

// Phase colors for scheduling UI
const SCHED_PHASE_COLORS: Record<GuidancePhase, string> = {
  coach_guided: GREEN,
  shared_guidance: GOLD,
  self_guided: '#7DD3FC',
};

const SCHED_PHASE_LABELS: Record<GuidancePhase, string> = {
  coach_guided: 'Coach Guided',
  shared_guidance: 'Shared Guidance',
  self_guided: 'Self Guided',
};

// ── Multi-day state type ────────────────────────────────────────────────────
interface DayTimeEntry {
  dayOfWeek: number;
  startTime: string;
}

export default function MemberDetail({
  member,
  onClose,
  onEdit,
  onArchive,
}: MemberDetailProps) {
  const [currentMember, setCurrentMember] = useState(member);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);

  // Plan data for phase sync
  const [memberPlan, setMemberPlan] = useState<MemberPlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planPhaseOverride, setPlanPhaseOverride] = useState(false);

  // Schedule form state — multi-day
  const [selectedDays, setSelectedDays] = useState<DayTimeEntry[]>([
    { dayOfWeek: 1, startTime: '06:00' },
  ]);
  const [editingTimeForDay, setEditingTimeForDay] = useState<number | null>(null);

  // Shared settings for all days in this batch
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [selectedTimezone, setSelectedTimezone] = useState('America/New_York');
  const [selectedPattern, setSelectedPattern] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [selectedWeekOfMonth, setSelectedWeekOfMonth] = useState<1 | 2 | 3 | 4>(1);
  const [selectedSessionType, setSelectedSessionType] = useState<SessionType>('strength');
  const [selectedPhase, setSelectedPhase] = useState<GuidancePhase>('coach_guided');
  const [coachJoining, setCoachJoining] = useState(true);
  const [creating, setCreating] = useState(false);

  // ── Load member data ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [member.id]);

  // Load existing slots for this member
  useEffect(() => {
    if (!member.id) return;
    const q = query(
      collection(db, 'recurring_slots'),
      where('memberId', '==', member.id),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setExistingSlots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubscribe();
  }, [member.id]);

  // ── Load member plan for phase sync ───────────────────────────────────────
  useEffect(() => {
    if (!member.id || !showScheduleModal) return;
    let cancelled = false;
    (async () => {
      setPlanLoading(true);
      try {
        // Try member.id as plan key first, then uid field
        const planDoc = await getDoc(doc(db, 'member_plans', member.id));
        if (planDoc.exists() && !cancelled) {
          setMemberPlan(planDoc.data() as MemberPlanData);
        } else {
          // Try querying by memberId
          const q = query(collection(db, 'member_plans'), where('memberId', '==', member.id));
          const snap = await getDocs(q);
          if (!snap.empty && !cancelled) {
            setMemberPlan(snap.docs[0].data() as MemberPlanData);
          }
        }
      } catch (err) {
        console.warn('[MemberDetail] Failed to load plan:', err);
      }
      if (!cancelled) setPlanLoading(false);
    })();
    return () => { cancelled = true; };
  }, [member.id, showScheduleModal]);

  // ── Derived phase data from plan ──────────────────────────────────────────
  const planPhases = useMemo(() => {
    if (!memberPlan?.phases?.length) return null;
    return memberPlan.phases;
  }, [memberPlan]);

  const totalWeeks = useMemo(() => {
    if (!planPhases) return 0;
    return planPhases.reduce((sum, p) => sum + (p.weeks || 0), 0);
  }, [planPhases]);

  // Map plan phases to scheduling phase labels with week counts
  const phaseWeekMap = useMemo(() => {
    const map: Record<GuidancePhase, number> = { coach_guided: 0, shared_guidance: 0, self_guided: 0 };
    if (!planPhases) return map;
    for (const p of planPhases) {
      const schedPhase = INTENSITY_TO_PHASE[p.intensity];
      if (schedPhase) map[schedPhase] += p.weeks;
    }
    return map;
  }, [planPhases]);

  const initials = currentMember.name
    ? currentMember.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  function navigateToPlan() {
    onClose();
    router.push(`/(app)/member-plan/${currentMember.id}` as any);
  }

  // ── Multi-day toggle ──────────────────────────────────────────────────────
  function toggleDay(dayIdx: number) {
    setSelectedDays(prev => {
      const exists = prev.find(d => d.dayOfWeek === dayIdx);
      if (exists) {
        // Don't remove if it's the last one
        if (prev.length <= 1) return prev;
        return prev.filter(d => d.dayOfWeek !== dayIdx);
      }
      return [...prev, { dayOfWeek: dayIdx, startTime: '06:00' }].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    });
  }

  function updateDayTime(dayIdx: number, time: string) {
    setSelectedDays(prev =>
      prev.map(d => d.dayOfWeek === dayIdx ? { ...d, startTime: time } : d)
    );
    setEditingTimeForDay(null);
  }

  // ── Room source auto-routing ──────────────────────────────────────────────
  const resolvedRoomSource = useMemo((): RoomSource => {
    if (selectedPhase === 'coach_guided') return 'coach_personal';
    if (selectedPhase === 'self_guided') return 'shared_pool';
    // shared_guidance: depends on coach joining toggle
    return coachJoining ? 'coach_personal' : 'shared_pool';
  }, [selectedPhase, coachJoining]);

  // ── Create slots (one per selected day) ───────────────────────────────────
  const handleCreateSlots = useCallback(async () => {
    setCreating(true);
    try {
      const fn = httpsCallable(functions, 'createRecurringSlot');
      let totalInstances = 0;
      const dayNames: string[] = [];

      for (const entry of selectedDays) {
        const result = await fn({
          memberId: member.id,
          memberName: currentMember.name || 'Unknown',
          dayOfWeek: entry.dayOfWeek,
          startTime: entry.startTime,
          durationMinutes: selectedDuration,
          timezone: selectedTimezone,
          recurrencePattern: selectedPattern,
          weekOfMonth: selectedPattern === 'monthly' ? selectedWeekOfMonth : undefined,
          sessionType: selectedSessionType,
          guidancePhase: selectedPhase,
          roomSource: resolvedRoomSource,
          coachJoining: selectedPhase === 'shared_guidance' ? coachJoining : selectedPhase === 'coach_guided',
        });
        const data = result.data as any;
        totalInstances += data.instancesGenerated || 0;
        dayNames.push(`${DAY_LABELS[entry.dayOfWeek]} ${formatTime(entry.startTime)}`);
      }

      Alert.alert(
        selectedDays.length > 1 ? 'Slots Created' : 'Slot Created',
        `${selectedDays.length} recurring slot${selectedDays.length > 1 ? 's' : ''} created:\n${dayNames.join(', ')}\n\n${totalInstances} total sessions generated for the next 4 weeks.`
      );
      setShowScheduleModal(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create slot(s)');
    }
    setCreating(false);
  }, [member.id, currentMember.name, selectedDays, selectedDuration, selectedTimezone, selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase, coachJoining, resolvedRoomSource]);

  const handlePauseSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'pause' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to pause slot');
    }
  }, []);

  const handleResumeSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      await fn({ slotId, action: 'resume' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to resume slot');
    }
  }, []);

  const handleCancelSlot = useCallback(async (slotId: string) => {
    try {
      const fn = httpsCallable(functions, 'updateRecurringSlot');
      const result = await fn({ slotId, action: 'cancel' });
      const data = result.data as any;
      Alert.alert('Slot Cancelled', `${data.instancesCancelled || 0} future sessions cancelled.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to cancel slot');
    }
  }, []);

  const activeSlots = existingSlots.filter(s => s.status === 'active' || s.status === 'paused');
  const scheduleSubLabel = activeSlots.length > 0
    ? `${activeSlots.length} active slot${activeSlots.length !== 1 ? 's' : ''}`
    : 'Assign recurring time';

  const tiles: HubTile[] = [
    {
      icon: 'document',
      label: 'Plan & Intake',
      sublabel: 'View & edit fitness plan',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: true,
      onPress: navigateToPlan,
    },
    {
      icon: 'fitness',
      label: 'Workouts',
      sublabel: 'Playlist & rotation',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'activity',
      label: 'Sessions & Stats',
      sublabel: 'Past & upcoming sessions',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'calendar',
      label: 'Schedule',
      sublabel: scheduleSubLabel,
      color: '#A78BFA',
      bgColor: 'rgba(167,139,250,0.1)',
      live: true,
      onPress: () => setShowScheduleModal(true),
    },
    {
      icon: 'mail',
      label: 'Messages',
      sublabel: 'Direct communication',
      color: BLUE,
      bgColor: 'rgba(125,211,252,0.1)',
      live: false,
    },
    {
      icon: 'play-circle',
      label: 'Check-in Call',
      sublabel: 'Start Zoom session',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'trending-up',
      label: 'Measurements',
      sublabel: 'Progress & photos',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'edit',
      label: 'Coach Notes',
      sublabel: 'Check-in call notes',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'person',
      label: 'Referrals',
      sublabel: 'Members they referred',
      color: GOLD,
      bgColor: 'rgba(245,166,35,0.1)',
      live: false,
    },
    {
      icon: 'share',
      label: 'Coach Videos',
      sublabel: 'Social content for member',
      color: '#F472B6',
      bgColor: 'rgba(244,114,182,0.1)',
      live: false,
    },
    {
      icon: 'document',
      label: 'Journal',
      sublabel: 'Entries & comments',
      color: GREEN,
      bgColor: 'rgba(110,187,122,0.1)',
      live: false,
    },
    {
      icon: 'lock',
      label: 'Password Reset',
      sublabel: 'Send reset link',
      color: MUTED,
      bgColor: 'rgba(138,149,163,0.1)',
      live: false,
    },
  ];

  // ── Phase Timeline Component ──────────────────────────────────────────────
  function PhaseTimeline() {
    if (!planPhases || planPhases.length === 0) return null;
    const barWidth = SCREEN_W - 80; // padding on both sides
    return (
      <View style={s.timelineWrap}>
        <View style={s.timelineHeader}>
          <Text style={s.timelineTitleText}>Plan Phase Timeline</Text>
          <TouchableOpacity
            style={s.editPlanBtn}
            onPress={() => {
              setShowScheduleModal(false);
              navigateToPlan();
            }}
          >
            <Icon name="edit" size={12} color={GOLD} />
            <Text style={s.editPlanBtnText}>Edit Plan</Text>
          </TouchableOpacity>
        </View>
        <View style={s.timelineBar}>
          {planPhases.map((phase, idx) => {
            const pct = totalWeeks > 0 ? (phase.weeks / totalWeeks) : (1 / planPhases!.length);
            const color = resolvePhaseColor(phase.intensity);
            return (
              <View
                key={idx}
                style={[
                  s.timelineSegment,
                  {
                    width: Math.max(pct * barWidth, 30),
                    backgroundColor: color.bar,
                    borderTopLeftRadius: idx === 0 ? 6 : 0,
                    borderBottomLeftRadius: idx === 0 ? 6 : 0,
                    borderTopRightRadius: idx === planPhases!.length - 1 ? 6 : 0,
                    borderBottomRightRadius: idx === planPhases!.length - 1 ? 6 : 0,
                  },
                ]}
              >
                <Text style={s.timelineSegText} numberOfLines={1}>
                  {phase.weeks}w
                </Text>
              </View>
            );
          })}
        </View>
        <View style={s.timelineLegend}>
          {planPhases.map((phase, idx) => {
            const color = resolvePhaseColor(phase.intensity);
            return (
              <View key={idx} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: color.bar }]} />
                <Text style={s.legendText}>{phase.name}: {phase.weeks}w</Text>
              </View>
            );
          })}
          <Text style={[s.legendText, { marginLeft: 'auto' }]}>{totalWeeks} weeks total</Text>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Drag handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={s.headerInfo}>
              <Text style={s.name} numberOfLines={1}>
                {currentMember.name}
              </Text>
              <View style={s.headerMeta}>
                {currentMember.isArchived && (
                  <View style={s.archivedBadge}>
                    <Text style={s.archivedBadgeText}>Archived</Text>
                  </View>
                )}
                {currentMember.email ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.email}</Text>
                ) : currentMember.phone ? (
                  <Text style={s.metaText} numberOfLines={1}>{currentMember.phone}</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="x" size={22} color={MUTED} />
            </TouchableOpacity>
          </View>

          {/* Quick actions row */}
          <View style={s.quickActions}>
            <TouchableOpacity
              style={s.qaBtn}
              onPress={() => onEdit(currentMember)}
            >
              <Icon name="edit" size={16} color={GOLD} />
              <Text style={s.qaBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.qaBtn, currentMember.isArchived && s.qaBtnRestore]}
              onPress={() => onArchive(currentMember)}
            >
              <Icon
                name={currentMember.isArchived ? 'refresh' : 'archive'}
                size={16}
                color={currentMember.isArchived ? GREEN : RED}
              />
              <Text style={[s.qaBtnText, { color: currentMember.isArchived ? GREEN : RED }]}>
                {currentMember.isArchived ? 'Restore' : 'Archive'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Hub grid */}
          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.sectionLabel}>MEMBER HUB</Text>
            <View style={s.grid}>
              {tiles.map((tile) => (
                <TouchableOpacity
                  key={tile.label}
                  style={[s.tile, { backgroundColor: tile.bgColor, borderColor: tile.live ? tile.color + '40' : BORDER }]}
                  onPress={tile.live && tile.onPress ? tile.onPress : undefined}
                  activeOpacity={tile.live ? 0.7 : 1}
                >
                  <View style={[s.tileIcon, { backgroundColor: tile.bgColor }]}>
                    <Icon name={tile.icon as any} size={20} color={tile.live ? tile.color : MUTED} />
                  </View>
                  <Text style={[s.tileLabel, { color: tile.live ? '#F0F4F8' : MUTED }]} numberOfLines={1}>
                    {tile.label}
                  </Text>
                  {tile.sublabel ? (
                    <Text style={s.tileSublabel} numberOfLines={1}>{tile.sublabel}</Text>
                  ) : null}
                  {!tile.live && (
                    <View style={s.comingSoonBadge}>
                      <Text style={s.comingSoonText}>Soon</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>

      {/* Schedule Modal */}
      <Modal visible={showScheduleModal} transparent animationType="slide">
        <View style={s.schedOverlay}>
          <View style={s.schedSheet}>
            <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {/* Header */}
              <View style={s.schedHeader}>
                <Text style={s.schedTitle}>Schedule {currentMember.name?.split(' ')[0] || 'Member'}</Text>
                <TouchableOpacity onPress={() => setShowScheduleModal(false)} hitSlop={8}>
                  <Icon name="x" size={22} color={MUTED} />
                </TouchableOpacity>
              </View>

              {/* Plan Phase Timeline */}
              {planLoading ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={GOLD} />
                  <Text style={[s.slotMeta, { marginTop: 6 }]}>Loading plan data...</Text>
                </View>
              ) : (
                <PhaseTimeline />
              )}

              {/* Existing Slots */}
              {activeSlots.length > 0 && (
                <View style={s.schedSection}>
                  <Text style={s.schedSectionTitle}>Current Slots</Text>
                  {activeSlots.map(slot => {
                    const phaseColors: Record<string, string> = { coach_guided: GREEN, shared_guidance: GOLD, self_guided: '#7DD3FC' };
                    const phaseLabels: Record<string, string> = { coach_guided: 'Coach Guided', shared_guidance: 'Shared Guidance', self_guided: 'Self Guided' };
                    const stLabel = slot.sessionType === 'check_in' ? 'Check-in' : (slot.sessionType || '').charAt(0).toUpperCase() + (slot.sessionType || '').slice(1);
                    return (
                    <View key={slot.id} style={s.slotCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.slotDay}>
                          {DAY_LABELS[slot.dayOfWeek]} · {formatTime(slot.startTime)}
                        </Text>
                        <Text style={s.slotMeta}>
                          {slot.durationMinutes}min · {slot.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'}
                          {stLabel ? ` · ${stLabel}` : ''}
                        </Text>
                        {slot.guidancePhase && (
                          <Text style={[s.slotMeta, { color: phaseColors[slot.guidancePhase] || MUTED, fontWeight: '600' }]}>
                            {phaseLabels[slot.guidancePhase] || slot.guidancePhase}
                            {slot.guidancePhase === 'shared_guidance' && slot.coachJoining !== undefined
                              ? (slot.coachJoining ? ' (you join)' : ' (on their own)')
                              : ''}
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {slot.status === 'active' ? (
                          <TouchableOpacity
                            style={[s.slotActionBtn, { backgroundColor: 'rgba(245,166,35,0.1)' }]}
                            onPress={() => handlePauseSlot(slot.id)}
                          >
                            <Text style={[s.slotActionText, { color: GOLD }]}>Pause</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[s.slotActionBtn, { backgroundColor: 'rgba(110,187,122,0.1)' }]}
                            onPress={() => handleResumeSlot(slot.id)}
                          >
                            <Text style={[s.slotActionText, { color: GREEN }]}>Resume</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[s.slotActionBtn, { backgroundColor: 'rgba(224,82,82,0.1)' }]}
                          onPress={() => handleCancelSlot(slot.id)}
                        >
                          <Text style={[s.slotActionText, { color: RED }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    );
                  })}
                </View>
              )}

              {/* New Slot Form */}
              <View style={s.schedSection}>
                <Text style={s.schedSectionTitle}>
                  {activeSlots.length > 0 ? 'Add More Slots' : 'Create Recurring Slots'}
                </Text>

                {/* Session Type */}
                <Text style={s.fieldLabel}>Session Type</Text>
                <View style={s.dayRow}>
                  {(['strength', 'cardio', 'flexibility', 'hiit', 'recovery', 'check_in'] as SessionType[]).map(st => (
                    <TouchableOpacity
                      key={st}
                      style={[s.dayBtn, selectedSessionType === st && s.dayBtnActive, { minWidth: 70 }]}
                      onPress={() => setSelectedSessionType(st)}
                    >
                      <Text style={[s.dayBtnText, selectedSessionType === st && s.dayBtnTextActive, { fontSize: 12 }]}>
                        {st === 'check_in' ? 'Check-in' : st.charAt(0).toUpperCase() + st.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Guidance Phase — with week counts from plan */}
                <View style={s.phaseHeaderRow}>
                  <Text style={s.fieldLabel}>Guidance Phase</Text>
                  {planPhases && !planPhaseOverride && (
                    <TouchableOpacity onPress={() => setPlanPhaseOverride(true)}>
                      <Text style={s.overrideLink}>Override</Text>
                    </TouchableOpacity>
                  )}
                  {planPhaseOverride && (
                    <TouchableOpacity onPress={() => setPlanPhaseOverride(false)}>
                      <Text style={[s.overrideLink, { color: GREEN }]}>Sync to plan</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={s.dayRow}>
                  {([
                    { key: 'coach_guided' as GuidancePhase, label: 'Coach Guided', color: GREEN },
                    { key: 'shared_guidance' as GuidancePhase, label: 'Shared Guidance', color: GOLD },
                    { key: 'self_guided' as GuidancePhase, label: 'Self Guided', color: '#7DD3FC' },
                  ] as const).map(phase => {
                    const weekCount = phaseWeekMap[phase.key];
                    return (
                      <TouchableOpacity
                        key={phase.key}
                        style={[
                          s.phaseBtn,
                          selectedPhase === phase.key && { backgroundColor: phase.color + '18', borderColor: phase.color + '60' },
                        ]}
                        onPress={() => {
                          setSelectedPhase(phase.key);
                          if (phase.key === 'coach_guided') setCoachJoining(true);
                          if (phase.key === 'self_guided') setCoachJoining(false);
                        }}
                      >
                        <Text style={[
                          s.phaseBtnLabel,
                          selectedPhase === phase.key && { color: phase.color },
                        ]}>
                          {phase.label}
                        </Text>
                        {weekCount > 0 && (
                          <Text style={[
                            s.phaseBtnWeeks,
                            selectedPhase === phase.key && { color: phase.color },
                          ]}>
                            {weekCount} weeks
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Room Source Indicator (auto-determined) */}
                <View style={s.roomSourceRow}>
                  <Icon name="info" size={14} color={MUTED} />
                  <Text style={s.roomSourceText}>
                    Room: {resolvedRoomSource === 'coach_personal' ? 'Your Zoom' : 'Shared Pool'}
                    {selectedPhase === 'coach_guided' && ' (always your Zoom for Coach Guided)'}
                    {selectedPhase === 'self_guided' && ' (always shared pool for Self Guided)'}
                  </Text>
                </View>

                {/* Shared Guidance: Coach Joining Toggle */}
                {selectedPhase === 'shared_guidance' && (
                  <View style={s.coachToggleRow}>
                    <TouchableOpacity
                      style={s.toggleBtn}
                      onPress={() => setCoachJoining(!coachJoining)}
                    >
                      <View style={[s.toggleTrack, coachJoining && s.toggleTrackOn]}>
                        <View style={[s.toggleThumb, coachJoining && s.toggleThumbOn]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.toggleLabel}>
                          {coachJoining ? "You're joining live" : 'Member on their own'}
                        </Text>
                        <Text style={s.toggleHint}>
                          {coachJoining
                            ? 'Uses your personal Zoom room'
                            : 'Uses a shared room from the pool'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                )}

                {/* ── Multi-Day Selector ─────────────────────────────────────── */}
                <Text style={s.fieldLabel}>Days & Times</Text>
                <Text style={s.fieldHint}>Tap days to select. Each day gets its own start time.</Text>
                <View style={s.dayRow}>
                  {DAY_SHORT_LABELS.map((label, idx) => {
                    const isSelected = selectedDays.some(d => d.dayOfWeek === idx);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[s.dayBtn, isSelected && s.dayBtnActive]}
                        onPress={() => toggleDay(idx)}
                      >
                        <Text style={[s.dayBtnText, isSelected && s.dayBtnTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Per-day time pickers */}
                {selectedDays.map(entry => (
                  <View key={entry.dayOfWeek} style={s.dayTimeRow}>
                    <View style={s.dayTimeLabel}>
                      <Text style={s.dayTimeDayText}>{DAY_LABELS[entry.dayOfWeek]}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.dayTimeBtn}
                      onPress={() => setEditingTimeForDay(
                        editingTimeForDay === entry.dayOfWeek ? null : entry.dayOfWeek
                      )}
                    >
                      <Text style={s.dayTimeBtnText}>{formatTime(entry.startTime)}</Text>
                      <Icon name="chevron-down" size={14} color={MUTED} />
                    </TouchableOpacity>
                    <Text style={s.dayTimeEnd}>
                      — {formatTime(addMinutesToTime(entry.startTime, selectedDuration))}
                    </Text>
                  </View>
                ))}

                {/* Time picker dropdown for active day */}
                {editingTimeForDay !== null && (
                  <View style={s.timePickerWrap}>
                    <Text style={s.timePickerTitle}>
                      Set time for {DAY_LABELS[editingTimeForDay]}
                    </Text>
                    <ScrollView style={s.timeList} nestedScrollEnabled>
                      {TIME_OPTIONS.map(t => {
                        const isActive = selectedDays.find(d => d.dayOfWeek === editingTimeForDay)?.startTime === t;
                        return (
                          <TouchableOpacity
                            key={t}
                            style={[s.timeOption, isActive && s.timeOptionActive]}
                            onPress={() => updateDayTime(editingTimeForDay, t)}
                          >
                            <Text style={[s.timeOptionText, isActive && { color: GOLD }]}>
                              {formatTime(t)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Duration — sliding scale */}
                <Text style={s.fieldLabel}>Duration — {selectedDuration} min</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                  <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
                    {DURATION_OPTIONS.map(d => (
                      <TouchableOpacity
                        key={d}
                        style={[s.dayBtn, selectedDuration === d && s.dayBtnActive, { minWidth: 48, paddingHorizontal: 8 }]}
                        onPress={() => setSelectedDuration(d)}
                      >
                        <Text style={[s.dayBtnText, selectedDuration === d && s.dayBtnTextActive, { fontSize: 12 }]}>
                          {d}m
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                {/* Pattern */}
                <Text style={s.fieldLabel}>Recurrence</Text>
                <View style={s.dayRow}>
                  {(['weekly', 'biweekly', 'monthly'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[s.dayBtn, selectedPattern === p && s.dayBtnActive, { minWidth: 80 }]}
                      onPress={() => setSelectedPattern(p)}
                    >
                      <Text style={[s.dayBtnText, selectedPattern === p && s.dayBtnTextActive]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Week of Month — only visible when Monthly is selected */}
                {selectedPattern === 'monthly' && (
                  <>
                    <Text style={s.fieldLabel}>Which week?</Text>
                    <View style={s.dayRow}>
                      {([1, 2, 3, 4] as const).map(w => {
                        const labels = ['1st', '2nd', '3rd', '4th'];
                        return (
                          <TouchableOpacity
                            key={w}
                            style={[s.dayBtn, selectedWeekOfMonth === w && s.dayBtnActive, { minWidth: 60 }]}
                            onPress={() => setSelectedWeekOfMonth(w)}
                          >
                            <Text style={[s.dayBtnText, selectedWeekOfMonth === w && s.dayBtnTextActive]}>
                              {labels[w - 1]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {/* Timezone */}
                <Text style={s.fieldLabel}>Timezone</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
                    {TIMEZONE_OPTIONS.map(tz => {
                      const short = tz.split('/')[1]?.replace(/_/g, ' ') || tz;
                      return (
                        <TouchableOpacity
                          key={tz}
                          style={[s.dayBtn, selectedTimezone === tz && s.dayBtnActive, { minWidth: 70 }]}
                          onPress={() => setSelectedTimezone(tz)}
                        >
                          <Text style={[s.dayBtnText, selectedTimezone === tz && s.dayBtnTextActive, { fontSize: 11 }]}>
                            {short}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>

                {/* Summary */}
                <View style={s.summaryCard}>
                  <Text style={s.summaryText}>
                    {selectedDays.length === 1
                      ? `${DAY_LABELS[selectedDays[0].dayOfWeek]}s at ${formatTime(selectedDays[0].startTime)} for ${selectedDuration} min`
                      : `${selectedDays.length} days/week for ${selectedDuration} min each`}
                    {selectedPattern === 'monthly'
                      ? `, ${['1st', '2nd', '3rd', '4th'][selectedWeekOfMonth - 1]} week monthly`
                      : `, ${selectedPattern}`}
                  </Text>
                  {selectedDays.length > 1 && (
                    <Text style={s.summaryDays}>
                      {selectedDays.map(d => `${DAY_SHORT_LABELS[d.dayOfWeek]} ${formatTime(d.startTime)}`).join(' · ')}
                    </Text>
                  )}
                  <Text style={s.summaryMeta}>
                    {selectedSessionType === 'check_in' ? 'Check-in' : selectedSessionType.charAt(0).toUpperCase() + selectedSessionType.slice(1)}
                    {' · '}
                    {SCHED_PHASE_LABELS[selectedPhase]}
                    {selectedPhase === 'shared_guidance' && (coachJoining ? ' (you join)' : ' (on their own)')}
                  </Text>
                  <Text style={s.summaryMeta}>
                    {resolvedRoomSource === 'coach_personal' ? 'Your Zoom' : 'Shared Pool'}
                    {' · '}
                    {selectedTimezone.split('/')[1]?.replace(/_/g, ' ')} time
                  </Text>
                </View>

                {/* Create Button */}
                <TouchableOpacity
                  style={s.createBtn}
                  onPress={handleCreateSlots}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={BG} />
                  ) : (
                    <Text style={s.createBtnText}>
                      {selectedDays.length > 1
                        ? `Create ${selectedDays.length} Recurring Slots`
                        : 'Create Recurring Slot'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1.5,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
  },
  headerInfo: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  archivedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,85,104,0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  archivedBadgeText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  qaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
  },
  qaBtnRestore: {
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderColor: 'rgba(110,187,122,0.25)',
  },
  qaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.5,
    fontFamily: FH,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '47%',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
    position: 'relative',
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FH,
  },
  tileSublabel: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },
  comingSoonBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(42,51,71,0.9)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: BORDER,
  },
  comingSoonText: {
    fontSize: 9,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FB,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Schedule Modal Styles ──────────────────────────────────────────────
  schedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  schedSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  schedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  schedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  schedSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  schedSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 14,
  },
  fieldHint: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 8,
    marginTop: -4,
  },
  dayRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  dayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: '#A78BFA',
  },
  dayBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  dayBtnTextActive: {
    color: '#A78BFA',
  },

  // ── Phase buttons (taller, with week count) ───────────────────────────
  phaseBtn: {
    flex: 1,
    minWidth: 90,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    gap: 2,
  },
  phaseBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  phaseBtnWeeks: {
    fontSize: 10,
    fontWeight: '500',
    color: MUTED,
    fontFamily: FB,
  },
  phaseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  overrideLink: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },

  // ── Room source indicator ─────────────────────────────────────────────
  roomSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  roomSourceText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
  },

  // ── Multi-day time rows ───────────────────────────────────────────────
  dayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  dayTimeLabel: {
    width: 80,
  },
  dayTimeDayText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  dayTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dayTimeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
    fontFamily: FB,
  },
  dayTimeEnd: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  timePickerWrap: {
    marginTop: 8,
    backgroundColor: BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  timePickerTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  selectBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  timeList: {
    maxHeight: 180,
    backgroundColor: BG,
  },
  timeOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timeOptionActive: {
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  timeOptionText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.3)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  slotDay: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 2,
  },
  slotActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  slotActionText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  summaryCard: {
    backgroundColor: 'rgba(167,139,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    textAlign: 'center',
  },
  summaryDays: {
    fontSize: 12,
    fontWeight: '500',
    color: '#A78BFA',
    fontFamily: FB,
    marginTop: 4,
    textAlign: 'center',
  },
  summaryMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 4,
  },
  createBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: BG,
    fontFamily: FH,
  },

  // ── Coach Joining Toggle ──────────────────────────────────────────────
  coachToggleRow: {
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(138,149,163,0.3)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: {
    backgroundColor: 'rgba(110,187,122,0.4)',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: MUTED,
  },
  toggleThumbOn: {
    backgroundColor: GREEN,
    alignSelf: 'flex-end',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  toggleHint: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginTop: 2,
  },

  // ── Phase Timeline ────────────────────────────────────────────────────
  timelineWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  editPlanBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  timelineBar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  timelineSegment: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 28,
  },
  timelineSegText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FB,
  },
  timelineLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: MUTED,
    fontFamily: FB,
  },
});
