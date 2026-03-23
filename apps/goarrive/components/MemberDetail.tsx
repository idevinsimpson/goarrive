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
 *   - Schedule (assign recurring time slot)
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
import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { db, functions } from '../lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Icon } from './Icon';
import { router } from 'expo-router';
import { DAY_LABELS, DAY_SHORT_LABELS, formatTime, type GuidancePhase, type SessionType, type RoomSource } from '../lib/schedulingTypes';

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

const DURATION_OPTIONS = [30, 45, 60, 90];

const TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
];

export default function MemberDetail({
  member,
  onClose,
  onEdit,
  onArchive,
}: MemberDetailProps) {
  const [currentMember, setCurrentMember] = useState(member);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [existingSlots, setExistingSlots] = useState<any[]>([]);

  // Schedule form state
  const [selectedDay, setSelectedDay] = useState(1); // Monday
  const [selectedTime, setSelectedTime] = useState('06:00');
  const [selectedDuration, setSelectedDuration] = useState(30);
  const [selectedTimezone, setSelectedTimezone] = useState('America/New_York');
  const [selectedPattern, setSelectedPattern] = useState<'weekly' | 'biweekly'>('weekly');
  const [selectedSessionType, setSelectedSessionType] = useState<SessionType>('strength');
  const [selectedPhase, setSelectedPhase] = useState<GuidancePhase>('coach_guided');
  const [coachJoining, setCoachJoining] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showTimeSelect, setShowTimeSelect] = useState(false);

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

  const handleCreateSlot = useCallback(async () => {
    setCreating(true);
    try {
      const fn = httpsCallable(functions, 'createRecurringSlot');
      // Determine room source based on guidance phase
      let roomSource: RoomSource = 'coach_personal';
      if (selectedPhase === 'self_guided') roomSource = 'shared_pool';
      else if (selectedPhase === 'shared_guidance') roomSource = coachJoining ? 'coach_personal' : 'shared_pool';

      const result = await fn({
        memberId: member.id,
        memberName: currentMember.name || 'Unknown',
        dayOfWeek: selectedDay,
        startTime: selectedTime,
        durationMinutes: selectedDuration,
        timezone: selectedTimezone,
        recurrencePattern: selectedPattern,
        sessionType: selectedSessionType,
        guidancePhase: selectedPhase,
        roomSource,
        coachJoining: selectedPhase === 'shared_guidance' ? coachJoining : selectedPhase === 'coach_guided',
      });
      const data = result.data as any;
      Alert.alert(
        'Slot Created',
        `Recurring ${DAY_LABELS[selectedDay]} ${formatTime(selectedTime)} slot created.\n${data.instancesGenerated} sessions generated for the next 4 weeks.`
      );
      setShowScheduleModal(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create slot');
    }
    setCreating(false);
  }, [member.id, currentMember.name, selectedDay, selectedTime, selectedDuration, selectedTimezone, selectedPattern, selectedSessionType, selectedPhase, coachJoining]);

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
                  {activeSlots.length > 0 ? 'Add Another Slot' : 'Create Recurring Slot'}
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

                {/* Guidance Phase */}
                <Text style={s.fieldLabel}>Guidance Phase</Text>
                <View style={s.dayRow}>
                  {[
                    { key: 'coach_guided' as GuidancePhase, label: 'Coach Guided', color: GREEN },
                    { key: 'shared_guidance' as GuidancePhase, label: 'Shared Guidance', color: GOLD },
                    { key: 'self_guided' as GuidancePhase, label: 'Self Guided', color: '#7DD3FC' },
                  ].map(phase => (
                    <TouchableOpacity
                      key={phase.key}
                      style={[
                        s.dayBtn,
                        selectedPhase === phase.key && { backgroundColor: phase.color + '18', borderColor: phase.color + '60' },
                        { minWidth: 95 },
                      ]}
                      onPress={() => {
                        setSelectedPhase(phase.key);
                        if (phase.key === 'coach_guided') setCoachJoining(true);
                        if (phase.key === 'self_guided') setCoachJoining(false);
                      }}
                    >
                      <Text style={[
                        s.dayBtnText,
                        selectedPhase === phase.key && { color: phase.color },
                        { fontSize: 12 },
                      ]}>
                        {phase.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
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

                {/* Day of Week */}
                <Text style={s.fieldLabel}>Day of Week</Text>
                <View style={s.dayRow}>
                  {DAY_SHORT_LABELS.map((label, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[s.dayBtn, selectedDay === idx && s.dayBtnActive]}
                      onPress={() => setSelectedDay(idx)}
                    >
                      <Text style={[s.dayBtnText, selectedDay === idx && s.dayBtnTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Start Time */}
                <Text style={s.fieldLabel}>Start Time</Text>
                <TouchableOpacity
                  style={s.selectBtn}
                  onPress={() => setShowTimeSelect(!showTimeSelect)}
                >
                  <Text style={s.selectBtnText}>{formatTime(selectedTime)}</Text>
                  <Icon name="chevron-down" size={16} color={MUTED} />
                </TouchableOpacity>
                {showTimeSelect && (
                  <ScrollView style={s.timeList} nestedScrollEnabled>
                    {TIME_OPTIONS.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[s.timeOption, selectedTime === t && s.timeOptionActive]}
                        onPress={() => { setSelectedTime(t); setShowTimeSelect(false); }}
                      >
                        <Text style={[s.timeOptionText, selectedTime === t && { color: GOLD }]}>
                          {formatTime(t)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Duration */}
                <Text style={s.fieldLabel}>Duration</Text>
                <View style={s.dayRow}>
                  {DURATION_OPTIONS.map(d => (
                    <TouchableOpacity
                      key={d}
                      style={[s.dayBtn, selectedDuration === d && s.dayBtnActive, { minWidth: 60 }]}
                      onPress={() => setSelectedDuration(d)}
                    >
                      <Text style={[s.dayBtnText, selectedDuration === d && s.dayBtnTextActive]}>
                        {d}m
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Pattern */}
                <Text style={s.fieldLabel}>Recurrence</Text>
                <View style={s.dayRow}>
                  <TouchableOpacity
                    style={[s.dayBtn, selectedPattern === 'weekly' && s.dayBtnActive, { minWidth: 80 }]}
                    onPress={() => setSelectedPattern('weekly')}
                  >
                    <Text style={[s.dayBtnText, selectedPattern === 'weekly' && s.dayBtnTextActive]}>
                      Weekly
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.dayBtn, selectedPattern === 'biweekly' && s.dayBtnActive, { minWidth: 80 }]}
                    onPress={() => setSelectedPattern('biweekly')}
                  >
                    <Text style={[s.dayBtnText, selectedPattern === 'biweekly' && s.dayBtnTextActive]}>
                      Biweekly
                    </Text>
                  </TouchableOpacity>
                </View>

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
                    {DAY_LABELS[selectedDay]}s at {formatTime(selectedTime)} for {selectedDuration} min, {selectedPattern}
                  </Text>
                  <Text style={s.summaryMeta}>
                    {selectedSessionType === 'check_in' ? 'Check-in' : selectedSessionType.charAt(0).toUpperCase() + selectedSessionType.slice(1)}
                    {' · '}
                    {selectedPhase === 'coach_guided' ? 'Coach Guided' : selectedPhase === 'shared_guidance' ? (coachJoining ? 'Shared Guidance (you join)' : 'Shared Guidance (on their own)') : 'Self Guided'}
                  </Text>
                  <Text style={s.summaryMeta}>
                    {selectedTimezone.split('/')[1]?.replace(/_/g, ' ')} time
                  </Text>
                </View>

                {/* Create Button */}
                <TouchableOpacity
                  style={s.createBtn}
                  onPress={handleCreateSlot}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={BG} />
                  ) : (
                    <Text style={s.createBtnText}>Create Recurring Slot</Text>
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 4,
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
});
